// Phase 1 Red→Green: 決定論データ生成（scenarios.md §8・bench-protocol §4）。

import { describe, expect, it } from 'vitest';
import {
  DISTRIBUTIONS,
  generateCells,
  isNumericColumn,
  type Distribution,
} from './data-gen';
import { isCanonicalNumber } from './stores/columnar-store';

const DIMS = { rows: 1000, cols: 40 } as const;

describe('data-gen: 決定論・件数・範囲', () => {
  for (const distribution of DISTRIBUTIONS) {
    it(`同一 config で完全再現・件数一致・全て範囲内・重複なし: ${distribution}`, () => {
      const cfg = { ...DIMS, nonEmpty: 2000, seed: 42, distribution };
      const a = generateCells(cfg);
      const b = generateCells(cfg);
      expect(a.count).toBe(2000);
      expect(a.cells).toEqual(b.cells); // 完全再現

      const seen = new Set<number>();
      let prevKey = -1;
      for (const cell of a.cells) {
        expect(cell.row).toBeGreaterThanOrEqual(0);
        expect(cell.row).toBeLessThan(DIMS.rows);
        expect(cell.col).toBeGreaterThanOrEqual(0);
        expect(cell.col).toBeLessThan(DIMS.cols);
        const key = cell.row * DIMS.cols + cell.col;
        expect(seen.has(key), `重複 ${cell.row},${cell.col}`).toBe(false);
        seen.add(key);
        expect(key, '(row,col) 昇順').toBeGreaterThan(prevKey);
        prevKey = key;
      }
    });
  }

  it('異なる seed でセル集合が変わる（uniform-sparse）', () => {
    const base = { ...DIMS, nonEmpty: 500, distribution: 'uniform-sparse' as Distribution };
    const a = generateCells({ ...base, seed: 1 });
    const b = generateCells({ ...base, seed: 2 });
    expect(a.cells).not.toEqual(b.cells);
  });

  it('nonEmpty は容量へクランプされる', () => {
    const r = generateCells({ rows: 10, cols: 10, nonEmpty: 1000, seed: 3, distribution: 'uniform-sparse' });
    expect(r.count).toBe(100); // 10*10 が上限
  });

  it('dense-block は先頭からの連続矩形（row-major）', () => {
    const r = generateCells({ rows: 100, cols: 10, nonEmpty: 25, seed: 5, distribution: 'dense-block' });
    expect(r.count).toBe(25);
    // 25 セル = 先頭 2 行 + 3 行目の 5 セル（row-major）。最大 row=2。
    const maxRow = Math.max(...r.cells.map((c) => c.row));
    expect(maxRow).toBe(2);
    expect(r.cells.some((c) => c.row === 0 && c.col === 0)).toBe(true);
  });

  it('top-left-cluster は平均位置が中心より上・左へ寄る', () => {
    const uniform = generateCells({ ...DIMS, nonEmpty: 3000, seed: 7, distribution: 'uniform-sparse' });
    const cluster = generateCells({ ...DIMS, nonEmpty: 3000, seed: 7, distribution: 'top-left-cluster' });
    const avg = (cells: readonly { row: number; col: number }[], key: 'row' | 'col') =>
      cells.reduce((s, c) => s + c[key], 0) / cells.length;
    expect(avg(cluster.cells, 'row')).toBeLessThan(avg(uniform.cells, 'row'));
    expect(avg(cluster.cells, 'col')).toBeLessThan(avg(uniform.cells, 'col'));
  });

  it('column-typed は数値列に正準数値・テキスト列に非数値', () => {
    const r = generateCells({ ...DIMS, nonEmpty: 3000, seed: 9, distribution: 'column-typed' });
    for (const cell of r.cells) {
      if (isNumericColumn(cell.col)) {
        expect(isCanonicalNumber(cell.value), `num col ${cell.col}=${cell.value}`).toBe(true);
      } else {
        expect(isCanonicalNumber(cell.value), `text col ${cell.col}=${cell.value}`).toBe(false);
      }
    }
  });

  it('生成する数値は正準（String(Number(s))===s）', () => {
    const r = generateCells({ ...DIMS, nonEmpty: 3000, seed: 11, distribution: 'uniform-sparse' });
    for (const cell of r.cells) {
      if (isCanonicalNumber(cell.value)) {
        expect(String(Number(cell.value))).toBe(cell.value);
      }
    }
  });
});
