// 最小文書モデルと純粋な読み取り/複製ユーティリティ（phase1-design §2）。
// 単一シート・行 Axis = rowOrder（tombstone を保持）＋ RowMeta・列は固定 ColumnId 列・
// CellStore は二段 Map。状態は持たず、関数は新状態を返すかバッファ（clone）を操作する。
// ランタイム依存ゼロ・DOM/Node 非参照。CellScalar は operations.ts が定義（phase1-design §3）。

import type { ColumnId, RowId } from '@nanairo-sheet/sheet-types';

import type { CellScalar } from './operations';

export interface RowMeta {
  id: RowId;
  slot: number; // 安定整数スロット（§6.3）
  tombstone: boolean; // DeleteRows で true。rowOrder からは消さない
  lastChangedRevision: number;
}

export interface CellRecord {
  value: CellScalar;
  lastChangedRevision: number; // 正準ハッシュに含める（phase1-design §5）
}

export interface SheetDocument {
  revision: number;
  rowOrder: RowId[]; // tombstone 含む全行の順序（アンカー解決の基準）
  rowMeta: Map<RowId, RowMeta>;
  columnOrder: ColumnId[]; // 固定 ColumnId 列（PoC は変更しない）
  cells: Map<RowId, Map<ColumnId, CellRecord>>; // 二段 Map（§6.4 最小形）
}

/** CellScalar を深く複製する（判別ユニオンを網羅・`as` 不使用）。 */
export function cloneCellScalar(value: CellScalar): CellScalar {
  switch (value.kind) {
    case 'blank':
      return { kind: 'blank' };
    case 'string':
      return { kind: 'string', value: value.value };
    case 'number':
      return { kind: 'number', value: value.value };
  }
}

export function createDocument(columns: ColumnId[]): SheetDocument {
  return {
    revision: 0,
    rowOrder: [],
    rowMeta: new Map(),
    columnOrder: [...columns], // 呼び出し側配列の後続変更から切り離す
    cells: new Map(),
  };
}

/**
 * 完全な深いコピーを返す（二相適用の validate→commit バッファ用）。
 * rowOrder/columnOrder は新配列、rowMeta/cells は新 Map、RowMeta/CellRecord/CellScalar も
 * すべて別オブジェクトにする。clone のどこを変更しても入力 doc は不変（部分ミューテーション経路の遮断）。
 */
export function cloneDocument(doc: SheetDocument): SheetDocument {
  const rowMeta = new Map<RowId, RowMeta>();
  for (const [rowId, meta] of doc.rowMeta) {
    rowMeta.set(rowId, { ...meta });
  }
  const cells = new Map<RowId, Map<ColumnId, CellRecord>>();
  for (const [rowId, rowCells] of doc.cells) {
    const clonedRow = new Map<ColumnId, CellRecord>();
    for (const [columnId, record] of rowCells) {
      clonedRow.set(columnId, {
        value: cloneCellScalar(record.value),
        lastChangedRevision: record.lastChangedRevision,
      });
    }
    cells.set(rowId, clonedRow);
  }
  return {
    revision: doc.revision,
    rowOrder: [...doc.rowOrder],
    rowMeta,
    columnOrder: [...doc.columnOrder],
    cells,
  };
}

export function getCell(
  doc: SheetDocument,
  rowId: RowId,
  columnId: ColumnId,
): CellRecord | undefined {
  return doc.cells.get(rowId)?.get(columnId);
}

/** rowOrder から tombstone を除いた表示順（hash/描画用）。 */
export function displayRowOrder(doc: SheetDocument): RowId[] {
  const result: RowId[] = [];
  for (const rowId of doc.rowOrder) {
    const meta = doc.rowMeta.get(rowId);
    if (meta !== undefined && !meta.tombstone) {
      result.push(rowId);
    }
  }
  return result;
}

/**
 * afterRowId の rowOrder 上インデックスを返す（null=先頭=-1）。未知IDは undefined。
 * tombstone 行も順序参照点として有効（削除済みアンカーへの InsertRows・S-D2 / protocol-subset §4-2）。
 */
export function resolveAnchorIndex(doc: SheetDocument, afterRowId: RowId | null): number | undefined {
  if (afterRowId === null) {
    return -1;
  }
  const index = doc.rowOrder.indexOf(afterRowId);
  return index === -1 ? undefined : index;
}

export function isTombstoned(doc: SheetDocument, rowId: RowId): boolean {
  return doc.rowMeta.get(rowId)?.tombstone ?? false;
}
