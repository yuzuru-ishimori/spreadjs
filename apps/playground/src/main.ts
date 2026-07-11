// PoC-A グリッド + 日本語 IME 編集 + 生トレース採取の配線（コントローラ）。
// 描画は grid-view、値は cell-store、座標は geometry、編集状態機械は editor-state-machine、
// 生イベント記録は event-recorder、常駐 textarea（状態機械統合）は resident-textarea、
// トレース表示/エクスポートは trace-panel が担い、ここは各モジュールをつなぐ薄いアダプタに徹する。
//
// Phase 3 の範囲は「20×10 グリッド + 常駐 textarea + 編集状態機械（確定 Enter 抑止・
// pendingNavigation・MarkConflictOnly）+ 生イベント recorder」。activeCell の所有権は
// 状態機械へ一本化した（DA #2）ため、main は editor.getActiveCell() を読むだけ。
import { createDocumentId, type DocumentId } from '@nanairo-sheet/sheet-types';

import { createCellStore } from './grid/cell-store';
import { createGridView } from './grid/grid-view';
import { DEFAULT_GRID_LAYOUT, type CellPosition, hitTestCell } from './grid/geometry';
import { createEventRecorder } from './ime/event-recorder';
import { createResidentEditor } from './ime/resident-textarea';
import { createRemoteUpdateSimulator } from './sim/remote-update-simulator';
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
const view = createGridView(canvas, store, layout);

// 生イベントレコーダー + トレースパネル（採取環境 ime は手入力欄から供給）。
const recorder = createEventRecorder();
const panel = createTracePanel({ root: panelRoot, recorder, userAgent: navigator.userAgent });

// 常駐 textarea（編集状態機械を内蔵）。keydown/IME の受け口をこの textarea 一本にする（DA #3）。
const editor = createResidentEditor({
  host: scroll,
  pointerTarget: scroll,
  layout,
  store,
  recorder,
  getEnvironment: () => panel.getEnvironment(),
  onViewChange: () => render(),
});

// アクティブセル・競合セルは状態機械が正（editor 経由で読む）。
function render(): void {
  view.render({ activeCell: editor.getActiveCell(), conflictCells: editor.getConflictCells() });
}

// セル値が変わったら再描画（cell-store が唯一の値の正。リモート更新の Canvas 反映もここ）。
store.subscribe(render);

// クリックでセル選択（ヘッダー・範囲外は null として状態機械に委ねる）。
// 変換中クリックの pendingNavigation 判定・編集中の commit も状態機械が担う（§11.6）。
canvas.addEventListener('pointerdown', (event) => {
  const rect = canvas.getBoundingClientRect();
  editor.pointerdownCell(hitTestCell(layout, event.clientX - rect.left, event.clientY - rect.top));
});

// ダブルクリックで既存値編集（§11.4）。
canvas.addEventListener('dblclick', (event) => {
  const rect = canvas.getBoundingClientRect();
  const hit = hitTestCell(layout, event.clientX - rect.left, event.clientY - rect.top);
  if (hit !== null) {
    editor.doubleClickCell(hit);
  }
});

// リモート更新シミュレーター（§11.7）。書込は editor.applyRemoteUpdate 経由で行うため
// cell-store は更新されるが textarea/draft は不変・編集中セルは競合マークのみ。
const simulator = createRemoteUpdateSimulator({
  layout,
  sink: {
    applyRemoteUpdate: (cell, value) => editor.applyRemoteUpdate(cell, value),
    getActiveCell: () => editor.getActiveCell(),
  },
});
wireSimulatorControls();

render();

/** シミュレーター操作ボタンを配線する（存在しない要素はスキップ）。 */
function wireSimulatorControls(): void {
  const activeButton = document.querySelector<HTMLButtonElement>('#sim-active');
  const otherButton = document.querySelector<HTMLButtonElement>('#sim-other');
  const burstButton = document.querySelector<HTMLButtonElement>('#sim-burst');
  const status = document.querySelector<HTMLSpanElement>('#sim-status');

  // ボタンの mousedown で既定のフォーカス移動を止め、textarea の focus を保つ（Codex 指摘）。
  // これをしないと click 前に textarea が blur し、非 composing 編集は commit・変換中は
  // composition が終了して「変換中にリモート更新して draft を維持」の検証（§11.7・#4/#5）が崩れる。
  const keepFocus = (button: HTMLButtonElement | null): void => {
    button?.addEventListener('mousedown', (event) => event.preventDefault());
  };
  keepFocus(activeButton);
  keepFocus(otherButton);
  keepFocus(burstButton);

  activeButton?.addEventListener('click', () => {
    simulator.writeActiveCell();
  });
  otherButton?.addEventListener('click', () => {
    simulator.writeOtherCell();
  });
  burstButton?.addEventListener('click', () => {
    if (simulator.isBursting()) {
      simulator.stopBurst();
    } else {
      simulator.startBurst();
    }
    if (burstButton !== null) {
      burstButton.textContent = simulator.isBursting() ? '連続書込 停止' : '連続書込 開始';
    }
    if (status !== null) {
      status.textContent = simulator.isBursting() ? '連続書込 中…' : '停止中';
    }
  });
}

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
