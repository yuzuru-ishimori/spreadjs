// Phase 4: 決定論 Operation 列（scenarios.md §8）＋ replay 整合（AC5素材）。

import { describe, expect, it } from 'vitest';
import {
  applyOperation,
  createDocument,
  documentHash,
  type SheetDocument,
} from '@nanairo-sheet/sheet-core';
import { generateOperations } from './op-gen';

function replay(count: number, seed: number): { doc: SheetDocument; applied: number } {
  const { columns, initialRowIds, operations } = generateOperations({ count, seed, initialRows: 200, cols: 8 });
  let doc = createDocument(columns);
  doc = applyOperation(doc, { type: 'insertRows', afterRowId: null, rows: initialRowIds.map((rowId) => ({ rowId })) }, { revision: 1 }).document;
  let rev = 2;
  let applied = 0;
  for (const op of operations) {
    doc = applyOperation(doc, op, { revision: rev }).document; // ApplyError が出れば op-gen のバグ
    rev += 1;
    applied += 1;
  }
  return { doc, applied };
}

describe('op-gen: 決定論', () => {
  it('同一 seed で完全一致の Operation 列・件数一致', () => {
    const a = generateOperations({ count: 2000, seed: 7, initialRows: 100, cols: 5 });
    const b = generateOperations({ count: 2000, seed: 7, initialRows: 100, cols: 5 });
    expect(a.operations.length).toBe(2000);
    expect(a.operations).toEqual(b.operations);
  });
  it('異なる seed で列が変わる', () => {
    const a = generateOperations({ count: 500, seed: 1, initialRows: 50, cols: 5 });
    const b = generateOperations({ count: 500, seed: 2, initialRows: 50, cols: 5 });
    expect(a.operations).not.toEqual(b.operations);
  });
});

describe('op-gen: replay 整合（AC5素材）', () => {
  it('全 Operation が valid（ApplyError なし）・同一 seed の replay で hash 一致', () => {
    const r1 = replay(3000, 42);
    const r2 = replay(3000, 42);
    expect(r1.applied).toBe(3000);
    expect(documentHash(r1.doc)).toBe(documentHash(r2.doc)); // 決定論
  });
  it('SetCells/InsertRows/DeleteRows が混在する', () => {
    const { operations } = generateOperations({ count: 3000, seed: 5, initialRows: 200, cols: 8 });
    const kinds = new Set(operations.map((o) => o.type));
    expect(kinds.has('setCells')).toBe(true);
    expect(kinds.has('insertRows')).toBe(true);
    expect(kinds.has('deleteRows')).toBe(true);
  });
});
