// 共有バリデーター（DD-003 Phase 2・主セッション指示 1）。
// サーバー（sequencer の reject 判定）とクライアント（Phase 3 の pending 再検証）が **同じ関数** で
// Operation の妥当性を判定し、サーバー/クライアントの判定乖離を構造的に防ぐ（§5.3 適用関数共有の精神）。
//
// applyOperation 本体は変更しない（apply が投げる ApplyError は構造 3 種のまま）。validateOperation は
// apply の構造 3 種（unknown-row / target-row-deleted / unknown-anchor）に加えて、Room 現在 revision との
// 照合が要る stale 判定（stale-cell-revision）と、Room 境界で担保する重複行拒否（duplicate-row・DA D11）を返す。
//
// 契約: validateOperation(doc, op) === [] ⇒ applyOperation(doc, op, ctx) は throw しない
// （違反集合が apply の構造 3 種を包含し、duplicate-row は apply が防御しない一意性契約を Room 側で塞ぐ）。
// 決定性: 違反は changes / rows の配列順で並ぶ（Map 反復順に依存しない）。時刻・乱数非参照。

import { getCell, resolveAnchorIndex } from './document';
import type { SheetDocument } from './document';
import type { CellScalar, DocumentOperation } from './operations';

import type { ColumnId, RowId } from '@nanairo-sheet/sheet-types';

/** Operation 検証で見つかった 1 件の違反。reject details の元になる（現在値/現在 revision を含む）。 */
export type OperationViolation =
  | { code: 'unknown-row'; rowId: RowId }
  | { code: 'target-row-deleted'; rowId: RowId }
  | { code: 'unknown-anchor'; afterRowId: RowId }
  | { code: 'duplicate-row'; rowId: RowId }
  | {
      code: 'stale-cell-revision';
      rowId: RowId;
      columnId: ColumnId;
      currentValue: CellScalar | undefined;
      currentRevision: number;
    };

/**
 * Operation を文書に対して検証し、違反の一覧を返す（空配列 = 妥当）。
 * SetCells は全件を検査し**全違反を列挙**する（原子性 reject の details 用・§3）。
 */
export function validateOperation(doc: SheetDocument, op: DocumentOperation): OperationViolation[] {
  switch (op.type) {
    case 'setCells':
      return validateSetCells(doc, op.changes);
    case 'insertRows':
      return validateInsertRows(doc, op.afterRowId, op.rows);
    case 'deleteRows':
      return []; // 再 Delete は冪等 no-op。DeleteRows は違反を持たない（S-E2/E3）
  }
}

function validateSetCells(
  doc: SheetDocument,
  changes: Array<{ rowId: RowId; columnId: ColumnId; beforeRevision?: number; value: CellScalar }>,
): OperationViolation[] {
  const violations: OperationViolation[] = [];
  for (const change of changes) {
    const meta = doc.rowMeta.get(change.rowId);
    if (meta === undefined) {
      violations.push({ code: 'unknown-row', rowId: change.rowId });
      continue;
    }
    if (meta.tombstone) {
      violations.push({ code: 'target-row-deleted', rowId: change.rowId });
      continue;
    }
    // stale 判定: beforeRevision 定義済みかつ現在セル revision と不一致（§10.2）。
    // 未書込セルの現在 revision は 0 とみなす（client が blank を beforeRevision:0 で書く場合と整合）。
    if (change.beforeRevision !== undefined) {
      const record = getCell(doc, change.rowId, change.columnId);
      const currentRevision = record?.lastChangedRevision ?? 0;
      if (change.beforeRevision !== currentRevision) {
        violations.push({
          code: 'stale-cell-revision',
          rowId: change.rowId,
          columnId: change.columnId,
          currentValue: record?.value,
          currentRevision,
        });
      }
    }
  }
  return violations;
}

function validateInsertRows(
  doc: SheetDocument,
  afterRowId: RowId | null,
  rows: Array<{ rowId: RowId; height?: number }>,
): OperationViolation[] {
  const violations: OperationViolation[] = [];
  // アンカー: 一度も存在しない ID は unknown-anchor（tombstone 済みは順序参照点として有効・S-D2）。
  if (resolveAnchorIndex(doc, afterRowId) === undefined && afterRowId !== null) {
    violations.push({ code: 'unknown-anchor', afterRowId });
  }
  // duplicate-row: 既存行と重複、または op 内で重複する rowId を拒否（指示 3・DA D11 の Room 境界担保・S-D6）。
  const seenInOp = new Set<RowId>();
  for (const rowSpec of rows) {
    if (doc.rowMeta.has(rowSpec.rowId) || seenInOp.has(rowSpec.rowId)) {
      violations.push({ code: 'duplicate-row', rowId: rowSpec.rowId });
    }
    seenInOp.add(rowSpec.rowId);
  }
  return violations;
}
