// presence-adapter（DD-005 Phase 3・task 4・シナリオ10）: ClientSession の他者 Presence（UserPresence＝
// RowId/ColumnId 参照・colorKey 文字列）を pocb overlay-layer が描く PresenceUser（表示 index・colorKey 数値）へ
// 変換する純粋関数（DOM 非依存）。presence-sim は統合ページでは使わない（他者分は実サーバー Presence から描く）。
//
// - editingCell を優先し（他者が編集中のセルを強調）、無ければ activeCell を使う。
// - RowId/ColumnId が現在の可視 Axis に無い（別スクロール位置・別ページ）他者は描画しない（index<0 を除外）。
// - selectionRanges は先頭 range を index へ解決（解決できなければ activeCell 単独セル）。

import type { UserPresence } from '@nanairo-sheet/sheet-core';
import type { ColumnId, RowId } from '@nanairo-sheet/sheet-types';

import type { PresenceUser } from '../pocb/presence-sim';

/** RowId/ColumnId → 表示 index の解決器（DocumentView が実装）。 */
export interface PresenceIndexResolver {
  rowIndexOf(rowId: RowId): number;
  colIndexOf(columnId: ColumnId): number;
}

/**
 * サーバー付与の colorKey（文字列）を overlay パレット index（数値）へ。
 * '0'..'7' 等の数値文字列はそのまま、非数値は決定論ハッシュで数値化する（overlay 側で % PALETTE する）。
 */
export function colorKeyToIndex(colorKey: string): number {
  const n = Number(colorKey);
  if (Number.isInteger(n) && n >= 0) {
    return n;
  }
  let h = 0;
  for (let i = 0; i < colorKey.length; i += 1) {
    h = (h * 31 + colorKey.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** UserPresence[] → overlay PresenceUser[]（可視 Axis に解決できる他者のみ）。 */
export function toPresenceUsers(
  presences: readonly UserPresence[],
  resolver: PresenceIndexResolver,
): PresenceUser[] {
  const users: PresenceUser[] = [];
  for (const p of presences) {
    const cell = p.editingCell ?? p.activeCell;
    if (cell === undefined) {
      continue;
    }
    const activeRow = resolver.rowIndexOf(cell.rowId);
    const activeCol = resolver.colIndexOf(cell.columnId);
    if (activeRow < 0 || activeCol < 0) {
      continue; // 現在の可視 Axis に無い他者は描かない
    }
    let selRowStart = activeRow;
    let selRowEnd = activeRow + 1;
    let selColStart = activeCol;
    let selColEnd = activeCol + 1;
    const range = p.selectionRanges[0];
    if (range !== undefined) {
      const r0 = resolver.rowIndexOf(range.startRowId);
      const r1 = resolver.rowIndexOf(range.endRowId);
      const c0 = resolver.colIndexOf(range.startColumnId);
      const c1 = resolver.colIndexOf(range.endColumnId);
      if (r0 >= 0 && r1 >= 0 && c0 >= 0 && c1 >= 0) {
        selRowStart = Math.min(r0, r1);
        selRowEnd = Math.max(r0, r1) + 1;
        selColStart = Math.min(c0, c1);
        selColEnd = Math.max(c0, c1) + 1;
      }
    }
    users.push({
      id: p.connectionId,
      displayName: p.displayName,
      colorKey: colorKeyToIndex(p.colorKey),
      activeRow,
      activeCol,
      selRowStart,
      selRowEnd,
      selColStart,
      selColEnd,
    });
  }
  return users;
}
