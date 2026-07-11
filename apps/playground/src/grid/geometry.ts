// グリッドのジオメトリ（座標計算）。DOM 非依存の純粋関数のみで構成し、
// 単体テストで矩形計算とヒットテストを機械検証できるようにする。
//
// 計画書 §18.1 の「20行×10列Canvas」に対応する固定サイズグリッド。
// 座標はすべて CSS ピクセルで統一し、高 DPI（devicePixelRatio）の吸収は
// 描画側（grid-view）が担う（geometry は DPR を一切扱わない）。

/** グリッドのレイアウト定義（固定サイズ。可変行高・列幅は PoC-A の範囲外）。 */
export interface GridLayout {
  /** 行数（データ行）。 */
  readonly rowCount: number;
  /** 列数（データ列）。 */
  readonly columnCount: number;
  /** 行ヘッダー（行番号）の幅（px）。 */
  readonly rowHeaderWidth: number;
  /** 列ヘッダー（列記号）の高さ（px）。 */
  readonly columnHeaderHeight: number;
  /** データセル 1 個の幅（px）。 */
  readonly cellWidth: number;
  /** データセル 1 個の高さ（px）。 */
  readonly cellHeight: number;
}

/** 既定レイアウト（§18.1 の 20行×10列）。 */
export const DEFAULT_GRID_LAYOUT: GridLayout = {
  rowCount: 20,
  columnCount: 10,
  rowHeaderWidth: 44,
  columnHeaderHeight: 24,
  cellWidth: 96,
  cellHeight: 28,
};

/** セルの論理位置（0 起点の行・列インデックス）。 */
export interface CellPosition {
  readonly row: number;
  readonly col: number;
}

/** CSS ピクセル座標の矩形。 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 幅・高さの組。 */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * セル位置を安定した文字列キーへ変換する（Map キー・競合セル集合の要素に使う）。
 * cell-store / grid-view で同一フォーマットを共有するため、正本をここに置く。
 */
export function cellKey(pos: CellPosition): string {
  return `${pos.row}:${pos.col}`;
}

/** `cellKey` の逆変換。フォーマット不正は例外にする（黙って 0 にしない）。 */
export function parseCellKey(key: string): CellPosition {
  const parts = key.split(':');
  const row = Number.parseInt(parts[0] ?? '', 10);
  const col = Number.parseInt(parts[1] ?? '', 10);
  if (Number.isNaN(row) || Number.isNaN(col)) {
    throw new Error(`不正な cellKey: ${key}`);
  }
  return { row, col };
}

/** セル位置がグリッド範囲内か判定する。 */
export function isValidCell(layout: GridLayout, pos: CellPosition): boolean {
  return (
    pos.row >= 0 &&
    pos.row < layout.rowCount &&
    pos.col >= 0 &&
    pos.col < layout.columnCount
  );
}

/** セル位置をグリッド範囲へクランプする（端を越えたら端に留める）。 */
export function clampCell(layout: GridLayout, pos: CellPosition): CellPosition {
  const row = Math.min(Math.max(pos.row, 0), layout.rowCount - 1);
  const col = Math.min(Math.max(pos.col, 0), layout.columnCount - 1);
  return { row, col };
}

/** 列インデックスを表計算式の列記号（A, B, ..., Z, AA, ...）へ変換する。 */
export function columnLabel(col: number): string {
  let n = col;
  let label = '';
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/** データセルのピクセル矩形（ヘッダー分オフセット済み）。 */
export function cellRect(layout: GridLayout, pos: CellPosition): Rect {
  return {
    x: layout.rowHeaderWidth + pos.col * layout.cellWidth,
    y: layout.columnHeaderHeight + pos.row * layout.cellHeight,
    width: layout.cellWidth,
    height: layout.cellHeight,
  };
}

/** 列ヘッダー（列記号セル）のピクセル矩形。 */
export function columnHeaderRect(layout: GridLayout, col: number): Rect {
  return {
    x: layout.rowHeaderWidth + col * layout.cellWidth,
    y: 0,
    width: layout.cellWidth,
    height: layout.columnHeaderHeight,
  };
}

/** 行ヘッダー（行番号セル）のピクセル矩形。 */
export function rowHeaderRect(layout: GridLayout, row: number): Rect {
  return {
    x: 0,
    y: layout.columnHeaderHeight + row * layout.cellHeight,
    width: layout.rowHeaderWidth,
    height: layout.cellHeight,
  };
}

/** グリッド全体の描画サイズ（ヘッダー込み）。overflow コンテナのスクロール量を決める。 */
export function contentSize(layout: GridLayout): Size {
  return {
    width: layout.rowHeaderWidth + layout.columnCount * layout.cellWidth,
    height: layout.columnHeaderHeight + layout.rowCount * layout.cellHeight,
  };
}

/**
 * CSS ピクセル座標 (x, y) からデータセルをヒットテストする。
 * ヘッダー領域・グリッド範囲外は null を返す（セル選択の対象外）。
 */
export function hitTestCell(
  layout: GridLayout,
  x: number,
  y: number,
): CellPosition | null {
  if (x < layout.rowHeaderWidth || y < layout.columnHeaderHeight) {
    return null;
  }
  const col = Math.floor((x - layout.rowHeaderWidth) / layout.cellWidth);
  const row = Math.floor((y - layout.columnHeaderHeight) / layout.cellHeight);
  const pos = { row, col };
  return isValidCell(layout, pos) ? pos : null;
}
