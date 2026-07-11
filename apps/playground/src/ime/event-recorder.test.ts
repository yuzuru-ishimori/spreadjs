import { describe, expect, it } from 'vitest';

import {
  type RecorderContext,
  type RecorderEventSnapshot,
  createEventRecorder,
  detectEnvironment,
  formatTrace,
} from './event-recorder';

// synthetic なイベントスナップショット/文脈で recorder の整形ロジックを駆動する
// （node 環境・DOM 非依存）。実 IME の候補ウィンドウ・イベント順は再現しない
// ＝ここでのテストは「整形の正しさ」の検証であり、実機受入試験の代替ではない。

const context: RecorderContext = {
  environment: { browser: 'Chrome', os: 'Windows', ime: 'Microsoft IME' },
  state: 'Composing',
  activeCell: { row: 2, col: 3 },
};

function snapshot(overrides: Partial<RecorderEventSnapshot> & Pick<RecorderEventSnapshot, 'type'>): RecorderEventSnapshot {
  return {
    timestamp: 1000,
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    ...overrides,
  };
}

describe('detectEnvironment（userAgent 推定）', () => {
  it('Windows の Chrome を判定する', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
    expect(detectEnvironment(ua)).toEqual({ browser: 'Chrome', os: 'Windows' });
  });

  it('Edge を Chrome より優先して判定する（UA に Chrome を含むため）', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0';
    expect(detectEnvironment(ua)).toEqual({ browser: 'Edge', os: 'Windows' });
  });

  it('Firefox / macOS Safari も判定できる', () => {
    const firefox = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0';
    expect(detectEnvironment(firefox)).toEqual({ browser: 'Firefox', os: 'Windows' });

    const safari =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
    expect(detectEnvironment(safari)).toEqual({ browser: 'Safari', os: 'macOS' });
  });

  it('不明な UA は Unknown を返す（黙って誤判定しない）', () => {
    expect(detectEnvironment('curl/8.0')).toEqual({ browser: 'Unknown', os: 'Unknown' });
  });
});

describe('formatTrace（イベント種別ごとの整形）', () => {
  it('共通フィールド（環境・状態・セル・値・選択）を写す', () => {
    const trace = formatTrace(snapshot({ type: 'focus', timestamp: 42, value: 'あ', selectionStart: 1, selectionEnd: 1 }), context);
    expect(trace.timestamp).toBe(42);
    expect(trace.browser).toBe('Chrome');
    expect(trace.os).toBe('Windows');
    expect(trace.ime).toBe('Microsoft IME');
    expect(trace.state).toBe('Composing');
    expect(trace.eventType).toBe('focus');
    expect(trace.value).toBe('あ');
    expect(trace.selectionStart).toBe(1);
    expect(trace.selectionEnd).toBe(1);
    expect(trace.activeCell).toEqual({ row: 2, col: 3 });
  });

  it('keydown は key/code/isComposing を持ち inputType/data を持たない', () => {
    const trace = formatTrace(
      snapshot({ type: 'keydown', key: 'Enter', code: 'Enter', isComposing: true }),
      context,
    );
    expect(trace.key).toBe('Enter');
    expect(trace.code).toBe('Enter');
    expect(trace.isComposing).toBe(true);
    expect('inputType' in trace).toBe(false);
    expect('data' in trace).toBe(false);
  });

  it('input は inputType/data/isComposing を持ち key/code を持たない', () => {
    const trace = formatTrace(
      snapshot({
        type: 'input',
        inputType: 'insertText',
        data: '日本',
        isComposing: false,
        value: '日本',
      }),
      context,
    );
    expect(trace.inputType).toBe('insertText');
    expect(trace.data).toBe('日本');
    expect(trace.isComposing).toBe(false);
    expect('key' in trace).toBe(false);
    expect('code' in trace).toBe(false);
  });

  it('input の data=null を保持する（削除系 inputType）', () => {
    const trace = formatTrace(
      snapshot({ type: 'input', inputType: 'deleteContentBackward', data: null }),
      context,
    );
    expect(trace.data).toBeNull();
  });

  it('compositionupdate は data のみ持つ（key/inputType/isComposing を持たない）', () => {
    const trace = formatTrace(snapshot({ type: 'compositionupdate', data: 'にほn' }), context);
    expect(trace.data).toBe('にほn');
    expect('key' in trace).toBe(false);
    expect('inputType' in trace).toBe(false);
    expect('isComposing' in trace).toBe(false);
  });

  it('focus/blur/pointerdown は補足フィールドを持たない', () => {
    for (const type of ['focus', 'blur', 'pointerdown'] as const) {
      const trace = formatTrace(snapshot({ type }), context);
      expect('key' in trace).toBe(false);
      expect('code' in trace).toBe(false);
      expect('inputType' in trace).toBe(false);
      expect('data' in trace).toBe(false);
      expect('isComposing' in trace).toBe(false);
    }
  });

  it('activeCell をコピーする（元オブジェクトの変更がトレースへ波及しない）', () => {
    const mutableCell = { row: 5, col: 6 };
    const trace = formatTrace(snapshot({ type: 'focus' }), {
      ...context,
      activeCell: mutableCell,
    });
    mutableCell.row = 99;
    expect(trace.activeCell).toEqual({ row: 5, col: 6 });
  });

  it('凍結したスナップショット/文脈を変更しない（recorder が入力へ干渉しない・DA #5）', () => {
    const frozenSnapshot = Object.freeze(snapshot({ type: 'keydown', key: 'a', code: 'KeyA', isComposing: false }));
    const frozenContext = Object.freeze({
      ...context,
      environment: Object.freeze({ ...context.environment }),
      activeCell: Object.freeze({ ...context.activeCell }),
    });
    expect(() => formatTrace(frozenSnapshot, frozenContext)).not.toThrow();
  });
});

describe('createEventRecorder（蓄積・取得・消去・購読）', () => {
  it('record で末尾へ追加し getTraces は古い順で返す', () => {
    const recorder = createEventRecorder();
    recorder.record(snapshot({ type: 'compositionstart', data: '' }), context);
    recorder.record(snapshot({ type: 'compositionupdate', data: 'に' }), context);
    recorder.record(snapshot({ type: 'compositionend', data: '日' }), context);

    const traces = recorder.getTraces();
    expect(recorder.size()).toBe(3);
    expect(traces.map((t) => t.eventType)).toEqual([
      'compositionstart',
      'compositionupdate',
      'compositionend',
    ]);
  });

  it('getRecent は直近 count 件（古い→新しい）を返す', () => {
    const recorder = createEventRecorder();
    for (let i = 0; i < 5; i += 1) {
      recorder.record(snapshot({ type: 'keydown', key: String(i), code: `Digit${i}`, isComposing: false }), context);
    }
    const recent = recorder.getRecent(2);
    expect(recent.map((t) => t.key)).toEqual(['3', '4']);
    expect(recorder.getRecent(0)).toEqual([]);
    expect(recorder.getRecent(99)).toHaveLength(5);
  });

  it('記録は独立コピー（呼び出し後に元セルを変えてもトレースは不変）', () => {
    const recorder = createEventRecorder();
    // 可変オブジェクト（readonly なし）を activeCell として渡し、記録後に変更する。
    const mutableCell = { row: 1, col: 1 };
    recorder.record(snapshot({ type: 'focus' }), { ...context, activeCell: mutableCell });
    mutableCell.row = 42;
    expect(recorder.getTraces()[0]?.activeCell).toEqual({ row: 1, col: 1 });
  });

  it('clear で空にし、record と clear で購読者へ通知する', () => {
    const recorder = createEventRecorder();
    let notifications = 0;
    const unsubscribe = recorder.subscribe(() => {
      notifications += 1;
    });

    recorder.record(snapshot({ type: 'focus' }), context);
    expect(notifications).toBe(1);

    recorder.clear();
    expect(recorder.size()).toBe(0);
    expect(notifications).toBe(2);

    // 既に空なら通知しない。
    recorder.clear();
    expect(notifications).toBe(2);

    unsubscribe();
    recorder.record(snapshot({ type: 'focus' }), context);
    expect(notifications).toBe(2);
  });
});
