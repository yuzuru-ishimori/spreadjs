// 🔬 Phase 5 実 WS 縮小スモーク（S-M5・AC1・Q-5 裁定）: 実 WebSocket サーバー（ランダムポート）＋ ws-transport 経由の
// ClientSession 3 体で 1,000 件の SetCells を流し、静止点で全 committed hash がサーバー hash と一致することを確認する。
// フォールト注入はしない（実 WS はタイミング非決定ゆえシード再現性が壊れる＝疎通と収束のみを確認。10,000 件の
// フォールト収束は in-process 決定論試験〔convergence.test〕が担う）。待機はイベント駆動ポーリング（乱数不使用）。
// testTimeout を延長し、後始末（close await・vitest 自然終了）でリーク無し。

import { afterEach, describe, expect, it } from 'vitest';

import { createDocumentId } from '@nanairo-sheet/sheet-types';

import { createCounterIdGenerator } from '../src/client-session/deps';
import { ClientSession } from '../src/client-session/session';
import { COLUMNS, row, setCells, str } from '../src/client-session/test-support';
import { WsClientTransport } from '../src/client-session/ws-transport';
import { startServer } from '../src/server';
import type { RunningServer } from '../src/server';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timeout: ${label}`);
    }
    await delay(15);
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
    clock: { now: () => Date.now() }, // アダプター層＝実クロック
    idGenerator: createCounterIdGenerator(`${clientId}-op`),
    catchupPollMillis: 200,
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

describe('ws-convergence.smoke — 実 WS ＋ ClientSession 3 体 × 1,000 件 SetCells', () => {
  it(
    '静止点で全 committed hash がサーバー hash と一致・二重適用0・pending 0',
    async () => {
      const server: RunningServer = await startServer({ port: 0, seedRows: 5 });
      cleanups.push(() => server.close());
      const wsUrl = `ws://127.0.0.1:${server.port}/ws`;

      const clients = [createClient(wsUrl, 'client-a'), createClient(wsUrl, 'client-b'), createClient(wsUrl, 'client-c')];
      const sessions = clients.map((c) => c.session);

      await waitFor(
        () => sessions.every((s) => s.isOnline && s.committedDocument.revision >= 1),
        'all clients online + seeded',
      );

      // 実クロックの tick 駆動（周期 catch-up ポーリングでテール到達を担保。乱数不使用）。
      const tickTimer = setInterval(() => {
        for (const s of sessions) {
          s.tick();
        }
      }, 30);
      cleanups.push(() => {
        clearInterval(tickTimer);
      });

      // **各クライアントが 1,000 件ずつ** SetCells を送信（Q-5/S-M5「3 Client×1,000件」＝計 3,000 件）。
      // seed 行 row-1..row-5 × col-a/b/c・beforeRevision 無し＝last-write-wins で全件受理。実 WS は TCP 順序保証
      // ゆえ各接続の clientSequence 順に届き violation は起きない（クライアント単位の高 clientSequence を検証）。
      const opsPerClient = 1_000;
      for (let i = 0; i < opsPerClient; i += 1) {
        for (let c = 0; c < sessions.length; c += 1) {
          const targetRow = row(`row-${(i % 5) + 1}`);
          const targetCol = COLUMNS[(i + c) % COLUMNS.length];
          sessions[c].submitLocalOperation(setCells([{ rowId: targetRow, columnId: targetCol, value: str(`v${c}-${i}`) }]));
        }
      }
      const totalOps = opsPerClient * sessions.length; // 3,000

      // 静止点: 全 committed hash がサーバー hash と一致・pending 0（＝二重適用0）まで待つ。
      await waitFor(
        () => sessions.every((s) => s.pendingCount === 0 && s.committedHash() === server.hash()),
        'all committed hashes converge after 3000 ops',
        40_000,
      );

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
