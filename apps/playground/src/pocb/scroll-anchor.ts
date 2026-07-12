// ScrollAnchor（計画書 §13.4）: 行高変更・行挿入・リモート構造更新で画面が跳ばないよう、
// スクロール域先頭の論理セル（rowId＋行内オフセット / columnId＋列内オフセット）を保持し、
// 構造変更後に同じ ID を基準に scrollTop/Left を補正する。DOM 非依存の純粋計算。

import type { ColumnId, RowId } from '@nanairo-sheet/types';

import type { Axis } from './axis';

/** §13.4 の ScrollAnchor。indexHint は PoC のアンカー行消失時フォールバック用。 */
export interface ScrollAnchor {
  readonly rowId: RowId;
  readonly offsetWithinRow: number;
  readonly columnId: ColumnId;
  readonly offsetWithinColumn: number;
  /** 捕捉時の行 index（アンカー行が削除された場合の近傍フォールバックに使う）。 */
  readonly rowIndexHint: number;
  /** 捕捉時の列 index。 */
  readonly columnIndexHint: number;
}

export interface AnchorCaptureParams {
  readonly rowAxis: Axis<RowId>;
  readonly colAxis: Axis<ColumnId>;
  readonly frozenRowCount: number;
  readonly frozenColCount: number;
  readonly scrollTop: number;
  readonly scrollLeft: number;
}

export interface AnchorRestoreParams {
  readonly rowAxis: Axis<RowId>;
  readonly colAxis: Axis<ColumnId>;
  readonly frozenRowCount: number;
  readonly frozenColCount: number;
  readonly anchor: ScrollAnchor;
}

/** スクロール域先頭の論理セルをアンカーとして捕捉する。 */
export function captureAnchor(params: AnchorCaptureParams): ScrollAnchor {
  const { rowAxis, colAxis, frozenRowCount, frozenColCount, scrollTop, scrollLeft } = params;
  const frozenHeight = rowAxis.offsetOf(frozenRowCount);
  const frozenWidth = colAxis.offsetOf(frozenColCount);

  // スクロール域の見えている先頭の content 座標。
  const topContent = frozenHeight + scrollTop;
  const leftContent = frozenWidth + scrollLeft;
  const rowIndex = Math.max(rowAxis.indexAt(topContent), frozenRowCount);
  const colIndex = Math.max(colAxis.indexAt(leftContent), frozenColCount);

  return {
    rowId: rowAxis.getId(rowIndex),
    offsetWithinRow: topContent - rowAxis.offsetOf(rowIndex),
    columnId: colAxis.getId(colIndex),
    offsetWithinColumn: leftContent - colAxis.offsetOf(colIndex),
    rowIndexHint: rowIndex,
    columnIndexHint: colIndex,
  };
}

/** 削除でアンカー ID が消えた場合に、index ヒントを新 count でクランプして近傍へフォールバック。 */
function resolveIndex<Id extends string>(axis: Axis<Id>, id: Id, indexHint: number): number {
  const found = axis.getIndex(id);
  if (found >= 0) {
    return found;
  }
  const count = axis.count();
  if (count === 0) {
    return 0;
  }
  return Math.min(Math.max(indexHint, 0), count - 1);
}

/**
 * 構造変更後、アンカーを基準に scrollTop/Left を補正して画面が跳ばないようにする。
 * アンカー行/列が残っていればその ID 位置、削除されていれば index ヒントの近傍へ寄せる。
 */
export function correctScroll(params: AnchorRestoreParams): { scrollTop: number; scrollLeft: number } {
  const { rowAxis, colAxis, frozenRowCount, frozenColCount, anchor } = params;
  const frozenHeight = rowAxis.offsetOf(frozenRowCount);
  const frozenWidth = colAxis.offsetOf(frozenColCount);

  const rowIndex = resolveIndex(rowAxis, anchor.rowId, anchor.rowIndexHint);
  const colIndex = resolveIndex(colAxis, anchor.columnId, anchor.columnIndexHint);

  const topContent = rowAxis.offsetOf(rowIndex) + anchor.offsetWithinRow;
  const leftContent = colAxis.offsetOf(colIndex) + anchor.offsetWithinColumn;

  return {
    scrollTop: Math.max(0, topContent - frozenHeight),
    scrollLeft: Math.max(0, leftContent - frozenWidth),
  };
}
