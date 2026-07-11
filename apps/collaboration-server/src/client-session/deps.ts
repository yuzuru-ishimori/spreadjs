// 注入依存（決定性のための境界）。ClientSession は Date.now()/Math.random()/setInterval/crypto を直接呼ばず、
// 以下を注入で受け取る（計画書 §7.6 の精神をクライアントへ拡張）。実クロック（Date ベース）や UUID 生成器は
// app 層（Phase 4 collaboration-server の起動コード）で実装して注入する。
//
// 【重要】本ファイルは client-session 本体（session.ts）が import する。sheet-server-core の deps とは**別実体**
// （ミラー）にして、client-session を server-core 非依存に保つ（Phase 1 で sheet-collaboration へ昇格しやすく）。
// import は無し（純粋）。

/** 単調とは限らない時刻源（ミリ秒）。再送タイマー・offline 上限・heartbeat の sentAt に使う。 */
export interface Clock {
  now(): number;
}

/** operationId/transactionId 採番器。既定は決定的連番でテスト再現可能にする（本番は UUID を注入）。 */
export interface IdGenerator {
  next(): string;
}

/** 決定的な連番 IdGenerator（`${prefix}-1`, `${prefix}-2`, ...）。テスト・デフォルト用。 */
export function createCounterIdGenerator(prefix = 'op'): IdGenerator {
  let counter = 0;
  return {
    next(): string {
      counter += 1;
      return `${prefix}-${counter}`;
    },
  };
}
