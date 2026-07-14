import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GRID_LAYOUT,
  cellKey,
  cellRect,
  clampCell,
  columnLabel,
  contentSize,
  hitTestCell,
  isValidCell,
  parseCellKey,
} from './geometry';

const layout = DEFAULT_GRID_LAYOUT;

describe('cellRect（セル矩形計算）', () => {
  it('先頭セル (0,0) はヘッダー分だけオフセットされる', () => {
    expect(cellRect(layout, { row: 0, col: 0 })).toEqual({
      x: 44,
      y: 24,
      width: 96,
      height: 28,
    });
  });

  it('任意セルの矩形は行高・列幅の倍数でオフセットされる', () => {
    expect(cellRect(layout, { row: 2, col: 3 })).toEqual({
      x: 44 + 3 * 96,
      y: 24 + 2 * 28,
      width: 96,
      height: 28,
    });
  });
});

describe('hitTestCell（point→cell ヒットテスト）', () => {
  it('データセル中央のクリックは該当セルを返す', () => {
    // (0,0) セルの中央付近
    expect(hitTestCell(layout, 44 + 48, 24 + 14)).toEqual({ row: 0, col: 0 });
    // 最終セル (19,9) の中央付近
    expect(hitTestCell(layout, 44 + 9 * 96 + 48, 24 + 19 * 28 + 14)).toEqual({
      row: 19,
      col: 9,
    });
  });

  it('ヘッダー領域（行番号・列記号）は null を返す', () => {
    expect(hitTestCell(layout, 10, 100)).toBeNull(); // 行ヘッダー内
    expect(hitTestCell(layout, 100, 10)).toBeNull(); // 列ヘッダー内
    expect(hitTestCell(layout, 10, 10)).toBeNull(); // 左上コーナー
  });

  it('グリッド範囲外（右・下）は null を返す', () => {
    const { width, height } = contentSize(layout);
    expect(hitTestCell(layout, width + 5, 100)).toBeNull();
    expect(hitTestCell(layout, 100, height + 5)).toBeNull();
  });

  it('セル境界（左上端）は隣接セルの内側に含まれる', () => {
    expect(hitTestCell(layout, 44, 24)).toEqual({ row: 0, col: 0 });
  });
});

describe('clampCell / isValidCell（範囲判定）', () => {
  it('範囲外の位置を端へクランプする', () => {
    expect(clampCell(layout, { row: -1, col: 5 })).toEqual({ row: 0, col: 5 });
    expect(clampCell(layout, { row: 100, col: 100 })).toEqual({ row: 19, col: 9 });
  });

  it('範囲内の位置はそのまま返す', () => {
    expect(clampCell(layout, { row: 3, col: 7 })).toEqual({ row: 3, col: 7 });
  });

  it('isValidCell は範囲内で true、範囲外で false', () => {
    expect(isValidCell(layout, { row: 0, col: 0 })).toBe(true);
    expect(isValidCell(layout, { row: 19, col: 9 })).toBe(true);
    expect(isValidCell(layout, { row: 20, col: 0 })).toBe(false);
    expect(isValidCell(layout, { row: 0, col: -1 })).toBe(false);
  });
});

describe('cellKey / parseCellKey（キー変換の往復）', () => {
  it('セル位置とキー文字列を相互変換できる', () => {
    expect(cellKey({ row: 3, col: 7 })).toBe('3:7');
    expect(parseCellKey('3:7')).toEqual({ row: 3, col: 7 });
  });

  it('不正なキーは例外にする（黙って 0 にしない）', () => {
    expect(() => parseCellKey('x:y')).toThrow();
  });
});

describe('columnLabel（列記号）', () => {
  it('0 起点で A..Z、26 で AA になる', () => {
    expect(columnLabel(0)).toBe('A');
    expect(columnLabel(9)).toBe('J'); // 10 列目
    expect(columnLabel(25)).toBe('Z');
    expect(columnLabel(26)).toBe('AA');
  });
});

describe('contentSize（グリッド全体サイズ）', () => {
  it('ヘッダー込みの総描画サイズを返す', () => {
    expect(contentSize(layout)).toEqual({
      width: 44 + 10 * 96,
      height: 24 + 20 * 28,
    });
  });
});
