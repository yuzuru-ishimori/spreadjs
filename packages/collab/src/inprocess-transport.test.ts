import { describe, expect, it } from 'vitest';

import { documentHash, getCell } from '@nanairo-sheet/core';
import type { ClientOperationEnvelope, DocumentOperation } from '@nanairo-sheet/core';
import { Room, Sequencer, createCounterIdGenerator as createConnIdGenerator, freshSequencerState } from '@nanairo-sheet/server';
import { createDocumentId, createOperationId, createTransactionId } from '@nanairo-sheet/types';

import { createCounterIdGenerator } from './deps';
import { InProcessHub } from './inprocess-transport';
import { ClientSession } from './session';
import { COLUMNS, col, createManualClock, insertRows, row, setCells, str } from './test-support';
import type { ManualClock } from './test-support';

function createRoom(clock: ManualClock): { room: Room; sequencer: Sequencer } {
  const sequencer = new Sequencer(freshSequencerState(COLUMNS), clock);
  const room = new Room(sequencer, { clock, idGenerator: createConnIdGenerator('conn') });
  return { room, sequencer };
}

function makeSession(hub: InProcessHub, clientId: string, userId: string, displayName: string, clock: ManualClock): ClientSession {
  const transport = hub.connect(clientId);
  const session = new ClientSession({
    clientId,
    userId,
    displayName,
    documentId: createDocumentId('doc-1'),
    columnOrder: COLUMNS,
    transport,
    clock,
    idGenerator: createCounterIdGenerator(`${clientId}-op`),
    resendTimeoutMillis: 1000,
  });
  session.start();
  return session;
}

/** tick（再送）→ deliverAll を交互に回して収束させる（決定論・注入クロック）。 */
function pump(hub: InProcessHub, sessions: ClientSession[], clock: ManualClock, rounds: number): void {
  for (let i = 0; i < rounds; i += 1) {
    clock.advance(1001);
    for (const session of sessions) {
      session.tick();
    }
    hub.deliverAll();
  }
}

describe('InProcessHub — Room 直結・基本ラウンドトリップ（フォールト無し）', () => {
  it('2 セッションの相互反映で全 committed hash が Room と一致・二重適用0', () => {
    const clock = createManualClock();
    const { room, sequencer } = createRoom(clock);
    const hub = new InProcessHub(room, { seed: 1 });
    const a = makeSession(hub, 'cA', 'user-a', 'Alice', clock);
    const b = makeSession(hub, 'cB', 'user-b', 'Bob', clock);
    hub.deliverAll(); // join → welcome/operations

    a.submitLocalOperation(insertRows(null, ['row-a']));
    b.submitLocalOperation(insertRows(null, ['row-b']));
    hub.deliverAll();
    a.submitLocalOperation(setCells([{ rowId: row('row-a'), columnId: col('col-a'), value: str('A') }]));
    b.submitLocalOperation(setCells([{ rowId: row('row-b'), columnId: col('col-a'), value: str('B') }]));
    hub.deliverAll();

    const serverHash = documentHash(sequencer.document);
    expect(a.committedHash()).toBe(serverHash);
    expect(b.committedHash()).toBe(serverHash);
    expect(a.pendingCount).toBe(0);
    expect(b.pendingCount).toBe(0);
    expect(hub.counters).toEqual({ duplicate: 0, drop: 0, delay: 0, disconnect: 0 });
  });

  it('Presence: A の presence が B の knownPresences に名前・色付きで届く（Phase 4 デモ経路）', () => {
    const clock = createManualClock();
    const { room } = createRoom(clock);
    const hub = new InProcessHub(room, { seed: 1 });
    const a = makeSession(hub, 'cA', 'user-a', 'Alice', clock);
    const b = makeSession(hub, 'cB', 'user-b', 'Bob', clock);
    hub.deliverAll();

    a.sendPresence({ activeCell: { rowId: row('row-1'), columnId: col('col-a') }, selectionRanges: [] });
    hub.deliverAll();

    const seenByB = b.knownPresences().find((p) => p.userId === 'user-a');
    expect(seenByB).toBeDefined();
    expect(seenByB?.displayName).toBe('Alice');
    expect(typeof seenByB?.colorKey).toBe('string');
    expect(a.colorKey).not.toBe(b.colorKey); // 同色回避（connection 単位割当）
  });
});

describe('InProcessHub — フォールト注入（重複/欠落/遅延）＋発火カウンター（S-M3 準備）', () => {
  it('重複/欠落/遅延を注入しても全 committed が Room と一致・カウンターが発火', () => {
    const clock = createManualClock();
    const { room, sequencer } = createRoom(clock);
    // 先に Room へ 3 行を投入（挿入依存を faults 下で送らないため）
    const seedOps: DocumentOperation[] = [insertRows(null, ['row-1']), insertRows(row('row-1'), ['row-2']), insertRows(row('row-2'), ['row-3'])];
    seedOps.forEach((op, i) => {
      const envelope: ClientOperationEnvelope = {
        protocolVersion: 1,
        documentId: createDocumentId('doc-1'),
        operationId: createOperationId(`seed-${i + 1}`),
        transactionId: createTransactionId(`tx-seed-${i + 1}`),
        actorId: 'seed',
        clientId: 'seed',
        clientSequence: i + 1,
        baseRevision: i,
        operation: op,
      };
      sequencer.submit(envelope);
    });

    const hub = new InProcessHub(room, { seed: 7, faults: { duplicate: 0.25, drop: 0.25, delay: 0.25 } });
    const a = makeSession(hub, 'cA', 'user-a', 'Alice', clock);
    const b = makeSession(hub, 'cB', 'user-b', 'Bob', clock);
    hub.deliverAll(); // join → 3 行を catch up
    pump(hub, [a, b], clock, 10); // faults 下でも 3 行を取り切る（送信前に行を既知にする）
    expect(a.committedDocument.revision).toBe(3);
    expect(b.committedDocument.revision).toBe(3);

    // 既存の別セルへの set（衝突しない）を各自送る
    a.submitLocalOperation(setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('A1') }]));
    a.submitLocalOperation(setCells([{ rowId: row('row-2'), columnId: col('col-a'), value: str('A2') }]));
    b.submitLocalOperation(setCells([{ rowId: row('row-1'), columnId: col('col-b'), value: str('B1') }]));
    b.submitLocalOperation(setCells([{ rowId: row('row-3'), columnId: col('col-a'), value: str('B3') }]));

    pump(hub, [a, b], clock, 40);

    const serverHash = documentHash(sequencer.document);
    expect(a.committedHash()).toBe(serverHash);
    expect(b.committedHash()).toBe(serverHash);
    expect(a.pendingCount).toBe(0);
    expect(b.pendingCount).toBe(0);
    expect(a.conflictQueue).toHaveLength(0); // 別セルゆえ競合なし（欠落/重複/遅延を吸収して収束）
    // 非自明な収束（全 no-op で緑にならない・D7）: 4 件の set が実際に権威文書へ反映されている
    expect(getCell(sequencer.document, row('row-1'), col('col-a'))?.value).toEqual(str('A1'));
    expect(getCell(sequencer.document, row('row-2'), col('col-a'))?.value).toEqual(str('A2'));
    expect(getCell(sequencer.document, row('row-1'), col('col-b'))?.value).toEqual(str('B1'));
    expect(getCell(sequencer.document, row('row-3'), col('col-a'))?.value).toEqual(str('B3'));
    // フォールトが実際に発火した（テストのための実装化の防止・S-M3 準備）
    const total = hub.counters.duplicate + hub.counters.drop + hub.counters.delay;
    expect(total).toBeGreaterThan(0);
  });

  it('競合（全員が同一セルを編集）でもフォールト下で収束・敗者は Conflict Queue（入力消失0・D26/D27 回帰）', () => {
    const clock = createManualClock();
    const { room, sequencer } = createRoom(clock);
    const seedEnv: ClientOperationEnvelope = {
      protocolVersion: 1,
      documentId: createDocumentId('doc-1'),
      operationId: createOperationId('seed-1'),
      transactionId: createTransactionId('tx-seed-1'),
      actorId: 'seed',
      clientId: 'seed',
      clientSequence: 1,
      baseRevision: 0,
      operation: insertRows(null, ['row-1']),
    };
    sequencer.submit(seedEnv);

    const hub = new InProcessHub(room, { seed: 11, faults: { duplicate: 0.2, drop: 0.2, delay: 0.2 } });
    const a = makeSession(hub, 'cA', 'user-a', 'Alice', clock);
    const b = makeSession(hub, 'cB', 'user-b', 'Bob', clock);
    hub.deliverAll();
    pump(hub, [a, b], clock, 10);

    // 2 名が同一セルを beforeRevision=0 で編集 → 1 名勝ち・1 名 Conflict Queue
    a.submitLocalOperation(setCells([{ rowId: row('row-1'), columnId: col('col-a'), beforeRevision: 0, value: str('A') }]));
    b.submitLocalOperation(setCells([{ rowId: row('row-1'), columnId: col('col-a'), beforeRevision: 0, value: str('B') }]));
    pump(hub, [a, b], clock, 60);

    const serverHash = documentHash(sequencer.document);
    expect(a.committedHash()).toBe(serverHash);
    expect(b.committedHash()).toBe(serverHash);
    expect(a.pendingCount).toBe(0);
    expect(b.pendingCount).toBe(0);
    // 敗者 1 名の入力は Conflict Queue に保全（消失0）
    expect(a.conflictQueue.length + b.conflictQueue.length).toBe(1);
  });

  it('切断→再接続でも収束（disconnect カウンター発火・clientId 継続）', () => {
    const clock = createManualClock();
    const { room, sequencer } = createRoom(clock);
    const hub = new InProcessHub(room, { seed: 3 });
    const a = makeSession(hub, 'cA', 'user-a', 'Alice', clock);
    const b = makeSession(hub, 'cB', 'user-b', 'Bob', clock);
    hub.deliverAll();

    a.submitLocalOperation(insertRows(null, ['row-1']));
    hub.deliverAll();

    // A を切断 → B が更新 → A 再接続
    hub.disconnect('cA');
    expect(a.isOnline).toBe(false);
    b.submitLocalOperation(setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('B') }]));
    hub.deliverAll();
    hub.reconnect('cA');
    pump(hub, [a, b], clock, 10);

    const serverHash = documentHash(sequencer.document);
    expect(a.committedHash()).toBe(serverHash);
    expect(b.committedHash()).toBe(serverHash);
    expect(hub.counters.disconnect).toBe(1);
  });
});
