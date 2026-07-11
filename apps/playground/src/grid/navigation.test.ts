import { describe, expect, it } from 'vitest';

import { DEFAULT_GRID_LAYOUT } from './geometry';
import { keyToDirection, moveActiveCell } from './navigation';

const layout = DEFAULT_GRID_LAYOUT;

describe('keyToDirection（キー→移動方向）', () => {
  it('矢印キーを対応する方向へ変換する', () => {
    expect(keyToDirection({ key: 'ArrowUp', shiftKey: false })).toBe('up');
    expect(keyToDirection({ key: 'ArrowDown', shiftKey: false })).toBe('down');
    expect(keyToDirection({ key: 'ArrowLeft', shiftKey: false })).toBe('left');
    expect(keyToDirection({ key: 'ArrowRight', shiftKey: false })).toBe('right');
  });

  it('Enter は下、Shift+Enter は上（Excel 準拠）', () => {
    expect(keyToDirection({ key: 'Enter', shiftKey: false })).toBe('down');
    expect(keyToDirection({ key: 'Enter', shiftKey: true })).toBe('up');
  });

  it('Tab は右、Shift+Tab は左', () => {
    expect(keyToDirection({ key: 'Tab', shiftKey: false })).toBe('right');
    expect(keyToDirection({ key: 'Tab', shiftKey: true })).toBe('left');
  });

  it('移動に対応しないキーは null', () => {
    expect(keyToDirection({ key: 'a', shiftKey: false })).toBeNull();
    expect(keyToDirection({ key: 'Escape', shiftKey: false })).toBeNull();
    expect(keyToDirection({ key: 'F2', shiftKey: false })).toBeNull();
  });
});

describe('moveActiveCell（移動＋端クランプ）', () => {
  it('各方向へ 1 セル移動する', () => {
    const from = { row: 5, col: 5 };
    expect(moveActiveCell(layout, from, 'up')).toEqual({ row: 4, col: 5 });
    expect(moveActiveCell(layout, from, 'down')).toEqual({ row: 6, col: 5 });
    expect(moveActiveCell(layout, from, 'left')).toEqual({ row: 5, col: 4 });
    expect(moveActiveCell(layout, from, 'right')).toEqual({ row: 5, col: 6 });
  });

  it('左上端で up/left してもグリッド外へ出ない（クランプ）', () => {
    const topLeft = { row: 0, col: 0 };
    expect(moveActiveCell(layout, topLeft, 'up')).toEqual({ row: 0, col: 0 });
    expect(moveActiveCell(layout, topLeft, 'left')).toEqual({ row: 0, col: 0 });
  });

  it('右下端で down/right してもグリッド外へ出ない（クランプ）', () => {
    const bottomRight = { row: 19, col: 9 };
    expect(moveActiveCell(layout, bottomRight, 'down')).toEqual({ row: 19, col: 9 });
    expect(moveActiveCell(layout, bottomRight, 'right')).toEqual({ row: 19, col: 9 });
  });

  it('連続移動を積み上げられる（down×2, right×1）', () => {
    let pos = { row: 5, col: 5 };
    pos = moveActiveCell(layout, pos, 'down');
    pos = moveActiveCell(layout, pos, 'down');
    pos = moveActiveCell(layout, pos, 'right');
    expect(pos).toEqual({ row: 7, col: 6 });
  });
});
