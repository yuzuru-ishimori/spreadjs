// 再接続バックオフ（DD-015 要確認①・トランスポート非依存の純粋関数）。実 WS（Node ws・collaboration-server）と
// ブラウザー native WebSocket（playground）の両トランスポートが共有し、指数バックオフ＋ジッタの計算乖離を防ぐ。
// 依存ゼロ（Math のみ・Date.now/Math.random 非参照＝乱数は注入）。

export interface BackoffOptions {
  /** 初回（attempt=0）の基準待機ミリ秒。 */
  baseMillis: number;
  /** 上限待機ミリ秒（指数がこれを超えたら頭打ち）。 */
  maxMillis: number;
}

/**
 * 指数バックオフ＋equal jitter の待機時間を計算する（DD-015 要確認①）。
 * - 指数: `base * 2^attempt` を `maxMillis` で cap（attempt は 0 始まり＝初回失敗が 0）。2^attempt のオーバーフローは
 *   cap 前に max で頭打ちして防ぐ（無期限リトライで attempt が増え続けても Infinity 化しない）。
 * - equal jitter: 返り値レンジは `[exp/2, exp)`＝thundering herd 抑止（多数クライアントの同時再接続殺到を分散）。
 *   初回（attempt=0・base=1000）は 500〜1000ms（"初回 1s" ≒ 上限 1s）。
 * @param attempt 連続再接続失敗回数（0 始まり・負値は 0 扱い）。
 * @param random 0..1 を返す注入乱数（既定 Math.random は呼び出し側で渡す＝本関数は純粋）。
 */
export function nextReconnectDelay(attempt: number, opts: BackoffOptions, random: () => number): number {
  const safeAttempt = attempt < 0 ? 0 : attempt;
  const exponential = Math.min(opts.maxMillis, opts.baseMillis * 2 ** safeAttempt);
  const half = exponential / 2;
  const jitter = random() * half; // [0, half)
  return Math.round(half + jitter); // [half, exponential)
}
