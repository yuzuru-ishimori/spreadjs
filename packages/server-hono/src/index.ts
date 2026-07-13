// @nanairo-sheet/server-hono — Facade skeleton（stub）。
//
// DD-011（基盤実装DD）で設置したサーバー側「唯一の公開面」の骨格。consumer は内部パッケージ
// （server/core/types）を直接 import せず、この Facade だけを import する（R1）。
//
// 【B→A 昇格の境界】本ファイルは **stub に留める**。実 API（起動/停止・接続 lifecycle・heartbeat/TTL・
// Room/Sequencer/Presence の実トランスポート配線）は DD-016 で確定する。stub が実 API を固定し始めたら
// Risk Class A へ昇格する（roadmap §2.4）。
//
// 【R7】server の内部型を公開シグネチャへ漏らさない（境界文書 §3/§4.2 R7）。stub は内部依存ゼロ。

/** serve 時オプション（stub。実 Options は DD-016 で確定）。 */
export interface ServeOptions {
  /** listen ポート。 */
  readonly port: number;
}

/**
 * serve が返すハンドル（lifecycle 契約の最小骨格）。
 * 実装（接続 lifecycle・heartbeat/TTL・graceful shutdown）は DD-016。
 */
export interface ServerInstance {
  readonly port: number;
  /** サーバーを停止し接続を解放する。 */
  stop(): Promise<void>;
}

/**
 * Facade skeleton のステージマーカー（contract test / consumer harness 用）。
 */
export const SERVER_HONO_FACADE_STAGE = 'stage1-alpha-skeleton' as const;

/**
 * 同期サーバーを起動する（**stub**）。実装は DD-016。呼び出すと未実装エラーを投げる。
 */
export function serve(options: ServeOptions): ServerInstance {
  void options;
  throw new Error(
    '@nanairo-sheet/server-hono: serve() は Facade skeleton の stub です（実装は DD-016）。',
  );
}
