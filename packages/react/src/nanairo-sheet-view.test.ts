// @vitest-environment jsdom
//
// React Facade（<NanairoSheetView>）の unit テスト（DD-025 Phase 2・jsdom）。
// grid Facade の mount() をモックし、Facade の責務（props→options 写像・event→callback 分配・
// callback 差し替え非 remount・ref handle・StrictMode 二重 mount 耐性・props 3 分類）を検証する。
// 実グリッド描画/IME は Phase 3 E2E（実ブラウザー）で検証する（jsdom は Canvas 2D を実装しない）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, createRef, StrictMode } from 'react';
import { cleanup, render } from '@testing-library/react';

import type { GridEvent } from '@nanairo-sheet/grid';
import {
  NanairoSheetView,
  type NanairoSheetViewHandle,
  type NanairoSheetViewProps,
} from './index';

// --- grid Facade モック（mount 呼び出しと fake GridInstance を記録） ---
interface FakeInstance {
  container: HTMLElement;
  options: {
    mode?: string;
    serverUrl?: string;
    columnOrder?: readonly string[];
    documentId?: string;
    initialData?: unknown;
    columnWidths?: unknown;
    rowHeights?: unknown;
    wrapColumns?: readonly string[];
    onEvent?: (event: GridEvent) => void;
    onDiagnostic?: unknown;
  };
  destroyed: boolean;
  setDataCalls: unknown[];
  focusCalls: number;
  connState: string;
  setData(data: unknown): void;
  focus(): void;
  connectionState(): string;
  destroy(): void;
  fire(event: GridEvent): void;
}

const h = vi.hoisted(() => ({ instances: [] as FakeInstance[] }));

vi.mock('@nanairo-sheet/grid', () => ({
  mount(target: { container: HTMLElement }, options: FakeInstance['options']): FakeInstance {
    const inst: FakeInstance = {
      container: target.container,
      options,
      destroyed: false,
      setDataCalls: [],
      focusCalls: 0,
      connState: 'standalone',
      setData(data) {
        this.setDataCalls.push(data);
      },
      focus() {
        this.focusCalls += 1;
      },
      connectionState() {
        return this.connState;
      },
      destroy() {
        this.destroyed = true;
      },
      fire(event) {
        this.options.onEvent?.(event);
      },
    };
    h.instances.push(inst);
    return inst;
  },
}));

/** 生存中（未 destroy）の fake instance。 */
function liveInstances(): FakeInstance[] {
  return h.instances.filter((i) => !i.destroyed);
}

/** 単独モードの最小 props。 */
function standaloneProps(over: Partial<NanairoSheetViewProps> = {}): NanairoSheetViewProps {
  return {
    mode: 'standalone',
    columnOrder: ['a', 'b'],
    ...over,
  } as NanairoSheetViewProps;
}

beforeEach(() => {
  h.instances.length = 0;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('NanairoSheetView — mount・props 写像（AC1）', () => {
  it('standalone props を GridMountOptions（判別 union）へ 1:1 写像して mount する', () => {
    const initialData = { rows: [{ rowId: 'r1', cells: { a: '1' } }] };
    render(
      createElement(NanairoSheetView, {
        mode: 'standalone',
        columnOrder: ['a', 'b', 'c'],
        documentId: 'doc-1',
        initialData,
        initialColumnWidths: { a: 120 },
        wrapColumns: ['b'],
      } as NanairoSheetViewProps),
    );

    expect(h.instances).toHaveLength(1);
    const opt = h.instances[0].options;
    expect(opt.mode).toBe('standalone');
    expect(opt.columnOrder).toEqual(['a', 'b', 'c']);
    expect(opt.documentId).toBe('doc-1');
    expect(opt.initialData).toEqual(initialData);
    expect(opt.columnWidths).toEqual({ a: 120 }); // initialColumnWidths → grid columnWidths
    expect(opt.wrapColumns).toEqual(['b']);
    // standalone なので serverUrl は写像しない（型排他・契約 §1）。
    expect(opt.serverUrl).toBeUndefined();
  });

  it('collaboration props（mode 省略）を serverUrl 付きで写像する', () => {
    render(
      createElement(NanairoSheetView, {
        serverUrl: 'http://127.0.0.1:8787',
        columnOrder: ['x'],
        displayName: 'alice',
      } as NanairoSheetViewProps),
    );
    const opt = h.instances[0].options;
    expect(opt.serverUrl).toBe('http://127.0.0.1:8787');
    expect(opt.mode).toBeUndefined(); // 省略時は既定 collaboration（grid 側で解釈）
  });
});

describe('NanairoSheetView — event → callback 分配（AC2 写像・契約 §2）', () => {
  it('cell-commit / layout / error / connection / pending を対応 callback と onEvent へ分配する', () => {
    const onCellCommit = vi.fn();
    const onLayout = vi.fn();
    const onError = vi.fn();
    const onConnectionChange = vi.fn();
    const onEvent = vi.fn();
    render(
      createElement(
        NanairoSheetView,
        standaloneProps({ onCellCommit, onLayout, onError, onConnectionChange, onEvent }),
      ),
    );
    const inst = h.instances[0];

    const commit: GridEvent = {
      type: 'cell-commit',
      changes: [{ rowId: 'r1', columnId: 'a', value: 'あ', previousValue: '' }],
    };
    inst.fire(commit);
    expect(onCellCommit).toHaveBeenCalledTimes(1);
    expect(onCellCommit).toHaveBeenCalledWith(commit.changes);

    inst.fire({ type: 'layout', columnWidths: { a: 100 }, rowHeights: { r1: 30 } });
    expect(onLayout).toHaveBeenCalledWith({ a: 100 }, { r1: 30 });

    inst.fire({ type: 'error', phase: 'runtime', code: 'runtime-fault', message: 'boom' });
    expect(onError).toHaveBeenCalledWith({ phase: 'runtime', code: 'runtime-fault', message: 'boom' });

    inst.fire({ type: 'connection', state: 'online', pendingCount: 2 });
    expect(onConnectionChange).toHaveBeenLastCalledWith('online', 2);

    // pending は state を持たないため直近の connection state（online）を補って通知する。
    inst.fire({ type: 'pending', pendingCount: 5 });
    expect(onConnectionChange).toHaveBeenLastCalledWith('online', 5);

    // onEvent は全種別を素通し（5 件）。
    expect(onEvent).toHaveBeenCalledTimes(5);
  });
});

describe('NanairoSheetView — callback 差し替えは非 remount（AC3・S3）', () => {
  it('callback props を差し替えても remount せず、次の確定で新しい callback を呼ぶ', () => {
    const fnA = vi.fn();
    const fnB = vi.fn();
    const { rerender } = render(
      createElement(NanairoSheetView, standaloneProps({ onCellCommit: fnA })),
    );
    expect(h.instances).toHaveLength(1);

    // 識別系 props は不変のまま callback だけ差し替え。
    rerender(createElement(NanairoSheetView, standaloneProps({ onCellCommit: fnB })));

    expect(h.instances).toHaveLength(1); // remount していない
    expect(h.instances[0].destroyed).toBe(false);

    h.instances[0].fire({
      type: 'cell-commit',
      changes: [{ rowId: 'r1', columnId: 'a', value: 'x', previousValue: '' }],
    });
    expect(fnA).not.toHaveBeenCalled();
    expect(fnB).toHaveBeenCalledTimes(1);
  });
});

describe('NanairoSheetView — ref handle（AC4・S4）', () => {
  it('ref.setData / focus / connectionState が GridInstance へ委譲され、React state を持たない', () => {
    const ref = createRef<NanairoSheetViewHandle>();
    render(createElement(NanairoSheetView, { mode: 'standalone', columnOrder: ['a', 'b'], ref }));

    const newData = { rows: [{ rowId: 'r9', cells: { a: '9' } }] };
    ref.current?.setData(newData);
    expect(h.instances[0].setDataCalls).toEqual([newData]);

    ref.current?.focus();
    expect(h.instances[0].focusCalls).toBe(1);

    h.instances[0].connState = 'standalone';
    expect(ref.current?.connectionState()).toBe('standalone');

    // setData を呼んでも React の再 render は起きない（instance は 1 つのまま＝内部状態を state 複製しない）。
    expect(h.instances).toHaveLength(1);
  });
});

describe('NanairoSheetView — StrictMode 二重 mount 耐性（AC5・S5）', () => {
  it('二重 mount/cleanup を経ても生存 instance は 1 つ・購読は重複しない', () => {
    const onCellCommit = vi.fn();
    render(
      createElement(
        StrictMode,
        null,
        createElement(NanairoSheetView, standaloneProps({ onCellCommit })),
      ),
    );

    // StrictMode（dev）は mount→cleanup→mount する。旧 instance は destroy 済み・生存は 1 つ。
    const live = liveInstances();
    expect(live).toHaveLength(1);
    expect(h.instances.filter((i) => i.destroyed).length).toBe(h.instances.length - 1);

    // 1 回の確定 → callback は 1 回だけ（購読重複なし）。
    live[0].fire({
      type: 'cell-commit',
      changes: [{ rowId: 'r1', columnId: 'a', value: 'y', previousValue: '' }],
    });
    expect(onCellCommit).toHaveBeenCalledTimes(1);
  });
});

describe('NanairoSheetView — props 3 分類の変更契約（AC7・S7・契約 §4）', () => {
  it('識別系（columnOrder）変更 → 自動 remount（旧 destroy→新 mount）', () => {
    const { rerender } = render(
      createElement(NanairoSheetView, standaloneProps({ columnOrder: ['a', 'b'] })),
    );
    expect(h.instances).toHaveLength(1);

    rerender(createElement(NanairoSheetView, standaloneProps({ columnOrder: ['a', 'b', 'c'] })));

    expect(h.instances).toHaveLength(2);
    expect(h.instances[0].destroyed).toBe(true);
    expect(h.instances[1].destroyed).toBe(false);
    expect(h.instances[1].options.columnOrder).toEqual(['a', 'b', 'c']);
  });

  it('識別系の配列を毎 render 新規リテラルで渡しても値が同じなら remount しない（identity 吸収）', () => {
    const { rerender } = render(
      createElement(NanairoSheetView, standaloneProps({ columnOrder: ['a', 'b'] })),
    );
    // 新しい配列インスタンスだが内容は同じ。
    rerender(createElement(NanairoSheetView, standaloneProps({ columnOrder: ['a', 'b'] })));
    expect(h.instances).toHaveLength(1);
    expect(h.instances[0].destroyed).toBe(false);
  });

  it('初期値系（initialData）変更 → 無視＋診断 warn（remount しない）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rerender } = render(
      createElement(
        NanairoSheetView,
        standaloneProps({ initialData: { rows: [{ rowId: 'r1', cells: { a: '1' } }] } }),
      ),
    );
    expect(h.instances).toHaveLength(1);

    rerender(
      createElement(
        NanairoSheetView,
        standaloneProps({ initialData: { rows: [{ rowId: 'r2', cells: { a: '2' } }] } }),
      ),
    );

    // remount していない（初回 initialData のまま）。
    expect(h.instances).toHaveLength(1);
    expect(h.instances[0].destroyed).toBe(false);
    // 診断 warn が出る。
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('[NanairoSheetView]');
  });

  it('同一参照の initialData を渡し続けても warn しない（参照比較・毎 render 直列化しない・Codex P1）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const data = { rows: [{ rowId: 'r1', cells: { a: '1' } }] };
    const { rerender } = render(
      createElement(NanairoSheetView, standaloneProps({ initialData: data })),
    );
    // 親の再 render で同じ data 参照を渡す（新規 props オブジェクトだが initialData は同一参照）。
    rerender(createElement(NanairoSheetView, standaloneProps({ initialData: data })));
    rerender(createElement(NanairoSheetView, standaloneProps({ initialData: data })));
    expect(h.instances).toHaveLength(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('onDiagnostic を mount 後に差し替えると grid へ渡した安定ラッパーが最新を呼ぶ（Codex P2）', () => {
    const diagA = vi.fn();
    const diagB = vi.fn();
    const { rerender } = render(
      createElement(NanairoSheetView, standaloneProps({ onDiagnostic: diagA })),
    );
    // grid へ渡された onDiagnostic は安定ラッパー（remount しない）。
    const wrapper = h.instances[0].options.onDiagnostic as (e: unknown) => void;
    expect(typeof wrapper).toBe('function');

    rerender(createElement(NanairoSheetView, standaloneProps({ onDiagnostic: diagB })));
    expect(h.instances).toHaveLength(1); // 差し替えで remount しない

    // 同じラッパーを呼ぶと最新（diagB）へ届く。
    const entry = { level: 'info', code: 'x', message: 'm', timestamp: 0 };
    wrapper(entry);
    expect(diagA).not.toHaveBeenCalled();
    expect(diagB).toHaveBeenCalledWith(entry);
  });

  it('onDiagnostic を mount 時に渡さなければ grid へ undefined を渡す（zero-cost opt-in 維持・Codex P2）', () => {
    render(createElement(NanairoSheetView, standaloneProps()));
    expect(h.instances[0].options.onDiagnostic).toBeUndefined();
  });

  it('初期値系変更を onDiagnostic hook でも受け取れる', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onDiagnostic = vi.fn();
    const { rerender } = render(
      createElement(
        NanairoSheetView,
        standaloneProps({ onDiagnostic, initialColumnWidths: { a: 10 } }),
      ),
    );
    rerender(
      createElement(
        NanairoSheetView,
        standaloneProps({ onDiagnostic, initialColumnWidths: { a: 20 } }),
      ),
    );
    expect(onDiagnostic).toHaveBeenCalledTimes(1);
    expect(onDiagnostic.mock.calls[0][0]).toMatchObject({ level: 'warn', code: 'initial-prop-ignored' });
  });
});

describe('NanairoSheetView — unmount で destroy（AC6・S6 の unit 断面）', () => {
  it('unmount すると GridInstance.destroy が呼ばれる', () => {
    const { unmount } = render(createElement(NanairoSheetView, standaloneProps()));
    expect(liveInstances()).toHaveLength(1);
    unmount();
    expect(liveInstances()).toHaveLength(0);
    expect(h.instances.every((i) => i.destroyed)).toBe(true);
  });
});
