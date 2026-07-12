// 決定論的適用関数（計画書 §7.6）。サーバー（sequencer）とクライアント（session）が共有する（§5.3）。
// 時刻・乱数・DOM・ネットワークを参照せず、同一 (文書, Operation, 付与revision) → 同一 ApplyResult。
// 付与 revision は呼び出し側（サーバー付与＝committed / クライアント楽観＝暫定）が ctx で渡す。
// 入力文書は破壊しない（cloneDocument バッファで二相適用）。
//
// 検査の分担: apply が投げる ApplyError は「文書だけで判定できる構造エラー」= unknown-row /
// target-row-deleted / unknown-anchor / unknown-column（DD-010・列固定違反）。すべて validateOperation が
// 先に検出でき「validate===[] ⇒ apply は throw しない」契約を保つ（phase1-design §4・protocol-subset §3。S-A6〜A8）。
// SetCells の beforeRevision による stale 検査（stale-cell-revision）は Room 現在 revision との
// 照合が要るため Phase 2 サーバー（sequencer）の責務とし、apply 層では beforeRevision を参照しない。

import type { ColumnId, RowId } from '@nanairo-sheet/types';

import { cloneCellScalar, cloneDocument, columnIndexOf, getCell, resolveAnchorIndex, setCell } from './document';
import type { RowMeta, SheetDocument } from './document';
import type {
  CellScalar,
  DeleteRowsOperation,
  DocumentOperation,
  InsertRowsOperation,
  SetCellsOperation,
} from './operations';

export interface CellChange {
  rowId: RowId;
  columnId: ColumnId;
  before: CellScalar | undefined;
  after: CellScalar | undefined;
}

export interface ChangeSet {
  cells: CellChange[];
  rowsInserted: RowId[];
  rowsDeleted: RowId[]; // 実際に tombstone 化した分のみ（再Delete no-op は含めない）
}

/**
 * rollback 用の逆操作生成データ（§7.6/7.7。Phase 3 で session.ts が消費する）。
 * Phase 3 消費者への契約:
 * - `cells` は変更前値。rollback では **後ろから順に**（forward の逆順で）適用する
 *   （同一 SetCells 内で同一セルを複数回書いた場合の正しい復元のため・DA D15）。空セルの前値は
 *   `{kind:'blank'}` として保持し、rollback で blank を書く（不在との差は hash 上等価・S-B3）。
 * - `insertedRowIds` は rowOrder / rowMeta / cells から除去する。
 * - `deletedRows` は un-tombstone で復元する（本モデルの DeleteRows は tombstone のみで rowOrder から
 *   物理削除しないため、行は現位置に残っている）。`index` は **削除時点**の rowOrder 位置で、参考情報。
 *   以後の InsertRows で位置がずれ得るので、index を使った物理再挿入はしない（un-tombstone in place・DA D10）。
 */
export interface InverseSeed {
  cells: Array<{ rowId: RowId; columnId: ColumnId; value: CellScalar | undefined }>; // 変更前値
  insertedRowIds: RowId[]; // 逆操作で削除すべき行
  deletedRows: Array<{ rowId: RowId; index: number; meta: RowMeta }>; // 逆操作で復元する行（tombstone 前 meta）
}

export interface ApplyResult {
  document: SheetDocument; // 適用後の新文書（入力は不変）
  changeSet: ChangeSet;
  inverseSeed: InverseSeed;
  dirtyRegions: RowId[]; // 再描画対象（PoC は行集合で十分）
  formulaInvalidations: never[]; // PoC はスコープ外（常に []）
}

export type ApplyErrorCode =
  | 'unknown-row'
  | 'target-row-deleted'
  | 'unknown-anchor'
  | 'unknown-column';

export class ApplyError extends Error {
  readonly code: ApplyErrorCode;
  readonly offending: unknown; // 違反 change/row の一覧（reject details の元）

  constructor(code: ApplyErrorCode, offending: unknown, message?: string) {
    super(message ?? code);
    this.name = 'ApplyError';
    this.code = code;
    this.offending = offending;
  }
}

export function applyOperation(
  doc: SheetDocument,
  op: DocumentOperation,
  ctx: { revision: number },
): ApplyResult {
  switch (op.type) {
    case 'setCells':
      return applySetCells(doc, op, ctx.revision);
    case 'insertRows':
      return applyInsertRows(doc, op, ctx.revision);
    case 'deleteRows':
      return applyDeleteRows(doc, op, ctx.revision);
    default:
      return assertNever(op);
  }
}

function applySetCells(doc: SheetDocument, op: SetCellsOperation, revision: number): ApplyResult {
  // Phase 1: 全件を構造検証（部分適用しない＝原子性・I-5）。違反は種別ごとに収集し全件 reject。
  const unknownRows: RowId[] = [];
  const deletedRows: RowId[] = [];
  const unknownColumns: ColumnId[] = [];
  for (const change of op.changes) {
    const meta = doc.rowMeta.get(change.rowId);
    if (meta === undefined) {
      unknownRows.push(change.rowId);
    } else if (meta.tombstone) {
      deletedRows.push(change.rowId);
    } else if (columnIndexOf(doc, change.columnId) < 0) {
      // columnOrder 外の列は構造エラー（DD-010・列固定 PoC）。setCell の raw throw ではなく ApplyError で reject。
      unknownColumns.push(change.columnId);
    }
  }
  if (unknownRows.length > 0) {
    throw new ApplyError('unknown-row', unknownRows);
  }
  if (deletedRows.length > 0) {
    throw new ApplyError('target-row-deleted', deletedRows);
  }
  if (unknownColumns.length > 0) {
    throw new ApplyError('unknown-column', unknownColumns);
  }

  // Phase 2: clone 上で確定（入力 doc は不変）。before は working clone から読み、
  // 同一 SetCells 内の複数変更（同一セルの連続書き）も正しく直前値を反映する。
  const next = cloneDocument(doc);
  const cells: CellChange[] = [];
  const inverseCells: InverseSeed['cells'] = [];
  const dirty: RowId[] = [];
  const seenDirty = new Set<RowId>();

  for (const change of op.changes) {
    const before = readCellValueOrBlank(next, change.rowId, change.columnId);
    setCell(next, change.rowId, change.columnId, {
      value: cloneCellScalar(change.value),
      lastChangedRevision: revision,
    });
    cells.push({
      rowId: change.rowId,
      columnId: change.columnId,
      before: cloneCellScalar(before),
      after: cloneCellScalar(change.value),
    });
    inverseCells.push({
      rowId: change.rowId,
      columnId: change.columnId,
      value: cloneCellScalar(before),
    });
    if (!seenDirty.has(change.rowId)) {
      seenDirty.add(change.rowId);
      dirty.push(change.rowId);
    }
  }
  next.revision = revision;

  return {
    document: next,
    changeSet: { cells, rowsInserted: [], rowsDeleted: [] },
    inverseSeed: { cells: inverseCells, insertedRowIds: [], deletedRows: [] },
    dirtyRegions: dirty,
    formulaInvalidations: [],
  };
}

function applyInsertRows(
  doc: SheetDocument,
  op: InsertRowsOperation,
  revision: number,
): ApplyResult {
  const anchorIndex = resolveAnchorIndex(doc, op.afterRowId);
  if (anchorIndex === undefined) {
    throw new ApplyError('unknown-anchor', op.afterRowId);
  }

  // 前提（呼び出し側の契約・DA D11）: op.rows の rowId は文書内で未使用（本番は crypto.randomUUID、
  // テストはシード一意）。既存 rowId を渡すと rowOrder に重複が入る。PoC は採番一意性を前提とし、
  // 専用エラーコードは設けない（apply の ApplyError は構造3種＝phase1-design §4 に限定）。
  const next = cloneDocument(doc);
  const insertedRowIds: RowId[] = [];
  let slot = nextSlot(next);
  let insertAt = anchorIndex + 1; // アンカー直後（先頭=-1 のときは 0）

  for (const rowSpec of op.rows) {
    next.rowOrder.splice(insertAt, 0, rowSpec.rowId);
    next.rowMeta.set(rowSpec.rowId, {
      id: rowSpec.rowId,
      slot,
      tombstone: false,
      lastChangedRevision: revision,
    });
    insertedRowIds.push(rowSpec.rowId);
    insertAt += 1;
    slot += 1;
  }
  next.revision = revision;

  return {
    document: next,
    changeSet: { cells: [], rowsInserted: insertedRowIds, rowsDeleted: [] },
    inverseSeed: { cells: [], insertedRowIds: [...insertedRowIds], deletedRows: [] },
    dirtyRegions: [...insertedRowIds],
    formulaInvalidations: [],
  };
}

function applyDeleteRows(
  doc: SheetDocument,
  op: DeleteRowsOperation,
  revision: number,
): ApplyResult {
  const next = cloneDocument(doc);
  const rowsDeleted: RowId[] = [];
  const inverseDeleted: InverseSeed['deletedRows'] = [];

  for (const rowId of op.rowIds) {
    const meta = next.rowMeta.get(rowId);
    // 未知行・tombstone 済みは冪等 no-op（S-E2/E3）。全件 no-op でも changeSet 空で成功。
    if (meta === undefined || meta.tombstone) {
      continue;
    }
    const index = next.rowOrder.indexOf(rowId);
    inverseDeleted.push({ rowId, index, meta: { ...meta } }); // tombstone 前の状態を保存（復元用）
    meta.tombstone = true;
    meta.lastChangedRevision = revision;
    rowsDeleted.push(rowId);
  }
  next.revision = revision;

  return {
    document: next,
    changeSet: { cells: [], rowsInserted: [], rowsDeleted },
    inverseSeed: { cells: [], insertedRowIds: [], deletedRows: inverseDeleted },
    dirtyRegions: [...rowsDeleted],
    formulaInvalidations: [],
  };
}

// 既存セル値を返し、無ければ blank を返す（before/inverse 値を CellScalar に正規化する）。
function readCellValueOrBlank(doc: SheetDocument, rowId: RowId, columnId: ColumnId): CellScalar {
  const record = getCell(doc, rowId, columnId);
  return record === undefined ? { kind: 'blank' } : record.value;
}

// 決定論的な次スロット = 既存スロットの最大 +1（空文書は 0）。rowMeta は縮まないため単調。
// slot は hash に含めないが再現性のため決定論に採番する（phase1-design §2）。
function nextSlot(doc: SheetDocument): number {
  let max = -1;
  for (const meta of doc.rowMeta.values()) {
    if (meta.slot > max) {
      max = meta.slot;
    }
  }
  return max + 1;
}

function assertNever(value: never): never {
  throw new Error(`applyOperation: unexpected operation ${JSON.stringify(value)}`);
}
