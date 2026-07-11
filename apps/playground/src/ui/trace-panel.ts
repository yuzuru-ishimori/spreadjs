// トレースパネル（DD-002 新 Phase 2）。
//
// 生イベントレコーダーの内容を画面表示し、JSON エクスポート（ダウンロード）・クリア・
// 採取環境（UA / browser / os / ime 手入力）の付与を行う開発ツール UI。
// ユーザーが実 IME トレースを採取するための操作面。DOM 依存（描画アダプタ）。

import {
  type EventRecorder,
  type ImeEventTrace,
  type TraceEnvironment,
  detectEnvironment,
} from '../ime/event-recorder';

export interface TracePanelOptions {
  /** パネルを描画するルート要素。 */
  readonly root: HTMLElement;
  readonly recorder: EventRecorder;
  /** 環境推定に使う userAgent（通常は navigator.userAgent）。 */
  readonly userAgent: string;
  /** 一覧に表示する最大件数（既定 40）。 */
  readonly maxRows?: number;
}

export interface TracePanel {
  /** 現在の採取環境（browser/os は自動推定、ime は手入力欄の値）。 */
  getEnvironment(): TraceEnvironment;
  /** リスナー解除。 */
  destroy(): void;
}

/** エクスポート JSON の最上位形式（メタ + トレース列）。 */
interface TraceExportDocument {
  readonly meta: {
    readonly browser: string;
    readonly os: string;
    readonly ime: string;
    readonly userAgent: string;
    readonly exportedAt: string;
    readonly traceCount: number;
  };
  readonly traces: readonly ImeEventTrace[];
}

const DEFAULT_MAX_ROWS = 40;

/** ファイル名に使える簡易スラグ（英数字とハイフンのみ）。 */
function slug(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized === '' ? 'unknown' : normalized;
}

/** イベント種別ごとの補足（key / inputType / data / isComposing）を 1 行に要約する。 */
function describeDetail(trace: ImeEventTrace): string {
  const parts: string[] = [];
  if (trace.key !== undefined) {
    parts.push(`key=${trace.key}`);
  }
  if (trace.code !== undefined && trace.code !== '') {
    parts.push(`code=${trace.code}`);
  }
  if (trace.inputType !== undefined) {
    parts.push(`inputType=${trace.inputType}`);
  }
  if (trace.data !== undefined) {
    parts.push(`data=${trace.data === null ? 'null' : JSON.stringify(trace.data)}`);
  }
  if (trace.isComposing !== undefined) {
    parts.push(`isComposing=${trace.isComposing}`);
  }
  return parts.join(' ');
}

/**
 * トレースパネルを生成し root に描画する。
 */
export function createTracePanel(options: TracePanelOptions): TracePanel {
  const { root, recorder, userAgent } = options;
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const detected = detectEnvironment(userAgent);

  root.replaceChildren();
  root.classList.add('trace-panel');

  const title = document.createElement('h2');
  title.textContent = 'IME イベントトレース';
  title.className = 'trace-panel__title';

  // --- 採取環境（browser/os は自動、ime は手入力） ---
  const envRow = document.createElement('div');
  envRow.className = 'trace-panel__env';

  const makeField = (labelText: string, value: string): HTMLSpanElement => {
    const span = document.createElement('span');
    span.className = 'trace-panel__env-item';
    const label = document.createElement('strong');
    label.textContent = `${labelText}: `;
    span.append(label, document.createTextNode(value));
    return span;
  };

  const imeLabel = document.createElement('label');
  imeLabel.className = 'trace-panel__env-item';
  const imeLabelText = document.createElement('strong');
  imeLabelText.textContent = 'IME: ';
  const imeInput = document.createElement('input');
  imeInput.type = 'text';
  imeInput.placeholder = '例: Microsoft IME / Google';
  imeInput.className = 'trace-panel__ime-input';
  imeLabel.append(imeLabelText, imeInput);

  envRow.append(
    makeField('browser', detected.browser),
    makeField('os', detected.os),
    imeLabel,
  );

  const uaRow = document.createElement('div');
  uaRow.className = 'trace-panel__ua';
  uaRow.textContent = `UA: ${userAgent}`;

  // --- 操作ボタン + 件数 ---
  const controls = document.createElement('div');
  controls.className = 'trace-panel__controls';

  const countLabel = document.createElement('span');
  countLabel.className = 'trace-panel__count';

  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.textContent = 'JSON エクスポート';

  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.textContent = 'クリア';

  controls.append(exportButton, clearButton, countLabel);

  // --- トレース一覧（新しい順） ---
  const list = document.createElement('div');
  list.className = 'trace-panel__list';

  root.append(title, envRow, uaRow, controls, list);

  const getEnvironment = (): TraceEnvironment => ({
    browser: detected.browser,
    os: detected.os,
    ime: imeInput.value.trim(),
  });

  const render = (): void => {
    const total = recorder.size();
    countLabel.textContent = `記録 ${total} 件（直近 ${Math.min(total, maxRows)} 件表示）`;

    const recent = recorder.getRecent(maxRows);
    const offset = total - recent.length;
    const rows = recent.map((trace, index) => {
      const row = document.createElement('div');
      row.className = 'trace-panel__row';

      const idx = document.createElement('span');
      idx.className = 'trace-panel__cell trace-panel__cell--idx';
      idx.textContent = String(offset + index);

      const state = document.createElement('span');
      state.className = 'trace-panel__cell trace-panel__cell--state';
      state.textContent = trace.state;

      const event = document.createElement('span');
      event.className = 'trace-panel__cell trace-panel__cell--event';
      event.textContent = trace.eventType;

      const detail = document.createElement('span');
      detail.className = 'trace-panel__cell trace-panel__cell--detail';
      detail.textContent = describeDetail(trace);

      const value = document.createElement('span');
      value.className = 'trace-panel__cell trace-panel__cell--value';
      value.textContent = `value=${JSON.stringify(trace.value)}`;

      row.append(idx, state, event, detail, value);
      return row;
    });
    // 新しい順（末尾が最新）で上から見えるよう反転して差し替える。
    rows.reverse();
    list.replaceChildren(...rows);
  };

  const exportJson = (): void => {
    const env = getEnvironment();
    const doc: TraceExportDocument = {
      meta: {
        browser: env.browser,
        os: env.os,
        ime: env.ime,
        userAgent,
        exportedAt: new Date().toISOString(),
        traceCount: recorder.size(),
      },
      traces: recorder.getTraces(),
    };
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${slug(env.ime)}-${slug(env.browser)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  exportButton.addEventListener('click', exportJson);
  clearButton.addEventListener('click', () => recorder.clear());
  const unsubscribe = recorder.subscribe(render);
  render();

  return {
    getEnvironment,
    destroy: () => {
      unsubscribe();
      root.replaceChildren();
    },
  };
}
