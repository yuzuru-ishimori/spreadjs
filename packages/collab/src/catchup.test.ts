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
    ...overrides,
  });
  return { session, transport, clock };
}

function startAndWelcome(h: Harness, currentRevision = 0): void {
  h.session.start();
  h.transport.receive({ type: 'welcome', sessionId: 'conn-1', currentRevision, colorKey: 'color-0', capabilities: { protocolVersion: 1 } });
}

function seedCommitted(h: Harness, ops: DocumentOperation[], startRevision = 1): void {
  const envs = ops.map((op, i) =>
    serverEnvelope({ revision: startRevision + i, operationId: `seed-${startRevision + i}`, operation: op, clientId: 'client-seed' }),
  );
  h.transport.receive(operationsMessage(envs));
}

// I カテゴリ共通のオペレーション列（revision に対応）
const REV2 = insertRows(row('row-1'), ['row-2']);
const REV3 = setCells([{ rowId: row('row-2'), columnId: col('col-a'), value: str('r3') }]);
const REV4 = setCells([{ rowId: row('row-2'), columnId: col('col-b'), value: str('r4') }]);

describe('I. 欠落検知 → requestCatchup / 重複無視 / バッファ（AC3・§8.4）', () => {
  it('S-I1/S-I5: revision 欠落 → requestCatchup{afterRevision: nextExpected-1}（off-by-one）・先の op は適用しない', () => {
    const h = createSession();
    startAndWelcome(h);
    seedCommitted(h, [insertRows(null, ['row-1'])]); // committed.rev=1, nextExpected=2

    // rev3 が届く（rev2 欠落）
    h.transport.receive(operationsMessage([serverEnvelope({ revision: 3, operationId: 'other-3', operation: REV3 })]));

    const catchups = h.transport.sentOfType('requestCatchup');
    expect(catchups).toHaveLength(1);
    expect(catchups[0].afterRevision).toBe(1); // = nextExpected(2) - 1（S-I5 off-by-one）
    // rev3 は適用しない（バッファ保留）
    expect(h.session.nextExpectedRevision).toBe(2);
    expect(h.session.committedDocument.revision).toBe(1);
  });

  it('S-I2: catch-up 応答（rev2..）→ 順に適用しバッファの rev3 も適用して収束', () => {
    const h = createSession();
    startAndWelcome(h);
    seedCommitted(h, [insertRows(null, ['row-1'])]);
    h.transport.receive(operationsMessage([serverEnvelope({ revision: 3, operationId: 'other-3', operation: REV3 })])); // 欠落 → バッファ

    // catch-up 応答: rev2 到着 → drain で rev2, rev3 を順適用
    h.transport.receive(operationsMessage([serverEnvelope({ revision: 2, operationId: 'other-2', operation: REV2 })]));

    expect(h.session.nextExpectedRevision).toBe(4);
    expect(h.session.committedDocument.revision).toBe(3);
    expect(getCell(h.session.committedDocument, row('row-2'), col('col-a'))?.value).toEqual(str('r3'));
  });

  it('S-I3: 期待より小さい revision は重複として無視（二重適用0）', () => {
    const h = createSession();
    startAndWelcome(h);
    seedCommitted(h, [insertRows(null, ['row-1']), setCells([{ rowId: row('row-1'), columnId: col('col-a'), value: str('v') }])]); // rev1,2 → nextExpected=3
    const before = h.session.committedHash();

    // rev1 を再配信（< nextExpected=3）→ 無視
    h.transport.receive(operationsMessage([serverEnvelope({ revision: 1, operationId: 'seed-1', operation: insertRows(null, ['row-1']) })]));
    expect(h.session.committedHash()).toBe(before);
    expect(h.session.nextExpectedRevision).toBe(3);
    expect(h.transport.sentOfType('requestCatchup')).toHaveLength(0); // 重複は catchup を誘発しない
  });

  it('S-I4: catch-up 待ち中の新着はバッファに積む（順序を飛ばさない・重複 requestCatchup を抑止）', () => {
    const h = createSession();
    startAndWelcome(h);
    seedCommitted(h, [insertRows(null, ['row-1'])]); // nextExpected=2

    h.transport.receive(operationsMessage([serverEnvelope({ revision: 3, operationId: 'other-3', operation: REV3 })])); // gap → catchup{after:1}
    h.transport.receive(operationsMessage([serverEnvelope({ revision: 4, operationId: 'other-4', operation: REV4 })])); // 待ち中の新着 → バッファ（再 catchup しない）
    expect(h.transport.sentOfType('requestCatchup')).toHaveLength(1); // 同一 gap では 1 回だけ
    expect(h.session.nextExpectedRevision).toBe(2); // まだ適用しない

    // catch-up 応答 rev2 → drain で rev2,3,4 を順適用
    h.transport.receive(operationsMessage([serverEnvelope({ revision: 2, operationId: 'other-2', operation: REV2 })]));
    expect(h.session.nextExpectedRevision).toBe(5);
    expect(getCell(h.session.committedDocument, row('row-2'), col('col-a'))?.value).toEqual(str('r3'));
    expect(getCell(h.session.committedDocument, row('row-2'), col('col-b'))?.value).toEqual(str('r4'));
  });

  it('S-I4（部分充填）: gap が前進したら残りの欠落へ再 catchup（afterRevision も前進）', () => {
    const h = createSession();
    startAndWelcome(h);
    seedCommitted(h, [insertRows(null, ['row-1'])]); // nextExpected=2

    h.transport.receive(operationsMessage([serverEnvelope({ revision: 4, operationId: 'other-4', operation: REV4 })])); // gap at 2 → catchup{after:1}
    // rev2 のみ充填（rev3 は依然欠落）→ gap が 3 へ前進 → 再 catchup{after:2}
    h.transport.receive(operationsMessage([serverEnvelope({ revision: 2, operationId: 'other-2', operation: REV2 })]));
    const catchups = h.transport.sentOfType('requestCatchup');
    expect(catchups.map((c) => c.afterRevision)).toEqual([1, 2]); // gap 前進で再要求
    expect(h.session.nextExpectedRevision).toBe(3); // rev2 まで適用・rev4 はバッファ
  });
});
