// 統合 PoC ページ（playground）— @nanairo-sheet/grid Facade の consumer。
//
// 旧 integration/main.ts の手組み配線（transport / sessionSync / render / integration-editor / rAF / tick / handlers）は
// grid Facade の mount() が内部で担う（DD-016 で package へ昇華）。本ファイルは **Facade の consumer** として:
//   ① size 済み container（#int-stage）を渡して mount（Facade が Canvas/scroller/常駐 textarea を構築）
//   ② GridEvent（接続状態・pending・競合・エラー）を購読して #int-status に表示
//   ③ E2E 用の深い introspection を test-support（getDebugApi）経由で window へ公開する（旧 __integrationTestApi の後継）
// のみを行う。内部パッケージ（core/collab/render/...）は一切 import しない（R1・Facade 経由に一本化）。

import { mount } from '@nanairo-sheet/grid';
import type { GridEvent, GridInstance } from '@nanairo-sheet/grid';
import { getDebugApi } from '@nanairo-sheet/grid/test-support';
import type { GridDebugApi } from '@nanairo-sheet/grid/test-support';

declare global {
  interface Window {
    /** E2E 検査用 introspection（test-support 経由・boot 前でも mount 直後から利用可）。 */
    __integrationTestApi?: GridDebugApi;
    __gridInstance?: GridInstance;
  }
}

const stage = document.getElementById('int-stage');
const statusEl = document.getElementById('int-status');
if (!(stage instanceof HTMLElement)) {
  throw new Error('#int-stage が見つかりません');
}

const params = new URLSearchParams(location.search);
const serverUrl = params.get('server') ?? 'http://127.0.0.1:8787';
const nameParam = params.get('name');

let connLabel = '未接続';
let pendingNow = 0;
function renderBar(): void {
  if (statusEl !== null) {
    statusEl.textContent = `接続: ${connLabel}  ｜  未送信(pending): ${pendingNow}  ｜  名前: ${nameParam ?? '(anon)'}`;
  }
}
function renderStatus(event: GridEvent): void {
  if (statusEl === null) {
    return;
  }
  switch (event.type) {
    case 'connection':
      connLabel =
        event.state === 'stopped'
          ? '🛑 stopped（編集停止・再接続試行中）'
          : event.state === 'online'
            ? '🟢 online'
            : '🟠 offline（再接続中…）';
      pendingNow = event.pendingCount;
      renderBar();
      break;
    case 'pending':
      // offline 中は connection が変化せず抑止されるため、pending イベントで backlog 件数を更新する（P2-4）。
      pendingNow = event.pendingCount;
      renderBar();
      break;
    case 'rejected':
      statusEl.textContent = `⚠ 競合 (${event.conflict.reason}${event.conflict.code !== undefined ? `/${event.conflict.code}` : ''})  ｜  未送信: ${event.pendingCount}`;
      break;
    case 'divergence':
      statusEl.textContent = `🛑 divergence（server=${event.serverRevision} / committed=${event.committedRevision}）`;
      break;
    case 'error':
      statusEl.textContent = `起動/接続エラー[${event.phase}]: ${event.message}`;
      break;
  }
}

const instance = mount(
  { container: stage },
  {
    serverUrl,
    ...(nameParam !== null ? { displayName: nameParam } : {}),
    onEvent: renderStatus,
  },
);

// E2E 用 introspection（旧 window.__integrationTestApi の後継。test-support 経由・mount 直後に登録済み）。
window.__gridInstance = instance;
window.__integrationTestApi = getDebugApi(instance);
