// 統合PoC コントローラ（DD-005 Phase 2 土台 ＋ Phase 3 IME×共同編集の結線）。
// pocb の Canvas 基盤（viewport/base-layer/overlay-layer/scroll-anchor/dpi）を **import して使い**、
// 値の源を pocb data-gen ではなく **ClientSession（共同編集の唯一の正本）→ DocumentView（読み取りアダプター）** に置く。
//
// Phase 3 で最小 plain input を **IME 状態機械＋常駐 textarea（integration-editor）** に置き換えた:
//   - 編集対象は RowId/ColumnId + 編集開始 revision で保持（#4/#3）。textarea は ViewportTransform で配置し scroll 追従（AC3）。
//   - Commit は cell-level beforeRevision の SetCells → ClientSession.submit（#7）。reject は ClientSession の Conflict Queue。
//   - リモート更新は Document State（Canvas）のみ反映し IME draft へは入れない（#8）。編集中の競合はインジケーター（#9）。
//   - Presence（activeCell/selectionRanges/editingCell）を送受信し他者を overlay で表示（シナリオ10）。
//
// 【状態所有権】Document State=ClientSession のみ。Canvas/Axis は Render State。IME draft は常駐 textarea（ローカルが正）。

import { createColumnId, createDocumentId, createRowId } from '@nanairo-sheet/sheet-types';
import type { ColumnId, RowId } from '@nanairo-sheet/sheet-types';
import { documentHash, getCell } from '@nanairo-sheet/sheet-core';
import type { DeleteRowsOperation, InsertRowsOperation } from '@nanairo-sheet/sheet-core';
import type { Clock, IdGenerator, PresenceUpdate } from '@nanairo-sheet/sheet-collaboration';

import type { GridLayout } from '../grid/geometry';
import { createBaseLayer, type FrameViewport } from '../pocb/base-layer';
import { backingSize } from '../pocb/dpi';
import { createOverlayLayer, type OverlayFrame } from '../pocb/overlay-layer';
import { captureAnchor, correctScroll } from '../pocb/scroll-anchor';
import { singleCell, type CellRange } from '../pocb/selection';
import { createViewportTransform, type ViewportTransform } from '../pocb/viewport';

import { BrowserWebSocketTransport } from './browser-transport';
import { cellScalarToDisplay } from './document-view';
import type { PlacementConfig } from './editor-placement';
import type { EditingDocumentPort } from './ime-editing-session';
import { createIntegrationEditor, type IntegrationEditor } from './integration-editor';
import { createLoadMetrics } from './initial-load-metrics';
import { toPresenceUsers } from './presence-adapter';
import { createSessionSync, type SessionSync } from './session-sync';

// ---- 定数 ------------------------------------------------------------------
const HEADER_WIDTH = 52;
const HEADER_HEIGHT = 24;
const ROW_HEIGHT = 22;
const COL_WIDTH = 80;
const DEFAULT_SERVER_ORIGIN = 'http://127.0.0.1:8787';
const TICK_INTERVAL_MS = 1_000;

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
let editor: IntegrationEditor | undefined;
const frozenRowCount = 1;
const frozenColCount = 1;
let dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
let viewportWidth = 0;
let viewportHeight = 0;
let selection: CellRange | null = null;
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

function placementConfig(): PlacementConfig {
  return {
    headerWidth: HEADER_WIDTH,
    headerHeight: HEADER_HEIGHT,
    viewportWidth,
    viewportHeight,
    frozenRowCount,
    frozenColCount,
  };
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
    // 他者の Presence（activeCell/selection/editingCell）を実サーバー Presence から描く（presence-sim は使わない）。
    presences: sync !== undefined ? toPresenceUsers(sync.session.knownPresences(), sync.view) : [],
  };
}

function redraw(): void {
  const transform = currentTransform();
  if (transform === undefined || baseLayer === undefined) {
    return;
  }
  baseLayer.draw(frameViewport(transform));
  overlayLayer.draw(overlayFrame(transform));
  // textarea を編集対象セルへ追従配置（RowId 再解決・scroll 追従・§13.5・AC3）。
  editor?.refreshPlacement(transform, placementConfig());
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
      // 初回ロード（空 Axis→50,000行の初期 replay）は保存すべき既存アンカーが無い。本体行がある時だけ
      // anchor を捕捉・補正し、初回構築時は flush＋redraw のみ行う（DA #9・headed smoke で検出した crash 対策）。
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

// ---- ポインター（選択・ダブルクリックで編集）--------------------------------
function stageLocal(event: PointerEvent): { x: number; y: number } {
  const rect = stage.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

scroller.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || sync === undefined || editor === undefined) {
    return;
  }
  const transform = currentTransform();
  if (transform === undefined) {
    return;
  }
  const { x, y } = stageLocal(event);
  const hit = transform.hitTest(x, y);
  if (hit.area !== 'cell') {
    editor.pointerdownCell(null);
    return;
  }
  // 選択＋編集対象は状態機械の activeCell へ一本化（DA #2）。selection は onChange で追従する。
  editor.pointerdownCell({ row: hit.rowIndex, col: hit.colIndex });
  sync.view.markViewportDirty();
});

scroller.addEventListener('dblclick', (event) => {
  if (sync === undefined || editor === undefined) {
    return;
  }
  const transform = currentTransform();
  if (transform === undefined) {
    return;
  }
  const rect = stage.getBoundingClientRect();
  const hit = transform.hitTest(event.clientX - rect.left, event.clientY - rect.top);
  if (hit.area === 'cell') {
    editor.doubleClickCell({ row: hit.rowIndex, col: hit.colIndex });
  }
});

scroller.addEventListener('scroll', () => {
  // scroll 中は viewport dirty → 次フレーム redraw で textarea も rAF 単位で追従配置する（AC3）。
  sync?.view.markViewportDirty();
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
  const conflicting = editor?.session.isConflicting() === true;
  const diverted = editor?.session.divertedDrafts().length ?? 0;
  statusEl.textContent = [
    `接続: ${session.isOnline ? 'online' : 'offline'}${session.isStopped ? '（stopped）' : ''}`,
    `名前: ${displayName}`,
    `revision: ${session.committedDocument.revision}`,
    `行数: ${view.rowAxis.count().toLocaleString()}`,
    `pending: ${session.pendingCount}`,
    `conflicts: ${session.conflictQueue.length}`,
    `退避draft: ${diverted}`,
    `他者: ${session.knownPresences().length}`,
    conflicting ? '⚠ 編集中セルが他者に更新されました' : '',
  ]
    .filter((s) => s !== '')
    .join('  ｜  ');
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
      // サーバー Operation 適用後: 編集対象行が削除されていれば draft を退避（AC4・#4）。生存セルの更新は IME 不変（#8）。
      editor?.session.noteServerUpdate();
    },
  });

  // base-layer は DocumentView の read-through store（唯一の正本を読む）に束縛する。
  const syncRef = sync;
  baseLayer = createBaseLayer({
    ctx: baseCtx,
    store: syncRef.view.store,
    headerWidth: HEADER_WIDTH,
    headerHeight: HEADER_HEIGHT,
  });

  // ---- IME×共同編集の結線（Phase 3）----
  // DocumentView（表示・index↔RowId）＋ ClientSession committed（権威 revision/生存）を editor へ渡す。
  const docPort: EditingDocumentPort = {
    getCommittedDocument: () => syncRef.session.committedDocument,
    displayText: (rowId, columnId) => syncRef.view.cellDisplay(rowId, columnId),
    rowIdAt: (index) => syncRef.view.rowIdAt(index),
    colIdAt: (index) => syncRef.view.columnIdAt(index),
    rowIndexOf: (rowId) => syncRef.view.rowIndexOf(rowId),
    colIndexOf: (columnId) => syncRef.view.colIndexOf(columnId),
  };
  // 状態機械の navigation 境界は現在の Axis から動的に取る（構造Op で行数が変わっても追従）。
  const editorLayout: GridLayout = {
    get rowCount() {
      return syncRef.view.rowAxis.count();
    },
    get columnCount() {
      return syncRef.view.colAxis.count();
    },
    rowHeaderWidth: HEADER_WIDTH,
    columnHeaderHeight: HEADER_HEIGHT,
    cellWidth: COL_WIDTH,
    cellHeight: ROW_HEIGHT,
  };
  editor = createIntegrationEditor({
    host: stage,
    document: docPort,
    submit: (op) => syncRef.session.submitLocalOperation(op),
    layout: editorLayout,
    onPresenceChange: (update: PresenceUpdate) => {
      // Presence（activeCell/selectionRanges/editingCell）を送信（textarea 文字列/caret は共有しない）。
      syncRef.session.sendPresence(update);
    },
    onChange: () => {
      if (editor === undefined) {
        return;
      }
      selection = singleCell(editor.session.getActiveCell()); // 選択は状態機械 activeCell に追従
      const transform = currentTransform();
      if (transform !== undefined) {
        editor.refreshPlacement(transform, placementConfig());
      }
      syncRef.view.markViewportDirty();
    },
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

// ---- E2E / 手動テスト用フック（DD-005 Phase 4）---------------------------------
// 【重要・挙動不変】このフックは Document State（ClientSession）／IME draft／描画のいずれの挙動も変えない。
//   - 観測系（*Count/committedCell/editingTarget 等）は sync/editor の現在値を読むだけ（副作用ゼロ）。
//   - submitInsertRowsAfter/submitDeleteRow は **本番の ClientSession.submitLocalOperation** をそのまま呼ぶ。
//     統合ページの PoC UI に「行挿入/削除」ボタンが無いため、AC4（行挿入で編集継続・行削除で draft 退避）を
//     E2E/実機で駆動するための最小アフォーダンス。結果（RowId 再解決・退避）は本番コードが生成し捏造しない。
// synthetic composition と同じく、これは実 IME・実 UI 操作の「代替」であって成立の捏造ではない（§20.5）。
interface IntegrationCellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface IntegrationCellAddress {
  rowId: string;
  columnId: string;
}
interface IntegrationSelectionRange {
  startRowId: string;
  startColumnId: string;
  endRowId: string;
  endColumnId: string;
}
interface IntegrationPresenceView {
  displayName: string;
  activeCell: IntegrationCellAddress | null;
  editingCell: IntegrationCellAddress | null;
  selectionRanges: IntegrationSelectionRange[];
}
export interface IntegrationTestApi {
  ready(): boolean;
  online(): boolean;
  rowCount(): number;
  committedRevision(): number;
  committedHash(): string;
  pendingCount(): number;
  conflictCount(): number;
  divertedCount(): number;
  knownPresenceCount(): number;
  presences(): IntegrationPresenceView[];
  isConflicting(): boolean;
  isComposing(): boolean;
  draft(): string;
  activeCell(): { row: number; col: number };
  editingTarget(): IntegrationCellAddress | null;
  rowIdAt(index: number): string | undefined;
  colIdAt(index: number): string | undefined;
  rowIndexOf(rowId: string): number;
  /** 表示 index のセル矩形（クリック座標算出用・読み取り専用の本番 transform を使う）。 */
  cellRectAt(row: number, col: number): IntegrationCellRect | null;
  /** committed（サーバー確定）セルの表示文字列。AC1/AC2 の収束・反映確認に使う。 */
  committedCell(rowId: string, columnId: string): string;
  /** committed+pending（view）セルの表示文字列。 */
  displayCell(rowId: string, columnId: string): string;
  /** AC4: 行挿入（本番 submitLocalOperation 経由）。 */
  submitInsertRowsAfter(afterRowId: string | null, newRowId: string): void;
  /** AC4: 行削除（本番 submitLocalOperation 経由）。 */
  submitDeleteRow(rowId: string): void;
}

declare global {
  interface Window {
    __integrationTestApi?: IntegrationTestApi;
  }
}

function toAddress(cell: { rowId: RowId; columnId: ColumnId } | undefined): IntegrationCellAddress | null {
  return cell === undefined ? null : { rowId: String(cell.rowId), columnId: String(cell.columnId) };
}

window.__integrationTestApi = {
  ready: () => sync !== undefined && firstDataDrawn && sync.view.rowAxis.count() > 1,
  online: () => sync?.session.isOnline ?? false,
  rowCount: () => sync?.view.rowAxis.count() ?? 0,
  committedRevision: () => sync?.session.committedDocument.revision ?? 0,
  committedHash: () => (sync === undefined ? '' : documentHash(sync.session.committedDocument)),
  pendingCount: () => sync?.session.pendingCount ?? 0,
  conflictCount: () => sync?.session.conflictQueue.length ?? 0,
  divertedCount: () => editor?.session.divertedDrafts().length ?? 0,
  knownPresenceCount: () => sync?.session.knownPresences().length ?? 0,
  presences: () =>
    (sync?.session.knownPresences() ?? []).map((p) => ({
      displayName: p.displayName,
      activeCell: toAddress(p.activeCell),
      editingCell: toAddress(p.editingCell),
      selectionRanges: p.selectionRanges.map((r) => ({
        startRowId: String(r.startRowId),
        startColumnId: String(r.startColumnId),
        endRowId: String(r.endRowId),
        endColumnId: String(r.endColumnId),
      })),
    })),
  isConflicting: () => editor?.session.isConflicting() ?? false,
  isComposing: () => editor?.session.isComposing() ?? false,
  draft: () => editor?.session.getDraft() ?? '',
  activeCell: () => editor?.session.getActiveCell() ?? { row: 0, col: 0 },
  editingTarget: () => {
    const t = editor?.session.getEditingTarget() ?? null;
    return t === null ? null : { rowId: String(t.rowId), columnId: String(t.columnId) };
  },
  rowIdAt: (index) => {
    const id = sync?.view.rowIdAt(index);
    return id === undefined ? undefined : String(id);
  },
  colIdAt: (index) => {
    const id = sync?.view.columnIdAt(index);
    return id === undefined ? undefined : String(id);
  },
  rowIndexOf: (rowId) => sync?.view.rowIndexOf(createRowId(rowId)) ?? -1,
  cellRectAt: (row, col) => currentTransform()?.cellRect(row, col) ?? null,
  committedCell: (rowId, columnId) => {
    if (sync === undefined) {
      return '';
    }
    const record = getCell(sync.session.committedDocument, createRowId(rowId), createColumnId(columnId));
    return record === undefined ? '' : cellScalarToDisplay(record.value);
  },
  displayCell: (rowId, columnId) =>
    sync === undefined ? '' : sync.view.cellDisplay(createRowId(rowId), createColumnId(columnId)),
  submitInsertRowsAfter: (afterRowId, newRowId) => {
    if (sync === undefined) {
      return;
    }
    const op: InsertRowsOperation = {
      type: 'insertRows',
      afterRowId: afterRowId === null ? null : createRowId(afterRowId),
      rows: [{ rowId: createRowId(newRowId) }],
    };
    sync.session.submitLocalOperation(op);
  },
  submitDeleteRow: (rowId) => {
    if (sync === undefined) {
      return;
    }
    const op: DeleteRowsOperation = { type: 'deleteRows', rowIds: [createRowId(rowId)] };
    sync.session.submitLocalOperation(op);
  },
};
