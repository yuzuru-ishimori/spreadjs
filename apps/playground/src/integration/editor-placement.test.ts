import { describe, expect, it } from 'vitest';

import { createColumnId, createRowId } from '@nanairo-sheet/sheet-types';
import type { ColumnId, RowId } from '@nanairo-sheet/sheet-types';

import { createAxis } from '../pocb/axis';
import { createViewportTransform } from '../pocb/viewport';

import { computeEditorPlacement, type PlacementConfig } from './editor-placement';

const HEADER_W = 52;
const HEADER_H = 24;
const ROW_H = 22;
const COL_W = 80;
const VIEW_W = 400;
const VIEW_H = 300;

function rowIds(n: number): RowId[] {
  return Array.from({ length: n }, (_v, i) => createRowId(`r${i}`));
}
function colIds(n: number): ColumnId[] {
  return Array.from({ length: n }, (_v, i) => createColumnId(`c${i}`));
}

function transformAt(scrollTop: number, scrollLeft: number) {
  return createViewportTransform({
    rowAxis: createAxis({ ids: rowIds(1000), defaultSize: ROW_H }),
    colAxis: createAxis({ ids: colIds(50), defaultSize: COL_W }),
    headerWidth: HEADER_W,
    headerHeight: HEADER_H,
    frozenRowCount: 1,
    frozenColCount: 1,
    viewportWidth: VIEW_W,
    viewportHeight: VIEW_H,
    scrollLeft,
    scrollTop,
    overscanX: COL_W,
    overscanY: VIEW_H,
  });
}

const CFG: PlacementConfig = {
  headerWidth: HEADER_W,
  headerHeight: HEADER_H,
  viewportWidth: VIEW_W,
  viewportHeight: VIEW_H,
  frozenRowCount: 1,
  frozenColCount: 1,
};

describe('computeEditorPlacement（§13.5 pane 区別・AC3 追従）', () => {
  it('index<0（RowId/ColumnId が Axis に無い）は非可視', () => {
    const t = transformAt(0, 0);
    expect(computeEditorPlacement(t, -1, 3, CFG).visible).toBe(false);
    expect(computeEditorPlacement(t, 3, -1, CFG).visible).toBe(false);
  });

  it('可視領域内のスクロールセルは visible＝true・rect は cellRect と一致', () => {
    const t = transformAt(0, 0);
    const p = computeEditorPlacement(t, 3, 3, CFG);
    expect(p.visible).toBe(true);
    expect(p.rect).toEqual(t.cellRect(3, 3));
  });

  it('スクロールで下方向へ大きく動くと同一 index のセルは画面外＝非可視', () => {
    // row index 3 は上方。scrollTop を十分大きくすると frozen 下端より上へ抜けて隠れる。
    const t = transformAt(5000, 0);
    expect(computeEditorPlacement(t, 3, 3, CFG).visible).toBe(false);
  });

  it('スクロールしても遠い下方の可視行は追従して可視（AC3: 同一 index が画面内に来ると可視）', () => {
    const t = transformAt(5000, 0);
    // scrollTop=5000 付近の行は body に入る。indexAt で可視行を選ぶ。
    const near = t.hitTest(HEADER_W + 100, HEADER_H + (t.frozenHeight() + 50)).rowIndex;
    expect(computeEditorPlacement(t, near, 3, CFG).visible).toBe(true);
  });

  it('固定行（index<frozenRowCount）はスクロールしても常に可視（pane 区別）', () => {
    const scrolled = transformAt(5000, 3000);
    expect(computeEditorPlacement(scrolled, 0, 0, CFG).visible).toBe(true); // corner（固定行×固定列）
  });

  it('スクロールセルが固定バンドの真下へ隠れると非可視（minY=header+frozenHeight）', () => {
    // 固定行のすぐ下（body 先頭）の行が、少しスクロールしただけで固定バンド下へ潜る境界。
    const t = transformAt(ROW_H * 4, 0); // body 先頭付近を 4 行分スクロール
    // body 先頭 index=1 はスクロールで frozen バンド下へ隠れているはず。
    expect(computeEditorPlacement(t, 1, 3, CFG).visible).toBe(false);
  });
});
