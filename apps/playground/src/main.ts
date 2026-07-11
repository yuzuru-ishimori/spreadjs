// PoC-A グリッド土台の配線（コントローラ）。
// 描画は grid-view、値は cell-store、移動計算は navigation、座標は geometry が担い、
// ここは DOM イベント（クリック・キー）を各モジュールへつなぐ薄いアダプタに徹する。
//
// Phase 1 の範囲は「20×10 グリッドの表示 + 単一セル選択 + キーボード/クリック移動」まで。
// 編集（常駐 textarea・IME 状態機械）・リモート更新シミュレーターは後続 Phase で追加する。
import { createDocumentId, type DocumentId } from '@nanairo-sheet/sheet-types';

import { createCellStore } from './grid/cell-store';
import { createGridView } from './grid/grid-view';
import { DEFAULT_GRID_LAYOUT, type CellPosition, hitTestCell } from './grid/geometry';
import { keyToDirection, moveActiveCell } from './grid/navigation';

const layout = DEFAULT_GRID_LAYOUT;

const canvas = document.querySelector<HTMLCanvasElement>('#grid');
if (canvas === null) {
  throw new Error('#grid の Canvas 要素が見つかりません');
}

const scroll = document.querySelector<HTMLDivElement>('#grid-scroll');
if (scroll === null) {
  throw new Error('#grid-scroll のスクロールコンテナが見つかりません');
}

// sheet-types のブランド型を 1 箇所使い、workspace 参照が機能することを示す。
const documentId: DocumentId = createDocumentId('playground-poc-a');
canvas.dataset.documentId = documentId;

const store = createCellStore(sampleCells());

// 選択中セル。編集状態機械の導入（Phase 2）までは main が保持する。
let activeCell: CellPosition = { row: 0, col: 0 };
// 競合インジケーター対象。リモート更新シミュレーター（Phase 3）が投入する。
const conflictCells: ReadonlySet<string> = new Set();

const view = createGridView(canvas, store, layout);

function render(): void {
  view.render({ activeCell, conflictCells });
}

// セル値が変わったら再描画（cell-store が唯一の値の正）。
store.subscribe(render);

// クリックでセル選択（ヘッダー・範囲外は無視）。
canvas.addEventListener('pointerdown', (event) => {
  const rect = canvas.getBoundingClientRect();
  const hit = hitTestCell(layout, event.clientX - rect.left, event.clientY - rect.top);
  if (hit === null) {
    return;
  }
  activeCell = hit;
  scroll.focus();
  render();
});

// キーボードでセル移動（フォーカス可能なスクロールコンテナにスコープ）。
scroll.addEventListener('keydown', (event) => {
  const direction = keyToDirection({ key: event.key, shiftKey: event.shiftKey });
  if (direction === null) {
    return;
  }
  // 既定動作（ページスクロール・Tab フォーカス移動）を止め、グリッド内移動に限定する。
  event.preventDefault();
  activeCell = moveActiveCell(layout, activeCell, direction);
  render();
});

scroll.focus();
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
