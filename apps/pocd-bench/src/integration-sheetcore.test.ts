// Phase 3: sheet-core 実文書との結合試験（AC3/4 の実文書版・scenarios.md §10）。
// sheet-core は「読み取り＋applyOperation」のみ利用（既存 package 無変更）。sheet-formula の
// 固定IDバインド（BoundCellReference）が、実 InsertRows/DeleteRows でも A1表示変化・評価値維持・
// 参照先削除で #REF! を満たすことを裏取りする。

import { describe, expect, it } from 'vitest';
import {
  applyOperation,
  createDocument,
  displayRowOrder,
  getCell,
  type SheetDocument,
} from '@nanairo-sheet/sheet-core';
import {
  createColumnId,
  createRowId,
  createSheetId,
  type ColumnId,
  type RowId,
} from '@nanairo-sheet/sheet-types';
import {
  bindCellRef,
  boundToA1String,
  createArrayAxisView,
  type AxisView,
  type BoundCellReference,
} from '@nanairo-sheet/sheet-formula';

const sheetId = createSheetId('s0');

/** sheet-core 文書の displayRowOrder / columnOrder から AxisView を作る（読み取り専用アダプタ）。 */
function axisOf(doc: SheetDocument): AxisView {
  return createArrayAxisView(displayRowOrder(doc), doc.columnOrder);
}

/** 束縛セルの現在値（数値）を読む。無ければ undefined。 */
function boundNumber(doc: SheetDocument, bound: BoundCellReference): number | undefined {
  const rec = getCell(doc, bound.rowId, bound.columnId);
  return rec !== undefined && rec.value.kind === 'number' ? rec.value.value : undefined;
}

function setup(): { doc: SheetDocument; rows: RowId[]; cols: ColumnId[] } {
  const cols = [createColumnId('c0'), createColumnId('c1')];
  let doc = createDocument(cols);
  const rows = Array.from({ length: 5 }, (_, i) => createRowId(`r${i}`));
  // afterRowId=null で先頭へ r0..r4 を一括挿入 → rowOrder=[r0..r4]。
  doc = applyOperation(doc, { type: 'insertRows', afterRowId: null, rows: rows.map((rowId) => ({ rowId })) }, { revision: 1 }).document;
  // A1(r0,c0)=10 を SetCells。
  doc = applyOperation(
    doc,
    { type: 'setCells', conflictPolicy: 'reject-overlap', changes: [{ rowId: rows[0]!, columnId: cols[0]!, value: { kind: 'number', value: 10 } }] },
    { revision: 2 },
  ).document;
  return { doc, rows, cols };
}

describe('sheet-core 結合: 固定ID参照の維持（AC3）', () => {
  it('参照行の手前に行挿入 → A1表示はA2へ・束縛セルの評価値は不変', () => {
    const { doc, rows } = setup();
    // A1（index row0,col0）を束縛 → rowId r0。
    const bound = bindCellRef({ col: 0, row: 0, colAbs: false, rowAbs: false }, axisOf(doc), sheetId);
    if (bound === '#REF!') throw new Error('unexpected #REF!');
    expect(bound.rowId).toBe(rows[0]);
    expect(boundToA1String(bound, axisOf(doc))).toBe('A1');
    expect(boundNumber(doc, bound)).toBe(10);

    // r0 の手前に新規行を挿入（実 InsertRows）。
    const inserted = applyOperation(
      doc,
      { type: 'insertRows', afterRowId: null, rows: [{ rowId: createRowId('rNew') }] },
      { revision: 3 },
    ).document;

    expect(bound.rowId).toBe(rows[0]); // 論理セルは不変
    expect(boundToA1String(bound, axisOf(inserted))).toBe('A2'); // 表示は移動後
    expect(boundNumber(inserted, bound)).toBe(10); // 固定ID評価値は維持
  });
});

describe('sheet-core 結合: 参照先削除で #REF!（AC4）', () => {
  it('参照先の行を削除 → 束縛参照は #REF!', () => {
    const { doc, rows } = setup();
    const bound = bindCellRef({ col: 0, row: 0, colAbs: false, rowAbs: false }, axisOf(doc), sheetId);
    if (bound === '#REF!') throw new Error('unexpected #REF!');

    // r0 を削除（実 DeleteRows・tombstone 化）。
    const deleted = applyOperation(doc, { type: 'deleteRows', rowIds: [rows[0]!] }, { revision: 3 }).document;

    expect(displayRowOrder(deleted)).not.toContain(rows[0]);
    expect(boundToA1String(bound, axisOf(deleted))).toBe('#REF!');
  });
});
