// 収束試験の構造 deep-equal 用ヘルパー（.test.ts ではないので vitest は実行しない。test/ の共有モジュール）。
// 文書ハッシュ（hash.ts）は displayRowOrder × 非空セルの content-based ゆえ、tombstone のみ・空行のみの
// 構造差を検知できない盲点がある（DA D12）。本ヘルパーは rowOrder（tombstone 含む全行）・rowMeta（slot/
// tombstone/lastChangedRevision）・全セル（blank 含む）・revision を、rowOrder/columnOrder 配列順で列挙した
// プレーン構造へ正規化する。hash とは独立の導出のため、`expect(a).toEqual(b)` で構造差を厳密に検出できる
// （収束 assert の独立性＝hash と同じ関数から導出しない・DA 重点）。Map 反復順・localeCompare 非依存。

import type { CellScalar, SheetDocument } from '@nanairo-sheet/sheet-core';

export interface NormalizedRowMeta {
  id: string;
  slot: number;
  tombstone: boolean;
  lastChangedRevision: number;
}

export interface NormalizedCell {
  rowId: string;
  columnId: string;
  value: CellScalar;
  lastChangedRevision: number;
}

export interface NormalizedDocument {
  revision: number;
  columnOrder: string[];
  rowOrder: string[]; // tombstone を含む全行の順序
  rowMeta: NormalizedRowMeta[]; // rowOrder 順
  cells: NormalizedCell[]; // (rowOrder × columnOrder) 順・blank も含める
}

/**
 * SheetDocument を hash 非依存のプレーン構造へ正規化する（構造 deep-equal 用）。
 * rowOrder / columnOrder の配列順でのみ列挙し、Map 反復順・環境依存整列に依存しない。
 */
export function normalizeDocument(doc: SheetDocument): NormalizedDocument {
  const rowMeta: NormalizedRowMeta[] = doc.rowOrder.map((rowId) => {
    const meta = doc.rowMeta.get(rowId);
    return {
      id: String(rowId),
      slot: meta?.slot ?? -1,
      tombstone: meta?.tombstone ?? false,
      lastChangedRevision: meta?.lastChangedRevision ?? -1,
    };
  });

  const cells: NormalizedCell[] = [];
  for (const rowId of doc.rowOrder) {
    const rowCells = doc.cells.get(rowId);
    if (rowCells === undefined) {
      continue;
    }
    for (const columnId of doc.columnOrder) {
      const record = rowCells.get(columnId);
      if (record === undefined) {
        continue;
      }
      cells.push({
        rowId: String(rowId),
        columnId: String(columnId),
        value: record.value,
        lastChangedRevision: record.lastChangedRevision,
      });
    }
  }

  return {
    revision: doc.revision,
    columnOrder: doc.columnOrder.map((c) => String(c)),
    rowOrder: doc.rowOrder.map((r) => String(r)),
    rowMeta,
    cells,
  };
}
