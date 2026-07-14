// grid Facade の mount 配線（旧 apps/playground/src/integration/main.ts を昇華）。
//
// pocb の Canvas 基盤（render）を使い、値の源を ClientSession（共同編集の唯一の正本）→ DocumentView（読み取り
// アダプター）に置く。IME は編集状態機械＋常駐 textarea（integration-editor）。挙動は main.ts と等価に保ちつつ、
// ①DOM は container 内に構築（dom-scaffold・D4）②SessionEvent を GridEvent へ写像して購読者へ配信③readout 表示は
// 持たず、代わりに destroy() で全リソース（RAF/interval/listener/ResizeObserver/WS/canvas/textarea）を解放する
// （再mountで leak しない・AC2）④E2E 用 introspection は debugRegistry 経由（test-support）で露出する。

import { documentHash, getCell } from '@nanairo-sheet/core';
import type { DeleteRowsOperation, InsertRowsOperation } from '@nanairo-sheet/core';
import { createColumnId, createDocumentId, createRowId } from '@nanairo-sheet/types';
import type { ColumnId, RowId } from '@nanairo-sheet/types';
import type { Clock, IdGenerator, PresenceUpdate, SessionEvent } from '@nanairo-sheet/collab';
import {
  backingSize,
  captureAnchor,
  correctScroll,
  createBaseLayer,
  createOverlayLayer,
  createViewportTransform,
} from '@nanairo-sheet/render';
import type { FrameViewport, OverlayFrame, ViewportTransform } from '@nanairo-sheet/render';
import { singleCell } from '@nanairo-sheet/selection';
import type { CellRange } from '@nanairo-sheet/selection';
import type { GridLayout } from '@nanairo-sheet/ime';

import { BrowserWebSocketTransport } from './browser-transport';
import { cellScalarToDisplay } from './document-view';
import type { PlacementConfig } from './editor-placement';
import type { EditingDocumentPort } from './ime-editing-session';
import { createIntegrationEditor } from './integration-editor';
import type { IntegrationEditor } from './integration-editor';
import { createLoadMetrics } from './initial-load-metrics';
import { toPresenceUsers } from './presence-adapter';
import { createSessionSync } from './session-sync';
import type { SessionSync } from './session-sync';
import { buildScaffold } from './dom-scaffold';
import { GridBootError, toGridConflictCode } from './error-codes';
import { createDiagnosticSink } from './diagnostics';
import { debugRegistry } from './internal';
import type { GridDebugApi, GridDebugCellAddress } from './internal';
import type {
  GridConnectionState,
  GridEvent,
  GridInstance,
  GridMountOptions,
  GridMountTarget,
} from './index';

const HEADER_WIDTH = 52;
const HEADER_HEIGHT = 24;
const ROW_HEIGHT = 22;
const COL_WIDTH = 80;
const TICK_INTERVAL_MS = 1_000;

interface ResolvedConfig {
  documentId: string;
  columnOrder: string[];
}

/** GridMountOptions を受けて grid を container へ配線し、GridInstance を返す（同期 return・boot は非同期進行）。 */
export function createGridController(target: GridMountTarget, options: GridMountOptions): GridInstance {
  const scaffold = buildScaffold(target.container);
  const { stage, baseCanvas, overlayCanvas, scroller, spacer, baseCtx, overlayCtx } = scaffold;

  const serverOrigin = options.serverUrl;
  const displayName = options.displayName ?? `user-${Math.floor(Math.random() * 1000)}`;
  const clientId = options.clientId ?? crypto.randomUUID(); // 再接続で不変（S-J4）
  const wsUrl = `${serverOrigin.replace(/^http/, 'ws')}/ws`;

  const frozenRowCount = 1;
  const frozenColCount = 1;
  const metrics = createLoadMetrics();

  // ---- 可変状態 ----
  let sync: SessionSync | undefined;
  let editor: IntegrationEditor | undefined;
  let browserTransport: BrowserWebSocketTransport | undefined;
  let baseLayer: ReturnType<typeof createBaseLayer> | undefined;
  let dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  let viewportWidth = 0;
  let viewportHeight = 0;
  let selection: CellRange | null = null;
  let firstDataDrawn = false;
  let lastSessionEvent: SessionEvent | undefined;
  let resolvedDocumentId = options.documentId;
  let hasEverConnected = false; // 一度でも接続確立したか（初回接続失敗のみ connect error として通知・P1-2）
  let focusRequested = false; // boot 完了前の focus() 要求（初回配置後に適用・P2-3）

  // ---- 購読・後始末 ----
  const listeners = new Set<(event: GridEvent) => void>();
  if (options.onEvent !== undefined) {
    listeners.add(options.onEvent);
  }
  const abort = new AbortController();
  const { signal } = abort;
  let rafId = 0;
  let intervalId = 0;
  let destroyed = false;

  // 診断ログ hook（opt-in・既定無出力）。GridEvent（consumer 契約）とは別系統の障害切り分け用。
  const diag = createDiagnosticSink(options.onDiagnostic);

  function emit(event: GridEvent): void {
    for (const listener of [...listeners]) {
      listener(event);
    }
  }

  function toGridEvent(event: SessionEvent): GridEvent {
    switch (event.type) {
      case 'connection':
        return { type: 'connection', state: event.state, pendingCount: event.pendingCount };
      case 'pending':
        return { type: 'pending', pendingCount: event.pendingCount };
      case 'rejected':
        return {
          type: 'rejected',
          pendingCount: event.pendingCount,
          conflict: {
            operationId: String(event.entry.operationId),
            reason: event.entry.reason,
            // 内部 RejectCode を素通しせず公開語彙へ写像する（R7・未知は 'unknown'）。
            code: toGridConflictCode(event.entry.reason, event.entry.code),
          },
        };
      case 'divergence':
        return {
          type: 'divergence',
          serverRevision: event.serverRevision,
          committedRevision: event.committedRevision,
        };
    }
  }

  // ---- 描画層（overlay は即時・base は接続後の DocumentView へ束縛するため遅延生成）----
  const overlayLayer = createOverlayLayer({
    ctx: overlayCtx,
    headerWidth: HEADER_WIDTH,
    headerHeight: HEADER_HEIGHT,
  });

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
      rowAxis: sync.view.rowAxis,
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
    editor?.refreshPlacement(transform, placementConfig());
  }

  /**
   * アクティブセルが body viewport の外にあれば最小スクロールで可視域へ入れる（Excel 準拠の scroll-follow）。
   * キーボード/クリックでアクティブセルが変わったとき onChange から呼ぶ。可視セルなら何もしない（クリックで勝手に
   * スクロールしない）。scroller.scrollTop/Left への代入は同期反映され、scroll イベント→再描画で追従する。
   */
  function ensureActiveCellVisible(): void {
    if (editor === undefined) {
      return;
    }
    const transform = currentTransform();
    if (transform === undefined) {
      return;
    }
    const active = editor.session.getActiveCell();
    const rect = transform.cellRect(active.row, active.col);
    const bodyOriginX = HEADER_WIDTH + transform.frozenWidth();
    const bodyOriginY = HEADER_HEIGHT + transform.frozenHeight();
    // 固定行/列のセルはスクロール非依存ゆえ追従不要（body セルのみ）。
    if (active.row >= frozenRowCount) {
      if (rect.y < bodyOriginY) {
        scroller.scrollTop += rect.y - bodyOriginY; // 上へはみ出し → スクロールアップ（負）
      } else if (rect.y + rect.height > viewportHeight) {
        scroller.scrollTop += rect.y + rect.height - viewportHeight; // 下へはみ出し → スクロールダウン
      }
    }
    if (active.col >= frozenColCount) {
      if (rect.x < bodyOriginX) {
        scroller.scrollLeft += rect.x - bodyOriginX;
      } else if (rect.x + rect.width > viewportWidth) {
        scroller.scrollLeft += rect.x + rect.width - viewportWidth;
      }
    }
  }

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

  function markFirstDataDraw(): void {
    if (!firstDataDrawn && sync !== undefined && sync.view.rowAxis.count() > 0) {
      firstDataDrawn = true;
      metrics.mark('firstDraw');
      metrics.mark('firstOperable');
      if (focusRequested) {
        focusRequested = false;
        editor?.focus(); // boot 前に要求された focus を初回配置後に適用する（P2-3）
      }
    }
  }

  function masterLoop(): void {
    const view = sync?.view;
    if (view !== undefined) {
      if (view.hasStructuralDirty()) {
        // 構造Op: scroll anchor 捕捉 → rowAxis 再構築 → scroll 補正（画面が跳ばないように・§13.4）。
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
    if (!destroyed) {
      rafId = requestAnimationFrame(masterLoop);
    }
  }

  // ---- ポインター（選択・ダブルクリックで編集）----
  function stageLocal(event: PointerEvent): { x: number; y: number } {
    const rect = stage.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  scroller.addEventListener(
    'pointerdown',
    (event) => {
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
      // 常駐 textarea をキーボード入力の受け口として保持する。scroller は非フォーカサブルなため、
      // mousedown 既定挙動が focus を body へ奪い、直後の pointerdownCell の textarea.focus() を打ち消す。
      // これを止めないとクリック後の矢印キーが scroller のネイティブスクロールへ流れ、カレントセルが動かない。
      event.preventDefault();
      editor.pointerdownCell({ row: hit.rowIndex, col: hit.colIndex });
      sync.view.markViewportDirty();
    },
    { signal },
  );

  scroller.addEventListener(
    'dblclick',
    (event) => {
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
    },
    { signal },
  );

  scroller.addEventListener(
    'scroll',
    () => {
      sync?.view.markViewportDirty();
    },
    { signal },
  );

  const resizeObserver = new ResizeObserver(() => {
    syncLayout();
  });
  resizeObserver.observe(stage);

  // ---- 起動 ----
  async function fetchConfig(): Promise<ResolvedConfig> {
    // destroy() で abort される（boot 進行中の /config を残さない・P2-2）。
    const response = await fetch(`${serverOrigin}/config`, { signal });
    if (!response.ok) {
      throw new GridBootError('config-unavailable', `/config 取得失敗: ${response.status}`);
    }
    // HTTP 200 でも本文が不正 JSON なら「到達性」でなく「応答形式」の問題＝config-invalid（P2-3）。
    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw new GridBootError('config-invalid', `/config の JSON 解析失敗: ${errorMessage(error)}`);
    }
    if (
      typeof json !== 'object' ||
      json === null ||
      !('documentId' in json) ||
      !('columnOrder' in json) ||
      !Array.isArray((json as { columnOrder: unknown }).columnOrder)
    ) {
      throw new GridBootError('config-invalid', '/config の形式が不正');
    }
    const record = json as { documentId: string; columnOrder: string[] };
    return { documentId: record.documentId, columnOrder: record.columnOrder };
  }

  // D1: columnOrder は既定で /config から取得（明示指定で上書き可）。documentId も同様。
  async function resolveConfig(): Promise<ResolvedConfig> {
    if (options.columnOrder !== undefined && options.documentId !== undefined) {
      return { documentId: options.documentId, columnOrder: [...options.columnOrder] };
    }
    const fetched = await fetchConfig();
    return {
      documentId: options.documentId ?? fetched.documentId,
      columnOrder: options.columnOrder !== undefined ? [...options.columnOrder] : fetched.columnOrder,
    };
  }

  async function boot(): Promise<void> {
    diag.emit('info', 'boot-start', `boot 開始（server=${serverOrigin}）`);
    let config: ResolvedConfig;
    try {
      config = await resolveConfig();
    } catch (error) {
      // destroy() 由来の AbortError は正常な後始末ゆえエラー通知しない（P2-2）。
      if (!destroyed) {
        // GridBootError は phase/code を保持する。それ以外（想定外）は config-unavailable 相当で通知。
        const code = error instanceof GridBootError ? error.code : 'config-unavailable';
        diag.emit('error', 'config-error', `${code}: ${errorMessage(error)}`);
        emit({ type: 'error', phase: 'config', code, message: errorMessage(error) });
      }
      return;
    }
    diag.emit('info', 'config-resolved', `documentId=${config.documentId} columns=${config.columnOrder.length}`);
    if (destroyed) {
      return; // boot 中に destroy された（wiring しない）
    }
    resolvedDocumentId = config.documentId;
    const columnOrder: ColumnId[] = config.columnOrder.map((c) => createColumnId(c));

    const clock: Clock = { now: () => Date.now() };
    const idGenerator: IdGenerator = { next: () => crypto.randomUUID() };
    const transport = new BrowserWebSocketTransport(wsUrl, {
      onServerFrame: (info) => {
        metrics.recordFrame(info);
      },
      // 初回接続確立前の WS エラーは connect error として通知する（approved lifecycle mapping・P1-2）。
      // 接続確立後の一時エラーは reconnect の一部＝connection offline イベントで表現するため connect error にしない。
      logger: (message) => {
        diag.emit('warn', 'transport', message);
        if (!hasEverConnected && !destroyed) {
          emit({ type: 'error', phase: 'connect', code: 'connect-failed', message });
        }
      },
    });
    browserTransport = transport;

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
        // イベント通知契約を GridEvent へ写像して購読者へ配信する（接続断/pending/reject/divergence を即時通知）。
        observer: (event) => {
          lastSessionEvent = event;
          if (event.type === 'connection' && event.state === 'online') {
            hasEverConnected = true; // 以降の transport エラーは connect error にしない（reconnect＝offline で表現）
          }
          const gridEvent = toGridEvent(event);
          if (gridEvent.type === 'connection') {
            diag.emit('info', 'connection', `state=${gridEvent.state} pending=${gridEvent.pendingCount}`);
          } else if (gridEvent.type === 'rejected') {
            diag.emit('warn', 'rejected', `code=${gridEvent.conflict.code} op=${gridEvent.conflict.operationId}`);
          } else if (gridEvent.type === 'divergence') {
            diag.emit('warn', 'divergence', `server=${gridEvent.serverRevision} committed=${gridEvent.committedRevision}`);
          }
          emit(gridEvent);
        },
      },
      rowHeight: ROW_HEIGHT,
      colWidth: COL_WIDTH,
      onConnected: () => {
        metrics.mark('wsConnected');
      },
      onOperations: () => {
        metrics.mark('firstSync');
        editor?.session.noteServerUpdate();
      },
    });

    const syncRef = sync;
    baseLayer = createBaseLayer({
      ctx: baseCtx,
      store: syncRef.view.store,
      headerWidth: HEADER_WIDTH,
      headerHeight: HEADER_HEIGHT,
    });

    // ---- IME×共同編集の結線 ----
    const docPort: EditingDocumentPort = {
      getCommittedDocument: () => syncRef.session.committedDocument,
      displayText: (rowId, columnId) => syncRef.view.cellDisplay(rowId, columnId),
      rowIdAt: (index) => syncRef.view.rowIdAt(index),
      colIdAt: (index) => syncRef.view.columnIdAt(index),
      rowIndexOf: (rowId) => syncRef.view.rowIndexOf(rowId),
      colIndexOf: (columnId) => syncRef.view.colIndexOf(columnId),
    };
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
        syncRef.session.sendPresence(update);
      },
      onChange: () => {
        if (editor === undefined) {
          return;
        }
        ensureActiveCellVisible(); // アクティブセルを可視域へ（scrollTop/Left を同期更新しうる）
        selection = singleCell(editor.session.getActiveCell());
        const transform = currentTransform(); // 上の scroll 反映後の transform で配置する
        if (transform !== undefined) {
          editor.refreshPlacement(transform, placementConfig());
        }
        syncRef.view.markViewportDirty();
      },
    });

    syncLayout();
    sync.start();
  }

  // ---- 公開ハンドル ----
  const instance: GridInstance = {
    get documentId(): string {
      return resolvedDocumentId ?? options.documentId ?? '';
    },
    connectionState(): GridConnectionState {
      if (sync === undefined) {
        return 'offline';
      }
      return sync.session.isStopped ? 'stopped' : sync.session.isOnline ? 'online' : 'offline';
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    focus() {
      // boot 完了前（editor 未生成 or 初回配置前）の focus 要求は保持し、初回描画後に適用する（P2-3）。
      if (firstDataDrawn && editor !== undefined) {
        editor.focus();
      } else {
        focusRequested = true;
      }
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      diag.emit('info', 'destroy', 'grid を破棄しリソースを解放');
      cancelAnimationFrame(rafId);
      window.clearInterval(intervalId);
      abort.abort(); // scroller listeners を解放
      resizeObserver.disconnect();
      editor?.destroy(); // 常駐 textarea/badge・editor listeners を解放
      browserTransport?.close(); // WS を閉じ再接続タイマーを解放
      scaffold.dispose(); // container から stage を除去
      debugRegistry.delete(instance);
      listeners.clear();
    },
  };

  // ---- E2E 用 introspection（test-support 経由）----
  const debugApi: GridDebugApi = {
    ready: () => sync !== undefined && firstDataDrawn && sync.view.rowAxis.count() > 1,
    online: () => sync?.session.isOnline ?? false,
    connectionState: () =>
      sync === undefined ? 'offline' : sync.session.isStopped ? 'stopped' : sync.session.isOnline ? 'online' : 'offline',
    lastEventType: () => lastSessionEvent?.type ?? '',
    rowCount: () => sync?.view.rowAxis.count() ?? 0,
    committedRevision: () => sync?.session.committedDocument.revision ?? 0,
    committedHash: () => (sync === undefined ? '' : documentHash(sync.session.committedDocument)),
    pendingCount: () => sync?.session.pendingCount ?? 0,
    conflictCount: () => sync?.session.conflictQueue.length ?? 0,
    divertedCount: () => editor?.session.divertedDrafts().length ?? 0,
    knownPresenceCount: () => sync?.session.knownPresences().length ?? 0,
    bootstrapRevision: () => sync?.session.bootstrapRevision ?? 0,
    appliedServerOpCount: () => sync?.session.appliedServerOpCount ?? 0,
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
    simulateDrop: () => {
      browserTransport?.dropForTest();
    },
    simulateReconnect: () => {
      browserTransport?.resumeReconnectForTest();
    },
  };
  debugRegistry.set(instance, debugApi);

  function toAddress(cell: { rowId: RowId; columnId: ColumnId } | undefined): GridDebugCellAddress | null {
    return cell === undefined ? null : { rowId: String(cell.rowId), columnId: String(cell.columnId) };
  }

  // ---- 起動（rAF ループ・tick interval・boot）----
  syncLayout();
  rafId = requestAnimationFrame(masterLoop);
  intervalId = window.setInterval(() => {
    // tick=再送/catch-up ポーリング、heartbeat=サーバー TTL（15秒）失効を防ぐ生存通知。offline 時は transport が drop。
    sync?.session.tick();
    sync?.session.sendHeartbeat();
  }, TICK_INTERVAL_MS);
  // boot は自前で config 失敗を error イベント化するが、config 以降の配線例外は runtime error として通知する
  // （旧 main.ts の `void boot().catch(...)` と等価・unhandled rejection を出さない）。
  void boot().catch((error) => {
    diag.emit('error', 'runtime-error', errorMessage(error));
    emit({ type: 'error', phase: 'runtime', code: 'runtime-fault', message: errorMessage(error) });
  });

  return instance;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
