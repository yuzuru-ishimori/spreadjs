// 選択範囲（矩形）ユーティリティ。anchor/focus セルから正規化した半開区間の矩形を作る。
// DOM 非依存の純粋関数（overlay-layer・main・presence が共有）。

/** 半開区間 [rowStart,rowEnd)×[colStart,colEnd) のセル矩形範囲。 */
export interface CellRange {
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly colStart: number;
  readonly colEnd: number;
}

export interface CellPos {
  readonly row: number;
  readonly col: number;
}

/** anchor（選択開始）と focus（現在位置）から正規化した矩形範囲を作る。 */
export function rangeFromAnchorFocus(anchor: CellPos, focus: CellPos): CellRange {
  return {
    rowStart: Math.min(anchor.row, focus.row),
    rowEnd: Math.max(anchor.row, focus.row) + 1,
    colStart: Math.min(anchor.col, focus.col),
    colEnd: Math.max(anchor.col, focus.col) + 1,
  };
}

/** range が (row,col) を含むか。 */
export function rangeContains(range: CellRange, row: number, col: number): boolean {
  return (
    row >= range.rowStart && row < range.rowEnd && col >= range.colStart && col < range.colEnd
  );
}

/** 単一セルの範囲。 */
export function singleCell(pos: CellPos): CellRange {
  return { rowStart: pos.row, rowEnd: pos.row + 1, colStart: pos.col, colEnd: pos.col + 1 };
}
