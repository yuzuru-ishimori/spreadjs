// テスト補助（.test.ts から import。vitest の include（*.test.ts）対象外ゆえテストとしては実行されない）。
// 決定的な手動クロック・Envelope/Operation ビルダーを提供する。index.ts では re-export しない（出荷しない）。

import type {
  CellScalar,
  ClientOperationEnvelope,
  DeleteRowsOperation,
  DocumentOperation,
  InsertRowsOperation,
  SetCellsOperation,
} from '@nanairo-sheet/core';
import {
  createColumnId,
  createDocumentId,
  createOperationId,
  createRowId,
  createTransactionId,
} from '@nanairo-sheet/types';
import type { ColumnId, RowId } from '@nanairo-sheet/types';

import type { Clock } from './deps';

/** 手動で進められる決定的クロック（TTL/acceptedAt をテストで制御する）。 */
export interface ManualClock extends Clock {
  set(time: number): void;
  advance(delta: number): void;
}

export function createManualClock(start = 0): ManualClock {
  let time = start;
  return {
    now: () => time,
    set: (value: number) => {
      time = value;
    },
    advance: (delta: number) => {
      time += delta;
    },
  };
}

export const col = (value: string): ColumnId => createColumnId(value);
export const row = (value: string): RowId => createRowId(value);
export const str = (value: string): CellScalar => ({ kind: 'string', value });
export const num = (value: number): CellScalar => ({ kind: 'number', value });

export const setCells = (changes: SetCellsOperation['changes']): SetCellsOperation => ({
  type: 'setCells',
  changes,
  conflictPolicy: 'reject-overlap',
});
export const insertRows = (afterRowId: RowId | null, rowIds: string[]): InsertRowsOperation => ({
  type: 'insertRows',
  afterRowId,
  rows: rowIds.map((r) => ({ rowId: createRowId(r) })),
});
export const deleteRows = (rowIds: RowId[]): DeleteRowsOperation => ({
  type: 'deleteRows',
  rowIds,
});

export const COLUMNS: ColumnId[] = [col('col-a'), col('col-b'), col('col-c')];

interface EnvelopeOverrides {
  operationId?: string;
  clientId?: string;
  clientSequence?: number;
  baseRevision?: number;
  actorId?: string;
  operation: DocumentOperation;
}

/** ClientOperationEnvelope を既定値つきで作る。必須は operation のみ。 */
export function envelope(overrides: EnvelopeOverrides): ClientOperationEnvelope {
  const operationId = overrides.operationId ?? 'op-default';
  return {
    protocolVersion: 1,
    documentId: createDocumentId('doc-1'),
    operationId: createOperationId(operationId),
    transactionId: createTransactionId(`tx-${operationId}`),
    actorId: overrides.actorId ?? 'user-1',
    clientId: overrides.clientId ?? 'client-A',
    clientSequence: overrides.clientSequence ?? 1,
    baseRevision: overrides.baseRevision ?? 0,
    operation: overrides.operation,
  };
}
