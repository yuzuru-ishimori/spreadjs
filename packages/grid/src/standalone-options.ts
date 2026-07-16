// 単独グリッドモード（DD-024）の options 検証（DOM 非依存の純関数）。
//
// 判別 union（案a・決定①）で型レベルの排他は担保されるが、JS 経路（非リテラル）では server 系 options の
// 混在・columnOrder 欠落が起こりうる。これを config phase の公開エラーコードへ写して fail-fast する
// （contract §4）。mount-controller から呼ばれ、単体テスト可能に切り出す（AC6）。

import type { GridErrorCode } from './error-codes';

/**
 * 単独モード options を検証し、違反時は公開エラーコードを返す（正常は undefined）。
 * - server 系 options（serverUrl/displayName/clientId）の混在 → 'standalone-options-conflict'
 *   （単独モードは認証・保存が全面的に利用側＝roadmap §6・server 系は責務境界違反）。
 * - columnOrder が未指定/非配列/空 → 'standalone-options-invalid'（/config が無く列順は必須）。
 */
export function validateStandaloneOptions(options: unknown): GridErrorCode | undefined {
  const raw = (options ?? {}) as Record<string, unknown>;
  if (raw.serverUrl !== undefined || raw.displayName !== undefined || raw.clientId !== undefined) {
    return 'standalone-options-conflict';
  }
  const cols = raw.columnOrder;
  if (!Array.isArray(cols) || cols.length === 0) {
    return 'standalone-options-invalid';
  }
  return undefined;
}
