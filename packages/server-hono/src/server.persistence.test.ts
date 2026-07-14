// 🔬 DD-014 Phase 3/4 機械検証: 実 WS サーバー＋ファイル永続化での再起動復旧・durable ACK 非喪失。
//   AC1 durable ACK: 編集→ACK 受領→サーバー close→同一 persistenceDir で再起動→ ACK 済み値が復元される。
//   AC7 再起動復旧手順: 新プロセス相当（新 startServer インスタンス）が snapshot＋tail から復旧し hash 継続。
//   AC8 相当（サーバー側）: 再接続クライアントが復元済み文書を受け取る（/snapshot・welcome revision）。
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDocumentId } from '@nanairo-sheet/types';
import { ClientSession, createCounterIdGenerator } from '@nanairo-sheet/collab';
import { COLUMNS, col, row, setCells, str } from '@nanairo-sheet/collab/test-support';

import { WsClientTransport } from './test-support';
import { startServer } from './server';
import type { RunningServer } from './server';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitFor(predicate: () => boolean, label: string, timeoutMs = 4_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timeout: ${label}`);
    }
    await delay(10);
  }
}

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

function createClient(wsUrl: string, clientId: string) {
  const transport = new WsClientTransport(wsUrl, { autoReconnect: false });
  const session = new ClientSession({
    clientId,
    userId: `u-${clientId}`,
    displayName: clientId,
    documentId: createDocumentId('demo-doc'),
    columnOrder: COLUMNS,
    transport,
    clock: { now: () => Date.now() },
    idGenerator: createCounterIdGenerator(`${clientId}-op`),
  });
  session.start();
  return { session, transport };
}

describe('server persistence — 再起動復旧・durable ACK（DD-014）', () => {
  it('編集→ACK→close→同一 dir で再起動で ACK 済み値が復元される（AC1/AC7）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'persist-e2e-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));

    // --- 起動 1: seed + 編集 + ACK 受領を確認してから close ---
    const server1: RunningServer = await startServer({
      port: 0,
      seedRows: 3,
      persistenceDir: dir,
    });
    const wsUrl1 = `ws://127.0.0.1:${server1.port}/ws`;
    const a = createClient(wsUrl1, 'client-a');
    await waitFor(() => a.session.isOnline && a.session.committedDocument.revision >= 1, 'client online + seeded (1)');

    a.session.submitLocalOperation(setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('DURABLE') }]));
    // ACK 受領＝pending 0 まで待つ（durable ACK ゆえ fsync 済み＝再起動後も残る契約）。
    await waitFor(() => a.session.pendingCount === 0 && a.session.committedHash() === server1.hash(), 'op acked (1)');
    const hashAfterEdit = server1.hash();
    const revisionAfterEdit = server1.snapshot().currentRevision;

    a.transport.close();
    await waitFor(() => server1.connectionCount() === 0, 'client disconnected (1)');
    await server1.close(); // graceful: 保留 durable 書込を確定してハンドルを閉じる

    // --- 起動 2: 同一 dir から復旧（seed しない・snapshot＋tail から復元） ---
    const server2: RunningServer = await startServer({
      port: 0,
      seedRows: 3, // 復旧が優先されるため seed は使われない
      persistenceDir: dir,
    });
    cleanups.push(() => server2.close());
    expect(server2.recovery?.totalOps).toBeGreaterThanOrEqual(2); // seed(1) + edit(1)
    // 復旧後の権威 hash・revision が編集後と一致（ACK 済み値の非喪失）。
    expect(server2.hash()).toBe(hashAfterEdit);
    expect(server2.snapshot().currentRevision).toBe(revisionAfterEdit);

    // 再接続クライアントが復元済み文書（DURABLE 値）を受け取る。
    const wsUrl2 = `ws://127.0.0.1:${server2.port}/ws`;
    const b = createClient(wsUrl2, 'client-b');
    await waitFor(
      () => b.session.isOnline && b.session.committedHash() === server2.hash() && b.session.committedDocument.revision === revisionAfterEdit,
      'reconnect client restored',
    );
    b.transport.close();
    await waitFor(() => server2.connectionCount() === 0, 'client disconnected (2)');
  });

  it('snapshot 生成後の再起動は snapshot＋tail から復旧する（O(tail)・AC3/AC5）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'persist-snap-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));

    // snapshotIntervalOps=2 で早めに snapshot 生成。
    const server1 = await startServer({ port: 0, seedRows: 2, persistenceDir: dir, snapshotIntervalOps: 2 });
    const a = createClient(`ws://127.0.0.1:${server1.port}/ws`, 'client-a');
    await waitFor(() => a.session.isOnline && a.session.committedDocument.revision >= 1, 'online + seeded');

    // 数 op 流して snapshot を跨がせ、tail も残す。
    for (let i = 0; i < 5; i += 1) {
      a.session.submitLocalOperation(setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str(`v${i}`) }]));
      await waitFor(() => a.session.pendingCount === 0, `op ${i} acked`);
    }
    const finalHash = server1.hash();
    a.transport.close();
    await waitFor(() => server1.connectionCount() === 0, 'disconnected');
    await delay(50); // 非同期 snapshot 生成の完了余地
    await server1.close();

    const server2 = await startServer({ port: 0, seedRows: 2, persistenceDir: dir, snapshotIntervalOps: 2 });
    cleanups.push(() => server2.close());
    expect(server2.hash()).toBe(finalHash);
    // snapshot から復旧していれば fromSnapshotRevision が設定される（tail は全 op 未満）。
    expect(server2.recovery?.fromSnapshotRevision).toBeGreaterThanOrEqual(1);
    expect(server2.recovery?.tailReplayed).toBeLessThan(server2.recovery?.totalOps ?? 0);
  });
});

describe('serve documentId × persistenceDir fail-fast（DD-018-1）', () => {
  it('AC1: 使用済み persistenceDir を別 documentId で起動すると fail-fast（A の内容を B として公開しない）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ff-docid-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));

    // documentId 'doc-A' で seed を durable 化して close（クライアント不要＝seed が oplog に入る）。
    const serverA = await startServer({ port: 0, seedRows: 3, documentId: 'doc-A', persistenceDir: dir });
    expect(serverA.documentId).toBe('doc-A');
    await serverA.close();

    // 同じ dir を documentId 'doc-B' で再利用 → recovery が persisted documentId 'doc-A' と照合し起動拒否。
    await expect(
      startServer({ port: 0, seedRows: 3, documentId: 'doc-B', persistenceDir: dir }),
    ).rejects.toThrow(/documentId 不一致/);

    // AC2: 同一 documentId 'doc-A' なら従来どおり復旧できる（過剰拒否しない）。
    const serverA2 = await startServer({ port: 0, seedRows: 3, documentId: 'doc-A', persistenceDir: dir });
    cleanups.push(() => serverA2.close());
    expect(serverA2.documentId).toBe('doc-A');
    expect(serverA2.recovery?.totalOps).toBeGreaterThanOrEqual(1);
  });

  it('AC3: restoreFrom と persistenceDir の併用は fail-fast（revision 不連続を防ぐ・P2-4）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ff-restore-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));

    // restoreFrom 用の in-memory snapshot を用意（永続化なしのサーバーから取得）。
    const src = await startServer({ port: 0, seedRows: 2 });
    const snap = src.snapshot();
    await src.close();

    await expect(
      startServer({ port: 0, restoreFrom: snap, persistenceDir: dir }),
    ).rejects.toThrow(/restoreFrom と persistenceDir は併用できません/);
  });
});
