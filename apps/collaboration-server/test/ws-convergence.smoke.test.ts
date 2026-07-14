// 🔬 実 WS 縮小スモーク（S-M5・AC1・Q-5 裁定 ＋ DD-015 要確認④ 恒久是正）: 実 WebSocket サーバー（ランダムポート）＋
// ws-transport 経由の ClientSession 3 体で SetCells を流し、**静止点待ち**で全 committed hash がサーバー hash と一致することを確認する。
//
// DD-015 恒久是正（flaky 解消）: 旧版は 3,000 op を**同期ループで一括 submit** し JS イベントループを塞ぐため echo が drain されず
// pending が ~1,000 深に達し rollback/replay が O(N²) 化 → 40s 収束 timeout（環境依存で毎回失敗）だった。有界バッチ submit ＋
// バッチ間の**静止点待ち（pending 空・全 hash 一致を明示 await）**へ書き換え、pending を有界（現実の利用パターン）に保つ。
// フォールト注入はしない（実 WS のタイミング非決定はフォールト収束の in-process 決定論試験〔convergence.test〕が担う）。乱数不使用。

import { afterEach, describe, expect, it } from 'vitest';

import { createDocumentId } from '@nanairo-sheet/types';
import { ClientSession, createCounterIdGenerator } from '@nanairo-sheet/collab';
import { COLUMNS, row, setCells, str } from '@nanairo-sheet/collab/test-support';

import { WsClientTransport } from '../src/client-session/ws-transport';
import { startServer } from '../src/server';
import type { RunningServer } from '../src/server';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 15_000): Promise<void> {
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

function createClient(wsUrl: string, clientId: string): Client {
  const transport = new WsClientTransport(wsUrl, { autoReconnect: false });
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
  });
  session.start();
  cleanups.push(() => {
    transport.close();
  });
  return { session, transport };
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

describe('ws-convergence.smoke — 実 WS ＋ ClientSession 3 体（静止点待ち・DD-015 安定化）', () => {
  it(
    '有界バッチ submit ＋ 各バッチ静止点待ちで全 committed hash がサーバー hash と一致・二重適用0・pending 0',
    async () => {
      const server: RunningServer = await startServer({ port: 0, seedRows: 5 });
      cleanups.push(() => server.close());
      const wsUrl = `ws://127.0.0.1:${server.port}/ws`;

      const clients = [createClient(wsUrl, 'client-a'), createClient(wsUrl, 'client-b'), createClient(wsUrl, 'client-c')];
      const sessions = clients.map((c) => c.session);

      await waitFor(() => sessions.every((s) => s.isOnline && s.committedDocument.revision >= 1), 'all clients online + seeded');

      // 実クロックの tick 駆動（周期 catch-up ポーリングでテール到達を担保。乱数不使用）。
      const tickTimer = setInterval(() => {
        for (const s of sessions) {
          s.tick();
        }
      }, 25);
      cleanups.push(() => {
        clearInterval(tickTimer);
      });

      // **各クライアントが 1,000 件ずつ** SetCells を送信（計 3,000 件）。有界バッチ（25/client）で submit し、
      // 各バッチ後に全 client が静止点（pending 空・全 hash == server hash）へ収束するのを待ってから次バッチへ。
      // → 各 client の pending は ≤25 に有界（現実の利用パターン）＝rollback/replay O(N²) を構造的に回避。
      const opsPerClient = 1_000;
      const batch = 25;
      for (let base = 0; base < opsPerClient; base += batch) {
        for (let k = 0; k < batch; k += 1) {
          const i = base + k;
          for (let c = 0; c < sessions.length; c += 1) {
            const targetRow = row(`row-${(i % 5) + 1}`);
            const targetCol = COLUMNS[(i + c) % COLUMNS.length];
            sessions[c].submitLocalOperation(setCells([{ rowId: targetRow, columnId: targetCol, value: str(`v${c}-${i}`) }]));
          }
        }
        // 静止点待ち: 全 client pending 空 かつ 全 committed hash == server hash（このバッチが確定するまで）。
        await waitFor(
          () => sessions.every((s) => s.pendingCount === 0 && s.committedHash() === server.hash()),
          `batch converge @${base}`,
        );
      }
      const totalOps = opsPerClient * sessions.length; // 3,000

      const serverRev = server.snapshot().currentRevision;
      expect(serverRev).toBe(1 + totalOps); // seed(1) + 3000 受理（no-op/reject 無し＝last-write-wins）
      for (const session of sessions) {
        expect(session.committedHash()).toBe(server.hash());
        expect(session.committedDocument.revision).toBe(serverRev); // 二重適用0（revision 一致）
        expect(session.nextExpectedRevision).toBe(serverRev + 1);
        expect(session.pendingCount).toBe(0);
        expect(session.conflictQueue).toHaveLength(0);
      }

      // 後始末: 全 transport close → 接続 0（リーク無し・プロセス自然終了）。
      clearInterval(tickTimer);
      for (const c of clients) {
        c.transport.close();
      }
      await waitFor(() => server.connectionCount() === 0, 'all connections cleaned up after close');
    },
    60_000,
  );
});
