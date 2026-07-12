// ②a チャンク型（列ごとのチャンクMap）— §6.4 推奨方式・ADR-011 ②。
// 構造: Map<col, Map<chunkIndex, (string|undefined)[]>>、chunk は chunkRows 長の密配列。
// 非空セルを含む (列, チャンク) だけを確保する。範囲走査は範囲に重なる列×チャンクの
// 該当行スロットのみを見る。

import {
  BYTES_PER_CHAR,
  type CellStoreCandidate,
  type CellStoreConfig,
  type RangeVisitor,
} from '../cell-store';

const DEFAULT_CHUNK_ROWS = 256;
type ColumnChunks = Map<number, (string | undefined)[]>;

export function createChunkedColumnStore(config: CellStoreConfig): CellStoreCandidate {
  const chunkRows = config.chunkRows ?? DEFAULT_CHUNK_ROWS;
  if (chunkRows <= 0) throw new Error(`chunkRows は正の数（受領: ${chunkRows}）`);
  const columns = new Map<number, ColumnChunks>();
  let nonEmpty = 0;
  let valueChars = 0;
  let chunkCount = 0;

  const getChunk = (col: number, chunkIndex: number, create: boolean): (string | undefined)[] | undefined => {
    let colChunks = columns.get(col);
    if (colChunks === undefined) {
      if (!create) return undefined;
      colChunks = new Map();
      columns.set(col, colChunks);
    }
    let chunk = colChunks.get(chunkIndex);
    if (chunk === undefined && create) {
      chunk = new Array<string | undefined>(chunkRows);
      colChunks.set(chunkIndex, chunk);
      chunkCount += 1;
    }
    return chunk;
  };

  const setInternal = (row: number, col: number, value: string): void => {
    const chunkIndex = Math.floor(row / chunkRows);
    const local = row - chunkIndex * chunkRows;
    if (value === '') {
      const chunk = getChunk(col, chunkIndex, false);
      if (chunk === undefined) return;
      const prev = chunk[local];
      if (prev !== undefined) {
        valueChars -= prev.length;
        chunk[local] = undefined;
        nonEmpty -= 1;
      }
      return;
    }
    const chunk = getChunk(col, chunkIndex, true);
    if (chunk === undefined) return;
    const prev = chunk[local];
    if (prev === undefined) {
      nonEmpty += 1;
      valueChars += value.length;
    } else {
      valueChars += value.length - prev.length;
    }
    chunk[local] = value;
  };

  return {
    label: 'chunked-column',
    get(row, col) {
      const chunkIndex = Math.floor(row / chunkRows);
      const chunk = getChunk(col, chunkIndex, false);
      return chunk?.[row - chunkIndex * chunkRows] ?? '';
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
      const firstChunk = Math.floor(rowStart / chunkRows);
      const lastChunk = Math.floor((rowEnd - 1) / chunkRows);
      for (let col = colStart; col < colEnd; col += 1) {
        const colChunks = columns.get(col);
        if (colChunks === undefined) continue;
        for (let chunkIndex = firstChunk; chunkIndex <= lastChunk; chunkIndex += 1) {
          const chunk = colChunks.get(chunkIndex);
          if (chunk === undefined) continue;
          const base = chunkIndex * chunkRows;
          const localStart = Math.max(rowStart - base, 0);
          const localEnd = Math.min(rowEnd - base, chunkRows);
          for (let local = localStart; local < localEnd; local += 1) {
            const value = chunk[local];
            if (value !== undefined) {
              visit(base + local, col, value);
              visited += 1;
            }
          }
        }
      }
      return visited;
    },
    nonEmptyCount() {
      return nonEmpty;
    },
    approxMemoryBytes() {
      // 確保済みチャンク（密配列）＋列Map/チャンクMap overhead＋値文字。
      return chunkCount * chunkRows * 8 + columns.size * 48 + chunkCount * 48 + valueChars * BYTES_PER_CHAR;
    },
  };
}
