// 🔬 Phase 5 契約テスト（§20.3 該当分・AC2/AC3/AC4）: 重複・欠落・stale を個別に注入し、それぞれ
// 「同一 ACK 再返却＋二重適用0（AC2）」「requestCatchup 発行→追従（AC3）」「operationRejected〔現在値/現在
// revision〕→ローカル入力を Conflict Queue に保持〔消失0〕（AC4）」を満たすことを決定論的に検証する。
// さらに **切断経由の reject 喪失経路**（D27 境界）を 1 ケース追加する: 競合 op 送信直後に切断→reject 未達→
// 再接続（§8.5）→pending 再検証（validateOperation）で stale 検出→Conflict Queue 行き・二重適用0。

import { describe, expect, it } from 'vitest';

import { documentHash, getCell } from '@nanairo-sheet/sheet-core';
import type { ClientOperationEnvelope } from '@nanairo-sheet/sheet-core';
import { Room, Sequencer, createCounterIdGenerator as createConnIdGenerator, freshSequencerState } from '@nanairo-sheet/sheet-server-core';
import { createDocumentId, createOperationId, createTransactionId } from '@nanairo-sheet/sheet-types';

import { createCounterIdGenerator } from '../src/client-session/deps';
import { InProcessHub } from '../src/client-session/inprocess-transport';
import { ClientSession } from '../src/client-session/session';
import {
  COLUMNS,
  RecordingTransport,
  col,
  createManualClock,
  insertRows,
  operationsMessage,
  row,
  serverEnvelope,
  setCells,
  str,
} from '../src/client-session/test-support';
import type { ManualClock } from '../src/client-session/test-support';

const DOCUMENT_ID = createDocumentId('contract-doc');

function makeSequencerRoom(clock: ManualClock): { sequencer: Sequencer; room: Room } {
  const sequencer = new Sequencer(freshSequencerState(COLUMNS), clock);
  const room = new Room(sequencer, { clock, idGenerator: createConnIdGenerator('conn') });
  return { sequencer, room };
}

function clientEnvelope(o: {
  operationId: string;
  clientSequence: number;
  baseRevision: number;
  operation: ClientOperationEnvelope['operation'];
  clientId?: string;
}): ClientOperationEnvelope {
  return {
    protocolVersion: 1,
    documentId: DOCUMENT_ID,
    operationId: createOperationId(o.operationId),
    transactionId: createTransactionId(`tx-${o.operationId}`),
    actorId: 'user',
    clientId: o.clientId ?? 'client',
    clientSequence: o.clientSequence,
    baseRevision: o.baseRevision,
    operation: o.operation,
  };
}

function newSession(clientId: string, transport: RecordingTransport, clock: ManualClock): ClientSession {
  const session = new ClientSession({
    clientId,
    userId: `user-${clientId}`,
    displayName: clientId,
    documentId: DOCUMENT_ID,
    columnOrder: COLUMNS,
    transport,
    clock,
    idGenerator: createCounterIdGenerator(`${clientId}-op`),
    resendTimeoutMillis: 1_000,
  });
  session.start();
  return session;
}

describe('契約テスト §20.3 — 重複（AC2）', () => {
  it('同一 Operation を重複送信 → 同一 ACK 再返却・二重適用0・ログ長不変（サーバー冪等）', () => {
    const clock = createManualClock();
    const { sequencer, room } = makeSequencerRoom(clock);
    const { connectionId } = room.handleJoin({ type: 'join', protocolVersion: 1, documentId: DOCUMENT_ID, lastAppliedRevision: 0, clientId: 'client' });
    const env = clientEnvelope({ operationId: 'op-1', clientSequence: 1, baseRevision: 0, operation: insertRows(null, ['row-1']) });

    const first = room.handleMessage(connectionId, { type: 'submitOperation', envelope: env });
    const hashAfterFirst = documentHash(sequencer.document);
    const logLenAfterFirst = sequencer.operationsSince(0).length;

    const second = room.handleMessage(connectionId, { type: 'submitOperation', envelope: env }); // 重複再送

    // 同一 ACK（revision 一致）が再返却される
    const ack1 = first.find((o) => o.message.type === 'operationAck');
    const ack2 = second.find((o) => o.message.type === 'operationAck');
    expect(ack1?.message).toEqual(ack2?.message);
    // 二通目は operations を配信しない（二重適用0）・ログ長も hash も不変
    expect(second.some((o) => o.message.type === 'operations')).toBe(false);
    expect(sequencer.operationsSince(0).length).toBe(logLenAfterFirst);
    expect(documentHash(sequencer.document)).toBe(hashAfterFirst);
  });

  it('クライアントが同一 operations エコーを2度受信 → committed へ一度だけ適用（二重適用0・I-3）', () => {
    const clock = createManualClock();
    const transport = new RecordingTransport();
    const session = newSession('cA', transport, clock);
    transport.receive({ type: 'welcome', sessionId: 'conn-1', currentRevision: 0, colorKey: 'color-0', capabilities: { protocolVersion: 1 } });

    const env = serverEnvelope({ revision: 1, operationId: 'other-1', operation: insertRows(null, ['row-1']) });
    transport.receive(operationsMessage([env]));
    const afterFirst = session.committedHash();
    expect(session.nextExpectedRevision).toBe(2);

    transport.receive(operationsMessage([env])); // 同一 revision の重複配信
    expect(session.nextExpectedRevision).toBe(2); // 前進しない（重複無視）
    expect(session.committedHash()).toBe(afterFirst); // 二重適用0
  });
});

describe('契約テスト §20.3 — 欠落（AC3）', () => {
  it('operations の revision 欠落 → requestCatchup 発行 → 追従して hash 一致', () => {
    const clock = createManualClock();
    const transport = new RecordingTransport();
    const session = newSession('cA', transport, clock);
    transport.receive({ type: 'welcome', sessionId: 'conn-1', currentRevision: 0, colorKey: 'color-0', capabilities: { protocolVersion: 1 } });

    const env1 = serverEnvelope({ revision: 1, operationId: 'o1', operation: insertRows(null, ['row-1']) });
    const env2 = serverEnvelope({ revision: 2, operationId: 'o2', operation: insertRows(row('row-1'), ['row-2']) });
    const env3 = serverEnvelope({ revision: 3, operationId: 'o3', operation: setCells([{ rowId: row('row-2'), columnId: col('col-a'), value: str('x') }]) });
    // revision 1 を適用後、revision 3 が届く（2 が欠落）
    transport.receive(operationsMessage([env1]));
    transport.clear();
    transport.receive(operationsMessage([env3]));

    // revision 3 は適用せず（nextExpected は 2 のまま）requestCatchup{afterRevision:1} を発行
    expect(session.nextExpectedRevision).toBe(2);
    const catchups = transport.sentOfType('requestCatchup');
    expect(catchups).toHaveLength(1);
    expect(catchups[0].afterRevision).toBe(1); // off-by-one: nextExpected-1（S-I5）

    // サーバーが 2..3 を返す（catch-up 応答）→ 追従して収束
    transport.receive(operationsMessage([env2, env3]));
    expect(session.nextExpectedRevision).toBe(4);
    // 参照文書（1→2→3 を素直に適用）と hash 一致
    const { sequencer } = makeSequencerRoom(clock);
    sequencer.submit(clientEnvelope({ operationId: 'o1', clientSequence: 1, baseRevision: 0, operation: insertRows(null, ['row-1']) }));
    sequencer.submit(clientEnvelope({ operationId: 'o2', clientSequence: 2, baseRevision: 1, operation: insertRows(row('row-1'), ['row-2']) }));
    sequencer.submit(clientEnvelope({ operationId: 'o3', clientSequence: 3, baseRevision: 2, operation: setCells([{ rowId: row('row-2'), columnId: col('col-a'), value: str('x') }]) }));
    expect(session.committedHash()).toBe(documentHash(sequencer.document));
  });
});

describe('契約テスト §20.3 — stale beforeRevision（AC4）', () => {
  it('operationRejected〔現在値/現在revision〕受信 → ローカル入力を Conflict Queue に保持（消失0）', () => {
    const clock = createManualClock();
    const transport = new RecordingTransport();
    const session = newSession('cB', transport, clock);
    // committed を「row-1 の cell=seed（rev2）」にする（welcome rev2 ＋ operations 1..2）
    transport.receive({ type: 'welcome', sessionId: 'conn-1', currentRevision: 2, colorKey: 'color-0', capabilities: { protocolVersion: 1 } });
    transport.receive(
      operationsMessage([
        serverEnvelope({ revision: 1, operationId: 's1', operation: insertRows(null, ['row-1']) }),
        serverEnvelope({ revision: 2, operationId: 's2', operation: setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('seed') }]) }),
      ]),
    );
    transport.clear();

    // beforeRevision=2（自 committed の cell rev と一致＝ローカルは valid）で編集 → 送信される
    const opId = session.submitLocalOperation(setCells([{ rowId: row('row-1'), columnId: col('col-a'), beforeRevision: 2, value: str('B-loses') }]));
    expect(transport.sentOfType('submitOperation')).toHaveLength(1);
    expect(session.pendingCount).toBe(1);

    // サーバーは他者が rev3 に更新済みで stale reject を返す（現在値/現在 revision 入り・§10.2）
    transport.receive({
      type: 'operationRejected',
      operationId: opId,
      code: 'stale-cell-revision',
      details: { violations: [{ code: 'stale-cell-revision', rowId: row('row-1'), columnId: col('col-a'), currentValue: str('winner'), currentRevision: 3 }] },
    });

    // ローカル入力は Conflict Queue に保持（消失0・I-2）・pending から除去（二重適用0）
    expect(session.pendingCount).toBe(0);
    expect(session.conflictQueue).toHaveLength(1);
    const entry = session.conflictQueue[0];
    expect(entry.reason).toBe('rejected');
    expect(entry.code).toBe('stale-cell-revision');
    expect(entry.operationId).toBe(opId);
    expect(entry.operation).toEqual(setCells([{ rowId: row('row-1'), columnId: col('col-a'), beforeRevision: 2, value: str('B-loses') }]));
    const violation = entry.violations?.[0];
    expect(violation?.code).toBe('stale-cell-revision');
    if (violation?.code === 'stale-cell-revision') {
      expect(violation.currentValue).toEqual(str('winner')); // 現在値
      expect(violation.currentRevision).toBe(3); // 現在 revision
    }
  });
});

describe('契約テスト — 切断経由の reject 喪失経路（D27 境界）', () => {
  it('競合 op 送信直後に切断 → reject 未達 → 再接続で pending 再検証 → stale 検出 → Conflict Queue・二重適用0', () => {
    const clock = createManualClock();
    const { sequencer, room } = makeSequencerRoom(clock);
    const hub = new InProcessHub(room, { seed: 1 });
    sequencer.submit(clientEnvelope({ operationId: 'seed', clientSequence: 1, baseRevision: 0, operation: insertRows(null, ['row-1']), clientId: 'seed' }));

    const a = new ClientSession({ clientId: 'cA', userId: 'ua', displayName: 'A', documentId: DOCUMENT_ID, columnOrder: COLUMNS, transport: hub.connect('cA'), clock, idGenerator: createCounterIdGenerator('cA-op'), resendTimeoutMillis: 1_000 });
    const b = new ClientSession({ clientId: 'cB', userId: 'ub', displayName: 'B', documentId: DOCUMENT_ID, columnOrder: COLUMNS, transport: hub.connect('cB'), clock, idGenerator: createCounterIdGenerator('cB-op'), resendTimeoutMillis: 1_000 });
    a.start();
    b.start();
    hub.deliverAll();

    // B が勝者となる編集を送りサーバーへ確定させる（echo はまだ A へ届けない）
    b.submitLocalOperation(setCells([{ rowId: row('row-1'), columnId: col('col-a'), beforeRevision: 0, value: str('B-wins') }]));
    // A は B の確定を知らずに同一セルを beforeRevision=0 で編集 → サーバーで stale reject（reject はキューへ）
    const aOpId = a.submitLocalOperation(setCells([{ rowId: row('row-1'), columnId: col('col-a'), beforeRevision: 0, value: str('A-loses') }]));

    // A の reject を配送する前に A を切断 → reject 未達（キュー済みメッセージは offline へ不達で破棄）
    hub.disconnect('cA');
    hub.deliverAll(); // B は echo 受信、A へのキュー（reject 含む）は破棄
    expect(a.isOnline).toBe(false);
    expect(a.pendingCount).toBe(1); // A はまだ自分の op を pending に保持（reject 未達）

    // A 再接続 → §8.5: 先にサーバー差分（B の勝者 op）を取得 → pending を validateOperation で再検証 → stale
    hub.reconnect('cA');
    for (let i = 0; i < 6; i += 1) {
      clock.advance(1_001);
      a.tick();
      b.tick();
      hub.deliverAll();
    }

    const serverHash = documentHash(sequencer.document);
    expect(a.committedHash()).toBe(serverHash);
    expect(a.pendingCount).toBe(0);
    expect(a.nextExpectedRevision).toBe(sequencer.currentRevision + 1); // 二重適用0（revision 連続）
    // A の入力は Conflict Queue に保全（消失0）。reject 未達でも再検証で stale を検出して行き先が Conflict Queue になる
    expect(a.conflictQueue).toHaveLength(1);
    expect(a.conflictQueue[0].operationId).toBe(aOpId);
    expect(a.conflictQueue[0].operation).toEqual(setCells([{ rowId: row('row-1'), columnId: col('col-a'), beforeRevision: 0, value: str('A-loses') }]));
    // 権威文書は B の値
    expect(getCell(sequencer.document, row('row-1'), col('col-a'))?.value).toEqual(str('B-wins'));
  });
});
