import { describe, expect, it } from 'vitest';

import { createChunkStore } from './chunk-store';
import { generateCells } from './data-gen';

describe('ChunkStore: 一括ロードと get', () => {
  it('生成 200 セルを投入すると nonEmptyCount=200・get で値・未設定は空文字', () => {
    const store = createChunkStore();
    const { cells } = generateCells({ rows: 100, cols: 20, nonEmpty: 200, seed: 20260712 });
    store.bulkLoad(cells);

    expect(store.nonEmptyCount()).toBe(200);
    for (const cell of cells) {
      expect(store.get(cell.row, cell.col)).toBe(cell.value);
    }
    // 空セル（生成されていない位置）は空文字。
    const filled = new Set(cells.map((c) => c.row * 20 + c.col));
    let checkedEmpty = 0;
    for (let row = 0; row < 100 && checkedEmpty < 5; row += 1) {
      for (let col = 0; col < 20 && checkedEmpty < 5; col += 1) {
        if (!filled.has(row * 20 + col)) {
          expect(store.get(row, col)).toBe('');
          checkedEmpty += 1;
        }
      }
    }
  });
});

describe('ChunkStore: 可視範囲クエリ O(可視セル数)', () => {
  const store = createChunkStore({ chunkRows: 8 });
  const { cells } = generateCells({ rows: 100, cols: 20, nonEmpty: 400, seed: 99 });
  store.bulkLoad(cells);

  it('範囲内の非空セルだけを visit し、範囲外は 1 件も visit しない', () => {
    const rowStart = 10;
    const rowEnd = 30;
    const colStart = 4;
    const colEnd = 12;
    const visited: Array<{ row: number; col: number }> = [];
    const count = store.queryRange(rowStart, rowEnd, colStart, colEnd, (row, col) => {
      visited.push({ row, col });
    });
    // すべて範囲内。
    for (const v of visited) {
      expect(v.row).toBeGreaterThanOrEqual(rowStart);
      expect(v.row).toBeLessThan(rowEnd);
      expect(v.col).toBeGreaterThanOrEqual(colStart);
      expect(v.col).toBeLessThan(colEnd);
    }
    // 件数は独立に数えた範囲内非空セル数と一致。
    const expectedInRange = cells.filter(
      (c) => c.row >= rowStart && c.row < rowEnd && c.col >= colStart && c.col < colEnd,
    ).length;
    expect(count).toBe(expectedInRange);
    expect(visited).toHaveLength(expectedInRange);
  });

  it('全セル空の窓は visit 0 回', () => {
    const empty = createChunkStore();
    const count = empty.queryRange(0, 50, 0, 50, () => {
      throw new Error('空ストアで visit されてはいけない');
    });
    expect(count).toBe(0);
  });
});

describe('ChunkStore: set による更新・削除', () => {
  it('set で追加・上書き・空文字で削除し nonEmptyCount が増減する', () => {
    const store = createChunkStore();
    store.set(5, 3, 'hello');
    expect(store.get(5, 3)).toBe('hello');
    expect(store.nonEmptyCount()).toBe(1);

    store.set(5, 3, 'world'); // 上書き
    expect(store.get(5, 3)).toBe('world');
    expect(store.nonEmptyCount()).toBe(1);

    store.set(5, 1, 'a'); // 同一行の前方へ挿入（昇順維持）
    store.set(5, 7, 'b');
    expect(store.nonEmptyCount()).toBe(3);
    // 昇順維持を範囲クエリで確認。
    const seen: number[] = [];
    store.queryRange(5, 6, 0, 20, (_row, col) => seen.push(col));
    expect(seen).toEqual([1, 3, 7]);

    store.set(5, 3, ''); // 削除
    expect(store.get(5, 3)).toBe('');
    expect(store.nonEmptyCount()).toBe(2);
  });
});

describe('ChunkStore: メモリ概算フック', () => {
  it('approxMemoryBytes は投入で正になる', () => {
    const store = createChunkStore();
    expect(store.approxMemoryBytes()).toBe(0);
    const { cells } = generateCells({ rows: 100, cols: 20, nonEmpty: 200, seed: 5 });
    store.bulkLoad(cells);
    expect(store.approxMemoryBytes()).toBeGreaterThan(0);
  });
});
