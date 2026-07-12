// 最小文書モデルと純粋な読み取り/複製ユーティリティ（phase1-design §2）。
// 単一シート・行 Axis = rowOrder（tombstone を保持）＋ RowMeta・列は固定 ColumnId 列・
// CellStore は二段 Map。状態は持たず、関数は新状態を返すかバッファ（clone）を操作する。
// ランタイム依存ゼロ・DOM/Node 非参照。CellScalar は operations.ts が定義（phase1-design §3）。

import type { ColumnId, RowId } from '@nanairo-sheet/sheet-types';

import { createCellStore } from './cell-store';
import type { CellStore } from './cell-store';
import type { CellScalar } from './operations';

export interface RowMeta {
  id: RowId;
  slot: number; // 安定整数スロット（§6.3）。CellStore のチャンクキー（DD-010・ADR-0011 A案）
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
  // 安定 slot キー CellStore（DD-010・CG-2）。RowId→slot は rowMeta、ColumnId→colIndex は columnOrder で
  // 解決する（下記 slotOf / columnIndexOf・getCell / setCell 等の純ヘルパー経由でのみ読み書きする）。
  cells: CellStore;
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
    cells: createCellStore(),
  };
}

/** RowId → 安定 slot（rowMeta 経由・tombstone 行も slot を保持）。未知行は undefined。 */
export function slotOf(doc: SheetDocument, rowId: RowId): number | undefined {
  return doc.rowMeta.get(rowId)?.slot;
}

/** ColumnId → colIndex（columnOrder 上の位置）。columnOrder 外は -1（get は undefined 扱い）。 */
export function columnIndexOf(doc: SheetDocument, columnId: ColumnId): number {
  return doc.columnOrder.indexOf(columnId);
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
  return {
    revision: doc.revision,
    rowOrder: [...doc.rowOrder],
    rowMeta,
    columnOrder: [...doc.columnOrder],
    cells: doc.cells.clone(), // CellRecord/CellScalar まで別オブジェクト（隔離は cell-store.clone が担保）
  };
}

export function getCell(
  doc: SheetDocument,
  rowId: RowId,
  columnId: ColumnId,
): CellRecord | undefined {
  const slot = slotOf(doc, rowId);
  if (slot === undefined) {
    return undefined; // 未知行
  }
  return doc.cells.get(slot, columnIndexOf(doc, columnId));
}

/**
 * セルを書き込む（doc.cells を破壊的に更新）。行は既存であること（slot 解決可能）が前提。
 * columnId は columnOrder 内であること（PoC は列固定）。前提違反は fail-fast（サイレント破損を防ぐ・CG-2）。
 */
export function setCell(
  doc: SheetDocument,
  rowId: RowId,
  columnId: ColumnId,
  record: CellRecord,
): void {
  const slot = slotOf(doc, rowId);
  if (slot === undefined) {
    throw new Error(`setCell: 未知の行 ${String(rowId)}（slot 未解決）`);
  }
  const colIndex = columnIndexOf(doc, columnId);
  if (colIndex < 0) {
    throw new Error(`setCell: columnOrder 外の列 ${String(columnId)}（PoC は列固定）`);
  }
  doc.cells.set(slot, colIndex, record);
}

/** セルを削除する（存在しなければ no-op）。行/列が未知でも no-op（rollback の前値=空 → 不在化に使う）。 */
export function deleteCell(doc: SheetDocument, rowId: RowId, columnId: ColumnId): void {
  const slot = slotOf(doc, rowId);
  if (slot === undefined) {
    return;
  }
  doc.cells.delete(slot, columnIndexOf(doc, columnId));
}

/** 行のセルを丸ごと除去する（挿入 rollback で行ごと消す経路・rowMeta 削除より前に呼ぶこと）。 */
export function deleteRowCells(doc: SheetDocument, rowId: RowId): void {
  const slot = slotOf(doc, rowId);
  if (slot === undefined) {
    return;
  }
  doc.cells.deleteRow(slot);
}

/** 行内の非空セルを colIndex 昇順で列挙する（columnId を解決して visit・serialize/構造比較用）。 */
export function forEachCellInRow(
  doc: SheetDocument,
  rowId: RowId,
  visit: (columnId: ColumnId, record: CellRecord) => void,
): void {
  const slot = slotOf(doc, rowId);
  if (slot === undefined) {
    return;
  }
  doc.cells.forEachInRow(slot, (colIndex, record) => {
    const columnId = doc.columnOrder[colIndex];
    if (columnId !== undefined) {
      visit(columnId, record);
    }
  });
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
