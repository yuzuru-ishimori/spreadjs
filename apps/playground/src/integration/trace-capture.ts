// CG-1 実機 IME trace 採取（DD-016-2 Phase 4・`?trace=1` でのみ有効化）。
//
// 統合ページは @nanairo-sheet/grid Facade の consumer（R1: 内部 @nanairo-sheet/* を import しない）ため、
// event-recorder（packages/ime）は import できない（import すると apps→internal の boundary 違反 new≠0）。
// よってここでは DOM イベントから `scripts/cg1/judge-ime-trace.mjs` が読む ImeEventTrace 互換のプレーンオブジェクトを
// 直接構築する（Facade が #int-stage 内に構築する常駐 textarea の composition/input/keydown はバブルするので、
// container で capture-phase 購読すれば textarea 参照なしに採取できる）。通常利用・E2E には一切影響しない
// （main.ts が `?trace=1` のときだけ dynamic import する）。
//
// judge の PASS 条件（先頭欠落0・順序B〔compositionend 後の keydown Enter isComposing:false〕採取・
// Chrome/Edge 両カバー・1セッション以上）を満たす trace を採るためのもの。実 IME の挙動は synthetic で
// 代替できない（DD-012-1 先例）ため、実際の打鍵とエクスポートは人手で行う。

/** judge が読む 1 イベント分の trace（ImeEventTrace 互換・Appendix B）。 */
interface CapturedTrace {
  timestamp: number;
  browser: string;
  os: string;
  ime: string;
  state: string;
  eventType: string;
  key?: string;
  code?: string;
  isComposing?: boolean;
  inputType?: string;
  data?: string | null;
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  activeCell: { row: number; col: number };
}

const RECORDED_TYPES = [
  'compositionstart',
  'compositionupdate',
  'compositionend',
  'beforeinput',
  'input',
  'keydown',
  'keyup',
  'focus',
  'blur',
] as const;

function inferBrowser(ua: string): string {
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('Chrome/')) return 'Chrome';
  if (ua.includes('Firefox/')) return 'Firefox';
  if (ua.includes('Safari/')) return 'Safari';
  return 'Unknown';
}

function inferOs(ua: string): string {
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac OS')) return 'macOS';
  if (ua.includes('Linux')) return 'Linux';
  return 'Unknown';
}

/** `?trace=1` のときだけ main.ts から呼ばれる。stage に採取UIと capture 購読を仕込む。 */
export function installTraceCapture(stage: HTMLElement): void {
  const traces: CapturedTrace[] = [];
  const ua = navigator.userAgent;
  const browser = inferBrowser(ua);
  const os = inferOs(ua);
  // 実 IME は userAgent から判別できない（Microsoft IME / Google 日本語入力 等）。採取者が明示する。
  let ime = 'Microsoft IME';
  // 粗い状態ラベル（judge は composition 系列で判定するので必須ではないが DD-012-1 形式に合わせる）。
  let composing = false;

  const record = (type: (typeof RECORDED_TYPES)[number], ev: Event): void => {
    const target = ev.target;
    const ta = target instanceof HTMLTextAreaElement ? target : null;
    const value = ta?.value ?? '';
    const selectionStart = ta?.selectionStart ?? null;
    const selectionEnd = ta?.selectionEnd ?? null;

    if (type === 'compositionstart') composing = true;
    if (type === 'compositionend') composing = false;

    const trace: CapturedTrace = {
      timestamp: Math.round(performance.now()),
      browser,
      os,
      ime,
      state: composing ? 'Composing' : 'Editing',
      eventType: type,
      value,
      selectionStart,
      selectionEnd,
      activeCell: { row: 0, col: 0 },
    };

    if (ev instanceof KeyboardEvent) {
      trace.key = ev.key;
      trace.code = ev.code;
      trace.isComposing = ev.isComposing;
    } else if (typeof CompositionEvent !== 'undefined' && ev instanceof CompositionEvent) {
      trace.data = ev.data;
    } else if (ev instanceof InputEvent) {
      trace.inputType = ev.inputType;
      trace.data = ev.data;
      trace.isComposing = ev.isComposing;
    }

    traces.push(trace);
    updateCount();
  };

  for (const type of RECORDED_TYPES) {
    // capture-phase: Facade 内部 textarea からバブルする前に採る（DA #5・recorder は記録のみ）。
    stage.addEventListener(type, (ev) => record(type, ev), true);
  }

  // ---- 採取UI（固定パネル・通常表示を邪魔しない右下） ----
  const panel = document.createElement('div');
  panel.setAttribute('data-trace-panel', '1');
  panel.style.cssText =
    'position:fixed;right:8px;bottom:8px;z-index:9999;background:#111;color:#eee;' +
    'font:12px ui-monospace,Consolas,monospace;padding:8px 10px;border-radius:6px;opacity:.92;';

  const count = document.createElement('span');
  const updateCount = (): void => {
    count.textContent = `traces: ${traces.length}`;
  };

  const imeInput = document.createElement('input');
  imeInput.value = ime;
  imeInput.title = '実 IME 名（採取環境）';
  imeInput.style.cssText = 'width:130px;margin:0 6px;font:inherit;';
  imeInput.addEventListener('input', () => {
    ime = imeInput.value.trim() || 'Microsoft IME';
  });

  const exportBtn = document.createElement('button');
  exportBtn.textContent = 'export trace';
  exportBtn.style.cssText = 'font:inherit;cursor:pointer;';
  exportBtn.setAttribute('data-trace-export', '1');
  exportBtn.addEventListener('click', () => {
    const payload = {
      meta: { browser, os, ime, userAgent: ua, capturedAt: new Date().toISOString() },
      traces,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cg1-${browser.toLowerCase()}-trace.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'clear';
  clearBtn.style.cssText = 'font:inherit;cursor:pointer;margin-left:6px;';
  clearBtn.addEventListener('click', () => {
    traces.length = 0;
    updateCount();
  });

  updateCount();
  panel.append('CG-1 ', count, imeInput, exportBtn, clearBtn);
  document.body.appendChild(panel);

  // E2E 検証（Step 0 plumbing 確認）用に window へ export payload getter を出す（?trace=1 のときだけ）。
  (window as unknown as { __cg1TracePayload?: () => unknown }).__cg1TracePayload = () => ({
    meta: { browser, os, ime, userAgent: ua },
    traces,
  });
}
