// range-ops（DD-020-1 Phase 2）: 表示 index の矩形範囲 → 原子的 SetCells の生成と上限検査（DOM 非依存の純粋関数）。
//
// 範囲クリア（Delete=blank 敷き詰め）の生成器。DD-020-2（paste/cut）が同じ上限検査・範囲走査を再利用する土台。
//
// 【上限（親 要確認①=100,000・ADR-020 D3）】判定は**範囲セル数**（矩形の面積＝体感と一致）で行い、超過は
// 走査せず実行前拒否する（50,000行×200列の全選択相当でも O(1) で弾く）。
//
// 【非空フィルター】SetCells の changes には**非空セルのみ**含める（結果同一・operation 最小化）。非空判定は
// **表示値（view=committed+own pending の描画値）**を正とする＝利用者が画面で見ている値。own pending が
// 載っているセル（committed は blank）も対象に含まれ、beforeRevision は committed 由来（下記）ゆえ pending が
// 先に確定すると全体 reject になる（単一セル Delete と同じ OCC 厳格性・原子性維持＝サイレント部分適用なし）。
//
// 【beforeRevision】クリア実行時点の committed `lastChangedRevision`（captureEditStartRevision 規約・未書込=0）。
// サーバー validateSetCells がセル単位で照合し、1 セルでも stale なら**全件 reject**する（I-5・AC5）。

import { SETCELLS_MAX_CELLS } from '@nanairo-sheet/core';
import type { SetCellsChange, SetCellsOperation, SheetDocument } from '@nanairo-sheet/core';
import type { CellRange } from '@nanairo-sheet/selection';
import type { ColumnId, RowId } from '@nanairo-sheet/types';

import { captureEditStartRevision } from './commit-bridge';

/**
 * 範囲演算が文書を読むための最小 port（EditingDocumentPort の部分集合＝構造的に互換）。
 * mount-controller が backend（session/view）から構築して渡す。
 */
export interface RangeDocumentPort {
  /** committed（サーバー確定・権威）文書。beforeRevision の捕捉に使う。 */
  getCommittedDocument(): SheetDocument;
  /** 表示値（view=committed+own pending の描画値）。非空判定に使う。 */
  displayText(rowId: RowId, columnId: ColumnId): string;
  /** 表示 index → Id（範囲外/削除済みは undefined＝走査からスキップ）。 */
  rowIdAt(index: number): RowId | undefined;
  colIdAt(index: number): ColumnId | undefined;
}

/** 範囲のセル数（半開区間の面積）。上限判定はこの値で行う（非空セル数ではない＝体感と一致）。 */
export function countRangeCells(range: CellRange): number {
  return Math.max(0, range.rowEnd - range.rowStart) * Math.max(0, range.colEnd - range.colStart);
}

export type RangeClearOutcome =
  /** 1 つの原子的 SetCells として submit する（changes=非空セルのみ・beforeRevision 付き）。 */
  | { readonly kind: 'submit'; readonly operation: SetCellsOperation; readonly cellCount: number }
  /** 範囲セル数が上限超過 → 実行前拒否（走査もしない）。呼び出し側が公開コードで通知する。 */
  | { readonly kind: 'too-large'; readonly cellCount: number; readonly limit: number }
  /** 範囲内が全て空 → 変更なし（submit 不要）。 */
  | { readonly kind: 'noop' };

/**
 * 範囲クリア（blank 敷き詰め）の原子的 SetCells を生成する（DD-020-1 AC5/AC6）。
 * 生成のみで submit はしない（呼び出し側が GridBackendSession.submitLocalOperation へ流す＝commit-bridge と同じ分担）。
 */
export function buildRangeClear(port: RangeDocumentPort, range: CellRange): RangeClearOutcome {
  // 空/逆転レンジは走査前に no-op（Codex[P2]）: 片側 span が 0 以下だと面積（cellCount）が 0 になり上限検査を
  // 通過するが、外側ループは rowEnd-rowStart 回まわる（例: rowEnd=10 億 × colSpan=0 で UI が停止する）。
  // UI 由来のレンジは正規化済み（rangeFromAnchorFocus）だが、本関数は DD-020-2 が再利用する内部 API のため防御する。
  const rowSpan = range.rowEnd - range.rowStart;
  const colSpan = range.colEnd - range.colStart;
  if (rowSpan <= 0 || colSpan <= 0) {
    return { kind: 'noop' };
  }
  const cellCount = rowSpan * colSpan;
  if (cellCount > SETCELLS_MAX_CELLS) {
    return { kind: 'too-large', cellCount, limit: SETCELLS_MAX_CELLS };
  }
  const committed = port.getCommittedDocument();
  const changes: SetCellsChange[] = [];
  for (let rowIndex = range.rowStart; rowIndex < range.rowEnd; rowIndex += 1) {
    const rowId = port.rowIdAt(rowIndex);
    if (rowId === undefined) {
      continue; // 選択後の構造変化などで軸から消えた行はスキップ（無効 RowId へ書かない・#4 と同旨）
    }
    for (let colIndex = range.colStart; colIndex < range.colEnd; colIndex += 1) {
      const columnId = port.colIdAt(colIndex);
      if (columnId === undefined) {
        continue;
      }
      if (port.displayText(rowId, columnId) === '') {
        continue; // 空セルは含めない（blank→blank は結果同一・operation 最小化）
      }
      changes.push({
        rowId,
        columnId,
        beforeRevision: captureEditStartRevision(committed, rowId, columnId),
        value: { kind: 'blank' },
      });
    }
  }
  if (changes.length === 0) {
    return { kind: 'noop' };
  }
  return {
    kind: 'submit',
    operation: { type: 'setCells', conflictPolicy: 'reject-overlap', changes },
    cellCount,
  };
}
