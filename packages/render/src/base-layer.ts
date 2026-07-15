// base レイヤー描画（計画書 §12.1/§12.2/§12.4/§12.5）: セル背景・文字・罫線・ヘッダー。
// 固定行列は 4 象限を clip region で 1 Canvas に描く（§12.2）。罫線は device pixel へ snap（§12.4）。
// 文字は measureText キャッシュ＋セル clip（§12.5）。可視非空セルのみ chunk-store の範囲クエリで描く。
//
// 本モジュールは Canvas API に依存する（描画アダプタの隔離）。座標計算は viewport.ts に委ね、
// ここは「与えられた ViewportTransform をどう塗るか」だけを持つ。単体テストは座標側（viewport 等）で行う。

import type { ChunkStore } from './chunk-store';
import { deviceLineWidth, snapToDevice } from './dpi';
import { createTextMetricsCache, type TextMetricsCache } from './text-cache';
import { MAX_LEFT_INFLOW_SCAN, nearestLeftNonEmpty, overflowRightExtent } from './text-overflow';
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
  /**
   * measureText キャッシュ（DD-012-5）。指定すると base-layer は自前生成せず共有インスタンスを使う。
   * 自動行高計算（DocumentView）と行分割キャッシュ（wrapLines）を共有し、描画と行高の line 数を一致させる。
   */
  readonly textCache?: TextMetricsCache;
  /** 列 index が折り返し（wrap）列か（DD-012-5 D1・列単位 wrap）。未指定なら全列オーバーフロー扱い。 */
  readonly isWrapColumn?: (colIndex: number) => boolean;
  /** 固定列数（DD-012-5 D2・オーバーフロー左外流入が pane 境界＝固定/本体境界を越えないための下限）。 */
  readonly frozenColCount?: number;
  /** wrap 折り返し行の行高（px・DD-012-5 D4/D5・自動行高計算と一致させる）。 */
  readonly lineHeight?: number;
}

export interface BaseLayer {
  draw(frame: FrameViewport): void;
  /** measureText キャッシュ（Web font 読込・DPR 変更で clear する）。 */
  readonly textCache: TextMetricsCache;
}

/** セル文字の左右パディング（px・DD-012-5 で自動行高計算と共有）。 */
export const CELL_TEXT_PADDING = 5;
/** wrap 折り返し行の既定行高（px・13px フォント想定・自動行高計算と一致させる）。 */
export const CELL_TEXT_LINE_HEIGHT = 16;
const CELL_PADDING = CELL_TEXT_PADDING;
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

/** 表示文字列が数値（右寄せ・オーバーフロー対象外）か。base-layer と自動行高計算で同一判定を使う。 */
export function isNumericCell(value: string): boolean {
  return NUMERIC_RE.test(value);
}

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
  const isWrapColumn = deps.isWrapColumn ?? (() => false);
  const frozenColCount = deps.frozenColCount ?? 0;
  const lineHeight = deps.lineHeight ?? CELL_TEXT_LINE_HEIGHT;
  const textCache =
    deps.textCache ??
    createTextMetricsCache((text, font) => {
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

  /** wrap 列セル: 折り返し複数行をセル内に clip して描く（DD-012-5 D4）。clipTop/clipBottom は pane 可視帯（Codex P1 対策）。 */
  const drawWrapCell = (
    transform: ViewportTransform,
    row: number,
    col: number,
    value: string,
    clipTop: number,
    clipBottom: number,
  ): void => {
    const rect = transform.cellRect(row, col);
    const maxWidth = rect.width - CELL_PADDING * 2;
    const lines = textCache.wrapLines(value, cellFont, maxWidth);
    ctx.textAlign = 'left';
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    if (lines.length <= 1) {
      ctx.fillText(lines[0] ?? value, rect.x + CELL_PADDING, rect.y + rect.height / 2);
    } else {
      // pane 可視帯に交差する行だけ描く（超長文でも O(可視行数)。無制限 fillText でフレームが凍る回帰を防ぐ・Codex P1）。
      const top = rect.y + CELL_PADDING;
      const first = Math.max(0, Math.floor((clipTop - top) / lineHeight));
      const last = Math.min(lines.length, Math.ceil((clipBottom - top) / lineHeight) + 1);
      for (let i = first; i < last; i += 1) {
        ctx.fillText(lines[i] ?? '', rect.x + CELL_PADDING, top + lineHeight / 2 + i * lineHeight);
      }
    }
    ctx.restore();
  };

  /**
   * 左寄せ文字列セル: 右方向の連続空セルへオーバーフロー描画する（DD-012-5 D2）。
   * 非空セル手前で止まったら省略記号でクリップ（AC2）、可視端まで空なら全文（pane clip で自然に切れる・AC1）。
   */
  const drawOverflowCell = (
    transform: ViewportTransform,
    row: number,
    col: number,
    value: string,
    maxColExclusive: number,
    isEmptyAt: (col: number) => boolean,
  ): void => {
    const rect = transform.cellRect(row, col);
    ctx.textAlign = 'left';
    // 高速パス: 自セル内に収まる文字列はオーバーフロー走査せず素描画する（DD-012-2 予算保護・非オーバーフロー時は従来コスト）。
    if (textCache.measureWidth(value, cellFont) <= rect.width - CELL_PADDING * 2) {
      ctx.fillText(value, rect.x + CELL_PADDING, rect.y + rect.height / 2);
      return;
    }
    const ext = overflowRightExtent(col, maxColExclusive, isEmptyAt);
    let rightEdge = rect.x + rect.width;
    if (ext.endColExclusive > col + 1) {
      const lastRect = transform.cellRect(row, ext.endColExclusive - 1);
      rightEdge = lastRect.x + lastRect.width;
    }
    if (ext.blocked) {
      // 非空セル手前でクリップ（省略記号）。延長幅ぶんまで載せ、収まらなければ … で切る（AC1/AC2）。
      const availWidth = rightEdge - CELL_PADDING - (rect.x + CELL_PADDING);
      const maxWidth = Math.max(rect.width - CELL_PADDING * 2, availWidth);
      const text = textCache.fitText(value, cellFont, maxWidth);
      ctx.fillText(text, rect.x + CELL_PADDING, rect.y + rect.height / 2);
    } else {
      // 可視端まで空 → 全文を描き pane clip に任せる（Excel 風のハードクリップ・AC1）。
      ctx.fillText(value, rect.x + CELL_PADDING, rect.y + rect.height / 2);
    }
  };

  const drawPaneValues = (frame: FrameViewport, pane: PaneRange): void => {
    const { transform } = frame;
    ctx.font = cellFont;
    ctx.textBaseline = 'middle';
    const maxCol = pane.cols.end;
    const clipTop = pane.clip.y;
    const clipBottom = pane.clip.y + pane.clip.height;
    const isEmptyAt = (row: number) => (col: number): boolean => store.get(row, col) === '';

    // Pass 1: pane 内の非空セルを描く（数値=右寄せ／wrap=折り返し／左寄せ文字列=オーバーフロー）。
    store.queryRange(pane.rows.start, pane.rows.end, pane.cols.start, pane.cols.end, (row, col, value) => {
      const isNumber = isNumericCell(value);
      ctx.fillStyle = isNumber ? colors.numberText : colors.cellText;
      if (!isNumber && isWrapColumn(col)) {
        drawWrapCell(transform, row, col, value, clipTop, clipBottom);
        return;
      }
      if (isNumber) {
        const rect = transform.cellRect(row, col);
        ctx.textAlign = 'right';
        const text = textCache.fitText(value, cellFont, rect.width - CELL_PADDING * 2);
        ctx.fillText(text, rect.x + rect.width - CELL_PADDING, rect.y + rect.height / 2);
        return;
      }
      drawOverflowCell(transform, row, col, value, maxCol, isEmptyAt(row));
    });

    // Pass 2: 可視範囲の左外にあるはみ出し元からの流入を描く（D3・最大 20 列遡り・pane 境界で停止）。
    // 固定列（frozenColCount）を越えて遡らない＝pane 境界でオーバーフローを止める（D2）。
    if (pane.cols.start > frozenColCount) {
      for (let row = pane.rows.start; row < pane.rows.end; row += 1) {
        // 可視左端セルが埋まっていれば左外流入は届かない（origin→可視の間に非空セルが要る）→ 走査省略（予算保護）。
        if (store.get(row, pane.cols.start) !== '') {
          continue;
        }
        const isEmpty = isEmptyAt(row);
        const originCol = nearestLeftNonEmpty(pane.cols.start, frozenColCount, MAX_LEFT_INFLOW_SCAN, isEmpty);
        if (originCol === null) {
          continue;
        }
        const value = store.get(row, originCol);
        // 数値・wrap 列はオーバーフローしない（左寄せ文字列のみ流入）。自セル内に収まる値は流入しない。
        if (isNumericCell(value) || isWrapColumn(originCol)) {
          continue;
        }
        ctx.fillStyle = colors.cellText;
        drawOverflowCell(transform, row, originCol, value, maxCol, isEmpty);
      }
    }
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
