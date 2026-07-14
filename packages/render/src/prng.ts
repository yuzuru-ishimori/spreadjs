// 決定論擬似乱数（seed 付き）。計画書 §18.2/§21 のデータ生成・Presence 模擬を
// 再現可能にするために使う。DOM 非依存・依存ゼロ。
//
// アルゴリズムは mulberry32（32bit・高速・十分な分布）。暗号用途ではない（計測用）。

/** 決定論 PRNG。同一 seed から常に同一列を返す。 */
export interface Prng {
  /** [0, 1) の浮動小数。 */
  next(): number;
  /** [0, maxExclusive) の整数（maxExclusive<=0 は 0 を返す）。 */
  nextInt(maxExclusive: number): number;
  /** [min, max] の整数（両端含む）。 */
  nextIntBetween(min: number, max: number): number;
  /** 配列から 1 要素を選ぶ（空配列は例外）。 */
  pick<T>(items: readonly T[]): T;
}

/** seed から PRNG を生成する。 */
export function createPrng(seed: number): Prng {
  // 32bit 符号なしへ丸める。
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const nextInt = (maxExclusive: number): number => {
    if (maxExclusive <= 0) {
      return 0;
    }
    return Math.floor(next() * maxExclusive);
  };

  return {
    next,
    nextInt,
    nextIntBetween(min, max) {
      if (max < min) {
        return min;
      }
      return min + nextInt(max - min + 1);
    },
    pick(items) {
      if (items.length === 0) {
        throw new Error('pick: 空配列からは選べません');
      }
      const chosen = items[nextInt(items.length)];
      if (chosen === undefined) {
        // items.length>0 かつ index<length のため到達しないが、型を絞るためのガード。
        throw new Error('pick: 要素の取得に失敗しました');
      }
      return chosen;
    },
  };
}
