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
  bindExpr,
  blank,
  boundToA1String,
  cellValueToString,
  createArrayAxisView,
  evaluate,
  num,
  parse,
  resolveExpr,
  str,
  type AxisView,
  type BoundCellReference,
  type CellReader,
  type CellValue,
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

/** sheet-core 文書を index ベースで読む CellReader（displayRowOrder/columnOrder 経由）。 */
function readerOf(doc: SheetDocument, axis: AxisView): CellReader {
  const readAt = (row: number, col: number): CellValue => {
    const rowId = axis.rowIdAt(row);
    const colId = axis.columnIdAt(col);
    if (rowId === undefined || colId === undefined) return blank;
    const rec = getCell(doc, rowId, colId);
    if (rec === undefined) return blank;
    const v = rec.value;
    return v.kind === 'number' ? num(v.value) : v.kind === 'string' ? str(v.value) : blank;
  };
  return {
    read: readAt,
    readRange: (r0, r1, c0, c1, visit) => {
      for (let r = r0; r < r1; r += 1) {
        for (let c = c0; c < c1; c += 1) {
          const val = readAt(r, c);
          if (val.kind !== 'blank') visit(r, c, val);
        }
      }
    },
  };
}

describe('sheet-core 結合: 数式評価が固定IDで維持（AC3/4・評価統合・Codex P1）', () => {
  it('=A1*2 を bind → 行挿入後も評価値20を維持／参照行削除で #REF!', () => {
    const { doc, rows } = setup(); // A1(r0,c0)=10
    const p = parse('=A1*2');
    if (!p.ok) throw new Error(p.error);
    // 作成時 Axis で固定ID束縛。
    const bound = bindExpr(p.ast, axisOf(doc), sheetId);
    if (bound === '#REF!') throw new Error('unexpected bind #REF!');

    // 作成時: 現在Axisで解決して評価 → 10*2 = 20。
    const resolved0 = resolveExpr(bound, axisOf(doc));
    if (resolved0 === '#REF!') throw new Error('unexpected resolve #REF!');
    expect(cellValueToString(evaluate(resolved0, readerOf(doc, axisOf(doc))))).toBe('20');

    // 行挿入（r0 の手前）→ 束縛は r0 を指すため index が繰り下がるが評価値は不変。
    const inserted = applyOperation(
      doc,
      { type: 'insertRows', afterRowId: null, rows: [{ rowId: createRowId('rNew') }] },
      { revision: 3 },
    ).document;
    const resolvedIns = resolveExpr(bound, axisOf(inserted));
    if (resolvedIns === '#REF!') throw new Error('unexpected #REF! after insert');
    expect(cellValueToString(evaluate(resolvedIns, readerOf(inserted, axisOf(inserted))))).toBe('20');

    // 参照行 r0 を削除 → 式全体が #REF!（解決不能）。
    const deleted = applyOperation(doc, { type: 'deleteRows', rowIds: [rows[0]!] }, { revision: 3 }).document;
    expect(resolveExpr(bound, axisOf(deleted))).toBe('#REF!');
  });
});
