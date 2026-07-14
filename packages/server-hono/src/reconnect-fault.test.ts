// 🔬 DD-015 Phase 2 実 WS 統合テスト（fault matrix C1/C8/C9・AC2/3/4/5）: 実 WebSocket サーバー＋ws-transport＋ClientSession で
// 切断→（offline 編集）→再接続→reconcile→収束を製品保証として固定する。synthetic 契約（packages/collab の reconcile 単体）を
// 実ソケット経路（join.pending 送信・welcome.reconcile 受信・bootstrap 再取得・server 再起動）で end-to-end 検証する。
//
// 待機は静止点待ち（pending 空・target revision 到達・全 hash 一致を明示 await）＝乱数/固定 sleep を使わない（要確認④方式）。
// 切断は WsClientTransport.dropForTest/resumeAfterDrop でタブ生存のまま決定論的に注入する（実ネットワーク断のシミュレート）。

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDocumentId } from '@nanairo-sheet/types';
import { ClientSession, createCounterIdGenerator } from '@nanairo-sheet/collab';
import { COLUMNS, row, setCells, str } from '@nanairo-sheet/collab/test-support';

import { WsClientTransport } from './test-support';
import { startServer } from './server';
import type { RunningServer } from './server';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitFor(predicate: () => boolean, label: string, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timeout: ${label}`);
    }
    await delay(10);
  }
}

interface Client {
  session: ClientSession;
  transport: WsClientTransport;
}

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

function createClient(wsUrl: string, clientId: string): Client {
  const transport = new WsClientTransport(wsUrl, {
    autoReconnect: true,
    reconnectDelayMillis: 100, // 高速再接続（テスト時間短縮・server 再起動待ち）
    maxReconnectDelayMillis: 500,
  });
  const session = new ClientSession({
    clientId,
    userId: `user-${clientId}`,
    displayName: clientId,
    documentId: createDocumentId('demo-doc'),
    columnOrder: COLUMNS,
    transport,
    clock: { now: () => Date.now() },
    idGenerator: createCounterIdGenerator(`${clientId}-op`),
    catchupPollMillis: 150,
    maxOfflineMillis: 120_000, // テスト中の offline 上限に達しない（stopped 化を避ける）
  });
  session.start();
  cleanups.push(() => {
    transport.close();
  });
  return { session, transport };
}

function startTicks(sessions: ClientSession[]): () => void {
  const timer = setInterval(() => {
    for (const s of sessions) {
      s.tick();
    }
  }, 25);
  cleanups.push(() => clearInterval(timer));
  return () => clearInterval(timer);
}

/** count 件を有界バッチで submit し、各バッチ後に pending 空へ収束させる（O(N²) pending 山積みを避ける・静止点待ち）。 */
async function submitBatched(
  session: ClientSession,
  make: (i: number) => Parameters<ClientSession['submitLocalOperation']>[0],
  count: number,
  batch = 100,
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    session.submitLocalOperation(make(i));
    if ((i + 1) % batch === 0) {
      await waitFor(() => session.pendingCount === 0, `batch drain at ${i + 1}`);
    }
  }
  await waitFor(() => session.pendingCount === 0, 'final batch drain');
}

describe('DD-015 reconnect-fault（実 WS・fault matrix C1/C8/C9）', () => {
  it('WS-R1 (C1): 異常切断→offline 編集→再接続 reconcile で未処理再送→全 hash 収束・喪失0・二重適用0', async () => {
    const server: RunningServer = await startServer({ port: 0, seedRows: 3 });
    cleanups.push(() => server.close());
    const wsUrl = `ws://127.0.0.1:${server.port}/ws`;

    const a = createClient(wsUrl, 'client-a');
    const b = createClient(wsUrl, 'client-b');
    startTicks([a.session, b.session]);
    await waitFor(() => [a, b].every((c) => c.session.isOnline && c.session.committedDocument.revision >= 1), 'A/B online+seeded');

    // A がオンラインで 2 件 → 収束
    a.session.submitLocalOperation(setCells([{ rowId: row('row-1'), columnId: COLUMNS[0], value: str('a-online-1') }]));
    a.session.submitLocalOperation(setCells([{ rowId: row('row-2'), columnId: COLUMNS[1], value: str('a-online-2') }]));
    await waitFor(() => a.session.pendingCount === 0 && a.session.committedHash() === server.hash(), 'A converges online');

    // 異常切断（タブ生存・pending 保持）→ offline で 2 件編集（未送信 pending）
    a.transport.dropForTest();
    await waitFor(() => !a.session.isOnline, 'A offline');
    a.session.submitLocalOperation(setCells([{ rowId: row('row-1'), columnId: COLUMNS[2], value: str('a-offline-1') }]));
    a.session.submitLocalOperation(setCells([{ rowId: row('row-3'), columnId: COLUMNS[0], value: str('a-offline-2') }]));
    expect(a.session.pendingCount).toBe(2); // offline ゆえ pending 保持

    // 再接続 → join.pending で reconcile（未処理判定→再送）→ 収束
    a.transport.resumeAfterDrop();
    await waitFor(
      () => [a, b].every((c) => c.session.isOnline && c.session.pendingCount === 0 && c.session.committedHash() === server.hash()),
      'A/B converge after reconnect',
    );

    // 収束・二重適用0（revision 一致）・offline 編集が反映・conflict なし
    for (const c of [a, b]) {
      expect(c.session.committedHash()).toBe(server.hash());
      expect(c.session.committedDocument.revision).toBe(server.snapshot().currentRevision);
      expect(c.session.conflictQueue).toHaveLength(0);
    }
    // offline 編集値が committed に反映（喪失0）
    const doc = a.session.committedDocument;
    const { getCell } = await import('@nanairo-sheet/core');
    expect(getCell(doc, row('row-1'), COLUMNS[2])?.value).toEqual(str('a-offline-1'));
    expect(getCell(doc, row('row-3'), COLUMNS[0])?.value).toEqual(str('a-offline-2'));
  });

  it('WS-R4 (C8): 切断中に他者が >1000 op → 再接続で snapshot 再取得（bootstrap）＝全 tail replay しない・収束', async () => {
    const server: RunningServer = await startServer({ port: 0, seedRows: 3 });
    cleanups.push(() => server.close());
    const wsUrl = `ws://127.0.0.1:${server.port}/ws`;

    const a = createClient(wsUrl, 'client-a');
    const b = createClient(wsUrl, 'client-b');
    startTicks([a.session, b.session]);
    await waitFor(() => [a, b].every((c) => c.session.isOnline && c.session.committedDocument.revision >= 1), 'A/B online+seeded');

    a.session.submitLocalOperation(setCells([{ rowId: row('row-1'), columnId: COLUMNS[0], value: str('a-1') }]));
    await waitFor(() => a.session.pendingCount === 0 && a.session.committedHash() === server.hash(), 'A converges');

    // A を切断（offline）→ B が 1001 op を投入（server frontier を >1000 前進）
    a.transport.dropForTest();
    await waitFor(() => !a.session.isOnline, 'A offline');
    const appliedBeforeReconnect = a.session.appliedServerOpCount;
    const bootstrapRevBefore = a.session.bootstrapRevision ?? 0;

    await submitBatched(b.session, (i) => setCells([{ rowId: row(`row-${(i % 3) + 1}`), columnId: COLUMNS[i % 3], value: str(`b-${i}`) }]), 1001);
    await waitFor(() => b.session.pendingCount === 0 && b.session.committedHash() === server.hash(), 'B converges after 1001 ops');
    const frontier = server.snapshot().currentRevision;
    expect(frontier).toBeGreaterThan(a.session.committedDocument.revision + 1000); // 差分 > T

    // A が offline で 1 件編集 → 再接続 → 差分>T ゆえ bootstrap 再取得（tail 1001 を replay しない）
    a.session.submitLocalOperation(setCells([{ rowId: row('row-2'), columnId: COLUMNS[2], value: str('a-offline-after-flood') }]));
    a.transport.resumeAfterDrop();
    await waitFor(
      () => a.session.isOnline && a.session.pendingCount === 0 && a.session.committedHash() === server.hash(),
      'A converges via bootstrap re-fetch',
    );

    // snapshot 再取得の実証: bootstrapRevision が frontier 相当へ更新・適用サーバー op 数は 1001 ではなく少数（tail replay 非依存）
    expect(a.session.bootstrapRevision ?? 0).toBeGreaterThan(bootstrapRevBefore);
    const appliedDelta = a.session.appliedServerOpCount - appliedBeforeReconnect;
    expect(appliedDelta).toBeLessThan(100); // 1001 の tail を replay していない（bootstrap で飛んだ）
    expect(a.session.committedHash()).toBe(server.hash());
    expect(a.session.conflictQueue).toHaveLength(0);
    // A の offline 編集も反映（喪失0）
    const { getCell } = await import('@nanairo-sheet/core');
    expect(getCell(a.session.committedDocument, row('row-2'), COLUMNS[2])?.value).toEqual(str('a-offline-after-flood'));
  });

  it('WS-R5 (C9): server 再起動（永続化）を挟む再接続でも reconcile で idempotent・revision 連続・収束', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dd015-restart-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));

    const server1: RunningServer = await startServer({ port: 0, seedRows: 3, persistenceDir: dir });
    const port = server1.port;
    const wsUrl = `ws://127.0.0.1:${port}/ws`;

    const a = createClient(wsUrl, 'client-a');
    const b = createClient(wsUrl, 'client-b');
    startTicks([a.session, b.session]);
    await waitFor(() => [a, b].every((c) => c.session.isOnline && c.session.committedDocument.revision >= 1), 'A/B online+seeded');

    // durable に数十 op 投入 → 収束
    await submitBatched(a.session, (i) => setCells([{ rowId: row(`row-${(i % 3) + 1}`), columnId: COLUMNS[i % 3], value: str(`pre-${i}`) }]), 40);
    await waitFor(() => [a, b].every((c) => c.session.pendingCount === 0 && c.session.committedHash() === server1.hash()), 'A/B converge pre-restart');
    const revBefore = server1.snapshot().currentRevision;

    // A を切断 → offline 編集（未送信 pending）→ その間に server を停止
    a.transport.dropForTest();
    await waitFor(() => !a.session.isOnline, 'A offline');
    a.session.submitLocalOperation(setCells([{ rowId: row('row-1'), columnId: COLUMNS[2], value: str('a-offline-across-restart') }]));

    // server 停止（B の socket も落ちる → B は指数バックオフ再接続へ）→ 同一 persistenceDir で再起動（snapshot＋tail 復旧）
    await server1.close();
    const server2: RunningServer = await startServer({ port, seedRows: 3, persistenceDir: dir });
    cleanups.push(() => server2.close());
    expect(server2.snapshot().currentRevision).toBe(revBefore); // 復旧 revision 継続（巻き戻りなし＝divergence 回避）

    // A を再接続 → B は autoReconnect → 全員 server2 で収束
    a.transport.resumeAfterDrop();
    await waitFor(
      () => [a, b].every((c) => c.session.isOnline && c.session.pendingCount === 0 && c.session.committedHash() === server2.hash()),
      'A/B converge on restarted server',
    );

    // revision 連続（A の offline op が 1 回だけ確定＝二重適用0・喪失0）・divergence イベントなし
    expect(server2.snapshot().currentRevision).toBe(revBefore + 1);
    for (const c of [a, b]) {
      expect(c.session.committedHash()).toBe(server2.hash());
      expect(c.session.committedDocument.revision).toBe(revBefore + 1);
      expect(c.session.isStopped).toBe(false); // divergence fail-fast は発火しない（正常復旧）
      expect(c.session.conflictQueue).toHaveLength(0);
    }
    const { getCell } = await import('@nanairo-sheet/core');
    expect(getCell(a.session.committedDocument, row('row-1'), COLUMNS[2])?.value).toEqual(str('a-offline-across-restart'));
  });
});
