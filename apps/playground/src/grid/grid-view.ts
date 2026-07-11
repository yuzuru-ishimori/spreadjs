// Canvas 描画。罫線・ヘッダー・セル値・アクティブセル枠・競合インジケーターを描く。
// 計画書 §12 の Base/Overlay 2 レイヤー分離は PoC-A では行わず、1 枚の Canvas を
// 毎回全再描画する（固定 20×10 で描画コストが小さいため。仮想スクロールは PoC-B）。
//
// 高 DPI（devicePixelRatio）の吸収はここ（描画側）で行う。geometry は CSS px のみ。
// 本モジュールのみ DOM（Canvas API）に依存する（描画アダプタの隔離）。

import { type CellStore } from './cell-store';
import {
  type CellPosition,
  type GridLayout,
  DEFAULT_GRID_LAYOUT,
  cellRect,
  columnHeaderRect,
  columnLabel,
  contentSize,
  parseCellKey,
  rowHeaderRect,
} from './geometry';

/** 1 フレーム分の描画モデル（値そのものは store から読む）。 */
export interface GridRenderModel {
  /** 選択中のアクティブセル。 */
  readonly activeCell: CellPosition;
  /** 競合インジケーターを表示するセルのキー集合（§11.7。Phase 3 で投入）。 */
  readonly conflictCells: ReadonlySet<string>;
}

export interface GridView {
  /** 現在の store 値とモデルでグリッドを全再描画する。 */
  render(model: GridRenderModel): void;
}

const COLOR = {
  headerBackground: '#f3f3f3',
  gridLine: '#d4d4d4',
  headerText: '#555555',
  cellText: '#202124',
  activeFrame: '#1a73e8',
  conflict: '#d93025',
} as const;

/**
 * Canvas グリッドビューを生成する。生成時に Canvas のバッキングストアを
 * レイアウトサイズ × DPR で確保し、以後 render() で全再描画する。
 */
export function createGridView(
  canvas: HTMLCanvasElement,
  store: CellStore,
  layout: GridLayout = DEFAULT_GRID_LAYOUT,
): GridView {
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('Canvas 2D コンテキストを取得できません');
  }

  const size = contentSize(layout);
  const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
  canvas.width = Math.round(size.width * dpr);
  canvas.height = Math.round(size.height * dpr);
  context.scale(dpr, dpr);

  const drawGridLines = (): void => {
    context.strokeStyle = COLOR.gridLine;
    context.lineWidth = 1;
    context.beginPath();
    // 縦線（列境界）。0.5 オフセットで 1px をくっきり描く。
    for (let col = 0; col <= layout.columnCount; col += 1) {
      const x = Math.round(layout.rowHeaderWidth + col * layout.cellWidth) + 0.5;
      context.moveTo(x, 0);
      context.lineTo(x, size.height);
    }
    // 横線（行境界）。
    for (let row = 0; row <= layout.rowCount; row += 1) {
      const y = Math.round(layout.columnHeaderHeight + row * layout.cellHeight) + 0.5;
      context.moveTo(0, y);
      context.lineTo(size.width, y);
    }
    // ヘッダー境界線（左端・上端）。
    context.moveTo(0.5, 0);
    context.lineTo(0.5, size.height);
    context.moveTo(0, 0.5);
    context.lineTo(size.width, 0.5);
    context.stroke();
  };

  const drawHeaders = (): void => {
    context.fillStyle = COLOR.headerBackground;
    context.fillRect(0, 0, size.width, layout.columnHeaderHeight);
    context.fillRect(0, 0, layout.rowHeaderWidth, size.height);

    context.fillStyle = COLOR.headerText;
    context.font = '12px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (let col = 0; col < layout.columnCount; col += 1) {
      const rect = columnHeaderRect(layout, col);
      context.fillText(columnLabel(col), rect.x + rect.width / 2, rect.y + rect.height / 2);
    }
    for (let row = 0; row < layout.rowCount; row += 1) {
      const rect = rowHeaderRect(layout, row);
      context.fillText(String(row + 1), rect.x + rect.width / 2, rect.y + rect.height / 2);
    }
  };

  const drawCellValues = (): void => {
    context.fillStyle = COLOR.cellText;
    context.font = '13px system-ui, sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    const padding = 6;
    for (const entry of store.entries()) {
      const rect = cellRect(layout, entry.pos);
      context.fillText(
        entry.value,
        rect.x + padding,
        rect.y + rect.height / 2,
        rect.width - padding * 2,
      );
    }
  };

  const drawActiveCell = (activeCell: CellPosition): void => {
    const rect = cellRect(layout, activeCell);
    context.strokeStyle = COLOR.activeFrame;
    context.lineWidth = 2;
    context.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
  };

  const drawConflictMarkers = (conflictCells: ReadonlySet<string>): void => {
    if (conflictCells.size === 0) {
      return;
    }
    context.fillStyle = COLOR.conflict;
    const markerSize = 7;
    for (const key of conflictCells) {
      const rect = cellRect(layout, parseCellKey(key));
      // セル右上に小さな三角形マーカーを描く。
      context.beginPath();
      context.moveTo(rect.x + rect.width - markerSize, rect.y);
      context.lineTo(rect.x + rect.width, rect.y);
      context.lineTo(rect.x + rect.width, rect.y + markerSize);
      context.closePath();
      context.fill();
    }
  };

  return {
    render(model) {
      context.clearRect(0, 0, size.width, size.height);
      drawHeaders();
      drawGridLines();
      drawCellValues();
      drawConflictMarkers(model.conflictCells);
      drawActiveCell(model.activeCell);
    },
  };
}
