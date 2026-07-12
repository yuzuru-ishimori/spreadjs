// 決定論 Operation 列生成（DD-006 Phase 4・AC5・DD-003 fuzzer 踏襲）。
// SetCells/InsertRows/DeleteRows を混在させ、同一 seed から常に同一列を返す。
// 生成する Operation はすべて「適用可能（valid）」= live 行のみ参照し ApplyError を出さない
// （replay 時間の純粋計測のため。フォールト注入は DD-003 が担当）。DOM/Node 非依存。

import type {
  ColumnId,
  RowId,
} from '@nanairo-sheet/types';
import { createColumnId, createRowId } from '@nanairo-sheet/types';
import type { CellScalar, DocumentOperation } from '@nanairo-sheet/core';
import { createPrng, type Prng } from './prng';

export interface GeneratedOps {
  readonly columns: ColumnId[];
  readonly initialRowIds: RowId[];
  readonly operations: DocumentOperation[];
}

export interface OpGenConfig {
  readonly count: number;
  readonly seed: number;
  readonly initialRows: number;
  readonly cols: number;
}

function makeValue(prng: Prng): CellScalar {
  if (prng.next() < 0.7) return { kind: 'number', value: prng.nextInt(1_000_000) };
  return { kind: 'string', value: `v${prng.nextInt(100000)}` };
}

/** 決定論に Operation 列を生成する。 */
export function generateOperations(config: OpGenConfig): GeneratedOps {
  const { count, seed, initialRows, cols } = config;
  const prng = createPrng(seed);
  const columns = Array.from({ length: cols }, (_, i) => createColumnId(`c${i}`));
  const initialRowIds = Array.from({ length: initialRows }, (_, i) => createRowId(`r-init-${i}`));
  const live: RowId[] = [...initialRowIds];
  const operations: DocumentOperation[] = [];
  let genCounter = 0;

  const pickLive = (): RowId => live[prng.nextInt(live.length)] ?? live[0]!;
  const pickCol = (): ColumnId => columns[prng.nextInt(columns.length)] ?? columns[0]!;

  for (let i = 0; i < count; i += 1) {
    const roll = prng.next();
    if (roll < 0.78) {
      // SetCells（live 行のみ）。
      operations.push({
        type: 'setCells',
        conflictPolicy: 'reject-overlap',
        changes: [{ rowId: pickLive(), columnId: pickCol(), value: makeValue(prng) }],
      });
    } else if (roll < 0.92) {
      // InsertRows（アンカーは live 行 or 先頭・新 rowId は一意）。
      const anchor = prng.next() < 0.1 ? null : pickLive();
      const rowId = createRowId(`r-gen-${genCounter}`);
      genCounter += 1;
      live.push(rowId);
      operations.push({ type: 'insertRows', afterRowId: anchor, rows: [{ rowId }] });
    } else if (live.length > 50) {
      // DeleteRows（live 行を1つ・50行は残す）。
      const idx = prng.nextInt(live.length);
      const rowId = live[idx] ?? live[0]!;
      live.splice(idx, 1);
      operations.push({ type: 'deleteRows', rowIds: [rowId] });
    } else {
      // live が少ないときは SetCells で埋める（決定論の draw を消費）。
      operations.push({
        type: 'setCells',
        conflictPolicy: 'reject-overlap',
        changes: [{ rowId: pickLive(), columnId: pickCol(), value: makeValue(prng) }],
      });
    }
  }

  return { columns, initialRowIds, operations };
}
