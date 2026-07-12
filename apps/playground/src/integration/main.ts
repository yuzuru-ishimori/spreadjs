// 統合PoC コントローラ（DD-005 Phase 2・統合ページ土台）。
// pocb の Canvas 基盤（viewport/base-layer/overlay-layer/scroll-anchor/dpi）を **import して使い**、
// 値の源を pocb data-gen ではなく **ClientSession（共同編集の唯一の正本）→ DocumentView（読み取りアダプター）** に差し替える。
// IME×共同編集の本結線（commit-bridge・Presence・競合表示）は Phase 3。ここでは 2 タブ相互反映を検証できる
// 最小のセル編集（plain input・IME 状態機械なし）と、50,000行スクロール・初期ロード計測を用意する。
//
// 【状態所有権】Document State=ClientSession のみ。Canvas/Axis は Render State（DocumentView が ClientSession から派生）。
// 編集はすべて ClientSession.submitLocalOperation へ流す（DocumentView に第二の CellStore を作らない・#2）。

import { createColumnId, createDocumentId } from '@nanairo-sheet/sheet-types';
import type { ColumnId, RowId } from '@nanairo-sheet/sheet-types';
import type { Clock, IdGenerator } from '@nanairo-sheet/sheet-collaboration';
import type { CellScalar, DocumentOperation } from '@nanairo-sheet/sheet-core';

import { createBaseLayer, type FrameViewport } from '../pocb/base-layer';
import { backingSize } from '../pocb/dpi';
import { createOverlayLayer, type OverlayFrame } from '../pocb/overlay-layer';
import { captureAnchor, correctScroll } from '../pocb/scroll-anchor';
import { singleCell, type CellRange } from '../pocb/selection';
import { createViewportTransform, type ViewportTransform } from '../pocb/viewport';

import { BrowserWebSocketTransport } from './browser-transport';
import { createLoadMetrics } from './initial-load-metrics';
import { createSessionSync, type SessionSync } from './session-sync';

// ---- 定数 ------------------------------------------------------------------
const HEADER_WIDTH = 52;
const HEADER_HEIGHT = 24;
const ROW_HEIGHT = 22;
const COL_WIDTH = 80;
const DEFAULT_SERVER_ORIGIN = 'http://127.0.0.1:8787';
const TICK_INTERVAL_MS = 1_000;
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

const metrics = createLoadMetrics();

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

const stage = requireEl('int-stage', HTMLDivElement);
const baseCanvas = requireEl('int-base', HTMLCanvasElement);
const overlayCanvas = requireEl('int-overlay', HTMLCanvasElement);
const scroller = requireEl('int-scroller', HTMLDivElement);
const spacer = requireEl('int-spacer', HTMLDivElement);
const readout = requireEl('int-readout', HTMLDivElement);
const statusEl = requireEl('int-status', HTMLDivElement);
const editor = requireEl('int-editor', HTMLInputElement);

function require2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('Canvas 2D コンテキストを取得できません');
  }
  return ctx;
}
const baseCtx = require2dContext(baseCanvas);
const overlayCtx = require2dContext(overlayCanvas);

// ---- 接続パラメータ --------------------------------------------------------
const params = new URLSearchParams(location.search);
const serverOrigin = params.get('server') ?? DEFAULT_SERVER_ORIGIN;
const displayName = params.get('name') ?? `user-${Math.floor(Math.random() * 1000)}`;
const clientId = crypto.randomUUID(); // 再接続で不変（S-J4）
const wsUrl = `${serverOrigin.replace(/^http/, 'ws')}/ws`;

// ---- 可変状態 --------------------------------------------------------------
let sync: SessionSync | undefined;
const frozenRowCount = 1;
const frozenColCount = 1;
let dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
let viewportWidth = 0;
let viewportHeight = 0;
let selection: CellRange | null = null;
let editing: { rowId: RowId; columnId: ColumnId } | null = null;
let firstDataDrawn = false;

// ---- 描画層（store は接続後の DocumentView に束縛するため遅延生成）----------
let baseLayer: ReturnType<typeof createBaseLayer> | undefined;
const overlayLayer = createOverlayLayer({
  ctx: overlayCtx,
  headerWidth: HEADER_WIDTH,
  headerHeight: HEADER_HEIGHT,
});

// ---- ViewportTransform ------------------------------------------------------
function overscanY(): number {
  return viewportHeight * 0.6;
}
function overscanX(): number {
  return COL_WIDTH * 3;
}

function currentTransform(): ViewportTransform | undefined {
  if (sync === undefined) {
    return undefined;
  }
  return createViewportTransform({
    rowAxis: sync.view.rowAxis, // 毎フレーム getter で最新 Axis（構造Op で作り直される）
    colAxis: sync.view.colAxis,
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
    presences: [], // Presence 結線は Phase 3
  };
}

function redraw(): void {
  const transform = currentTransform();
  if (transform === undefined || baseLayer === undefined) {
    return;
  }
  baseLayer.draw(frameViewport(transform));
  overlayLayer.draw(overlayFrame(transform));
  positionEditor(transform);
}

// ---- レイアウト同期 --------------------------------------------------------
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
  if (transform === undefined) {
    return;
  }
  spacer.style.width = `${transform.scrollableWidth()}px`;
  spacer.style.height = `${transform.scrollableHeight()}px`;
}

function syncLayout(): void {
  dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  viewportWidth = Math.max(0, Math.floor(stage.clientWidth));
  viewportHeight = Math.max(0, Math.floor(stage.clientHeight));
  provisionCanvas(baseCanvas, baseCtx);
  provisionCanvas(overlayCanvas, overlayCtx);
  baseLayer?.textCache.clear();
  syncSpacer();
  sync?.view.markViewportDirty();
}

// ---- master rAF ループ -----------------------------------------------------
function masterLoop(): void {
  const view = sync?.view;
  if (view !== undefined) {
    if (view.hasStructuralDirty()) {
      // 構造Op: scroll anchor を捕捉 → rowAxis 再構築 → scroll 補正（画面が跳ばないように・§13.4）。
      // ただし初回ロード（空 Axis→50,000行の初期 replay）は保存すべき既存アンカーが無い。captureAnchor は
      // 本体行前提で index=frozenRowCount を読むため空 Axis(count=0) では範囲外例外になる（headed smoke で検出）。
      // → 本体行が既にあるときだけ anchor を捕捉・補正し、初回構築時は flush＋redraw のみ行う。
      const hasBodyRows = view.rowAxis.count() > frozenRowCount;
      const anchor = hasBodyRows
        ? captureAnchor({
            rowAxis: view.rowAxis,
            colAxis: view.colAxis,
            frozenRowCount,
            frozenColCount,
            scrollTop: scroller.scrollTop,
            scrollLeft: scroller.scrollLeft,
          })
        : null;
      const result = view.flush();
      if (result.structuralRebuilt) {
        metrics.mark('axisBuilt');
      }
      syncSpacer();
      if (anchor !== null) {
        const corrected = correctScroll({
          rowAxis: view.rowAxis,
          colAxis: view.colAxis,
          frozenRowCount,
          frozenColCount,
          anchor,
        });
        scroller.scrollTop = corrected.scrollTop;
        scroller.scrollLeft = corrected.scrollLeft;
      }
      if (result.needsRedraw) {
        redraw();
        markFirstDataDraw();
      }
    } else {
      const result = view.flush();
      if (result.needsRedraw) {
        redraw();
        markFirstDataDraw();
      }
    }
  }
  requestAnimationFrame(masterLoop);
}

function markFirstDataDraw(): void {
  if (!firstDataDrawn && sync !== undefined && sync.view.rowAxis.count() > 0) {
    firstDataDrawn = true;
    metrics.mark('firstDraw');
    metrics.mark('firstOperable');
  }
}

// ---- 最小セル編集（2 タブ相互反映 smoke 用・Phase 3 の IME commit-bridge が置き換える）----
function valueFromInput(text: string): CellScalar {
  if (text === '') {
    return { kind: 'blank' };
  }
  if (NUMERIC_RE.test(text)) {
    return { kind: 'number', value: Number(text) };
  }
  return { kind: 'string', value: text };
}

function positionEditor(transform: ViewportTransform): void {
  if (editing === null || sync === undefined) {
    editor.style.display = 'none';
    return;
  }
  const rowIndex = sync.view.rowIndexOf(editing.rowId);
  const colIndex = sync.view.colIndexOf(editing.columnId);
  if (rowIndex < 0 || colIndex < 0) {
    // 編集対象セルが削除された（Phase 3 で Conflict Queue 退避を実装。Phase 2 は編集を閉じる）。
    closeEditor();
    return;
  }
  const rect = transform.cellRect(rowIndex, colIndex);
  editor.style.display = 'block';
  editor.style.left = `${rect.x}px`;
  editor.style.top = `${rect.y}px`;
  editor.style.width = `${rect.width}px`;
  editor.style.height = `${rect.height}px`;
}

function openEditor(rowId: RowId, columnId: ColumnId): void {
  if (sync === undefined) {
    return;
  }
  editing = { rowId, columnId };
  editor.value = sync.view.cellDisplay(rowId, columnId);
  const transform = currentTransform();
  if (transform !== undefined) {
    positionEditor(transform);
  }
  editor.focus();
  editor.select();
}

function closeEditor(): void {
  editing = null;
  editor.style.display = 'none';
}

function commitEditor(): void {
  if (editing === null || sync === undefined) {
    return;
  }
  const target = editing;
  const op: DocumentOperation = {
    type: 'setCells',
    conflictPolicy: 'reject-overlap',
    changes: [{ rowId: target.rowId, columnId: target.columnId, value: valueFromInput(editor.value) }],
  };
  sync.session.submitLocalOperation(op); // 楽観適用 → pending → 送信
  sync.view.markCellDirty(); // ローカル submit の即時反映（server echo でも再度 dirty）
  closeEditor();
}

editor.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    commitEditor();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeEditor();
  }
});
editor.addEventListener('blur', () => {
  closeEditor();
});

// ---- ポインター（選択・ダブルクリックで編集）--------------------------------
function stageLocal(event: PointerEvent): { x: number; y: number } {
  const rect = stage.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

scroller.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || sync === undefined) {
    return;
  }
  const transform = currentTransform();
  if (transform === undefined) {
    return;
  }
  const { x, y } = stageLocal(event);
  const hit = transform.hitTest(x, y);
  if (hit.area !== 'cell') {
    return;
  }
  selection = singleCell({ row: hit.rowIndex, col: hit.colIndex });
  sync.view.markViewportDirty();
});

scroller.addEventListener('dblclick', (event) => {
  if (sync === undefined) {
    return;
  }
  const transform = currentTransform();
  if (transform === undefined) {
    return;
  }
  const rect = stage.getBoundingClientRect();
  const hit = transform.hitTest(event.clientX - rect.left, event.clientY - rect.top);
  if (hit.area === 'cell' && hit.rowId !== undefined && hit.columnId !== undefined) {
    openEditor(hit.rowId, hit.columnId);
  }
});

scroller.addEventListener('scroll', () => {
  sync?.view.markViewportDirty();
  if (editing !== null) {
    const transform = currentTransform();
    if (transform !== undefined) {
      positionEditor(transform);
    }
  }
});

// ---- リサイズ監視 ----------------------------------------------------------
const resizeObserver = new ResizeObserver(() => {
  syncLayout();
});
resizeObserver.observe(stage);

// ---- readout --------------------------------------------------------------
function updateReadout(): void {
  if (sync === undefined) {
    return;
  }
  const view = sync.view;
  const session = sync.session;
  statusEl.textContent = [
    `接続: ${session.isOnline ? 'online' : 'offline'}${session.isStopped ? '（stopped）' : ''}`,
    `名前: ${displayName}`,
    `revision: ${session.committedDocument.revision}`,
    `行数: ${view.rowAxis.count().toLocaleString()}`,
    `pending: ${session.pendingCount}`,
    `conflicts: ${session.conflictQueue.length}`,
  ].join('  ｜  ');
  readout.textContent = metrics.toText();
}

// ---- 起動 ------------------------------------------------------------------
interface ServerConfig {
  documentId: string;
  columnOrder: string[];
}

async function fetchConfig(): Promise<ServerConfig> {
  const response = await fetch(`${serverOrigin}/config`);
  if (!response.ok) {
    throw new Error(`/config 取得失敗: ${response.status}`);
  }
  const json: unknown = await response.json();
  if (
    typeof json !== 'object' ||
    json === null ||
    !('documentId' in json) ||
    !('columnOrder' in json) ||
    !Array.isArray((json as { columnOrder: unknown }).columnOrder)
  ) {
    throw new Error('/config の形式が不正');
  }
  const record = json as { documentId: string; columnOrder: string[] };
  return { documentId: record.documentId, columnOrder: record.columnOrder };
}

async function boot(): Promise<void> {
  statusEl.textContent = `接続中… (${serverOrigin})`;
  const config = await fetchConfig();
  const columnOrder: ColumnId[] = config.columnOrder.map((c) => createColumnId(c));

  const clock: Clock = { now: () => Date.now() };
  const idGenerator: IdGenerator = { next: () => crypto.randomUUID() };
  const transport = new BrowserWebSocketTransport(wsUrl, {
    onServerFrame: (info) => {
      metrics.recordFrame(info);
    },
  });

  sync = createSessionSync({
    innerTransport: transport,
    sessionConfig: {
      clientId,
      userId: clientId,
      displayName,
      documentId: createDocumentId(config.documentId),
      columnOrder,
      clock,
      idGenerator,
    },
    rowHeight: ROW_HEIGHT,
    colWidth: COL_WIDTH,
    onConnected: () => {
      metrics.mark('wsConnected');
    },
    onOperations: () => {
      metrics.mark('firstSync');
    },
  });

  // base-layer は DocumentView の read-through store（唯一の正本を読む）に束縛する。
  baseLayer = createBaseLayer({
    ctx: baseCtx,
    store: sync.view.store,
    headerWidth: HEADER_WIDTH,
    headerHeight: HEADER_HEIGHT,
  });
  syncLayout();
  sync.start();
}

syncLayout();
requestAnimationFrame(masterLoop);
window.setInterval(() => {
  // tick=再送/catch-up ポーリング、heartbeat=サーバー TTL（15秒）失効を防ぐ生存通知。offline 時は transport が drop。
  sync?.session.tick();
  sync?.session.sendHeartbeat();
  updateReadout();
}, TICK_INTERVAL_MS);

void boot().catch((error: unknown) => {
  statusEl.textContent = `起動失敗: ${error instanceof Error ? error.message : String(error)}`;
});
