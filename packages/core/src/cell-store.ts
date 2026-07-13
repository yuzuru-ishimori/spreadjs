// 安定ID・チャンク化 CellStore（DD-010・CG-2・ADR-0011 A案「slot 間接」）。
//
// 目的: ADR-0011 の chunked-rowslot 構造（チャンク×行スロット×列昇順並列配列）を、行 index キーから
// **安定 slot キー**へ差し替える。slot は RowMeta.slot（§6.3・単調・tombstone でも保持・回収しない）で、
// RowId→slot の解決は document.ts が rowMeta で行う（本ストアは slot: number / colIndex: number の
// 整数キーだけを扱う純データ構造）。列は columnOrder 上の位置 = colIndex（整数）。
//
// これにより InsertRows/DeleteRows でセルデータは物理移動しない（slot 不変）＝index ずれ・サイレント
// 上書きが構造的に起きない（CG-2 の核）。同時に ADR-0011 の実測優位（O(可視セル) 走査・省メモリ・
// 昇順 append ロード）を維持する。DOM/Node 非参照・ランタイム依存ゼロ。
//
// 二段 Map（Map<RowId, Map<ColumnId, CellRecord>>）と論理等価であることは differential test で機械実証する
// （cell-store-differential.test.ts）。二段 Map と違い、行内は colIndex 昇順の並列配列＋二分探索で保持する。

import type { CellRecord } from './document';
import type { CellScalar } from './operations';

/** slot 内の行スロット: colIndex 昇順の並列配列（cols[i] の値が records[i]）。 */
interface RowSlot {
  cols: number[];
  records: CellRecord[];
}

interface Chunk {
  slots: (RowSlot | undefined)[];
}

const DEFAULT_CHUNK_ROWS = 256;
// メモリ概算の係数（レポート用・厳密値ではない）。
const BYTES_PER_COL_ENTRY = 8; // cols:number 1 要素の概算
const BYTES_PER_RECORD_REF = 8; // records[] の参照 1 要素
const BYTES_PER_RECORD_OBJECT = 32; // CellRecord + CellScalar オブジェクトの概算
const BYTES_PER_CHAR = 2; // UTF-16

/** CellScalar を深く複製する（clone() 用・cloneCellScalar と等価。循環 import 回避のため本ファイルに保持）。 */
function cloneScalar(value: CellScalar): CellScalar {
  switch (value.kind) {
    case 'blank':
      return { kind: 'blank' };
    case 'string':
      return { kind: 'string', value: value.value };
    case 'number':
      return { kind: 'number', value: value.value };
    case 'date':
      return { kind: 'date', value: value.value };
  }
}

function cloneRecord(record: CellRecord): CellRecord {
  return { value: cloneScalar(record.value), lastChangedRevision: record.lastChangedRevision };
}

/** cols 昇順配列で target 以上になる最初の位置（lower bound・二分探索）。 */
function lowerBound(cols: readonly number[], target: number): number {
  let lo = 0;
  let hi = cols.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((cols[mid] ?? 0) < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * 安定 slot キー CellStore。document.ts が RowId→slot・ColumnId→colIndex を解決して呼ぶ。
 * - `get`/`set`/`delete` は (slot, colIndex) 整数キー。set は blank レコードも保持する（二段 Map と等価）。
 * - `forEachInRow` は colIndex 昇順で列挙（正準直列化・serialization が Map 反復順に依存しないための決定順）。
 * - `deleteRow` は挿入 rollback（inverseSeed）で行ごと除去する経路。
 * - `clone` は CellRecord/CellScalar まで別オブジェクトへ深く複製する（二相適用バッファの隔離）。
 */
export interface CellStore {
  get(slot: number, colIndex: number): CellRecord | undefined;
  set(slot: number, colIndex: number, record: CellRecord): void;
  delete(slot: number, colIndex: number): void;
  deleteRow(slot: number): void;
  hasRow(slot: number): boolean;
  forEachInRow(slot: number, visit: (colIndex: number, record: CellRecord) => void): void;
  clone(): CellStore;
  /** 保持レコード総数（blank レコードも含む。二段 Map の Σ rowCells.size と一致）。 */
  nonEmptyCount(): number;
  approxMemoryBytes(): number;
}

export interface CellStoreConfig {
  /** 1 チャンクの slot 数（既定 256・§6.4）。 */
  chunkRows?: number;
}

export function createCellStore(config: CellStoreConfig = {}): CellStore {
  const chunkRows = config.chunkRows ?? DEFAULT_CHUNK_ROWS;
  if (!Number.isInteger(chunkRows) || chunkRows <= 0) {
    throw new Error(`chunkRows は正の整数（受領: ${chunkRows}）`);
  }
  const chunks = new Map<number, Chunk>();
  let count = 0;
  let totalValueChars = 0;

  const getSlot = (slot: number, create: boolean): RowSlot | undefined => {
    if (slot < 0 || !Number.isInteger(slot)) {
      throw new Error(`slot は 0 以上の整数（受領: ${slot}）`);
    }
    const chunkIndex = Math.floor(slot / chunkRows);
    let chunk = chunks.get(chunkIndex);
    if (chunk === undefined) {
      if (!create) {
        return undefined;
      }
      chunk = { slots: new Array<RowSlot | undefined>(chunkRows) };
      chunks.set(chunkIndex, chunk);
    }
    const local = slot - chunkIndex * chunkRows;
    let row = chunk.slots[local];
    if (row === undefined && create) {
      row = { cols: [], records: [] };
      chunk.slots[local] = row;
    }
    return row;
  };

  const valueChars = (record: CellRecord): number =>
    // string と date（LocalDate 文字列）は UTF-16 文字列領域を持つため文字数を計上する。
    // date を除外すると大量日付セルのメモリを過少評価する（Codex P2）。
    record.value.kind === 'string' || record.value.kind === 'date' ? record.value.value.length : 0;

  const store: CellStore = {
    get(slot, colIndex) {
      if (colIndex < 0) {
        return undefined;
      }
      const row = getSlot(slot, false);
      if (row === undefined) {
        return undefined;
      }
      const idx = lowerBound(row.cols, colIndex);
      if (idx < row.cols.length && row.cols[idx] === colIndex) {
        return row.records[idx];
      }
      return undefined;
    },
    set(slot, colIndex, record) {
      if (colIndex < 0 || !Number.isInteger(colIndex)) {
        throw new Error(`colIndex は 0 以上の整数（受領: ${colIndex}）`);
      }
      const row = getSlot(slot, true);
      if (row === undefined) {
        return;
      }
      const idx = lowerBound(row.cols, colIndex);
      if (idx < row.cols.length && row.cols[idx] === colIndex) {
        totalValueChars += valueChars(record) - valueChars(row.records[idx]!);
        row.records[idx] = record;
      } else {
        row.cols.splice(idx, 0, colIndex);
        row.records.splice(idx, 0, record);
        totalValueChars += valueChars(record);
        count += 1;
      }
    },
    delete(slot, colIndex) {
      if (colIndex < 0) {
        return;
      }
      const row = getSlot(slot, false);
      if (row === undefined) {
        return;
      }
      const idx = lowerBound(row.cols, colIndex);
      if (idx < row.cols.length && row.cols[idx] === colIndex) {
        totalValueChars -= valueChars(row.records[idx]!);
        row.cols.splice(idx, 1);
        row.records.splice(idx, 1);
        count -= 1;
      }
    },
    deleteRow(slot) {
      const row = getSlot(slot, false);
      if (row === undefined) {
        return;
      }
      for (const record of row.records) {
        totalValueChars -= valueChars(record);
      }
      count -= row.cols.length;
      const chunkIndex = Math.floor(slot / chunkRows);
      const chunk = chunks.get(chunkIndex);
      if (chunk !== undefined) {
        chunk.slots[slot - chunkIndex * chunkRows] = undefined;
      }
    },
    hasRow(slot) {
      const row = getSlot(slot, false);
      return row !== undefined && row.cols.length > 0;
    },
    forEachInRow(slot, visit) {
      const row = getSlot(slot, false);
      if (row === undefined) {
        return;
      }
      for (let i = 0; i < row.cols.length; i += 1) {
        visit(row.cols[i]!, row.records[i]!);
      }
    },
    clone() {
      const copy = createCellStore({ chunkRows });
      for (const [chunkIndex, chunk] of chunks) {
        for (let local = 0; local < chunk.slots.length; local += 1) {
          const row = chunk.slots[local];
          if (row === undefined) {
            continue;
          }
          const slot = chunkIndex * chunkRows + local;
          for (let i = 0; i < row.cols.length; i += 1) {
            copy.set(slot, row.cols[i]!, cloneRecord(row.records[i]!));
          }
        }
      }
      return copy;
    },
    nonEmptyCount() {
      return count;
    },
    approxMemoryBytes() {
      return (
        count * (BYTES_PER_COL_ENTRY + BYTES_PER_RECORD_REF + BYTES_PER_RECORD_OBJECT) +
        totalValueChars * BYTES_PER_CHAR +
        chunks.size * chunkRows * BYTES_PER_RECORD_REF
      );
    },
  };
  return store;
}
