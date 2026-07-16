// 単独グリッドモード（DD-024）の playground consumer。
//
// 共同編集サーバーを一切使わず mount('standalone') する。cell-commit を「利用側 API のモック」＝localStorage へ
// 保存し、次回ロード時に initialData として再注入する（利用側で認証・保存を持つ責務境界の実演＝roadmap §6）。
// E2E は本ページ（standalone.html）を対象に、表示/注入・cell-commit・F5 復元・再mount リークを検証する。
// 内部パッケージ（core/collab/...）は一切 import しない（R1・Facade 経由に一本化）。

import { mount, GRID_API_VERSION } from '@nanairo-sheet/grid';
import type { GridEvent, GridInstance, GridStandaloneData } from '@nanairo-sheet/grid';
import { getDebugApi } from '@nanairo-sheet/grid/test-support';
import type { GridDebugApi } from '@nanairo-sheet/grid/test-support';

const stage = document.getElementById('int-stage');
const statusEl = document.getElementById('int-status');
if (!(stage instanceof HTMLElement)) {
  throw new Error('#int-stage が見つかりません');
}

const COLUMN_ORDER = ['col-a', 'col-b', 'col-c', 'col-d'];
const SEED_ROW_COUNT = 20;

// 利用側の保存モック（localStorage）。cell-commit を rowId|columnId→value で蓄積し、次回 initialData に混ぜる。
const SAVE_KEY = 'nsheet:standalone:cells';
type SavedCells = Record<string /* rowId */, Record<string /* columnId */, string>>;

function loadSaved(): SavedCells {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw === null ? {} : (JSON.parse(raw) as SavedCells);
  } catch {
    return {};
  }
}
function persist(saved: SavedCells): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(saved));
  } catch {
    // 保存不可（プライベートモード等）でも致命ではない。
  }
}

/** シード行（r0..r19）＋保存済み値をマージした初期データを組む（F5 復元の実演）。 */
function buildInitialData(): GridStandaloneData {
  const saved = loadSaved();
  const rows: GridStandaloneData['rows'] = Array.from({ length: SEED_ROW_COUNT }, (_, i) => {
    const rowId = `r${i}`;
    // 既定シード: col-a に行ラベル。保存済み値があれば上書き。
    const cells: Record<string, string> = { 'col-a': `行${i}` };
    Object.assign(cells, saved[rowId] ?? {});
    return { rowId, cells };
  });
  return { rows };
}

const events: GridEvent[] = [];
let connLabel = '未接続';

function renderBar(): void {
  if (statusEl !== null) {
    statusEl.textContent = `SDK ${GRID_API_VERSION} ｜ 単独モード ｜ 接続: ${connLabel} ｜ cell-commit: ${events.filter((e) => e.type === 'cell-commit').length} 件`;
  }
}

function onEvent(event: GridEvent): void {
  events.push(event);
  if (event.type === 'cell-commit') {
    // 利用側 API（モック）へ保存する（決定②「通知のみ」＝grid は書き戻さない・利用側が保存）。
    const saved = loadSaved();
    for (const change of event.changes) {
      const row = saved[change.rowId] ?? (saved[change.rowId] = {});
      row[change.columnId] = change.value;
    }
    persist(saved);
  } else if (event.type === 'error') {
    connLabel = `error[${event.phase}]: ${event.message}`;
  }
  renderBar();
}

/** consumer が公開 API だけで grid を制御するハンドル（route 遷移・E2E 駆動用）。 */
interface StandaloneHandle {
  instance: GridInstance | null;
  readonly events: GridEvent[];
  connectionState(): string;
  mount(): void;
  destroy(): void;
  /** 再注入デモ（決定③）: 指定データで setData を呼ぶ。 */
  reinject(data: GridStandaloneData): void;
  /** localStorage の保存モックを消す（テストの独立性）。 */
  clearSaved(): void;
}

const handle: StandaloneHandle = {
  instance: null,
  events,
  connectionState(): string {
    return this.instance?.connectionState() ?? 'none';
  },
  mount(): void {
    if (this.instance !== null) {
      return;
    }
    const instance = mount(
      { container: stage },
      { mode: 'standalone', columnOrder: COLUMN_ORDER, initialData: buildInitialData(), onEvent },
    );
    this.instance = instance;
    connLabel = instance.connectionState();
    renderBar();
    instance.focus();
    // E2E introspection（displayCell/ready 等）を公開する（test-support 経由・mount 直後に登録済み）。
    window.__integrationTestApi = getDebugApi(instance);
    window.__gridInstance = instance;
  },
  destroy(): void {
    this.instance?.destroy();
    this.instance = null;
    window.__integrationTestApi = undefined;
    window.__gridInstance = undefined;
    connLabel = '未接続';
    renderBar();
  },
  reinject(data: GridStandaloneData): void {
    this.instance?.setData(data);
  },
  clearSaved(): void {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // no-op
    }
  },
};

declare global {
  interface Window {
    __standalone?: StandaloneHandle;
    __integrationTestApi?: GridDebugApi;
    __gridInstance?: GridInstance;
  }
}

window.__standalone = handle;
renderBar();
handle.mount();
