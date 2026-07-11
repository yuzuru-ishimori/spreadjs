// PoC-B コントローラ（計画書 §18.2 / §12 / §13）。
// §13.1 の DOM viewport＋spacer＋固定 Canvas を配線し、scroll→rAF→可視範囲のみ描画する。
// 座標は viewport.ts、値は chunk-store、描画は base/overlay-layer、更新振り分けは render-scheduler、
// Presence は presence-sim、計測は harness/metrics が担い、ここは各モジュールをつなぐアダプタに徹する。
//
// 既存 src/grid|ime|sim|ui（DD-002 の実機受入環境）とは独立した別エントリ（poc-b.html）。
import { createColumnId, createRowId, type ColumnId, type RowId } from '@nanairo-sheet/sheet-types';

import { createAxis, type Axis } from './axis';
import { createBaseLayer, type FrameViewport } from './base-layer';
import { createChunkStore } from './chunk-store';
import { backingSize } from './dpi';
import { generateCells } from './data-gen';
import { createMeasurementHarness } from './harness';
import { createOverlayLayer, type OverlayFrame } from './overlay-layer';
import { createPresenceSim } from './presence-sim';
import { createRenderScheduler } from './render-scheduler';
import { captureAnchor, correctScroll, type ScrollAnchor } from './scroll-anchor';
import { rangeFromAnchorFocus, singleCell, type CellPos, type CellRange } from './selection';
import { createViewportTransform, type ViewportTransform } from './viewport';

// ---- 定数（計画書 §21 基準・§18.2 計測条件） -------------------------------
const ROW_COUNT = 50_000;
const COL_COUNT = 200;
const NON_EMPTY = 500_000;
const DATA_SEED = 20_260_712;
const HEADER_WIDTH = 44;
const HEADER_HEIGHT = 24;
const PRESENCE_COUNT = 20;
const PRESENCE_SEED = 424_242;
const PRESENCE_STEP_MS = 400;
const AUTOSCROLL_SPEED_PX_PER_SEC = 1500;
const STOPPED_REDRAW_SAMPLES = 20;

// ---- DOM ヘルパー ----------------------------------------------------------
function requireEl<T extends Element>(id: string, ctor: new () => T): T {
  const el = document.getElementById(id);
  if (el === null) {
    throw new Error(`#${id} が見つかりません`);
  }
  if (!(el instanceof ctor)) {
    throw new Error(`#${id} の型が想定と異なります`);
  }
  return el;
}

const stage = requireEl('pocb-stage', HTMLDivElement);
const baseCanvas = requireEl('pocb-base', HTMLCanvasElement);
const overlayCanvas = requireEl('pocb-overlay', HTMLCanvasElement);
const scroller = requireEl('pocb-scroller', HTMLDivElement);
const spacer = requireEl('pocb-spacer', HTMLDivElement);
const readout = requireEl('pocb-readout', HTMLDivElement);

function require2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('Canvas 2D コンテキストを取得できません');
  }
  return ctx;
}
const baseCtx = require2dContext(baseCanvas);
const overlayCtx = require2dContext(overlayCanvas);

// ---- データ・Axis・ストア --------------------------------------------------
const rowIds: RowId[] = Array.from({ length: ROW_COUNT }, (_v, i) => createRowId(`r${i}`));
const colIds: ColumnId[] = Array.from({ length: COL_COUNT }, (_v, i) => createColumnId(`c${i}`));

let rowHeight = 22;
let colWidth = 56;
// Axis は insert/remove/setSize で内部を変異させ、参照は不変（base-layer が束縛する参照が有効なまま）。
const rowAxis: Axis<RowId> = createAxis({ ids: rowIds, defaultSize: rowHeight });
const colAxis: Axis<ColumnId> = createAxis({ ids: colIds, defaultSize: colWidth });

const store = createChunkStore();
// 生成した 500,000 セル配列はロード後に手放す（ページ存続中の保持はメモリ実測を数十MB押し上げるため。Codex 指摘）。
const genSummary = ((): { count: number; elapsedMs: number } => {
  const result = generateCells({ rows: ROW_COUNT, cols: COL_COUNT, nonEmpty: NON_EMPTY, seed: DATA_SEED });
  store.bulkLoad(result.cells);
  return { count: result.count, elapsedMs: result.elapsedMs };
})();

// ---- 可変状態 --------------------------------------------------------------
let frozenRowCount = 1;
let frozenColCount = 1;
let dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
let viewportWidth = 0;
let viewportHeight = 0;
let selection: CellRange | null = null;
let dragAnchor: CellPos | null = null;
let pendingSelectionT0: number | null = null;
let presenceEnabled = true;
// null = anchor 検証未実施（AC5 は n/a）。構造変更操作を実行した時のみ真偽を入れる（Codex 指摘）。
let lastAnchorMaintained: boolean | null = null;

const presenceSim = createPresenceSim({
  count: PRESENCE_COUNT,
  seed: PRESENCE_SEED,
  rows: ROW_COUNT,
  cols: COL_COUNT,
});
const harness = createMeasurementHarness();

// ---- 描画層 ----------------------------------------------------------------
const baseLayer = createBaseLayer({
  ctx: baseCtx,
  store,
  headerWidth: HEADER_WIDTH,
  headerHeight: HEADER_HEIGHT,
});
const overlayLayer = createOverlayLayer({
  ctx: overlayCtx,
  headerWidth: HEADER_WIDTH,
  headerHeight: HEADER_HEIGHT,
});

// ---- ViewportTransform / フレーム構築 --------------------------------------
function overscanY(): number {
  return viewportHeight * 0.6;
}
function overscanX(): number {
  return colWidth * 3;
}

function currentTransform(): ViewportTransform {
  return createViewportTransform({
    rowAxis,
    colAxis,
    headerWidth: HEADER_WIDTH,
    headerHeight: HEADER_HEIGHT,
    frozenRowCount,
    frozenColCount,
    viewportWidth,
    viewportHeight,
    scrollLeft: scroller.scrollLeft,
    scrollTop: scroller.scrollTop,
    overscanX: overscanX(),
    overscanY: overscanY(),
  });
}

function frameViewport(transform: ViewportTransform): FrameViewport {
  return { transform, viewportWidth, viewportHeight, dpr };
}

function overlayFrame(transform: ViewportTransform): OverlayFrame {
  return {
    transform,
    viewportWidth,
    viewportHeight,
    dpr,
    selection,
    dragRange: null,
    presences: presenceEnabled ? presenceSim.users() : [],
  };
}

let lastVisibleCellCount = 0;

function drawBaseNow(): void {
  const transform = currentTransform();
  lastVisibleCellCount = transform.visibleCellCount();
  baseLayer.draw(frameViewport(transform));
}

function drawOverlayNow(): void {
  const transform = currentTransform();
  overlayLayer.draw(overlayFrame(transform));
  if (pendingSelectionT0 !== null) {
    harness.recordSelectionLatency(performance.now() - pendingSelectionT0);
    pendingSelectionT0 = null;
  }
}

// render-scheduler は自前 rAF を使わず（scheduleFrame を no-op）、master ループで flush する。
const scheduler = createRenderScheduler({
  drawBase: drawBaseNow,
  drawOverlay: drawOverlayNow,
  scheduleFrame: () => {
    /* master ループが毎フレーム flush する。 */
  },
});

// ---- レイアウト同期（サイズ・DPR・spacer） ---------------------------------
function provisionCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  const backing = backingSize({ width: viewportWidth, height: viewportHeight }, dpr);
  canvas.style.width = `${viewportWidth}px`;
  canvas.style.height = `${viewportHeight}px`;
  canvas.width = backing.width;
  canvas.height = backing.height;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function syncSpacer(): void {
  const transform = currentTransform();
  spacer.style.width = `${transform.scrollableWidth()}px`;
  spacer.style.height = `${transform.scrollableHeight()}px`;
}

function syncLayout(): void {
  dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  viewportWidth = Math.max(0, Math.floor(stage.clientWidth));
  viewportHeight = Math.max(0, Math.floor(stage.clientHeight));
  provisionCanvas(baseCanvas, baseCtx);
  provisionCanvas(overlayCanvas, overlayCtx);
  baseLayer.textCache.clear(); // DPR/サイズ変化で測定キャッシュを破棄（§12.4/§12.5）
  syncSpacer();
  scheduler.invalidate('full');
}

// ---- master rAF ループ -----------------------------------------------------
let frameCounter = 0;
function masterLoop(now: number): void {
  const outcome = harness.onFrame(now);
  if (outcome.scroll !== null) {
    scroller.scrollTop = outcome.scroll.top;
    scroller.scrollLeft = outcome.scroll.left;
    scheduler.invalidate('cells');
  }
  scheduler.flush();
  frameCounter += 1;
  if (frameCounter % 20 === 0) {
    updateReadout();
  }
  requestAnimationFrame(masterLoop);
}

// ---- イベント: スクロール・ポインター --------------------------------------
scroller.addEventListener('scroll', () => {
  scheduler.invalidate('cells');
});

function stageLocal(event: PointerEvent): { x: number; y: number } {
  const rect = stage.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

scroller.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) {
    return;
  }
  const { x, y } = stageLocal(event);
  const hit = currentTransform().hitTest(x, y);
  if (hit.area !== 'cell') {
    return;
  }
  // AC3 は Event.timeStamp→overlay 描画完了で測る（イベント配送の待ち時間も含める。Codex 指摘）。
  // timeStamp は performance.now() と同一時間原点のため overlay 側の差分計算に使える。
  pendingSelectionT0 = event.timeStamp;
  dragAnchor = { row: hit.rowIndex, col: hit.colIndex };
  selection = singleCell(dragAnchor);
  scroller.setPointerCapture(event.pointerId);
  scheduler.invalidate('selection');
});

scroller.addEventListener('pointermove', (event) => {
  if (dragAnchor === null) {
    return;
  }
  const { x, y } = stageLocal(event);
  const hit = currentTransform().hitTest(x, y);
  if (hit.area === 'cell') {
    selection = rangeFromAnchorFocus(dragAnchor, { row: hit.rowIndex, col: hit.colIndex });
    scheduler.invalidate('selection');
  }
});

function endDrag(event: PointerEvent): void {
  if (dragAnchor === null) {
    return;
  }
  dragAnchor = null;
  if (scroller.hasPointerCapture(event.pointerId)) {
    scroller.releasePointerCapture(event.pointerId);
  }
}
scroller.addEventListener('pointerup', endDrag);
scroller.addEventListener('pointercancel', endDrag);

// ---- リサイズ・DPR 監視 ----------------------------------------------------
const resizeObserver = new ResizeObserver(() => {
  syncLayout();
});
resizeObserver.observe(stage);
// DPR 変化（ブラウザー拡大縮小・ディスプレイ移動）を監視して再確保する（§12.4）。
function watchDpr(): void {
  const query = matchMedia(`(resolution: ${dpr}dppx)`);
  const onChange = (): void => {
    syncLayout();
    watchDpr();
  };
  query.addEventListener('change', onChange, { once: true });
}

// ---- Presence タイマー -----------------------------------------------------
window.setInterval(() => {
  if (!presenceEnabled) {
    return;
  }
  presenceSim.step();
  scheduler.invalidate('presence'); // overlay のみ再描画（base は増えない）
}, PRESENCE_STEP_MS);

// ---- 構造変更（anchor 検証）------------------------------------------------
function anchorScreenY(anchor: ScrollAnchor, scrollTop: number): number {
  const index = rowAxis.getIndex(anchor.rowId);
  const offset = index >= 0 ? rowAxis.offsetOf(index) : 0;
  return offset + anchor.offsetWithinRow - rowAxis.offsetOf(frozenRowCount) - scrollTop;
}

function applyStructureChange(mutate: () => void): void {
  const anchor = captureAnchor({
    rowAxis,
    colAxis,
    frozenRowCount,
    frozenColCount,
    scrollTop: scroller.scrollTop,
    scrollLeft: scroller.scrollLeft,
  });
  const beforeY = anchorScreenY(anchor, scroller.scrollTop);
  mutate();
  syncSpacer();
  const corrected = correctScroll({ rowAxis, colAxis, frozenRowCount, frozenColCount, anchor });
  scroller.scrollTop = corrected.scrollTop;
  scroller.scrollLeft = corrected.scrollLeft;
  const afterY = anchorScreenY(anchor, scroller.scrollTop);
  lastAnchorMaintained = Math.abs(afterY - beforeY) < 1.5;
  scheduler.invalidate('full');
}

function topVisibleRow(): number {
  const transform = currentTransform();
  const body = transform.panes().find((p) => p.pane === 'body');
  return body ? body.rows.start : frozenRowCount;
}

// ---- コントロール配線 ------------------------------------------------------
function numberInput(id: string): HTMLInputElement {
  return requireEl(id, HTMLInputElement);
}
function requireButton(id: string): HTMLButtonElement {
  return requireEl(id, HTMLButtonElement);
}

const colWidthInput = numberInput('pocb-col-width');
const rowHeightInput = numberInput('pocb-row-height');
requireButton('pocb-apply-size').addEventListener('click', () => {
  const w = Number(colWidthInput.value);
  const h = Number(rowHeightInput.value);
  // 構造変更（挿入/削除）後も安全に回すため上限は現在の count()（固定 COUNT ではない。Codex 指摘）。
  if (Number.isFinite(w) && w > 0) {
    colWidth = w;
    for (let i = 0; i < colAxis.count(); i += 1) {
      colAxis.setSize(i, w);
    }
  }
  if (Number.isFinite(h) && h > 0) {
    rowHeight = h;
    for (let i = 0; i < rowAxis.count(); i += 1) {
      rowAxis.setSize(i, h);
    }
  }
  syncLayout();
});

requireButton('pocb-grow-rows').addEventListener('click', () => {
  applyStructureChange(() => {
    const top = topVisibleRow();
    const from = Math.max(0, top - 30);
    for (let i = from; i < top; i += 1) {
      rowAxis.setSize(i, rowAxis.size(i) + 80);
    }
  });
});

requireButton('pocb-insert-rows').addEventListener('click', () => {
  applyStructureChange(() => {
    const top = topVisibleRow();
    const inserted = Array.from({ length: 1000 }, (_v, i) =>
      createRowId(`ins-${Date.now()}-${i}`),
    );
    rowAxis.insert(Math.max(0, top - 1), inserted, rowHeight);
  });
});

requireButton('pocb-delete-rows').addEventListener('click', () => {
  applyStructureChange(() => {
    const top = topVisibleRow();
    const from = Math.max(0, top - 1001);
    rowAxis.remove(from, Math.min(1000, rowAxis.count() - from - 1));
  });
});

const frozenRowsInput = numberInput('pocb-frozen-rows');
frozenRowsInput.addEventListener('change', () => {
  const value = Number(frozenRowsInput.value);
  frozenRowCount = Number.isFinite(value) ? Math.max(0, Math.min(5, value)) : frozenRowCount;
  syncLayout();
});
const frozenColsInput = numberInput('pocb-frozen-cols');
frozenColsInput.addEventListener('change', () => {
  const value = Number(frozenColsInput.value);
  frozenColCount = Number.isFinite(value) ? Math.max(0, Math.min(5, value)) : frozenColCount;
  syncLayout();
});

const presenceToggle = requireEl('pocb-presence-toggle', HTMLInputElement);
presenceToggle.addEventListener('change', () => {
  presenceEnabled = presenceToggle.checked;
  scheduler.invalidate('presence');
});

const autoScrollButton = requireButton('pocb-autoscroll');
autoScrollButton.addEventListener('click', () => {
  if (harness.isAutoScrolling()) {
    harness.stopAutoScroll();
    autoScrollButton.textContent = '自動スクロール開始';
  } else {
    harness.startAutoScroll({
      maxScrollTop: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
      maxScrollLeft: Math.max(0, scroller.scrollWidth - scroller.clientWidth),
      speedPxPerSec: AUTOSCROLL_SPEED_PX_PER_SEC,
    });
    autoScrollButton.textContent = '自動スクロール停止';
  }
});

requireButton('pocb-stopped-redraw').addEventListener('click', () => {
  for (let i = 0; i < STOPPED_REDRAW_SAMPLES; i += 1) {
    const start = performance.now();
    drawBaseNow();
    harness.recordStoppedRedraw(performance.now() - start);
  }
  updateReadout();
});

requireButton('pocb-reset-metrics').addEventListener('click', () => {
  harness.reset();
  updateReadout();
});

requireButton('pocb-export').addEventListener('click', () => {
  const json = harness.toReportJson(lastAnchorMaintained, lastVisibleCellCount);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `pocb-measurement-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  readout.textContent = json;
});

// ---- ライブ表示 ------------------------------------------------------------
function updateReadout(): void {
  const s = harness.summary();
  const anchorText = lastAnchorMaintained === null ? '未検証' : String(lastAnchorMaintained);
  readout.textContent = [
    `可視セル数: ${lastVisibleCellCount}（目標 2,000〜4,000）  非空: ${genSummary.count.toLocaleString()}  データ生成: ${genSummary.elapsedMs.toFixed(1)}ms  概算メモリ: ${(store.approxMemoryBytes() / (1024 * 1024)).toFixed(1)}MB`,
    `frame数(スクロール中): ${s.frameCount}  p95: ${s.frameP95.toFixed(1)}ms  worst: ${s.frameWorst.toFixed(1)}ms  自動スクロール: ${s.autoScrolling ? '中' : '停止'}`,
    `停止中再描画 平均: ${s.stoppedRedrawMean.toFixed(2)}ms  選択遅延worst: ${s.selectionWorst.toFixed(1)}ms  memory標本: ${s.memorySampleCount}  傾き: ${(s.memorySlopeBytesPerSec / 1024).toFixed(1)}KB/s`,
    `Axis再構築: 行${rowAxis.rebuildStats().rebuildCount}回/最新${rowAxis.rebuildStats().lastRebuildMs.toFixed(2)}ms  anchor維持(直近): ${anchorText}`,
  ].join('\n');
}

// ---- 起動 ------------------------------------------------------------------
syncLayout();
watchDpr();
requestAnimationFrame(masterLoop);
updateReadout();
