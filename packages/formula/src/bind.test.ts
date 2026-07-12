// Phase 2 Red→Green: 固定IDバインド（scenarios.md §4・AC3/4 ユニット）。

import { describe, expect, it } from 'vitest';
import {
  createColumnId,
  createRowId,
  createSheetId,
  type ColumnId,
  type RowId,
} from '@nanairo-sheet/types';
import type { A1Ref } from './ast';
import {
  bindCellRef,
  bindRange,
  boundToA1String,
  createArrayAxisView,
} from './bind';

const sheetId = createSheetId('s0');
const rowIds = (n: number): RowId[] => Array.from({ length: n }, (_, i) => createRowId(`r${i}`));
const colIds = (n: number): ColumnId[] => Array.from({ length: n }, (_, i) => createColumnId(`c${i}`));
const ref = (col: number, row: number, colAbs = false, rowAbs = false): A1Ref => ({ col, row, colAbs, rowAbs });

describe('A1 ↔ BoundCellReference 往復', () => {
  it('A1 を bind → 論理セル（r0,c0）・A1 へ戻る', () => {
    const axis = createArrayAxisView(rowIds(10), colIds(10));
    const bound = bindCellRef(ref(0, 0), axis, sheetId);
    expect(bound).not.toBe('#REF!');
    if (bound === '#REF!') return;
    expect(bound.rowId).toBe('r0');
    expect(bound.columnId).toBe('c0');
    expect(bound.rowMode).toBe('relative');
    expect(bound.columnMode).toBe('relative');
    expect(boundToA1String(bound, axis)).toBe('A1');
  });

  it('$A$1 は絶対属性を保持し往復で $ を保存', () => {
    const axis = createArrayAxisView(rowIds(10), colIds(10));
    const bound = bindCellRef(ref(0, 0, true, true), axis, sheetId);
    if (bound === '#REF!') throw new Error('unexpected #REF!');
    expect(bound.columnMode).toBe('absolute');
    expect(bound.rowMode).toBe('absolute');
    expect(boundToA1String(bound, axis)).toBe('$A$1');
  });

  it('範囲外の参照は #REF!', () => {
    const axis = createArrayAxisView(rowIds(3), colIds(3));
    expect(bindCellRef(ref(5, 0), axis, sheetId)).toBe('#REF!');
    expect(bindCellRef(ref(0, 5), axis, sheetId)).toBe('#REF!');
  });
});

describe('構造変更後の固定ID維持（AC3/4 ユニット）', () => {
  it('参照行の手前に2行挿入 → RowId 不変・A1 表示は A3 へ', () => {
    const before = createArrayAxisView(rowIds(10), colIds(10));
    const bound = bindCellRef(ref(0, 0), before, sheetId); // A1 = r0
    if (bound === '#REF!') throw new Error('unexpected');
    // 手前に rX, rY を挿入した新しい Axis（RowId r0 は不変）。
    const inserted = createArrayAxisView(
      [createRowId('rX'), createRowId('rY'), ...rowIds(10)],
      colIds(10),
    );
    expect(bound.rowId).toBe('r0'); // 論理セルは不変
    expect(boundToA1String(bound, inserted)).toBe('A3'); // 表示は移動後の位置
  });

  it('参照先の行を削除 → #REF!', () => {
    const before = createArrayAxisView(rowIds(10), colIds(10));
    const bound = bindCellRef(ref(0, 0), before, sheetId); // r0
    if (bound === '#REF!') throw new Error('unexpected');
    const deleted = createArrayAxisView(
      rowIds(10).filter((id) => id !== 'r0'),
      colIds(10),
    );
    expect(boundToA1String(bound, deleted)).toBe('#REF!');
  });

  it('範囲参照 A1:B2 の bind と解決', () => {
    const axis = createArrayAxisView(rowIds(10), colIds(10));
    const bound = bindRange(ref(0, 0), ref(1, 1), axis, sheetId);
    if (bound === '#REF!') throw new Error('unexpected');
    expect(boundToA1String(bound.start, axis)).toBe('A1');
    expect(boundToA1String(bound.end, axis)).toBe('B2');
  });
});
