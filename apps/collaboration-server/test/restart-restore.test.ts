// 🔬 Phase 5 復元試験（AC5・S-K1〜K4・D18・実 WS）: 実サーバー起動 → クライアント数体が数百 op 適用 →
// サーバー停止（close）→ exportSnapshot（document+log+revision+ackCache+clientSequenceTable）→ 新インスタンスへ
// import して**同一ポートで復元起動** → クライアントが同一 clientId で再接続 → catch-up → 全 hash 一致（AC5）・
// 復元後の新規 op で revision 継続（S-K4）・**再接続クライアントの clientSequence 継続**（復元済み clientSequenceTable
// で violation にならず受理＝D18）を確認する。
// 注: **D17（un-ACK pending の再送を復元済み ackCache が冪等救済）は ACK 欠落を要するため実 WS〔TCP 順序・非欠落〕
//   では自然発生しない**。ackCache の冪等救済は snapshot.test（単体・no-op 再送も duplicate／ackCache 欠落の反例）と
//   in-process 収束試験で検証済み（Codex [P2] 指摘の実 WS 未カバーを本注記で明示）。
// 待機はイベント駆動ポーリング（乱数不使用）。testTimeout 延長・後始末でリーク無し。

import { afterEach, describe, expect, it } from 'vitest';

import { verifySnapshotIntegrity } from '@nanairo-sheet/sheet-server-core';
import { createDocumentId } from '@nanairo-sheet/sheet-types';

import { createCounterIdGenerator } from '../src/client-session/deps';
import { ClientSession } from '../src/client-session/session';
import { COLUMNS, col, row, setCells, str } from '../src/client-session/test-support';
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

function createClient(wsUrl: string, clientId: string, autoReconnect: boolean): Client {
  const transport = new WsClientTransport(wsUrl, { autoReconnect, reconnectDelayMillis: 100 });
  const session = new ClientSession({
    clientId,
    userId: `user-${clientId}`,
    displayName: clientId,
    documentId: createDocumentId('demo-doc'),
    columnOrder: COLUMNS,
    transport,
    clock: { now: () => Date.now() },
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

describe('restart-restore — snapshot 復元起動 → 再接続 catch-up 収束（AC5・S-K4・D18）', () => {
  it(
    '停止 → snapshot import で同一ポート復元 → 同一 clientId 再接続 catch-up → 全 hash 一致・revision 継続',
    async () => {
      // --- 稼働: A/B が数百 op を適用して収束 ---
      const server1: RunningServer = await startServer({ port: 0, seedRows: 3 });
      const port = server1.port;
      const wsUrl = `ws://127.0.0.1:${port}/ws`;

      const a = createClient(wsUrl, 'client-a', true);
      const b = createClient(wsUrl, 'client-b', true);
      const live = [a.session, b.session];
      await waitFor(() => live.every((s) => s.isOnline && s.committedDocument.revision >= 1), 'A/B online + seeded');

      const tickTimer = setInterval(() => {
        for (const c of [a, b]) {
          c.session.tick();
        }
      }, 30);
      cleanups.push(() => {
        clearInterval(tickTimer);
      });

      const preOps = 250; // 数百 op
      for (let i = 0; i < preOps; i += 1) {
        const session = live[i % live.length];
        session.submitLocalOperation(setCells([{ rowId: row(`row-${(i % 3) + 1}`), columnId: COLUMNS[i % COLUMNS.length], value: str(`pre${i}`) }]));
      }
      await waitFor(() => live.every((s) => s.pendingCount === 0 && s.committedHash() === server1.hash()), 'A/B converge pre-restart');
      const revBeforeRestart = server1.snapshot().currentRevision;
      expect(revBeforeRestart).toBe(1 + preOps);

      // --- snapshot エクスポート＋整合検証（document hash == ログ replay hash・S-K1・D7）---
      const snapshot = server1.snapshot();
      const integrity = verifySnapshotIntegrity(snapshot);
      expect(integrity.ok).toBe(true);
      expect(integrity.documentHash).toBe(server1.hash());

      // --- 停止 → 同一ポートで復元起動（import・revision=R 継続）---
      await server1.close();
      const server2: RunningServer = await startServer({ port, restoreFrom: snapshot });
      cleanups.push(() => server2.close());
      // 復元直後の hash が停止前と一致（構築経路非依存・S-K2）
      expect(server2.hash()).toBe(integrity.documentHash);
      expect(server2.snapshot().currentRevision).toBe(revBeforeRestart);

      // --- A/B が同一 clientId で自動再接続 → committed=R のまま収束（AC5）---
      await waitFor(
        () => live.every((s) => s.isOnline && s.committedHash() === server2.hash()),
        'A/B reconnect + converge on restored server',
      );

      // --- 復元後の新規 op: A が送信 → revision は R+1 から継続（S-K4）・clientSequence 継続（restore で
      //     clientSequenceTable 復元＝violation にならず受理・D18）。B は catch-up で R+1 を受信（catch-up 実証）。---
      a.session.submitLocalOperation(setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('post-restore') }]));
      await waitFor(
        () => live.every((s) => s.pendingCount === 0 && s.committedHash() === server2.hash()),
        'A/B converge after post-restore op',
      );
      expect(server2.snapshot().currentRevision).toBe(revBeforeRestart + 1); // 継続（R+1・二重適用0）

      // --- 復元サーバーへ R'=0 の新規クライアント C が join → 全ログ 1..R+1 を catch-up して収束（S-K3・AC5）---
      const c = createClient(wsUrl, 'client-c', false);
      await waitFor(
        () => c.session.isOnline && c.session.committedHash() === server2.hash(),
        'fresh client C full catch-up on restored server',
      );

      // --- 収束 assert（AC5）---
      const restoredHash = server2.hash();
      const restoredRev = server2.snapshot().currentRevision;
      for (const session of [a.session, b.session, c.session]) {
        expect(session.committedHash()).toBe(restoredHash);
        expect(session.committedDocument.revision).toBe(restoredRev);
        expect(session.nextExpectedRevision).toBe(restoredRev + 1); // 二重適用0（revision 連続）
        expect(session.pendingCount).toBe(0);
        expect(session.conflictQueue).toHaveLength(0);
      }

      // --- 後始末 ---
      clearInterval(tickTimer);
      for (const client of [a, b, c]) {
        client.transport.close();
      }
      await waitFor(() => server2.connectionCount() === 0, 'all connections cleaned up');
    },
    60_000,
  );
});
