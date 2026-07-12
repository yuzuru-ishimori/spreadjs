// ②c 安定 slot キー CellStore（DD-010・CG-2）— 製品 sheet-core の CellStore を bench 契約へアダプト。
// 目的: ADR-0011 の chunked-rowslot 構造を **RowId キー（slot 間接）** へ移行した製品 CellStore が、
// 500k×4分布で chunked-rowslot（index キー・文字列格納）に対し許容内（範囲走査 +30%・メモリ +20%）で
// あることを計測する（AC6）。row=slot・col=colIndex の恒等写像で bench の (row,col) を渡す＝構造は同一。
// 値は製品モデルの CellRecord（CellScalar + lastChangedRevision）で格納する（＝二段 Map と同じ値表現）。
// これにより「slot キー化のコスト（≒0・構造同一）」と「CellRecord 値モデルのコスト（既存の文書表現に内在）」
// を分離して観察できる。

import { createCellStore, type CellStore } from '@nanairo-sheet/sheet-core';

import { type CellStoreCandidate, type CellStoreConfig } from '../cell-store';

function recordText(kind: string, value: unknown): string {
  if (kind === 'string') return value as string;
  if (kind === 'number') return String(value);
  return '';
}

export function createChunkedRowslotStableStore(config: CellStoreConfig): CellStoreCandidate {
  const store: CellStore = createCellStore({ chunkRows: config.chunkRows });

  return {
    label: 'chunked-rowslot-stable',
    get(row, col) {
      const record = store.get(row, col);
      return record === undefined ? '' : recordText(record.value.kind, (record.value as { value?: unknown }).value);
    },
    set(row, col, value) {
      if (value === '') {
        store.delete(row, col);
        return;
      }
      store.set(row, col, { value: { kind: 'string', value }, lastChangedRevision: 1 });
    },
    bulkLoad(cells) {
      for (const cell of cells) {
        if (cell.value === '') continue;
        store.set(cell.row, cell.col, {
          value: { kind: 'string', value: cell.value },
          lastChangedRevision: 1,
        });
      }
    },
    queryRange(rowStart, rowEnd, colStart, colEnd, visit) {
      if (rowEnd <= rowStart || colEnd <= colStart) return 0;
      let visited = 0;
      for (let slot = rowStart; slot < rowEnd; slot += 1) {
        store.forEachInRow(slot, (colIndex, record) => {
          if (colIndex < colStart || colIndex >= colEnd) return;
          visit(slot, colIndex, recordText(record.value.kind, (record.value as { value?: unknown }).value));
          visited += 1;
        });
      }
      return visited;
    },
    nonEmptyCount() {
      return store.nonEmptyCount();
    },
    // sheet-core CellStore の内部概算（CellRecord/CellScalar オブジェクト込み・値文字も内部で計上）。
    approxMemoryBytes() {
      return store.approxMemoryBytes();
    },
  };
}
