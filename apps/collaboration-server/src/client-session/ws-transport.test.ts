// DD-015 Phase 1（要確認①）: 指数バックオフ＋ジッタの純粋計算 `nextReconnectDelay` の単体検証。
// トランスポート配線（open 成功でリセット・切断で成長・無期限リトライ）は実 WS 統合テスト
// （test/reconnect-fault.test.ts）で駆動する。ここは乱数注入で決定論的にアルゴリズムを固定する。

import { describe, expect, it } from 'vitest';

import { nextReconnectDelay } from '@nanairo-sheet/collab';

const OPTS = { baseMillis: 1_000, maxMillis: 30_000 };

describe('nextReconnectDelay — 指数バックオフ＋equal jitter（DD-015 要確認①）', () => {
  it('attempt=0: random=0 で下限（base/2）・random→1 で上限（≒base）', () => {
    expect(nextReconnectDelay(0, OPTS, () => 0)).toBe(500); // half = 1000/2
    expect(nextReconnectDelay(0, OPTS, () => 0.999999)).toBe(1_000); // half + half*~1 ≒ base
  });

  it('指数成長: attempt が増えると待機レンジが倍々になる（下限=base*2^n/2）', () => {
    expect(nextReconnectDelay(0, OPTS, () => 0)).toBe(500); // 1000/2
    expect(nextReconnectDelay(1, OPTS, () => 0)).toBe(1_000); // 2000/2
    expect(nextReconnectDelay(2, OPTS, () => 0)).toBe(2_000); // 4000/2
    expect(nextReconnectDelay(3, OPTS, () => 0)).toBe(4_000); // 8000/2
    expect(nextReconnectDelay(4, OPTS, () => 0)).toBe(8_000); // 16000/2
  });

  it('上限 cap: 指数が maxMillis を超えたら maxMillis で頭打ち（上限 30s・要確認①）', () => {
    // base*2^5 = 32000 > 30000 → exp=30000 → range [15000, 30000]
    expect(nextReconnectDelay(5, OPTS, () => 0)).toBe(15_000);
    expect(nextReconnectDelay(5, OPTS, () => 0.999999)).toBe(30_000);
    // 十分大きい attempt でも上限を超えない（無期限リトライで attempt が増え続けても安全）
    expect(nextReconnectDelay(50, OPTS, () => 0.999999)).toBe(30_000);
  });

  it('オーバーフロー安全: 巨大 attempt（2^attempt=Infinity）でも maxMillis で頭打ち', () => {
    expect(nextReconnectDelay(2_000, OPTS, () => 0)).toBe(15_000); // Infinity → min で 30000 → half
    expect(Number.isFinite(nextReconnectDelay(2_000, OPTS, () => 0.5))).toBe(true);
  });

  it('負 attempt は 0 とみなす（防御的）', () => {
    expect(nextReconnectDelay(-3, OPTS, () => 0)).toBe(500);
  });

  it('ジッタは [exp/2, exp) の一様分布（thundering herd 抑止）— random を掃引しレンジ内', () => {
    for (const r of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999]) {
      const d = nextReconnectDelay(2, OPTS, () => r); // exp=4000 → [2000, 4000)
      expect(d).toBeGreaterThanOrEqual(2_000);
      expect(d).toBeLessThanOrEqual(4_000);
    }
  });
});
