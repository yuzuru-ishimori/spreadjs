import { describe, expect, it } from 'vitest';

import { generateCells } from './data-gen';

describe('generateCells: 件数・範囲・重複', () => {
  const result = generateCells({ rows: 100, cols: 20, nonEmpty: 200, seed: 20260712 });

  it('非空セル数がちょうど nonEmpty', () => {
    expect(result.count).toBe(200);
    expect(result.cells).toHaveLength(200);
  });

  it('すべて範囲内・位置重複なし', () => {
    const keys = new Set<number>();
    for (const cell of result.cells) {
      expect(cell.row).toBeGreaterThanOrEqual(0);
      expect(cell.row).toBeLessThan(100);
      expect(cell.col).toBeGreaterThanOrEqual(0);
      expect(cell.col).toBeLessThan(20);
      keys.add(cell.row * 20 + cell.col);
    }
    expect(keys.size).toBe(200); // 重複なし
  });

  it('出力は (row,col) 昇順', () => {
    for (let i = 1; i < result.cells.length; i += 1) {
      const prev = result.cells[i - 1];
      const cur = result.cells[i];
      if (prev === undefined || cur === undefined) {
        throw new Error('セルが存在する前提');
      }
      const prevKey = prev.row * 20 + prev.col;
      const curKey = cur.row * 20 + cur.col;
      expect(curKey).toBeGreaterThan(prevKey);
    }
  });
});

describe('generateCells: 決定論・内容混在', () => {
  it('同一 seed は完全に同一の (row,col,value) 列', () => {
    const a = generateCells({ rows: 100, cols: 20, nonEmpty: 200, seed: 42 });
    const b = generateCells({ rows: 100, cols: 20, nonEmpty: 200, seed: 42 });
    expect(a.cells).toEqual(b.cells);
  });

  it('異なる seed は異なる列', () => {
    const a = generateCells({ rows: 100, cols: 20, nonEmpty: 200, seed: 1 });
    const b = generateCells({ rows: 100, cols: 20, nonEmpty: 200, seed: 2 });
    expect(a.cells).not.toEqual(b.cells);
  });

  it('数値と日本語（非ASCII）が混在する', () => {
    const result = generateCells({ rows: 200, cols: 50, nonEmpty: 1000, seed: 7 });
    const hasNumeric = result.cells.some((c) => /^\d+(\.\d+)?$/.test(c.value));
    // 非 ASCII（日本語）コードポイントを含むか（正規表現の制御文字を避け charCode で判定）。
    const hasJapanese = result.cells.some((c) =>
      [...c.value].some((ch) => ch.charCodeAt(0) > 127),
    );
    expect(hasNumeric).toBe(true);
    expect(hasJapanese).toBe(true);
  });
});

describe('generateCells: 上限クランプ', () => {
  it('nonEmpty が容量を超えたら容量へクランプ', () => {
    const result = generateCells({ rows: 5, cols: 5, nonEmpty: 1000, seed: 3 });
    expect(result.count).toBe(25);
  });
});
