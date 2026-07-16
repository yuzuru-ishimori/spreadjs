// grid Facade の mount 配線（旧 apps/playground/src/integration/main.ts を昇華）。
//
// pocb の Canvas 基盤（render）を使い、値の源を ClientSession（共同編集の唯一の正本）→ DocumentView（読み取り
// アダプター）に置く。IME は編集状態機械＋常駐 textarea（integration-editor）。挙動は main.ts と等価に保ちつつ、
// ①DOM は container 内に構築（dom-scaffold・D4）②SessionEvent を GridEvent へ写像して購読者へ配信③readout 表示は
// 持たず、代わりに destroy() で全リソース（RAF/interval/listener/ResizeObserver/WS/canvas/textarea）を解放する
// （再mountで leak しない・AC2）④E2E 用 introspection は debugRegistry 経由（test-support）で露出する。

import { documentHash, displayRowOrder, getCell } from '@nanairo-sheet/core';
import type { DeleteRowsOperation, InsertRowsOperation, SetCellsOperation } from '@nanairo-sheet/core';
import { createColumnId, createDocumentId, createRowId } from '@nanairo-sheet/types';
import type { ColumnId, OperationId, RowId } from '@nanairo-sheet/types';
import type { Clock, IdGenerator, PresenceUpdate, SessionEvent } from '@nanairo-sheet/collab';
import {
  CELL_TEXT_LINE_HEIGHT,
  backingSize,
  captureAnchor,
  correctScroll,
  createBaseLayer,
  createOverlayLayer,
  createTextMetricsCache,
  createViewportTransform,
} from '@nanairo-sheet/render';
import type { FrameViewport, OverlayFrame, TextMetricsCache, ViewportTransform } from '@nanairo-sheet/render';
import { singleCell } from '@nanairo-sheet/selection';
import type { CellRange } from '@nanairo-sheet/selection';
import type { CellPosition, GridLayout } from '@nanairo-sheet/ime';

import { BrowserWebSocketTransport } from './browser-transport';
import { cellScalarToDisplay } from './document-view';
import type { PlacementConfig } from './editor-placement';
import type { EditingDocumentPort } from './ime-editing-session';
import { createIntegrationEditor } from './integration-editor';
import type { IntegrationEditor } from './integration-editor';
import { createLoadMetrics } from './initial-load-metrics';
import { toPresenceUsers } from './presence-adapter';
import { createSessionSync } from './session-sync';
import { buildScaffold } from './dom-scaffold';
import { buildRangeClear } from './range-ops';
import { computeResizeSize, resizeHitTest } from './resize-interaction';
import type { ResizeTarget } from './resize-interaction';
import { createSelectionController, decideNavigationIntercept } from './selection-controller';
import { GridBootError, toGridConflictCode } from './error-codes';
import { createDiagnosticSink } from './diagnostics';
import { debugRegistry } from './internal';
import type { GridDebugApi, GridDebugCellAddress } from './internal';
import { createStandaloneSession } from './standalone-session';
import type { StandaloneSession } from './standalone-session';
import { validateStandaloneOptions } from './standalone-options';
import type { GridBackend } from './grid-backend';
import type {
  GridCollaborationMountOptions,
  GridConnectionState,
  GridEvent,
  GridInstance,
  GridMountOptions,
  GridMountTarget,
  GridStandaloneData,
  GridStandaloneMountOptions,
} from './index';

const HEADER_WIDTH = 52;
const HEADER_HEIGHT = 24;
const ROW_HEIGHT = 22;
const COL_WIDTH = 80;
const TICK_INTERVAL_MS = 1_000;
// セル文字フォント（base-layer 描画・自動行高の測定で共有する。両者で一致していないと wrap 行数がずれる・DD-012-5）。
const CELL_FONT = '13px system-ui, sans-serif';

interface ResolvedConfig {
  documentId: string;
  columnOrder: string[];
}

/** GridMountOptions を受けて grid を container へ配線し、GridInstance を返す（同期 return・boot は非同期進行）。 */
export function createGridController(target: GridMountTarget, options: GridMountOptions): GridInstance {
  const scaffold = buildScaffold(target.container);
  const { stage, baseCanvas, overlayCanvas, scroller, spacer, baseCtx, overlayCtx } = scaffold;

  // モード判別（DD-024・決定①）。標準は共同編集（mode 省略時）。単独モードは serverUrl/WS を使わない。
  const isStandalone = options.mode === 'standalone';
  // server 系フィールドは共同編集モードでのみ意味を持つ（単独モードでは未参照・空文字で安全化）。
  const collabOptions = isStandalone ? undefined : (options as GridCollaborationMountOptions);
  const serverOrigin = collabOptions?.serverUrl ?? '';
  const displayName = collabOptions?.displayName ?? `user-${Math.floor(Math.random() * 1000)}`;
  const clientId = collabOptions?.clientId ?? crypto.randomUUID(); // 再接続で不変（S-J4）
  const wsUrl = serverOrigin === '' ? '' : `${serverOrigin.replace(/^http/, 'ws')}/ws`;

  const frozenRowCount = 1;
  const frozenColCount = 1;
  const metrics = createLoadMetrics();

  // DD-012-5: 折り返し（wrap）列（ColumnId 文字列）。mount 時固定（D1・実行時切替は Stage 2）。
  const wrapColumns = options.wrapColumns ?? [];
  const wrapColumnStrings = new Set<string>(wrapColumns);
  const wrapEnabled = wrapColumnStrings.size > 0;
  // 行分割・文字測定の共有キャッシュ（base-layer 描画と自動行高計算で共有し line 数を一致させる・D4）。
  // measure は baseCtx.measureText（描画と同一フォント計測）。base-layer とキャッシュを共有する。
  const cellTextCache: TextMetricsCache = createTextMetricsCache((text, font) => {
    baseCtx.font = font;
    return baseCtx.measureText(text).width;
  });

  // ---- 可変状態 ----
  // backend は共同編集（SessionSync）と単独（StandaloneSession）の共通面（GridBackend・DD-024）。
  let sync: GridBackend | undefined;
  // 単独モードの再注入（setData）用の具体参照。共同編集モードでは undefined のまま。
  let standalone: StandaloneSession | undefined;
  // boot（microtask）完了前に setData が呼ばれたときの保留データ（Codex[P1]: mount 直後の同期 setData を捨てない）。
  let pendingStandaloneData: GridStandaloneData | undefined;
  let editor: IntegrationEditor | undefined;
  let browserTransport: BrowserWebSocketTransport | undefined;
  let baseLayer: ReturnType<typeof createBaseLayer> | undefined;
  let dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  let viewportWidth = 0;
  let viewportHeight = 0;
  let selection: CellRange | null = null;
  // 矩形範囲選択の所有者（DD-020-1 案X）。activeCell の所有は editor-state-machine のまま・レンジのみここが持つ。
  const selectionCtrl = createSelectionController();
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
      // 明示レンジ（DD-020-1）があればそれを、無ければ activeCell の単一セル（onChange が更新する shadow）を描く。
      selection: selectionCtrl.getRange() ?? selection,
      dragRange: selectionCtrl.getDragRange(),
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
   * 指定セルが body viewport の外にあれば最小スクロールで可視域へ入れる（Excel 準拠の scroll-follow）。
   * activeCell 移動（onChange）と Shift+矢印の focus 端拡張（DD-020-1）で呼ぶ。可視セルなら何もしない
   * （クリックで勝手にスクロールしない）。scroller.scrollTop/Left への代入は同期反映され、scroll イベント→
   * 再描画で追従する。
   */
  function ensureCellVisible(cell: CellPosition): void {
    const transform = currentTransform();
    if (transform === undefined) {
      return;
    }
    const rect = transform.cellRect(cell.row, cell.col);
    const bodyOriginX = HEADER_WIDTH + transform.frozenWidth();
    const bodyOriginY = HEADER_HEIGHT + transform.frozenHeight();
    // 固定行/列のセルはスクロール非依存ゆえ追従不要（body セルのみ）。
    if (cell.row >= frozenRowCount) {
      if (rect.y < bodyOriginY) {
        scroller.scrollTop += rect.y - bodyOriginY; // 上へはみ出し → スクロールアップ（負）
      } else if (rect.y + rect.height > viewportHeight) {
        scroller.scrollTop += rect.y + rect.height - viewportHeight; // 下へはみ出し → スクロールダウン
      }
    }
    if (cell.col >= frozenColCount) {
      if (rect.x < bodyOriginX) {
        scroller.scrollLeft += rect.x - bodyOriginX;
      } else if (rect.x + rect.width > viewportWidth) {
        scroller.scrollLeft += rect.x + rect.width - viewportWidth;
      }
    }
  }

  function ensureActiveCellVisible(): void {
    if (editor === undefined) {
      return;
    }
    ensureCellVisible(editor.session.getActiveCell());
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
    // DPR・Web font 変更で行分割キャッシュが消える → 折り返し行数が変わりうるため自動行高を再計算する（D5 ③相当）。
    if (wrapEnabled) {
      sync?.view.onTextMetricsChanged();
    }
    syncSpacer(); // 自動行高変化で総サイズが変わる → spacer を更新

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
          // 自動行高が変わると総サイズ（totalSize）が変わるため spacer を同期する（末尾まで scroll 可能に維持）。
          if (wrapEnabled) {
            syncSpacer();
          }
          redraw();
          markFirstDataDraw();
        }
      }
    }
    if (!destroyed) {
      rafId = requestAnimationFrame(masterLoop);
    }
  }

  // ---- ポインター（選択・ダブルクリックで編集・ヘッダー境界リサイズ）----
  function stageLocal(event: PointerEvent): { x: number; y: number } {
    const rect = stage.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  // 列幅・行高リサイズのドラッグ状態（DD-012-4）。null=非リサイズ。対象は index ではなく Id で保持し、
  // ドラッグ中に他クライアントの構造Op で Axis が作り直されても正しい列/行を追い続ける（Codex[P2]）。
  // originalSize は pointercancel/capture 喪失時に開始時サイズへ戻すため（D2 は pointerup のみ確定・Codex[P2]）。
  type ResizeDrag =
    | { readonly axis: 'column'; readonly columnId: ColumnId; readonly pointerId: number; readonly originalSize: number }
    | {
        readonly axis: 'row';
        readonly rowId: RowId;
        readonly pointerId: number;
        readonly originalSize: number;
        // 開始時の手動 override 状態（DD-012-5 Codex P2）。取消時に実効 px でなくこの状態へ戻す
        // （自動高を誤って手動化しない＝以後の自動縮小を殺さない）。undefined=開始時は手動 override 無し。
        readonly originalManual: number | undefined;
      };
  let resizeDrag: ResizeDrag | null = null;

  // 範囲選択ドラッグの追跡（DD-020-1）。null=非ドラッグ。矩形自体は selectionCtrl が持ち、ここは
  // 「どの pointer のドラッグか」だけを持つ（マルチタッチの誤更新防止・resizeDrag と同型）。
  let selectionDrag: { readonly pointerId: number } | null = null;

  /**
   * 範囲選択ドラッグ終了。confirm=true（pointerup）は矩形を明示レンジへ確定する（同一セルなら単一選択のまま）。
   * confirm=false（pointercancel/capture 喪失）はドラッグを破棄する（確定済みレンジは変更しない）。
   */
  function finishSelectionDrag(pointerId: number, confirm: boolean): void {
    if (selectionDrag === null || selectionDrag.pointerId !== pointerId) {
      return;
    }
    selectionDrag = null; // release より先に null 化（release が誘発する lostpointercapture の二重処理を無効化）
    if (scroller.hasPointerCapture(pointerId)) {
      scroller.releasePointerCapture(pointerId);
    }
    if (confirm) {
      selectionCtrl.endDrag();
    } else {
      selectionCtrl.cancelDrag();
    }
    sync?.view.markViewportDirty();
  }

  function resizeHit(transform: ViewportTransform, x: number, y: number): ResizeTarget | null {
    if (sync === undefined) {
      return null;
    }
    return resizeHitTest(transform, x, y, {
      headerWidth: HEADER_WIDTH,
      headerHeight: HEADER_HEIGHT,
      rowCount: sync.view.rowAxis.count(),
      colCount: sync.view.colAxis.count(),
    });
  }

  /**
   * リサイズ終了。emitLayout=true（pointerup）は override のみを含む layout を 1 度だけ発火する（D2）。
   * emitLayout=false（pointercancel/capture 喪失）は確定せず開始時サイズへ戻す（途中状態を保存しない）。
   */
  function finishResize(pointerId: number, emitLayout: boolean): void {
    if (resizeDrag === null || resizeDrag.pointerId !== pointerId) {
      return;
    }
    const drag = resizeDrag;
    resizeDrag = null; // release より先に null 化（release が誘発する lostpointercapture の二重処理を無効化）
    if (scroller.hasPointerCapture(pointerId)) {
      scroller.releasePointerCapture(pointerId);
    }
    scroller.style.cursor = '';
    if (sync === undefined) {
      return;
    }
    if (emitLayout) {
      // 列幅変更の確定で、wrap 列の折り返し行数が変わりうる → 自動行高を一括再計算する（D5 トリガー③）。
      // ドラッグ中（live）は再計算せず確定時のみ（batch を毎 move 走らせない・perf）。
      if (wrapEnabled && drag.axis === 'column') {
        sync.view.recomputeAllAutoRowHeights();
        syncSpacer();
      }
      emit({
        type: 'layout',
        columnWidths: sync.view.columnWidthOverrideRecord(),
        rowHeights: sync.view.rowHeightOverrideRecord(),
      });
    } else {
      // 途中状態を破棄して開始時サイズへ戻す（cancel/capture 喪失は確定ではない）。
      if (drag.axis === 'column') {
        sync.view.setColumnWidth(drag.columnId, drag.originalSize);
      } else {
        // 行は「開始時の手動 override 状態」へ戻す（自動高を手動化しない・Codex P2）。
        sync.view.restoreRowHeight(drag.rowId, drag.originalManual);
      }
      syncSpacer();
    }
  }

  scroller.addEventListener(
    'pointermove',
    (event) => {
      if (sync === undefined) {
        return;
      }
      const { x, y } = stageLocal(event);
      if (resizeDrag !== null) {
        if (event.pointerId !== resizeDrag.pointerId) {
          return; // active pointer 以外の move は無視（マルチタッチでの誤リサイズ防止・Codex[P2]）
        }
        // 新サイズを Axis へ反映（markViewportDirty → rAF でライブ再描画）。editor へは流さない（D5）。
        // 対象の左端/上端は現在 transform から毎回再解決する（scroll・構造Op に追従・Codex[P2]）。
        const transform = currentTransform();
        if (transform === undefined) {
          return;
        }
        if (resizeDrag.axis === 'column') {
          const idx = sync.view.colIndexOf(resizeDrag.columnId);
          if (idx < 0) {
            return; // 対象列が消えた（防御）
          }
          const edge = transform.columnHeaderRect(idx).x;
          sync.view.setColumnWidth(resizeDrag.columnId, computeResizeSize('column', x, edge));
        } else {
          const idx = sync.view.rowIndexOf(resizeDrag.rowId);
          if (idx < 0) {
            return;
          }
          const edge = transform.rowHeaderRect(idx).y;
          sync.view.setRowHeight(resizeDrag.rowId, computeResizeSize('row', y, edge));
        }
        syncSpacer(); // 総サイズが変わる → spacer を同期（末尾までスクロール可能に・Codex[P1]）
        return;
      }
      if (selectionDrag !== null) {
        if (event.pointerId !== selectionDrag.pointerId) {
          return; // active pointer 以外の move は無視（マルチタッチでの誤更新防止）
        }
        const transform = currentTransform();
        if (transform === undefined) {
          return;
        }
        // セル領域のみ focus を更新する（ヘッダー上/viewport 外は直近セルを保持。autoscroll は対象外=既定案）。
        const hit = transform.hitTest(x, y);
        if (hit.area === 'cell') {
          selectionCtrl.updateDrag({ row: hit.rowIndex, col: hit.colIndex });
          sync.view.markViewportDirty();
        }
        return;
      }
      // 非ドラッグ: ヘッダー境界上でのみ resize カーソルへ切替（セル領域は cheap に既定へ戻す）。
      if (x >= HEADER_WIDTH && y >= HEADER_HEIGHT) {
        if (scroller.style.cursor !== '') {
          scroller.style.cursor = '';
        }
        return;
      }
      const transform = currentTransform();
      if (transform === undefined) {
        return;
      }
      const rz = resizeHit(transform, x, y);
      scroller.style.cursor = rz === null ? '' : rz.axis === 'column' ? 'col-resize' : 'row-resize';
    },
    { signal },
  );

  scroller.addEventListener(
    'pointerup',
    (event) => {
      finishResize(event.pointerId, true);
      finishSelectionDrag(event.pointerId, true);
    },
    { signal },
  );
  scroller.addEventListener(
    'pointercancel',
    (event) => {
      finishResize(event.pointerId, false);
      finishSelectionDrag(event.pointerId, false);
    },
    { signal },
  );
  scroller.addEventListener(
    'lostpointercapture',
    (event) => {
      finishResize(event.pointerId, false);
      finishSelectionDrag(event.pointerId, false);
    },
    { signal },
  );

  scroller.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0 || sync === undefined || editor === undefined) {
        return;
      }
      if (resizeDrag !== null || selectionDrag !== null) {
        return; // ドラッグ中の追加 pointerdown は無視（capture 漏れ・状態上書き防止・Codex[P2]）
      }
      const transform = currentTransform();
      if (transform === undefined) {
        return;
      }
      const { x, y } = stageLocal(event);
      // ヘッダー境界のリサイズを先取りする（editor へイベントを流さない＝D5・IME 不変）。
      const rz = resizeHit(transform, x, y);
      if (rz !== null) {
        event.preventDefault();
        if (rz.axis === 'column') {
          const columnId = sync.view.columnIdAt(rz.index);
          if (columnId === undefined) {
            return;
          }
          resizeDrag = { axis: 'column', columnId, pointerId: event.pointerId, originalSize: sync.view.colAxis.size(rz.index) };
        } else {
          const rowId = sync.view.rowIdAt(rz.index);
          if (rowId === undefined) {
            return;
          }
          resizeDrag = {
            axis: 'row',
            rowId,
            pointerId: event.pointerId,
            originalSize: sync.view.rowAxis.size(rz.index),
            // 取消復元用に開始時の手動 override 値（無ければ undefined）を捕捉する（Codex P2）。
            originalManual: sync.view.rowHeightOverrideRecord()[String(rowId)],
          };
        }
        scroller.setPointerCapture(event.pointerId);
        scroller.style.cursor = rz.axis === 'column' ? 'col-resize' : 'row-resize';
        return;
      }
      const hit = transform.hitTest(x, y);
      if (hit.area !== 'cell') {
        editor.pointerdownCell(null);
        return;
      }
      // 常駐 textarea をキーボード入力の受け口として保持する。scroller は非フォーカサブルなため、
      // mousedown 既定挙動が focus を body へ奪い、直後の pointerdownCell の textarea.focus() を打ち消す。
      // これを止めないとクリック後の矢印キーが scroller のネイティブスクロールへ流れ、カレントセルが動かない。
      event.preventDefault();
      const cell = { row: hit.rowIndex, col: hit.colIndex };
      // Shift+クリック（Navigation・非 composition 限定）: anchor=activeCell 固定でレンジ拡張（DD-020-1 AC2）。
      // activeCell は動かさない（editor.pointerdownCell を呼ばない）。編集中/変換中は前段消費せず従来経路
      // （確定して移動 / pendingNavigation）のまま＝IME・編集の挙動保存（案X）。
      if (event.shiftKey && !editor.session.isComposing() && editor.session.getPhase() === 'Navigation') {
        selectionCtrl.extendTo(editor.session.getActiveCell(), cell);
        editor.focus(); // 入力受け口（常駐 textarea）を保持（以降の Shift+矢印を受けられるように）
        sync.view.markViewportDirty();
        return;
      }
      // 通常クリック: 明示レンジを解除（同一セル再クリックでも単一選択へ戻す・AC4）→ activeCell 移動。
      selectionCtrl.clear();
      editor.pointerdownCell(cell);
      // pointerdownCell 処理後に Navigation なら（元から Navigation / 編集は確定済み）ドラッグ選択を開始する。
      // composition 中は開始しない（クリックは pendingNavigation 経路のまま・composition を乱さない・AC7）。
      if (!editor.session.isComposing() && editor.session.getPhase() === 'Navigation') {
        selectionDrag = { pointerId: event.pointerId };
        selectionCtrl.beginDrag(cell);
        scroller.setPointerCapture(event.pointerId);
      }
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
      ...(options.columnWidths !== undefined ? { columnWidths: options.columnWidths } : {}),
      ...(options.rowHeights !== undefined ? { rowHeights: options.rowHeights } : {}),
      // DD-012-5: wrap 列・行分割キャッシュ・フォント・行高を DocumentView へ渡す（自動行高の計算基盤）。
      ...(wrapEnabled ? { wrapColumns } : {}),
      wrapCache: cellTextCache,
      cellFont: CELL_FONT,
      lineHeight: CELL_TEXT_LINE_HEIGHT,
      onConnected: () => {
        metrics.mark('wsConnected');
      },
      onOperations: () => {
        metrics.mark('firstSync');
        editor?.session.noteServerUpdate();
      },
    });

    attachBackendRendering();
  }

  /**
   * SetCells を backend へ submit する共有経路（IME 確定と DD-020-1 範囲クリアが共用する）。
   * 単独モードは submitLocalOperation 内で cell-commit を通知する（onCellCommit→emit・DD-024 決定②）。
   * ローカル楽観適用の直後に、変更行の自動行高を再計算する（D5 トリガー②＝ローカル・SetCells のみ）。
   */
  function submitSetCells(op: SetCellsOperation): OperationId | void {
    const backend = sync;
    if (backend === undefined) {
      return;
    }
    const id = backend.session.submitLocalOperation(op);
    if (wrapEnabled) {
      backend.view.recomputeAutoRowHeightsForRows(op.changes.map((c) => c.rowId));
    }
    return id;
  }

  /**
   * backend（共同編集 SessionSync / 単独 StandaloneSession）を描画層・IME へ結線する（DD-024 で boot から抽出）。
   * `sync` が設定済みであることを前提に、base-layer・docPort・editor を構築し syncLayout → backend.start() する。
   * 共同編集/単独で共有し、両者の差分は「どの backend を作るか」だけに閉じる（案B・contract §5）。
   */
  function attachBackendRendering(): void {
    const backend = sync;
    if (backend === undefined) {
      return;
    }
    baseLayer = createBaseLayer({
      ctx: baseCtx,
      store: backend.view.store,
      headerWidth: HEADER_WIDTH,
      headerHeight: HEADER_HEIGHT,
      // DD-012-5: 共有キャッシュ・wrap 判定・pane 境界・折り返し行高を渡す（オーバーフロー／折り返し描画）。
      cellFont: CELL_FONT,
      textCache: cellTextCache,
      frozenColCount,
      lineHeight: CELL_TEXT_LINE_HEIGHT,
      isWrapColumn: (colIndex) => {
        if (!wrapEnabled) {
          return false;
        }
        const id = backend.view.columnIdAt(colIndex);
        return id !== undefined && wrapColumnStrings.has(String(id));
      },
    });

    // ---- IME×backend の結線（値の源は backend.session／backend.view）----
    const docPort: EditingDocumentPort = {
      getCommittedDocument: () => backend.session.committedDocument,
      displayText: (rowId, columnId) => backend.view.cellDisplay(rowId, columnId),
      rowIdAt: (index) => backend.view.rowIdAt(index),
      colIdAt: (index) => backend.view.columnIdAt(index),
      rowIndexOf: (rowId) => backend.view.rowIndexOf(rowId),
      colIndexOf: (columnId) => backend.view.colIndexOf(columnId),
    };

    /**
     * 範囲クリア（DD-020-1 AC5/AC6）: 明示レンジを 1 つの原子的 SetCells（非空セルのみ・beforeRevision 付き）
     * で blank 化する。生成・上限検査は range-ops（純粋関数）・submit は IME 確定と同じ共有経路（submitSetCells）。
     * 上限超過は submit せず rejected イベント（公開 code=range-too-large・operationId は空＝未 submit）で通知する。
     * レンジは維持する（AC5: Delete は解除トリガーではない／AC6: 縮めて再実行できる）。
     * （arrow 式: 上の backend undefined ガード後の narrowing を閉包へ効かせる＝hoist される function 宣言にしない）
     */
    const performRangeClear = (): void => {
      const range = selectionCtrl.getRange();
      if (range === null) {
        return; // 裁定（delete-range）と実行の間に状態が変わった場合の防御（何もしない）
      }
      const outcome = buildRangeClear(docPort, range);
      switch (outcome.kind) {
        case 'noop':
          return; // 範囲内が全て空 → 変更なし（submit しない）
        case 'too-large':
          diag.emit('warn', 'range-clear-too-large', `範囲 ${outcome.cellCount} セル > 上限 ${outcome.limit}（拒否）`);
          emit({
            type: 'rejected',
            pendingCount: backend.session.pendingCount,
            conflict: { operationId: '', reason: 'rejected', code: 'range-too-large' },
          });
          return;
        case 'submit':
          submitSetCells(outcome.operation);
          // 前段消費のため editor onChange（markViewportDirty）が走らない → 楽観適用の再描画をここで要求する。
          backend.view.markCellDirty();
          return;
      }
    };
    const editorLayout: GridLayout = {
      get rowCount() {
        return backend.view.rowAxis.count();
      },
      get columnCount() {
        return backend.view.colAxis.count();
      },
      rowHeaderWidth: HEADER_WIDTH,
      columnHeaderHeight: HEADER_HEIGHT,
      cellWidth: COL_WIDTH,
      cellHeight: ROW_HEIGHT,
    };
    editor = createIntegrationEditor({
      host: stage,
      document: docPort,
      submit: (op) => submitSetCells(op),
      layout: editorLayout,
      onPresenceChange: (update: PresenceUpdate) => {
        backend.session.sendPresence(update);
      },
      onChange: () => {
        if (editor === undefined) {
          return;
        }
        ensureActiveCellVisible(); // アクティブセルを可視域へ（scrollTop/Left を同期更新しうる）
        // DD-020-1 AC4: activeCell 移動・編集開始で明示レンジを単一選択へ戻す（不変条件は controller が判定）。
        selectionCtrl.syncWithEditor(editor.session.getActiveCell(), editor.session.getPhase());
        selection = singleCell(editor.session.getActiveCell());
        const transform = currentTransform(); // 上の scroll 反映後の transform で配置する
        if (transform !== undefined) {
          editor.refreshPlacement(transform, placementConfig());
        }
        backend.view.markViewportDirty();
      },
      // keydown 前段裁定（DD-020-1 案X）: Navigation 位相の Shift+矢印をレンジ拡張として消費する。
      // composition 中・編集中は decideNavigationIntercept が必ず 'none' を返し従来経路のまま（CG-1 資産無変更）。
      interceptKeydown: (input) => {
        const current = editor;
        const backendNow = sync;
        if (current === undefined || backendNow === undefined) {
          return false;
        }
        const decision = decideNavigationIntercept({
          key: input.key,
          shiftKey: input.shiftKey,
          eventComposing: input.isComposing,
          sessionComposing: current.session.isComposing(),
          phase: current.session.getPhase(),
          hasRange: selectionCtrl.getRange() !== null,
        });
        switch (decision.action) {
          case 'none':
            return false;
          case 'clear-range':
            // Escape: レンジ解除のみ。キー自体は状態機械へも流す（Navigation の Escape は no-op＝挙動保存）。
            selectionCtrl.clear();
            backendNow.view.markViewportDirty();
            return false;
          case 'delete-range':
            // Delete（レンジあり）: 範囲クリア＝原子 SetCells（AC5/AC6）。消費して状態機械の単一セル
            // Delete（S-A4）にしない。レンジ無しの Delete は 'none' で従来経路のまま。
            performRangeClear();
            return true;
          case 'extend': {
            const focus = selectionCtrl.extendByArrow(current.session.getActiveCell(), decision.direction, {
              rowCount: backendNow.view.rowAxis.count(),
              colCount: backendNow.view.colAxis.count(),
            });
            ensureCellVisible(focus); // focus 端を可視域へ（Excel 準拠の scroll-follow）
            backendNow.view.markViewportDirty();
            return true; // 消費（状態機械の Move にしない）
          }
        }
      },
    });

    syncLayout();
    backend.start();
  }

  /** 単独モードの backend を構築して結線する（同期・共同編集の boot に相当・DD-024）。 */
  function bootStandalone(): void {
    if (destroyed) {
      return;
    }
    const errorCode = validateStandaloneOptions(options);
    if (errorCode !== undefined) {
      diag.emit('error', 'config-error', `${errorCode}: 単独モードの options 検証に失敗`);
      emit({ type: 'error', phase: 'config', code: errorCode, message: `standalone options invalid (${errorCode})` });
      return; // 配線しない（rAF ループは sync=undefined で no-op）
    }
    const standaloneOptions = options as GridStandaloneMountOptions;
    resolvedDocumentId = standaloneOptions.documentId;
    diag.emit('info', 'standalone-boot', `columns=${standaloneOptions.columnOrder.length}`);
    standalone = createStandaloneSession({
      columnOrder: standaloneOptions.columnOrder,
      ...(standaloneOptions.initialData !== undefined ? { initialData: standaloneOptions.initialData } : {}),
      rowHeight: ROW_HEIGHT,
      colWidth: COL_WIDTH,
      ...(options.columnWidths !== undefined ? { columnWidths: options.columnWidths } : {}),
      ...(options.rowHeights !== undefined ? { rowHeights: options.rowHeights } : {}),
      ...(wrapEnabled ? { wrapColumns } : {}),
      wrapCache: cellTextCache,
      cellFont: CELL_FONT,
      lineHeight: CELL_TEXT_LINE_HEIGHT,
      // 確定通知（決定②「通知のみ」）: 表示文字列 batch を cell-commit イベントへ写して購読者へ配信する。
      onCellCommit: (changes) => {
        emit({ type: 'cell-commit', changes });
      },
    });
    sync = standalone;
    attachBackendRendering();
    // boot 前に呼ばれた setData（キャッシュ済みデータの mount 直後注入等）を適用する（Codex[P1]）。
    if (pendingStandaloneData !== undefined) {
      const data = pendingStandaloneData;
      pendingStandaloneData = undefined;
      applyStandaloneData(data);
    }
  }

  /**
   * 単独モードの再注入を適用する（setData 経由）。文書差し替え後、IME state machine の activeCell が新しい行/列
   * 範囲外に取り残されると以後の入力/Delete が無効 RowId へ落ちて無言で失われるため、範囲外なら active cell を
   * クランプして再シートする（Codex[P2]）。合成中は I-3 を守って触らない（利用側は編集完了後の再注入を推奨）。
   */
  function applyStandaloneData(data: GridStandaloneData): void {
    if (standalone === undefined) {
      return;
    }
    standalone.setData(data);
    if (editor === undefined || editor.session.isComposing()) {
      return;
    }
    // 新文書（差し替え直後・Axis は次 flush で再構築される）から行数・列数を読む。
    const doc = standalone.session.committedDocument;
    const rowCount = displayRowOrder(doc).length;
    const colCount = doc.columnOrder.length;
    const active = editor.session.getActiveCell();
    if (active.row < rowCount && active.col < colCount) {
      return; // 範囲内 → active cell は触らない（周期リフレッシュでカーソルを飛ばさない）
    }
    if (rowCount === 0 || colCount === 0) {
      editor.pointerdownCell(null); // 空文書 → 選択解除
      return;
    }
    editor.pointerdownCell({ row: Math.min(active.row, rowCount - 1), col: Math.min(active.col, colCount - 1) });
  }

  // ---- 公開ハンドル ----
  const instance: GridInstance = {
    get documentId(): string {
      return resolvedDocumentId ?? options.documentId ?? '';
    },
    connectionState(): GridConnectionState {
      // 単独モードは恒常的に非接続（DD-024・contract §4）。'offline'（一時切断）と区別する専用値。
      if (isStandalone) {
        return 'standalone';
      }
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
    setData(data: GridStandaloneData) {
      // 単独モード専用（DD-024・決定③）。
      if (standalone !== undefined) {
        applyStandaloneData(data);
        return;
      }
      // 単独モードだが boot（microtask）未完了 → 保留し構築後に適用する（Codex[P1]・mount 直後注入を捨てない）。
      if (isStandalone && !destroyed) {
        pendingStandaloneData = data; // 複数回呼ばれたら最後の 1 回を採用（最新状態）
        return;
      }
      // 共同編集モードでは no-op（診断のみ）。
      diag.emit('warn', 'setData', 'setData は単独モード専用（共同編集モードでは無視）');
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
      isStandalone
        ? 'standalone'
        : sync === undefined
          ? 'offline'
          : sync.session.isStopped
            ? 'stopped'
            : sync.session.isOnline
              ? 'online'
              : 'offline',
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
    selectionRange: () => selectionCtrl.getRange(),
    dragRange: () => selectionCtrl.getDragRange(),
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
    columnHeaderRectAt: (col) => currentTransform()?.columnHeaderRect(col) ?? null,
    rowHeaderRectAt: (row) => currentTransform()?.rowHeaderRect(row) ?? null,
    columnWidthOverrides: () => sync?.view.columnWidthOverrideRecord() ?? {},
    rowHeightOverrides: () => sync?.view.rowHeightOverrideRecord() ?? {},
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
  if (isStandalone) {
    // 単独モード（DD-024）: WS/tick interval は不要（transport 無し）。backend 構築は microtask で行い、
    // mount() の同期 return 契約（イベントは return 後に届く）を共同編集経路と揃える。destroy 済みなら配線しない。
    queueMicrotask(() => {
      try {
        bootStandalone();
      } catch (error) {
        diag.emit('error', 'runtime-error', errorMessage(error));
        emit({ type: 'error', phase: 'runtime', code: 'runtime-fault', message: errorMessage(error) });
      }
    });
  } else {
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
  }

  return instance;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
