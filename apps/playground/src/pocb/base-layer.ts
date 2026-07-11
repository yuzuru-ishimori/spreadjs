// base レイヤー描画（計画書 §12.1/§12.2/§12.4/§12.5）: セル背景・文字・罫線・ヘッダー。
// 固定行列は 4 象限を clip region で 1 Canvas に描く（§12.2）。罫線は device pixel へ snap（§12.4）。
// 文字は measureText キャッシュ＋セル clip（§12.5）。可視非空セルのみ chunk-store の範囲クエリで描く。
//
// 本モジュールは Canvas API に依存する（描画アダプタの隔離）。座標計算は viewport.ts に委ね、
// ここは「与えられた ViewportTransform をどう塗るか」だけを持つ。単体テストは座標側（viewport 等）で行う。

import type { ChunkStore } from './chunk-store';
import { deviceLineWidth, snapToDevice } from './dpi';
import { createTextMetricsCache, type TextMetricsCache } from './text-cache';
import type { PaneId, PaneRange, ViewportTransform } from './viewport';

/** 1 フレーム分の viewport 情報（base/overlay 共通）。 */
export interface FrameViewport {
  readonly transform: ViewportTransform;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly dpr: number;
}

export interface BaseLayerColors {
  readonly cellBackground: string;
  readonly frozenBackground: string;
  readonly gridLine: string;
  readonly headerBackground: string;
  readonly headerText: string;
  readonly cellText: string;
  readonly numberText: string;
}

export const DEFAULT_BASE_COLORS: BaseLayerColors = {
  cellBackground: '#ffffff',
  frozenBackground: '#f8fbff',
  gridLine: '#d4d4d4',
  headerBackground: '#f3f3f3',
  headerText: '#555555',
  cellText: '#202124',
  numberText: '#1a4f8a',
};

export interface BaseLayerDeps {
  readonly ctx: CanvasRenderingContext2D;
  readonly store: ChunkStore;
  readonly headerWidth: number;
  readonly headerHeight: number;
  readonly colors?: BaseLayerColors;
  readonly cellFont?: string;
  readonly headerFont?: string;
}

export interface BaseLayer {
  draw(frame: FrameViewport): void;
  /** measureText キャッシュ（Web font 読込・DPR 変更で clear する）。 */
  readonly textCache: TextMetricsCache;
}

const CELL_PADDING = 5;
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

/** 列 index → A, B, ..., Z, AA, ... の列記号。 */
function columnLabel(col: number): string {
  let n = col;
  let label = '';
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

function findPane(panes: readonly PaneRange[], id: PaneId): PaneRange {
  const found = panes.find((p) => p.pane === id);
  if (found === undefined) {
    throw new Error(`pane ${id} が見つからない`);
  }
  return found;
}

export function createBaseLayer(deps: BaseLayerDeps): BaseLayer {
  const { ctx, store, headerWidth, headerHeight } = deps;
  const colors = deps.colors ?? DEFAULT_BASE_COLORS;
  const cellFont = deps.cellFont ?? '13px system-ui, sans-serif';
  const headerFont = deps.headerFont ?? '12px system-ui, sans-serif';
  const textCache = createTextMetricsCache((text, font) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  });

  const drawPaneGrid = (frame: FrameViewport, pane: PaneRange): void => {
    const { transform, dpr } = frame;
    if (pane.rows.end <= pane.rows.start || pane.cols.end <= pane.cols.start) {
      return;
    }
    ctx.strokeStyle = colors.gridLine;
    ctx.lineWidth = deviceLineWidth(dpr);
    ctx.beginPath();
    const top = transform.cellRect(pane.rows.start, pane.cols.start).y;
    const firstRect = transform.cellRect(pane.rows.start, pane.cols.start);
    const lastRect = transform.cellRect(pane.rows.end - 1, pane.cols.end - 1);
    const bottom = lastRect.y + lastRect.height;
    const left = firstRect.x;
    const right = lastRect.x + lastRect.width;
    // 縦罫線（列境界）。
    for (let col = pane.cols.start; col <= pane.cols.end; col += 1) {
      const boundary =
        col === pane.cols.end ? right : transform.cellRect(pane.rows.start, col).x;
      const x = snapToDevice(boundary, dpr);
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
    }
    // 横罫線（行境界）。
    for (let row = pane.rows.start; row <= pane.rows.end; row += 1) {
      const boundary =
        row === pane.rows.end ? bottom : transform.cellRect(row, pane.cols.start).y;
      const y = snapToDevice(boundary, dpr);
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
    }
    ctx.stroke();
  };

  const drawPaneValues = (frame: FrameViewport, pane: PaneRange): void => {
    const { transform } = frame;
    ctx.font = cellFont;
    ctx.textBaseline = 'middle';
    store.queryRange(pane.rows.start, pane.rows.end, pane.cols.start, pane.cols.end, (row, col, value) => {
      const rect = transform.cellRect(row, col);
      const maxWidth = rect.width - CELL_PADDING * 2;
      const isNumber = NUMERIC_RE.test(value);
      ctx.fillStyle = isNumber ? colors.numberText : colors.cellText;
      const text = textCache.fitText(value, cellFont, maxWidth);
      if (isNumber) {
        ctx.textAlign = 'right';
        ctx.fillText(text, rect.x + rect.width - CELL_PADDING, rect.y + rect.height / 2);
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(text, rect.x + CELL_PADDING, rect.y + rect.height / 2);
      }
    });
  };

  const drawPane = (frame: FrameViewport, pane: PaneRange): void => {
    if (pane.clip.width <= 0 || pane.clip.height <= 0) {
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(pane.clip.x, pane.clip.y, pane.clip.width, pane.clip.height);
    ctx.clip();
    ctx.fillStyle = pane.pane === 'body' ? colors.cellBackground : colors.frozenBackground;
    ctx.fillRect(pane.clip.x, pane.clip.y, pane.clip.width, pane.clip.height);
    drawPaneGrid(frame, pane);
    drawPaneValues(frame, pane);
    ctx.restore();
  };

  const drawHeaders = (frame: FrameViewport): void => {
    const { transform, viewportWidth, dpr } = frame;
    const panes = transform.panes();
    const body = findPane(panes, 'body');
    const corner = findPane(panes, 'corner');

    // 列記号ヘッダー（上帯）。
    ctx.save();
    ctx.beginPath();
    ctx.rect(headerWidth, 0, Math.max(0, viewportWidth - headerWidth), headerHeight);
    ctx.clip();
    ctx.fillStyle = colors.headerBackground;
    ctx.fillRect(headerWidth, 0, viewportWidth, headerHeight);
    ctx.fillStyle = colors.headerText;
    ctx.font = headerFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const drawColHeader = (col: number): void => {
      const rect = transform.columnHeaderRect(col);
      ctx.fillText(columnLabel(col), rect.x + rect.width / 2, headerHeight / 2);
    };
    for (let col = corner.cols.start; col < corner.cols.end; col += 1) {
      drawColHeader(col);
    }
    for (let col = body.cols.start; col < body.cols.end; col += 1) {
      drawColHeader(col);
    }
    ctx.restore();

    // 行番号ヘッダー（左帯）。
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, headerHeight, headerWidth, Math.max(0, frame.viewportHeight - headerHeight));
    ctx.clip();
    ctx.fillStyle = colors.headerBackground;
    ctx.fillRect(0, headerHeight, headerWidth, frame.viewportHeight);
    ctx.fillStyle = colors.headerText;
    ctx.font = headerFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const drawRowHeader = (row: number): void => {
      const rect = transform.rowHeaderRect(row);
      ctx.fillText(String(row + 1), headerWidth / 2, rect.y + rect.height / 2);
    };
    for (let row = corner.rows.start; row < corner.rows.end; row += 1) {
      drawRowHeader(row);
    }
    for (let row = body.rows.start; row < body.rows.end; row += 1) {
      drawRowHeader(row);
    }
    ctx.restore();

    // 左上コーナー。
    ctx.fillStyle = colors.headerBackground;
    ctx.fillRect(0, 0, headerWidth, headerHeight);
    // ヘッダー境界線（device snap）。
    ctx.strokeStyle = colors.gridLine;
    ctx.lineWidth = deviceLineWidth(dpr);
    ctx.beginPath();
    const hx = snapToDevice(headerWidth, dpr);
    const hy = snapToDevice(headerHeight, dpr);
    ctx.moveTo(hx, 0);
    ctx.lineTo(hx, frame.viewportHeight);
    ctx.moveTo(0, hy);
    ctx.lineTo(viewportWidth, hy);
    ctx.stroke();
  };

  return {
    textCache,
    draw(frame) {
      ctx.clearRect(0, 0, frame.viewportWidth, frame.viewportHeight);
      // 4 象限を描画順（body → left → top → corner）で塗り、固定領域が上に来るようにする。
      const panes = frame.transform.panes();
      drawPane(frame, findPane(panes, 'body'));
      drawPane(frame, findPane(panes, 'left'));
      drawPane(frame, findPane(panes, 'top'));
      drawPane(frame, findPane(panes, 'corner'));
      drawHeaders(frame);
    },
  };
}
