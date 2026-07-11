import { describe, expect, it, vi } from 'vitest';

import { createCellStore } from './cell-store';

describe('createCellStore（値保持）', () => {
  it('未設定セルは空文字を返す', () => {
    const store = createCellStore();
    expect(store.get({ row: 0, col: 0 })).toBe('');
  });

  it('設定した値を取得できる', () => {
    const store = createCellStore();
    store.set({ row: 1, col: 2 }, 'あ');
    expect(store.get({ row: 1, col: 2 })).toBe('あ');
  });

  it('初期値を受け取れる', () => {
    const store = createCellStore([[{ row: 0, col: 0 }, '初期']]);
    expect(store.get({ row: 0, col: 0 })).toBe('初期');
  });

  it('clear は値を空にする', () => {
    const store = createCellStore([[{ row: 3, col: 3 }, 'x']]);
    store.clear({ row: 3, col: 3 });
    expect(store.get({ row: 3, col: 3 })).toBe('');
  });

  it('entries は非空セルのみを返す', () => {
    const store = createCellStore();
    store.set({ row: 0, col: 0 }, 'a');
    store.set({ row: 1, col: 1 }, 'b');
    store.clear({ row: 0, col: 0 });
    const values = store.entries().map((entry) => entry.value);
    expect(values).toEqual(['b']);
  });
});

describe('subscribe（変更通知）', () => {
  it('値が変化したときだけ購読者へ通知する', () => {
    const store = createCellStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.set({ row: 0, col: 0 }, 'a');
    expect(listener).toHaveBeenCalledTimes(1);

    // 同じ値の再設定は通知しない（不要な再描画を避ける）。
    store.set({ row: 0, col: 0 }, 'a');
    expect(listener).toHaveBeenCalledTimes(1);

    store.set({ row: 0, col: 0 }, 'b');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('空セルを空にしても通知しない（変化なし）', () => {
    const store = createCellStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.clear({ row: 5, col: 5 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('購読解除すると以後は通知されない', () => {
    const store = createCellStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.set({ row: 0, col: 0 }, 'a');
    expect(listener).not.toHaveBeenCalled();
  });
});
