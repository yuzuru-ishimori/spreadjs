import { describe, expect, it } from 'vitest';

import { applyOperation, createDocument } from '@nanairo-sheet/sheet-core';
import type { DocumentOperation, SheetDocument } from '@nanairo-sheet/sheet-core';
import { col, insertRows, num, row, setCells, str } from '@nanairo-sheet/sheet-collaboration/test-support';

import {
  DocumentView,
  cellScalarToDisplay,
  operationDirtyKind,
} from './document-view';

const COLS = [col('col-0'), col('col-1'), col('col-2')];

/** ClientSession の committed を模した文書ホルダー（Operation を順に適用して view を進める）。 */
function createDocHolder(): {
  view: DocumentView;
  apply: (op: DocumentOperation) => void;
  doc: () => SheetDocument;
} {
  let doc = createDocument(COLS);
  let revision = 0;
  const apply = (op: DocumentOperation): void => {
    revision += 1;
    doc = applyOperation(doc, op, { revision }).document;
  };
  const view = new DocumentView({ getDocument: () => doc, rowHeight: 20, colWidth: 60 });
  return { view, apply, doc: () => doc };
}

/** queryRange の結果を (row,col,value) 配列で収集する。 */
function collect(view: DocumentView, r0: number, r1: number, c0: number, c1: number): Array<[number, number, string]> {
  const out: Array<[number, number, string]> = [];
  view.store.queryRange(r0, r1, c0, c1, (r, c, v) => out.push([r, c, v]));
  return out;
}

describe('cellScalarToDisplay / operationDirtyKind（純粋関数）', () => {
  it('CellScalar を描画文字列へ', () => {
    expect(cellScalarToDisplay({ kind: 'blank' })).toBe('');
    expect(cellScalarToDisplay(str('あ'))).toBe('あ');
    expect(cellScalarToDisplay(num(42.5))).toBe('42.5');
  });

  it('Operation を dirty 種別へ分類', () => {
    expect(operationDirtyKind(setCells([]))).toBe('cell');
    expect(operationDirtyKind(insertRows(null, ['r0']))).toBe('row-structure');
    expect(operationDirtyKind({ type: 'deleteRows', rowIds: [row('r0')] })).toBe('row-structure');
  });
});

describe('DocumentView（ClientSession 文書の読み取りアダプター・#2）', () => {
  it('初期構築で colAxis=列順・rowAxis=displayRowOrder', () => {
    const { view, apply } = createDocHolder();
    expect(view.colAxis.count()).toBe(3);
    expect(view.rowAxis.count()).toBe(0);
    apply(insertRows(null, ['r0', 'r1', 'r2']));
    view.markStructureDirty();
    view.flush();
    expect(view.rowAxis.count()).toBe(3);
    expect(view.rowIndexOf(row('r0'))).toBe(0);
    expect(view.rowIndexOf(row('r2'))).toBe(2);
  });

  it('queryRange は ClientSession 文書の可視セルを読む（blank は描画しない）', () => {
    const { view, apply } = createDocHolder();
    apply(insertRows(null, ['r0', 'r1']));
    apply(setCells([{ rowId: row('r1'), columnId: col('col-1'), value: str('hello') }]));
    view.markStructureDirty();
    view.markCellDirty();
    view.flush();
    expect(collect(view, 0, 2, 0, 3)).toEqual([[1, 1, 'hello']]);
  });

  it('store への書き込みは禁止（第二 CellStore を作らない・#2）', () => {
    const { view } = createDocHolder();
    expect(() => view.store.set(0, 0, 'x')).toThrow(/読み取り専用/);
    expect(() => view.store.bulkLoad([])).toThrow(/読み取り専用/);
  });

  it('SetCells は rowAxis を再構築しない（#5 全再構築の否定・同一 Axis 参照）', () => {
    const { view, apply } = createDocHolder();
    apply(insertRows(null, ['r0', 'r1', 'r2']));
    view.markStructureDirty();
    view.flush();
    const axisAfterBuild = view.rowAxis;
    const rebuildsAfterBuild = view.structuralRebuildCount;

    // セル更新 → cell dirty のみ。
    apply(setCells([{ rowId: row('r1'), columnId: col('col-0'), value: num(7) }]));
    view.noteOperation(setCells([{ rowId: row('r1'), columnId: col('col-0'), value: num(7) }]));
    const result = view.flush();

    expect(result.dirty.cell).toBe(true);
    expect(result.dirty['row-structure']).toBe(false);
    expect(result.structuralRebuilt).toBe(false);
    expect(view.structuralRebuildCount).toBe(rebuildsAfterBuild); // Axis 再構築回数が増えない
    expect(view.rowAxis).toBe(axisAfterBuild); // 同一 Axis 参照のまま
    expect(collect(view, 1, 2, 0, 1)).toEqual([[1, 0, '7']]); // 新しい値が読める
  });

  it('InsertRows（編集行の上）で RowId 追従（AC4 前提・#4）', () => {
    const { view, apply } = createDocHolder();
    apply(insertRows(null, ['r0', 'r1', 'r2']));
    apply(setCells([{ rowId: row('r2'), columnId: col('col-0'), value: str('X') }]));
    view.markFullRebuild();
    view.flush();
    expect(view.rowIndexOf(row('r2'))).toBe(2);
    expect(collect(view, 2, 3, 0, 1)).toEqual([[2, 0, 'X']]);

    const axisBefore = view.rowAxis;
    const rebuildsBefore = view.structuralRebuildCount;
    // 先頭へ 1 行挿入 → r2 は index 3 へずれるが RowId は不変。
    apply(insertRows(null, ['rNew']));
    view.noteOperation(insertRows(null, ['rNew']));
    const result = view.flush();

    expect(result.structuralRebuilt).toBe(true);
    expect(view.structuralRebuildCount).toBe(rebuildsBefore + 1);
    expect(view.rowAxis).not.toBe(axisBefore); // 構造Op では Axis を作り直す
    expect(view.rowIndexOf(row('r2'))).toBe(3); // 同一 RowId が新 index へ解決
    expect(collect(view, 3, 4, 0, 1)).toEqual([[3, 0, 'X']]); // 値も追従
  });

  it('DeleteRows で編集行の消失を検知（#4・削除判定は tombstone/displayRowOrder 消失）', () => {
    const { view, apply } = createDocHolder();
    apply(insertRows(null, ['r0', 'r1', 'r2']));
    view.markStructureDirty();
    view.flush();
    expect(view.hasRow(row('r1'))).toBe(true);

    apply({ type: 'deleteRows', rowIds: [row('r1')] });
    view.markStructureDirty();
    view.flush();
    expect(view.hasRow(row('r1'))).toBe(false); // tombstone 化＝index 範囲でなく存在で判定
    expect(view.rowIndexOf(row('r1'))).toBe(-1);
    expect(view.rowIndexOf(row('r2'))).toBe(1); // 詰められた表示位置
  });

  it('viewport dirty は再描画するが Axis 不変', () => {
    const { view, apply } = createDocHolder();
    apply(insertRows(null, ['r0']));
    view.markFullRebuild();
    view.flush();
    const axis = view.rowAxis;
    view.markViewportDirty();
    const result = view.flush();
    expect(result.needsRedraw).toBe(true);
    expect(result.dirty.viewport).toBe(true);
    expect(result.structuralRebuilt).toBe(false);
    expect(view.rowAxis).toBe(axis);
  });

  it('dirty が無ければ needsRedraw=false（アイドルフレームは描画しない）', () => {
    const { view } = createDocHolder();
    expect(view.flush().needsRedraw).toBe(false);
  });
});
