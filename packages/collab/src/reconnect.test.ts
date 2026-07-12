import { describe, expect, it } from 'vitest';

import { getCell } from '@nanairo-sheet/core';
import type { DocumentOperation } from '@nanairo-sheet/core';
import { createDocumentId } from '@nanairo-sheet/types';

import { createCounterIdGenerator } from './deps';
import { ClientSession } from './session';
import type { SessionConfig } from './session';
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
} from './test-support';
import type { ManualClock } from './test-support';

interface Harness {
  session: ClientSession;
  transport: RecordingTransport;
  clock: ManualClock;
}

function createSession(overrides: Partial<SessionConfig> = {}): Harness {
  const clock = createManualClock();
  const transport = new RecordingTransport();
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
    maxOfflineMillis: 30_000,
    maxOfflinePending: 100,
    ...overrides,
  });
  return { session, transport, clock };
}

function startAndWelcome(h: Harness, sessionId = 'conn-1', currentRevision = 0): void {
  h.session.start();
  h.transport.receive({ type: 'welcome', sessionId, currentRevision, colorKey: 'color-0', capabilities: { protocolVersion: 1 } });
}

function seedCommitted(h: Harness, ops: DocumentOperation[], startRevision = 1): void {
  const envs = ops.map((op, i) =>
    serverEnvelope({ revision: startRevision + i, operationId: `seed-${startRevision + i}`, operation: op, clientId: 'client-seed' }),
  );
  h.transport.receive(operationsMessage(envs));
}

describe('J. 再接続（§8.5・先にサーバー差分→後に未送信再検証）— AC1/AC5', () => {
  it('S-J1: 切断中も pending を保持（確定/未送信ローカル Operation を上限付きキューに）', () => {
    const h = createSession();
    startAndWelcome(h);
    seedCommitted(h, [insertRows(null, ['row-1'])]);
    h.session.submitLocalOperation(setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('x') }]));
    h.transport.drop();
    expect(h.session.isOnline).toBe(false);
    expect(h.session.pendingCount).toBe(1); // 切断中も保持
  });

  it('S-J2/S-J4: 再接続は同一 clientId で join（lastAppliedRevision=committed）→ 差分後に pending を再送', () => {
    const h = createSession();
    startAndWelcome(h);
    seedCommitted(h, [insertRows(null, ['row-1'])]); // committed.rev=1
    const opX = h.session.submitLocalOperation(setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('x') }]));
    const originalSeq = h.transport.sentOfType('submitOperation')[0].envelope.clientSequence;

    h.transport.clear();
    h.transport.drop();
    h.transport.reconnect(); // handleConnected → join 送信

    const joins = h.transport.sentOfType('join');
    expect(joins).toHaveLength(1);
    expect(joins[0].clientId).toBe('cA'); // clientId 不変（S-J4）
    expect(joins[0].lastAppliedRevision).toBe(1); // committed.revision（先にサーバー差分要求）

    // welcome（新 connectionId）で差分完了（新規 op 無し）→ pending 再送
    h.transport.receive({ type: 'welcome', sessionId: 'conn-2', currentRevision: 1, colorKey: 'color-0', capabilities: { protocolVersion: 1 } });
    expect(h.session.connectionId).toBe('conn-2'); // connectionId は新規（S-J4）
    const resent = h.transport.sentOfType('submitOperation');
    expect(resent).toHaveLength(1);
    expect(resent[0].envelope.operationId).toBe(opX);
    expect(resent[0].envelope.clientSequence).toBe(originalSeq); // clientSequence 継続（S-J4）
  });

  it('S-J3: 切断中に対象セルが他者更新 → 再接続の差分で再検証 stale → Conflict Queue（再送しない）', () => {
    const h = createSession();
    startAndWelcome(h);
    seedCommitted(h, [insertRows(null, ['row-1']), setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('base') }])]); // rev2
    const opX = h.session.submitLocalOperation(setCells([{ rowId: row('row-1'), columnId: col('col-a'), beforeRevision: 2, value: str('mine') }]));

    h.transport.clear();
    h.transport.drop();
    h.transport.reconnect();
    // welcome: 切断中にサーバーは rev3 まで進んだ
    h.transport.receive({ type: 'welcome', sessionId: 'conn-2', currentRevision: 3, colorKey: 'color-0', capabilities: { protocolVersion: 1 } });
    // 差分 rev3: 他者が row-1.col-a を更新
    h.transport.receive(operationsMessage([serverEnvelope({ revision: 3, operationId: 'other-3', operation: setCells([{ rowId: row('row-1'), columnId: col('col-a'), beforeRevision: 2, value: str('serverY') }]) })]));

    expect(h.session.pendingCount).toBe(0);
    expect(h.session.conflictQueue).toHaveLength(1);
    expect(h.session.conflictQueue[0].operationId).toBe(opX);
    expect(getCell(h.session.committedDocument, row('row-1'), col('col-a'))?.value).toEqual(str('serverY'));
    expect(h.transport.sentOfType('submitOperation')).toHaveLength(0); // stale は再送しない
  });

  it('S-J5（時間上限）: offline が maxOfflineMillis 超過 → 編集停止（submitLocalOperation は throw）', () => {
    const h = createSession({ maxOfflineMillis: 30_000 });
    startAndWelcome(h);
    seedCommitted(h, [insertRows(null, ['row-1'])]);
    h.transport.drop(); // offlineSince=0
    h.clock.advance(30_001);
    h.session.tick();
    expect(h.session.isStopped).toBe(true);
    expect(() => h.session.submitLocalOperation(setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('x') }]))).toThrow();
  });

  it('S-J5（件数上限）: 切断中の pending が maxOfflinePending 超過 → 編集停止', () => {
    const h = createSession({ maxOfflinePending: 3 });
    startAndWelcome(h);
    h.transport.drop();
    // offline で 4 件積む（3 を超えた時点で停止）
    h.session.submitLocalOperation(insertRows(null, ['r1']));
    h.session.submitLocalOperation(insertRows(null, ['r2']));
    h.session.submitLocalOperation(insertRows(null, ['r3']));
    h.session.submitLocalOperation(insertRows(null, ['r4']));
    expect(h.session.pendingCount).toBe(4);
    expect(h.session.isStopped).toBe(true);
    expect(() => h.session.submitLocalOperation(insertRows(null, ['r5']))).toThrow();
  });
});
