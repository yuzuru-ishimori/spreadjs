// editor-placement（DD-005 Phase 3・§13.5・AC3）: 編集 textarea の配置矩形を ViewportTransform から算出する
// 純粋関数（DOM 非依存）。座標変換は viewport.ts へ集約されているため、ここは可視判定と pane 区別だけを担う。
//
// 固定領域とスクロール領域の pane 区別（§13.5）:
//   - スクロール pane のセルは固定バンド/ヘッダーの下へスクロールされると隠れる（minX/minY = header + frozen 寸法）。
//   - 固定行/固定列のセルはスクロールで動かない（minX/minY = header のみ）。
// transform.cellRect は固定/スクロールを内部で吸収するので、可視判定だけ pane を区別すればよい。

import type { CellRect, ViewportTransform } from '@nanairo-sheet/render';

export interface PlacementConfig {
  readonly headerWidth: number;
  readonly headerHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly frozenRowCount: number;
  readonly frozenColCount: number;
}

export interface EditorPlacement {
  /** 編集セルが可視データ領域に（一部でも）出ているか。false なら textarea を隠す。 */
  readonly visible: boolean;
  /** 編集セルの viewport 矩形（CSS px・base/overlay と同一座標系）。 */
  readonly rect: CellRect;
}

const HIDDEN: CellRect = { x: 0, y: 0, width: 0, height: 0 };

/**
 * 表示 index（rowIndex/colIndex）から textarea の配置を算出する。
 * index<0（RowId/ColumnId が現在の Axis に無い＝スクロール外/削除）は非可視。
 */
export function computeEditorPlacement(
  transform: ViewportTransform,
  rowIndex: number,
  colIndex: number,
  cfg: PlacementConfig,
): EditorPlacement {
  if (rowIndex < 0 || colIndex < 0) {
    return { visible: false, rect: HIDDEN };
  }
  const rect = transform.cellRect(rowIndex, colIndex);
  // pane 区別（§13.5）: スクロールセルは frozen バンド下へ隠れうる。固定セルは header 直下から可視。
  const minX = colIndex < cfg.frozenColCount ? cfg.headerWidth : cfg.headerWidth + transform.frozenWidth();
  const minY = rowIndex < cfg.frozenRowCount ? cfg.headerHeight : cfg.headerHeight + transform.frozenHeight();
  const visible =
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x + rect.width > minX &&
    rect.x < cfg.viewportWidth &&
    rect.y + rect.height > minY &&
    rect.y < cfg.viewportHeight;
  return { visible, rect };
}
