// 注入依存（決定性のための境界）。Room/Sequencer/Presence は Date.now()/Math.random()/setInterval を
// 直接呼ばず、以下を注入で受け取る（計画書 §7.6 は apply の制約だが、サーバー状態管理もテスト再現性のため注入する）。
// 実クロック（Date ベース）や乱数 ID は app 層（Phase 4 collaboration-server）で実装して注入する。

/** 単調とは限らない時刻源（ミリ秒）。TTL 判定・acceptedAt に使う。テストは手動クロックで任意に進める。 */
export interface Clock {
  now(): number;
}

/** connectionId 払い出し器。既定は決定的連番でテスト再現可能にする（本番は乱数/UUID を注入）。 */
export interface IdGenerator {
  next(): string;
}

/** 決定的な連番 IdGenerator（`${prefix}-1`, `${prefix}-2`, ...）。テスト・デフォルト用。 */
export function createCounterIdGenerator(prefix = 'conn'): IdGenerator {
  let counter = 0;
  return {
    next(): string {
      counter += 1;
      return `${prefix}-${counter}`;
    },
  };
}
