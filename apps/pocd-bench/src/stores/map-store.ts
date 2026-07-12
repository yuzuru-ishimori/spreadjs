// ①Map型（単一 Map）— DD-002 方式・基準線（§6.4・ADR-011 ①）。
// key = row*cols + col の単一 Map<number,string>。空間索引を持たないため範囲走査は
// 範囲面積を走査する（＝可視窓が小さければ実用・全域走査は不利）。基準線として比較する。

import {
  BYTES_PER_CHAR,
  type CellStoreCandidate,
  type CellStoreConfig,
  type RangeVisitor,
} from '../cell-store';

export function createMapStore(config: CellStoreConfig): CellStoreCandidate {
  const { cols } = config;
  const map = new Map<number, string>();
  let valueChars = 0;

  const keyOf = (row: number, col: number): number => row * cols + col;

  const setInternal = (row: number, col: number, value: string): void => {
    const key = keyOf(row, col);
    const prev = map.get(key);
    if (value === '') {
      if (prev !== undefined) {
        valueChars -= prev.length;
        map.delete(key);
      }
      return;
    }
    valueChars += value.length - (prev?.length ?? 0);
    map.set(key, value);
  };

  return {
    label: 'map',
    get(row, col) {
      return map.get(keyOf(row, col)) ?? '';
    },
    set(row, col, value) {
      setInternal(row, col, value);
    },
    bulkLoad(cells) {
      for (const cell of cells) {
        if (cell.value === '') continue;
        setInternal(cell.row, cell.col, cell.value);
      }
    },
    queryRange(rowStart, rowEnd, colStart, colEnd, visit: RangeVisitor) {
      if (rowEnd <= rowStart || colEnd <= colStart) return 0;
      let visited = 0;
      for (let row = rowStart; row < rowEnd; row += 1) {
        const base = row * cols;
        for (let col = colStart; col < colEnd; col += 1) {
          const value = map.get(base + col);
          if (value !== undefined) {
            visit(row, col, value);
            visited += 1;
          }
        }
      }
      return visited;
    },
    nonEmptyCount() {
      return map.size;
    },
    approxMemoryBytes() {
      // Map エントリ概算（key=8 + エントリ overhead ~40）＋値文字。
      return map.size * 48 + valueChars * BYTES_PER_CHAR;
    },
  };
}
