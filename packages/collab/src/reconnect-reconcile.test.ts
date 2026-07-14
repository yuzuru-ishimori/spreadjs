// DD-015 Phase 2/3（exactly-once reconnect・fault matrix C1〜C4/C11 ＋ Codex P1-2 回帰）: 再接続 reconcile の分類ロジックを
// synthetic 契約で固定する。welcome.reconcile（ackedClientSequence・acceptedOperationIds）で未ACK pending を「受理済＝除去／
// reject 済＝Conflict Queue／未処理＝再送」の3分類する。DD-014-1 の un-acked-drop race（受理済み未ACK op の phantom conflict）を封鎖する中核。
//
// reconcile は **committed が権威化した後**（bootstrap 受信直後 or tail drain 完了＝finalize）に適用する（Codex P1-2）。ゆえに
// テストは bootstrap/finalize を経由させてから分類結果を確認する。閾値超の snapshot 再取得（C8）と server 再起動（C9）は実 WS 統合テストで駆動。

import { describe, expect, it } from 'vitest';

import { applyOperation, createDocument, getCell, serializeDocument } from '@nanairo-sheet/core';
import type { DocumentOperation, DocumentSnapshot, ServerMessage } from '@nanairo-sheet/core';
import { createDocumentId } from '@nanairo-sheet/types';
import type { OperationId } from '@nanairo-sheet/types';

import { createCounterIdGenerator } from './deps';
import { ClientSession } from './session';
import type { SessionConfig, SessionEvent } from './session';
import { COLUMNS, RecordingTransport, col, createManualClock, insertRows, operationsMessage, row, serverEnvelope, setCells, str } from './test-support';
import type { ManualClock } from './test-support';

interface Harness {
  session: ClientSession;
  transport: RecordingTransport;
  clock: ManualClock;
  events: SessionEvent[];
}

function createSession(overrides: Partial<SessionConfig> = {}): Harness {
  const clock = createManualClock();
  const transport = new RecordingTransport();
  const events: SessionEvent[] = [];
  const session = new ClientSession({
    clientId: 'cA',
    userId: 'user-a',
    displayName: 'Alice',
    documentId: createDocumentId('doc-1'),
    columnOrder: COLUMNS,
    transport,
    clock,
    idGenerator: createCounterIdGenerator('op'),
    resendTimeoutMillis: 1000,
    observer: (event) => events.push(event),
    ...overrides,
  });
  return { session, transport, clock, events };
}

/** fresh join（server 空・currentRevision=0）。 */
function startFresh(h: Harness): void {
  h.session.start();
  h.transport.receive({ type: 'welcome', sessionId: 'conn-1', currentRevision: 0, colorKey: 'c', capabilities: { protocolVersion: 1 } });
}

function welcomeReconnect(o: {
  currentRevision: number;
  ackedClientSequence: number;
  acceptedOperationIds: OperationId[];
  inFlightOperationIds?: OperationId[];
  diverged?: boolean;
}): ServerMessage {
  return {
    type: 'welcome',
    sessionId: 'conn-2',
    currentRevision: o.currentRevision,
    colorKey: 'c',
    capabilities: { protocolVersion: 1 },
    reconcile: {
      ackedClientSequence: o.ackedClientSequence,
      acceptedOperationIds: o.acceptedOperationIds,
      ...(o.inFlightOperationIds !== undefined ? { inFlightOperationIds: o.inFlightOperationIds } : {}),
    },
    ...(o.diverged ? { diverged: true } : {}),
  };
}

/** op 列から committed@revision の document snapshot を構築する（bootstrap メッセージの document 用）。 */
function buildDoc(ops: DocumentOperation[]): { snapshot: DocumentSnapshot; revision: number } {
  let doc = createDocument([...COLUMNS]);
  let revision = 0;
  for (const op of ops) {
    revision += 1;
    doc = applyOperation(doc, op, { revision }).document;
  }
  return { snapshot: serializeDocument(doc), revision };
}

function bootstrapMsg(snapshot: DocumentSnapshot, revision: number): ServerMessage {
  return { type: 'bootstrap', document: snapshot, revision };
}

describe('DD-015 再接続 reconcile — fault matrix C1〜C4/C11・Codex P1-2 回帰（exactly-once）', () => {
  it('sendJoin は未ACK pending の {operationId, clientSequence} を添える（reconcile 材料）', () => {
    const h = createSession();
    startFresh(h);
    const opX = h.session.submitLocalOperation(insertRows(null, ['row-1']));
    h.transport.clear();
    h.transport.drop();
    h.transport.reconnect();
    const join = h.transport.sentOfType('join')[0];
    expect(join.pending).toEqual([{ operationId: opX, clientSequence: 1 }]);
  });

  it('S-R2 (C2): 受理済み未ACK の insertRows（ACK喪失）→ 再接続 bootstrap 経路で reconcile 除去・phantom duplicate-row なし・二重適用0', () => {
    const h = createSession();
    startFresh(h);
    // A: insert row-1 を送信 → server 受理（rev1）だが ACK/echo 喪失。client committed=0 のまま。
    const opX = h.session.submitLocalOperation(insertRows(null, ['row-1']));
    expect(h.session.pendingCount).toBe(1);

    h.transport.clear();
    h.transport.drop();
    h.transport.reconnect();
    // welcome: server は opX を rev1 で受理済 → reconcile.accepted=[opX], acked=1。committed=0 ゆえ bootstrap 経路。
    h.transport.receive(welcomeReconnect({ currentRevision: 1, ackedClientSequence: 1, acceptedOperationIds: [opX] }));
    // bootstrap: document@1（row-1 を含む）
    const { snapshot, revision } = buildDoc([insertRows(null, ['row-1'])]);
    h.transport.receive(bootstrapMsg(snapshot, revision));

    // reconcile が opX を除去（duplicate-row の phantom conflict を出さない）・再送もしない・二重適用0（row-1 は1回だけ）
    expect(h.session.pendingCount).toBe(0);
    expect(h.session.conflictQueue).toHaveLength(0);
    expect(h.transport.sentOfType('submitOperation')).toHaveLength(0);
    expect(h.session.committedDocument.revision).toBe(1);
    expect(h.session.committedDocument.rowOrder.filter((r) => String(r) === 'row-1')).toHaveLength(1);
  });

  it('Codex P1-2 回帰: 受理済み依存元 A（行挿入）＋未処理依存 B（A の行を編集）→ B を誤 Conflict 化せず再送する', () => {
    const h = createSession();
    startFresh(h);
    // A: insert row-1（server 受理 rev1・ACK喪失）。B: row-1 のセル編集（未処理＝server 未達）。
    const opA = h.session.submitLocalOperation(insertRows(null, ['row-1']));
    const opB = h.session.submitLocalOperation(setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('B') }]));
    expect(h.session.pendingCount).toBe(2);

    h.transport.clear();
    h.transport.drop();
    h.transport.reconnect();
    // welcome: server は A（rev1）を受理済・B は未処理。reconcile.accepted=[opA], acked=1。
    h.transport.receive(welcomeReconnect({ currentRevision: 1, ackedClientSequence: 1, acceptedOperationIds: [opA] }));
    // bootstrap: document@1（row-1 を含む＝受理済み依存元 A の効果）
    const { snapshot, revision } = buildDoc([insertRows(null, ['row-1'])]);
    h.transport.receive(bootstrapMsg(snapshot, revision));

    // committed=doc@1（row-1 あり）で reconcile 後に rebuild するため、B は row-1 に対して valid → **Conflict 化しない**（P1-2 fix）。
    expect(h.session.conflictQueue).toHaveLength(0);
    expect(h.session.pendingCount).toBe(1); // B は残る
    expect(h.session.pendingOperationIds()).toEqual([opB]);
    expect(h.transport.sentOfType('submitOperation').map((s) => s.envelope.operationId)).toContain(opB); // B 再送
    expect(getCell(h.session.viewDocument, row('row-1'), col('col-a'))?.value).toEqual(str('B')); // B の楽観値が view に保持
  });

  it('S-R1 (C1): 切断中に編集した送信前 pending → 未処理判定で再送（喪失0）', () => {
    const h = createSession();
    startFresh(h);
    h.transport.drop(); // offline
    const opX = h.session.submitLocalOperation(insertRows(null, ['row-1']));
    expect(h.transport.sentOfType('submitOperation')).toHaveLength(0); // offline ゆえ未送信

    h.transport.clear();
    h.transport.reconnect();
    // welcome: server 未処理（acked=0, accepted=[]）。currentRevision=0 ゆえ bootstrap なし → finalize で reconcile 適用。
    h.transport.receive(welcomeReconnect({ currentRevision: 0, ackedClientSequence: 0, acceptedOperationIds: [] }));

    const resent = h.transport.sentOfType('submitOperation');
    expect(resent.map((s) => s.envelope.operationId)).toEqual([opX]);
    expect(h.session.conflictQueue).toHaveLength(0);
  });

  it('S-R3 (C3): 送信済未ACK が server reject（通知喪失・seq消費）→ reconcile で Conflict Queue・再送しない（seq違反ループ回避・サイレント喪失0）', () => {
    const h = createSession();
    startFresh(h);
    const opX = h.session.submitLocalOperation(insertRows(null, ['row-1'])); // seq1・server が reject（rev 非消費）
    h.transport.clear();
    h.transport.drop();
    h.transport.reconnect();
    // server: seq1 は処理済み（acked=1）だが opX は ackCache 不在（accepted=[]）＝reject。currentRevision=0（reject は rev 非消費）。
    h.transport.receive(welcomeReconnect({ currentRevision: 0, ackedClientSequence: 1, acceptedOperationIds: [] }));

    expect(h.session.pendingCount).toBe(0); // pending から除去
    expect(h.session.conflictQueue).toHaveLength(1);
    expect(h.session.conflictQueue[0].operationId).toBe(opX);
    expect(h.session.conflictQueue[0].reason).toBe('rejected');
    expect(h.session.conflictQueue[0].operation).toEqual(insertRows(null, ['row-1'])); // 元 op 保持
    expect(h.transport.sentOfType('submitOperation')).toHaveLength(0); // 再送しない
    expect(h.events.filter((e) => e.type === 'rejected')).toHaveLength(1); // rejected イベント発火
  });

  it('S-R4 (C4): 送信済未ACK が server 未達（transit消失）→ 未処理判定で再送', () => {
    const h = createSession();
    startFresh(h);
    const opX = h.session.submitLocalOperation(insertRows(null, ['row-1'])); // seq1
    h.transport.clear();
    h.transport.drop();
    h.transport.reconnect();
    h.transport.receive(welcomeReconnect({ currentRevision: 0, ackedClientSequence: 0, acceptedOperationIds: [] }));

    expect(h.session.pendingCount).toBe(1); // 保持
    expect(h.session.conflictQueue).toHaveLength(0);
    const resent = h.transport.sentOfType('submitOperation');
    expect(resent).toHaveLength(1);
    expect(resent[0].envelope.operationId).toBe(opX);
    expect(resent[0].envelope.clientSequence).toBe(1); // seq 継続（再送キー不変）
  });

  it('S-R3+R4 混在: seq3 reject（喪失）＋seq4 accepted（ACK喪失）→ 前者は Conflict・後者は除去（分類の独立性）', () => {
    const h = createSession();
    startFresh(h);
    const ids: OperationId[] = [];
    ids.push(h.session.submitLocalOperation(insertRows(null, ['r1']))); // seq1 accepted
    ids.push(h.session.submitLocalOperation(insertRows(null, ['r2']))); // seq2 accepted
    ids.push(h.session.submitLocalOperation(insertRows(null, ['r3']))); // seq3 reject（喪失）
    ids.push(h.session.submitLocalOperation(insertRows(null, ['r4']))); // seq4 accepted（ACK喪失）
    const opSeq3 = ids[2];
    const accepted = [ids[0], ids[1], ids[3]]; // r1,r2,r4 は受理済み（rev1,2,3）・r3 は reject
    h.transport.clear();
    h.transport.drop();
    h.transport.reconnect();
    // acked=4（seq4 まで処理）。currentRevision=3（accepted 3 件＝rev1,2,3）。committed=0 ゆえ bootstrap。
    h.transport.receive(welcomeReconnect({ currentRevision: 3, ackedClientSequence: 4, acceptedOperationIds: accepted }));
    const { snapshot, revision } = buildDoc([insertRows(null, ['r1']), insertRows(null, ['r2']), insertRows(null, ['r4'])]);
    h.transport.receive(bootstrapMsg(snapshot, revision));

    // r1,r2,r4 は除去（accepted）・r3 は Conflict（reject・喪失0）・未処理なし
    expect(h.session.conflictQueue.map((c) => c.operationId)).toEqual([opSeq3]);
    expect(h.session.pendingCount).toBe(0);
    expect(h.transport.sentOfType('submitOperation')).toHaveLength(0);
  });

  it('S-R7 (C11): server が divergence（client が frontier より先）を検出→ divergence 通知＋編集停止（fail-fast・黙って merge しない）', () => {
    const h = createSession();
    startFresh(h);
    // committed を rev1 まで進める（他者 op）＝client は権威 rev1 を持つ
    h.transport.receive(operationsMessage([serverEnvelope({ revision: 1, operationId: 'other-1', operation: insertRows(null, ['row-1']) })]));
    const committedBefore = h.session.committedDocument.revision;
    expect(committedBefore).toBe(1);
    h.transport.clear();
    h.transport.drop();
    h.transport.reconnect();
    // server が巻き戻り、join.lastAppliedRevision > frontier を検出して diverged=true
    h.transport.receive(welcomeReconnect({ currentRevision: 0, ackedClientSequence: 0, acceptedOperationIds: [], diverged: true }));

    const divergence = h.events.filter((e) => e.type === 'divergence');
    expect(divergence).toHaveLength(1);
    expect(h.session.isStopped).toBe(true);
    expect(h.session.committedDocument.revision).toBe(committedBefore); // 巻き戻りを committed へ反映しない
    expect(() => h.session.submitLocalOperation(insertRows(null, ['row-x']))).toThrow();
  });

  it('Codex P1-c 回帰: bootstrap が welcome より先着（reorder）→ buffer し welcome 受信時に処理（受理済み op を phantom conflict にしない）', () => {
    const h = createSession();
    startFresh(h);
    const opX = h.session.submitLocalOperation(insertRows(null, ['row-1'])); // server 受理 rev1・ACK喪失
    h.transport.clear();
    h.transport.drop();
    h.transport.reconnect();

    // reorder: bootstrap が welcome より**先**に届く → reconcile 情報が無いので buffer される（即処理しない）
    const { snapshot, revision } = buildDoc([insertRows(null, ['row-1'])]);
    h.transport.receive(bootstrapMsg(snapshot, revision));
    expect(h.session.committedDocument.revision).toBe(0); // まだ処理していない（buffer 済み）
    expect(h.session.conflictQueue).toHaveLength(0); // phantom conflict を出していない

    // welcome 到着（reconcile 付き）→ buffer 済み bootstrap を処理・opX は accepted で除去
    h.transport.receive(welcomeReconnect({ currentRevision: 1, ackedClientSequence: 1, acceptedOperationIds: [opX] }));
    expect(h.session.committedDocument.revision).toBe(1);
    expect(h.session.pendingCount).toBe(0);
    expect(h.session.conflictQueue).toHaveLength(0); // 受理済み op を phantom duplicate-row にしない
    expect(h.session.committedDocument.rowOrder.filter((r) => String(r) === 'row-1')).toHaveLength(1);
  });

  it('Codex 第3回 P1-b 回帰: pre-fsync accepted（in-flight・未 durable）は reject せず保持して再送する（false conflict 回避・喪失0）', () => {
    const h = createSession();
    startFresh(h);
    const opX = h.session.submitLocalOperation(insertRows(null, ['row-1'])); // seq1・server 受理したが未 fsync（in-flight）
    h.transport.clear();
    h.transport.drop();
    h.transport.reconnect();
    // server: opX は ackCache 在だが revision>frontier（未 durable）→ inFlightOperationIds=[opX]。seq1≦acked1 だが in-flight ゆえ reject にしない。
    h.transport.receive(welcomeReconnect({ currentRevision: 0, ackedClientSequence: 1, acceptedOperationIds: [], inFlightOperationIds: [opX] }));
    expect(h.session.conflictQueue).toHaveLength(0); // false conflict にしない
    expect(h.session.pendingCount).toBe(1); // 保持
    expect(h.transport.sentOfType('submitOperation').map((s) => s.envelope.operationId)).toContain(opX); // 再送（durable 化後 echo で正規化）
  });

  it('Codex 第3回 P1-c 回帰: client-sequence-violation の expectedSequence が pending 先頭 seq より小さい→ 未ACK pending を expected から連番へ再整列（D27）', () => {
    const h = createSession();
    startFresh(h);
    const op1 = h.session.submitLocalOperation(insertRows(null, ['r1'])); // seq1
    const op2 = h.session.submitLocalOperation(insertRows(null, ['r2'])); // seq2
    const op3 = h.session.submitLocalOperation(insertRows(null, ['r3'])); // seq3
    // op1,op2 を echo で確定・除去 → op3（seq3）だけ un-acked pending
    h.transport.receive(operationsMessage([
      serverEnvelope({ revision: 1, operationId: String(op1), operation: insertRows(null, ['r1']), clientId: 'cA', clientSequence: 1 }),
      serverEnvelope({ revision: 2, operationId: String(op2), operation: insertRows(null, ['r2']), clientId: 'cA', clientSequence: 2 }),
    ]));
    expect(h.session.pendingOperationIds()).toEqual([op3]);
    h.transport.clear();
    // server が restart で seq を後退（expected=1・op3 の seq3 より小）→ op3 に client-sequence-violation
    h.transport.receive({ type: 'operationRejected', operationId: op3, code: 'client-sequence-violation', details: { expectedSequence: 1, receivedSequence: 3 } });
    // 再整列: op3 の seq を 3→1 へ。resend される envelope の clientSequence=1（operationId 不変＝dedup キー）
    const op3Resend = h.transport.sentOfType('submitOperation').find((s) => s.envelope.operationId === op3);
    expect(op3Resend?.envelope.clientSequence).toBe(1);
    expect(op3Resend?.envelope.operationId).toBe(op3);
  });

  it('legacy welcome（reconcile なし）は従来の再送経路（後方互換・synthetic 契約不変）', () => {
    const h = createSession();
    startFresh(h);
    const opX = h.session.submitLocalOperation(insertRows(null, ['row-1']));
    h.transport.clear();
    h.transport.drop();
    h.transport.reconnect();
    h.transport.receive({ type: 'welcome', sessionId: 'conn-2', currentRevision: 0, colorKey: 'c', capabilities: { protocolVersion: 1 } });
    const resent = h.transport.sentOfType('submitOperation');
    expect(resent).toHaveLength(1); // 従来どおり全 un-acked を再送
    expect(resent[0].envelope.operationId).toBe(opX);
  });
});
