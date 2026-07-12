// ②b チャンク型（行スロット）— DD-004 の chunk-store 移植・ADR-011 ②。
// 構造: Map<chunkIndex, Chunk>、Chunk.slots[row%chunkRows] = { cols[](昇順), values[] }。
// 行内は列の二分探索で colStart 以降だけを見る（範囲走査 O(可視非空数 + log)）。
// DD-004 の実装を CellStoreCandidate 契約へ合わせて移植（挙動は保存）。

import {
  BYTES_PER_CHAR,
  type CellStoreCandidate,
  type CellStoreConfig,
  type RangeVisitor,
} from '../cell-store';

const DEFAULT_CHUNK_ROWS = 256;

interface RowSlot {
  cols: number[];
  values: string[];
}
interface Chunk {
  slots: (RowSlot | undefined)[];
}

/** cols 昇順配列で target 以上になる最初の位置（lower bound）。 */
function lowerBound(cols: readonly number[], target: number): number {
  let lo = 0;
  let hi = cols.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((cols[mid] ?? 0) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function createChunkedRowslotStore(config: CellStoreConfig): CellStoreCandidate {
  const chunkRows = config.chunkRows ?? DEFAULT_CHUNK_ROWS;
  if (chunkRows <= 0) throw new Error(`chunkRows は正の数（受領: ${chunkRows}）`);
  const chunks = new Map<number, Chunk>();
  let nonEmpty = 0;
  let valueChars = 0;

  const getSlot = (row: number, create: boolean): RowSlot | undefined => {
    const chunkIndex = Math.floor(row / chunkRows);
    let chunk = chunks.get(chunkIndex);
    if (chunk === undefined) {
      if (!create) return undefined;
      chunk = { slots: new Array<RowSlot | undefined>(chunkRows) };
      chunks.set(chunkIndex, chunk);
    }
    const local = row - chunkIndex * chunkRows;
    let slot = chunk.slots[local];
    if (slot === undefined && create) {
      slot = { cols: [], values: [] };
      chunk.slots[local] = slot;
    }
    return slot;
  };

  const setInternal = (row: number, col: number, value: string): void => {
    if (value === '') {
      const slot = getSlot(row, false);
      if (slot === undefined) return;
      const idx = lowerBound(slot.cols, col);
      if (idx < slot.cols.length && slot.cols[idx] === col) {
        valueChars -= (slot.values[idx] ?? '').length;
        slot.cols.splice(idx, 1);
        slot.values.splice(idx, 1);
        nonEmpty -= 1;
      }
      return;
    }
    const slot = getSlot(row, true);
    if (slot === undefined) return;
    const idx = lowerBound(slot.cols, col);
    if (idx < slot.cols.length && slot.cols[idx] === col) {
      valueChars += value.length - (slot.values[idx] ?? '').length;
      slot.values[idx] = value;
    } else {
      slot.cols.splice(idx, 0, col);
      slot.values.splice(idx, 0, value);
      valueChars += value.length;
      nonEmpty += 1;
    }
  };

  return {
    label: 'chunked-rowslot',
    get(row, col) {
      const slot = getSlot(row, false);
      if (slot === undefined) return '';
      const idx = lowerBound(slot.cols, col);
      if (idx < slot.cols.length && slot.cols[idx] === col) return slot.values[idx] ?? '';
      return '';
    },
    set(row, col, value) {
      setInternal(row, col, value);
    },
    bulkLoad(cells) {
      for (const cell of cells) {
        if (cell.value === '') continue;
        const slot = getSlot(cell.row, true);
        if (slot === undefined) continue;
        const lastCol = slot.cols.length > 0 ? slot.cols[slot.cols.length - 1] : undefined;
        if (lastCol === undefined || cell.col > lastCol) {
          // 昇順入力の高速 append。
          slot.cols.push(cell.col);
          slot.values.push(cell.value);
          valueChars += cell.value.length;
          nonEmpty += 1;
        } else {
          setInternal(cell.row, cell.col, cell.value);
        }
      }
    },
    queryRange(rowStart, rowEnd, colStart, colEnd, visit: RangeVisitor) {
      if (rowEnd <= rowStart || colEnd <= colStart) return 0;
      let visited = 0;
      const firstChunk = Math.floor(rowStart / chunkRows);
      const lastChunk = Math.floor((rowEnd - 1) / chunkRows);
      for (let chunkIndex = firstChunk; chunkIndex <= lastChunk; chunkIndex += 1) {
        const chunk = chunks.get(chunkIndex);
        if (chunk === undefined) continue;
        const base = chunkIndex * chunkRows;
        const localStart = Math.max(rowStart - base, 0);
        const localEnd = Math.min(rowEnd - base, chunkRows);
        for (let local = localStart; local < localEnd; local += 1) {
          const slot = chunk.slots[local];
          if (slot === undefined) continue;
          const row = base + local;
          for (let i = lowerBound(slot.cols, colStart); i < slot.cols.length; i += 1) {
            const col = slot.cols[i] ?? 0;
            if (col >= colEnd) break;
            visit(row, col, slot.values[i] ?? '');
            visited += 1;
          }
        }
      }
      return visited;
    },
    nonEmptyCount() {
      return nonEmpty;
    },
    approxMemoryBytes() {
      // 並列配列（cols:number/ values:参照）＋チャンク slots 配列＋値文字。
      return nonEmpty * 16 + chunks.size * chunkRows * 8 + valueChars * BYTES_PER_CHAR;
    },
  };
}
