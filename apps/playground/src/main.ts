// PoC-A グリッド + 生 IME トレース採取の配線（コントローラ）。
// 描画は grid-view、値は cell-store、移動計算は navigation、座標は geometry、
// 生イベント記録は event-recorder、常駐 textarea（最小版）は resident-textarea、
// トレース表示/エクスポートは trace-panel が担い、ここは各モジュールをつなぐ薄いアダプタに徹する。
//
// 新 Phase 2 の範囲は「20×10 グリッド + 単一セル選択/移動 + 最小常駐 textarea + 生イベント recorder」まで。
// 編集状態機械（IME 確定 Enter 抑止など）・リモート更新シミュレーターは後続 Phase で追加する。
import { createDocumentId, type DocumentId } from '@nanairo-sheet/sheet-types';

import { createCellStore } from './grid/cell-store';
import { createGridView } from './grid/grid-view';
import { DEFAULT_GRID_LAYOUT, type CellPosition, hitTestCell } from './grid/geometry';
import { moveActiveCell } from './grid/navigation';
import { createEventRecorder } from './ime/event-recorder';
import { type EditorSelection, createResidentEditor } from './ime/resident-textarea';
import { createTracePanel } from './ui/trace-panel';

const layout = DEFAULT_GRID_LAYOUT;

const canvas = document.querySelector<HTMLCanvasElement>('#grid');
if (canvas === null) {
  throw new Error('#grid の Canvas 要素が見つかりません');
}

const scroll = document.querySelector<HTMLDivElement>('#grid-scroll');
if (scroll === null) {
  throw new Error('#grid-scroll のスクロールコンテナが見つかりません');
}

const panelRoot = document.querySelector<HTMLDivElement>('#trace-panel');
if (panelRoot === null) {
  throw new Error('#trace-panel のパネル要素が見つかりません');
}

// sheet-types のブランド型を 1 箇所使い、workspace 参照が機能することを示す。
const documentId: DocumentId = createDocumentId('playground-poc-a');
canvas.dataset.documentId = documentId;

const store = createCellStore(sampleCells());

// 選択中セル。編集状態機械の導入（Phase 3）までは main が保持する（DA #2）。
let activeCell: CellPosition = { row: 0, col: 0 };
// 競合インジケーター対象。リモート更新シミュレーター（Phase 4）が投入する。
const conflictCells: ReadonlySet<string> = new Set();

const view = createGridView(canvas, store, layout);

function render(): void {
  view.render({ activeCell, conflictCells });
}

// セル値が変わったら再描画（cell-store が唯一の値の正）。
store.subscribe(render);

// 生イベントレコーダー + トレースパネル（採取環境 ime は手入力欄から供給）。
const recorder = createEventRecorder();
const panel = createTracePanel({ root: panelRoot, recorder, userAgent: navigator.userAgent });

// アクティブセルの読み書き（main 所有）を editor へ渡す。set/move は再描画まで行う。
const selection: EditorSelection = {
  get: () => activeCell,
  set: (cell) => {
    activeCell = cell;
    render();
  },
  move: (direction) => {
    activeCell = moveActiveCell(layout, activeCell, direction);
    render();
  },
};

// 最小常駐 textarea。keydown/IME の受け口をこの textarea 一本にする（DA #3）。
const editor = createResidentEditor({
  host: scroll,
  pointerTarget: scroll,
  layout,
  store,
  selection,
  recorder,
  getEnvironment: () => panel.getEnvironment(),
});

// クリックでセル選択（ヘッダー・範囲外は無視）。pointerdown 自体は recorder が記録する。
canvas.addEventListener('pointerdown', (event) => {
  // 変換中は composition を壊す移動をしない（§11.6・pendingNavigation は Phase 3）。
  if (editor.isComposing()) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const hit = hitTestCell(layout, event.clientX - rect.left, event.clientY - rect.top);
  if (hit === null) {
    return;
  }
  // 編集中なら現在の draft を確定してから選択を移す（非 composing 時のみ到達）。
  editor.commit();
  selection.set(hit);
  editor.place();
  editor.focus();
});

// ダブルクリックで既存値編集（§11.4）。
canvas.addEventListener('dblclick', (event) => {
  if (editor.isComposing()) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const hit = hitTestCell(layout, event.clientX - rect.left, event.clientY - rect.top);
  if (hit === null) {
    return;
  }
  editor.beginExisting(hit);
});

render();

/** 表示・移動確認用のサンプル値（日本語の Canvas 描画確認を兼ねる）。 */
function sampleCells(): ReadonlyArray<readonly [CellPosition, string]> {
  return [
    [{ row: 0, col: 0 }, '氏名'],
    [{ row: 0, col: 1 }, '部署'],
    [{ row: 0, col: 2 }, '内線'],
    [{ row: 1, col: 0 }, '田中 太郎'],
    [{ row: 1, col: 1 }, '営業部'],
    [{ row: 1, col: 2 }, '1234'],
    [{ row: 2, col: 0 }, '鈴木 花子'],
    [{ row: 2, col: 1 }, '開発部'],
    [{ row: 2, col: 2 }, '5678'],
    [{ row: 4, col: 5 }, 'スクロール確認用'],
  ];
}
