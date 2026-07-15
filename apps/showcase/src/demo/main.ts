// 動作デモページ（DD-017-2）。@nanairo-sheet/grid Facade（公開API）だけでグリッドを組み込む＝
// このファイル自体が「consumer は Facade のみで統合できる」ことの実演でもある（R1・S1-3 と同じ経路）。
import { mount } from '@nanairo-sheet/grid';
import type { GridEvent } from '@nanairo-sheet/grid';

import { SCENARIOS, findScenario } from './scenarios';

const params = new URLSearchParams(location.search);
// 既定は dev-start.sh --showcase が起動する server-hono（:9499）。E2E 等はクエリで差し替える。
const serverUrl = params.get('server') ?? 'http://127.0.0.1:9499';
const scenario = findScenario(params.get('scenario'));
const displayName = params.get('name') ?? `見学者-${Math.floor(Math.random() * 1000)}`;

// --- シナリオパネル ---------------------------------------------------------

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`demo: #${id} が demo.html にありません`);
  return el;
}

document.title = `Nanairo Sheet（仮称）SDK — デモ: ${scenario.title}`;
byId('demo-title').textContent = `動作デモ — ${scenario.title}`;
byId('scenario-title').textContent = scenario.title;
byId('scenario-goal').textContent = scenario.goal;

const stepsEl = byId('scenario-steps');
for (const step of scenario.steps) {
  const li = document.createElement('li');
  // <code>コマンド</code> 区切りだけを解釈して DOM を組み立てる（innerHTML は使わない）。
  for (const [index, segment] of step.split(/<\/?code>/).entries()) {
    if (segment === '') continue;
    if (index % 2 === 1) {
      const code = document.createElement('code');
      code.textContent = segment;
      li.appendChild(code);
    } else {
      li.appendChild(document.createTextNode(segment));
    }
  }
  stepsEl.appendChild(li);
}

if (scenario.action === 'open-second-window') {
  const button = document.createElement('button');
  button.textContent = '別ウィンドウで開く';
  button.addEventListener('click', () => {
    const url = new URL(location.href);
    url.searchParams.set('name', `ゲスト-${Math.floor(Math.random() * 1000)}`);
    window.open(url.toString(), '_blank', 'width=1000,height=700');
  });
  byId('scenario-actions').appendChild(button);
}

const othersEl = byId('scenario-others');
const othersLabel = document.createElement('b');
othersLabel.textContent = '他のシナリオ';
othersEl.appendChild(othersLabel);
for (const s of SCENARIOS) {
  const a = document.createElement('a');
  const url = new URL(location.href);
  url.searchParams.set('scenario', s.id);
  a.href = url.toString();
  a.textContent = s.title;
  if (s.id === scenario.id) a.className = 'current';
  othersEl.appendChild(a);
}

// --- 接続ステータス・イベントログ -------------------------------------------

const connEl = byId('conn');
const pendingEl = byId('pending');
const logEl = byId('event-log');

const CONN_LABEL: Record<string, string> = {
  online: 'オンライン',
  offline: 'オフライン（編集はローカル保持）',
  stopped: '停止',
};

function log(message: string): void {
  const line = document.createElement('div');
  line.textContent = `${new Date().toLocaleTimeString()} ${message}`;
  logEl.prepend(line);
  while (logEl.childElementCount > 50) logEl.lastElementChild?.remove();
}

function onEvent(event: GridEvent): void {
  switch (event.type) {
    case 'connection':
      connEl.textContent = CONN_LABEL[event.state] ?? event.state;
      connEl.className = `pill ${event.state}`;
      pendingEl.textContent = `未送信 ${event.pendingCount}`;
      log(`接続状態: ${event.state}`);
      break;
    case 'pending':
      pendingEl.textContent = `未送信 ${event.pendingCount}`;
      break;
    case 'rejected':
      pendingEl.textContent = `未送信 ${event.pendingCount}`;
      log(`競合を検出（黙って上書きしません）: ${event.conflict.code}`);
      break;
    case 'divergence':
      log(`divergence: server=${event.serverRevision} committed=${event.committedRevision}`);
      break;
    case 'error':
      log(`エラー [${event.phase}/${event.code}] ${event.message}`);
      break;
  }
}

// --- グリッド組み込み（Facade のみ） -----------------------------------------

const instance = mount({ container: byId('stage') }, { serverUrl, displayName, onEvent });
byId('stage').addEventListener('click', () => instance.focus());
log(`mount 完了（server: ${serverUrl} / 表示名: ${displayName}）`);
