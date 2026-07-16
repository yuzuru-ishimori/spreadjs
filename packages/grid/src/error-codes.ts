// grid Facade の安定エラーコード語彙（Experimental 0.x・ADR-0015）。
//
// 内部 protocol の RejectCode / 内部文字列を consumer へ素通ししない（R7）。公開語彙へ写像し、未知コードは
// 'unknown' フォールバックで前方互換を保つ（内部 RejectCode の追加で consumer の分岐が壊れない）。破壊的変更は
// CHANGELOG に記録する（S1-5・ADR-0015 D1）。本ファイルは DOM/内部 package 非依存で単体テスト可能に保つ。

/** error イベント（boot/transport 失敗）の安定コード。phase と対で consumer の障害切り分けに使う。 */
export const GRID_ERROR_CODES = [
  'config-unavailable', // /config 取得に失敗（ネットワーク/HTTP エラー・config phase）
  'config-invalid', // /config の形式が不正（config phase）
  'connect-failed', // 初回 WS 接続の確立に失敗（connect phase）
  'runtime-fault', // 配線後の予期しない実行時例外（runtime phase）
  'standalone-options-conflict', // 単独モードに server 系 options（serverUrl/displayName/clientId）を混在指定（config phase・DD-024）
  'standalone-options-invalid', // 単独モードで columnOrder が未指定/空（config phase・DD-024）
] as const;
export type GridErrorCode = (typeof GRID_ERROR_CODES)[number];

/** rejected イベント（server 競合）の安定コード。内部 RejectCode / ConflictReason を写像する。 */
export const GRID_CONFLICT_CODES = [
  'cell-conflict', // 同一セルの同時編集競合（stale-cell-revision）
  'row-unavailable', // 対象行が存在しない/削除済み（target-row-deleted / unknown-row / unknown-anchor）
  'column-unavailable', // 対象列が存在しない（unknown-column）
  'revision-stale', // ベースリビジョン不整合（invalid-base-revision）
  'sequence-violation', // クライアント連番違反（client-sequence-violation）
  'duplicate-row', // 行 ID 重複（duplicate-row）
  'revalidation-failed', // ローカル再検証に失敗（reason=revalidation-failed）
  'dependency', // 依存 Op の失敗に連鎖して不成立（reason=dependency）
  'unknown', // 未知/未写像（前方互換フォールバック）
] as const;
export type GridConflictCode = (typeof GRID_CONFLICT_CODES)[number];

/**
 * boot 失敗を error phase の公開 code 付きで伝える内部エラー。mount-controller の boot が throw し、
 * 呼び出し側が code を error イベントへ載せる（内部 message 文字列からの脆い判定を避ける）。
 */
export class GridBootError extends Error {
  constructor(
    readonly code: GridErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GridBootError';
  }
}

// server RejectCode（core protocol §3）→ 公開 GridConflictCode の写像表。ここに無い code は 'unknown'。
const REJECT_CODE_MAP: Record<string, GridConflictCode> = {
  'stale-cell-revision': 'cell-conflict',
  'target-row-deleted': 'row-unavailable',
  'unknown-row': 'row-unavailable',
  'unknown-anchor': 'row-unavailable',
  'unknown-column': 'column-unavailable',
  'invalid-base-revision': 'revision-stale',
  'client-sequence-violation': 'sequence-violation',
  'duplicate-row': 'duplicate-row',
};

/**
 * 内部 ConflictReason（'rejected' | 'revalidation-failed' | 'dependency'）と server RejectCode 文字列を
 * 公開 GridConflictCode へ写像する。未知 RejectCode は 'unknown'（前方互換）。
 */
export function toGridConflictCode(reason: string, rawCode: string | undefined): GridConflictCode {
  if (reason === 'revalidation-failed') {
    return 'revalidation-failed';
  }
  if (reason === 'dependency') {
    return 'dependency';
  }
  // reason === 'rejected'（server 判定）: RejectCode を公開語彙へ写像する。
  const mapped = rawCode === undefined ? undefined : REJECT_CODE_MAP[rawCode];
  return mapped ?? 'unknown';
}
