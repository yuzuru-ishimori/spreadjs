// Phase 1 Red→Green: CellStore 4実装の等価性・境界・範囲走査（scenarios.md §7・AC1）。
// 「4実装が同一操作列で同一結果を返す」を最重要契約として検証する。

import { describe, expect, it } from 'vitest';
import { STORE_CANDIDATES } from './index';
import type { CellStoreCandidate, CellStoreConfig } from '../cell-store';
import { DISTRIBUTIONS, generateCells } from '../data-gen';

function buildAll(config: CellStoreConfig): CellStoreCandidate[] {
  return STORE_CANDIDATES.map((c) => c.create(config));
}

/** 範囲走査結果を "row,col"→value の Map に集約（順序非依存の比較用）。 */
function collectRange(
  store: CellStoreCandidate,
  r0: number,
  r1: number,
  c0: number,
  c1: number,
): { visited: number; map: Map<string, string> } {
  const map = new Map<string, string>();
  const visited = store.queryRange(r0, r1, c0, c1, (row, col, value) => {
    map.set(`${row},${col}`, value);
  });
  return { visited, map };
}

describe('CellStore 4実装の等価性（全4分布）', () => {
  const config: CellStoreConfig = { rows: 600, cols: 30, chunkRows: 256 };

  for (const distribution of DISTRIBUTIONS) {
    it(`bulkLoad 後の get/nonEmptyCount/queryRange が4実装で一致: ${distribution}`, () => {
      const { cells, count } = generateCells({
        rows: config.rows,
        cols: config.cols,
        nonEmpty: 1500,
        seed: 20260712,
        distribution,
      });
      const stores = buildAll(config);
      for (const s of stores) s.bulkLoad(cells);

      // nonEmptyCount は全実装で生成件数に一致。
      for (const s of stores) {
        expect(s.nonEmptyCount(), `${s.label} nonEmptyCount`).toBe(count);
      }

      // 全生成セル＋一部の空セルで get() が全実装一致（map を基準）。
      const [ref, ...rest] = stores;
      if (ref === undefined) throw new Error('no store');
      for (const cell of cells) {
        const expected = ref.get(cell.row, cell.col);
        expect(expected, `ref value ${cell.row},${cell.col}`).toBe(cell.value);
        for (const s of rest) {
          expect(s.get(cell.row, cell.col), `${s.label} ${cell.row},${cell.col}`).toBe(expected);
        }
      }
      // 空セル（生成されていない位置）も '' で一致。
      for (const [row, col] of [[599, 29], [0, 0], [123, 7], [500, 15]] as const) {
        const expected = ref.get(row, col);
        for (const s of rest) {
          expect(s.get(row, col), `${s.label} empty ${row},${col}`).toBe(expected);
        }
      }

      // queryRange が全実装で同一の visited 件数・同一セル集合。
      for (const win of [
        [0, 300, 0, 30],
        [250, 260, 0, 30], // チャンク境界跨ぎ
        [100, 140, 5, 20],
      ] as const) {
        const base = collectRange(ref, win[0], win[1], win[2], win[3]);
        for (const s of rest) {
          const got = collectRange(s, win[0], win[1], win[2], win[3]);
          expect(got.visited, `${s.label} visited ${win}`).toBe(base.visited);
          expect(got.map, `${s.label} range map ${win}`).toEqual(base.map);
        }
        // visited は範囲内非空セル数に一致（範囲外を訪問しない）。
        let manual = 0;
        for (const cell of cells) {
          if (cell.row >= win[0] && cell.row < win[1] && cell.col >= win[2] && cell.col < win[3]) {
            manual += 1;
          }
        }
        expect(base.visited, `visited=範囲内非空 ${win}`).toBe(manual);
      }
    });
  }
});

describe('CellStore 変異操作の等価性（set/削除/上書き/列型変換）', () => {
  const config: CellStoreConfig = { rows: 300, cols: 12, chunkRows: 256 };

  it('同一 set 列で4実装の get/nonEmptyCount が一致', () => {
    const stores = buildAll(config);
    // 列1 を最初は正準数値だけで満たし（columnar は数値列化）、
    // 後からテキストを入れて文字列列へ変換させる経路も通す。
    const ops: Array<[number, number, string]> = [
      [10, 1, '12'],
      [11, 1, '3.5'],
      [255, 1, '7'], // チャンク境界手前
      [256, 1, '8'], // チャンク境界
      [10, 1, '99'], // 上書き
      [11, 1, ''], // 削除
      [12, 1, '本社'], // 数値列→文字列列へ変換を誘発
      [10, 5, '氏名'],
      [10, 5, ''], // 削除して空へ
      [299, 11, '末尾'],
    ];
    for (const s of stores) {
      for (const [r, c, v] of ops) s.set(r, c, v);
    }
    const [ref, ...rest] = stores;
    if (ref === undefined) throw new Error('no store');
    // 代表位置の get 一致。
    const probes: Array<[number, number]> = [
      [10, 1], [11, 1], [255, 1], [256, 1], [12, 1], [10, 5], [299, 11], [0, 0],
    ];
    for (const [r, c] of probes) {
      const expected = ref.get(r, c);
      for (const s of rest) {
        expect(s.get(r, c), `${s.label} ${r},${c}`).toBe(expected);
      }
    }
    // 具体値の確認（正準数値の round-trip・削除・上書き・変換）。
    expect(ref.get(10, 1)).toBe('99');
    expect(ref.get(11, 1)).toBe('');
    expect(ref.get(12, 1)).toBe('本社');
    expect(ref.get(256, 1)).toBe('8');
    expect(ref.get(10, 5)).toBe('');
    for (const s of stores) {
      expect(s.nonEmptyCount(), `${s.label} count`).toBe(ref.nonEmptyCount());
    }
  });

  it('空文字 set は削除（nonEmptyCount 減）・空窓 queryRange は 0', () => {
    for (const s of buildAll(config)) {
      s.set(5, 3, 'x');
      expect(s.nonEmptyCount(), `${s.label}`).toBe(1);
      s.set(5, 3, '');
      expect(s.nonEmptyCount(), `${s.label} after delete`).toBe(0);
      const visited = s.queryRange(0, 100, 0, 12, () => {
        throw new Error('空窓で visit されるべきでない');
      });
      expect(visited, `${s.label} empty visited`).toBe(0);
    }
  });

  it('approxMemoryBytes は正の概算を返す', () => {
    const { cells } = generateCells({
      rows: config.rows,
      cols: config.cols,
      nonEmpty: 500,
      seed: 1,
      distribution: 'uniform-sparse',
    });
    for (const s of buildAll(config)) {
      s.bulkLoad(cells);
      expect(s.approxMemoryBytes(), `${s.label}`).toBeGreaterThan(0);
    }
  });
});
