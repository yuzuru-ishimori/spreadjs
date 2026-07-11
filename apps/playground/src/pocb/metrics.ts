// 計測ハーネスの純粋コア（計画書 §18.2 合格条件・§21 性能目標）。
// fps 分位・停止中再描画・選択遅延・メモリ傾向・自動スクロール計画・合否自動判定を
// DOM 非依存の純粋関数として実装し、vitest で機械検証する。
// 実ブラウザーでのサンプル採取（rAF ループ・performance.memory・実スクロール）は
// main.ts の計測ドライバーが本モジュールの関数へ値を供給して行う（headed 実測は主セッション）。

/** 合格しきい値（§18.2）。 */
export const ACCEPTANCE_THRESHOLDS = {
  /** AC1: 95% フレームが 33ms 未満（p95<33）。 */
  frameP95Ms: 33,
  /** AC2: 停止中 full 再描画の目標（8〜12ms）。上限 12ms を判定に使う。 */
  stoppedRedrawMaxMs: 12,
  /** AC3: pointer→選択枠 50ms 未満。 */
  selectionLatencyMs: 50,
  /**
   * AC4: メモリ増加傾向のしきい値（bytes/sec）。これ未満なら「単調増加でない」の必要条件。
   * 64KB/s は 10 分で約 38MB。緩すぎる 512KB/s（=300MB/10分）を Codex 指摘で厳格化。
   */
  memorySlopeBytesPerSec: 64 * 1024,
  /** AC4: 末尾/先頭の増加率上限（傾き条件と AND で判定。後半の非線形スパイクも捕える）。 */
  memoryGrowthRatioMax: 1.25,
  /** 計測条件: 可視セル数の目標帯（§18.2）。範囲外は負荷条件未達として overall を n/a に落とす。 */
  visibleCellMin: 2000,
  visibleCellMax: 4000,
} as const;

/** 昇順ソートして nearest-rank 方式の分位値を返す。 */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) {
    return 0;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index] ?? 0;
}

export interface FrameStats {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly worst: number;
  readonly mean: number;
  /** 33ms 以上のフレーム比率（0〜1）。 */
  readonly over33Ratio: number;
}

/** フレーム間隔（ms）列から統計を出す。 */
export function frameStats(intervalsMs: readonly number[]): FrameStats {
  const count = intervalsMs.length;
  if (count === 0) {
    return { count: 0, p50: 0, p95: 0, worst: 0, mean: 0, over33Ratio: 0 };
  }
  let sum = 0;
  let worst = 0;
  let over = 0;
  for (const v of intervalsMs) {
    sum += v;
    if (v > worst) {
      worst = v;
    }
    if (v >= ACCEPTANCE_THRESHOLDS.frameP95Ms) {
      over += 1;
    }
  }
  return {
    count,
    p50: percentile(intervalsMs, 50),
    p95: percentile(intervalsMs, 95),
    worst,
    mean: sum / count,
    over33Ratio: over / count,
  };
}

export interface MemorySample {
  /** 経過時間（ms）。 */
  readonly t: number;
  readonly usedBytes: number;
}

export interface MemoryTrend {
  /** 線形回帰の傾き（bytes/sec）。 */
  readonly slopeBytesPerSec: number;
  /** 末尾 / 先頭 の増加率。 */
  readonly growthRatio: number;
}

/** メモリサンプルの傾き（bytes/sec）と増加率を線形回帰で求める。 */
export function memoryTrend(samples: readonly MemorySample[]): MemoryTrend {
  if (samples.length < 2) {
    return { slopeBytesPerSec: 0, growthRatio: 1 };
  }
  const n = samples.length;
  let sumT = 0;
  let sumY = 0;
  let sumTT = 0;
  let sumTY = 0;
  for (const s of samples) {
    sumT += s.t;
    sumY += s.usedBytes;
    sumTT += s.t * s.t;
    sumTY += s.t * s.usedBytes;
  }
  const denom = n * sumTT - sumT * sumT;
  const slopePerMs = denom === 0 ? 0 : (n * sumTY - sumT * sumY) / denom;
  const first = samples[0]?.usedBytes ?? 0;
  const last = samples[n - 1]?.usedBytes ?? 0;
  return {
    slopeBytesPerSec: slopePerMs * 1000,
    growthRatio: first === 0 ? 1 : last / first,
  };
}

/**
 * メモリが「単調増加でない」か。傾き（bytes/sec）と末尾/先頭の増加率の AND で判定する。
 * 傾きだけだと「毎秒わずかずつ確実に増える」持続的リークを見逃す（Codex 指摘）ため、増加率も併用する。
 */
export function isMemoryStable(samples: readonly MemorySample[]): boolean {
  const trend = memoryTrend(samples);
  return (
    trend.slopeBytesPerSec < ACCEPTANCE_THRESHOLDS.memorySlopeBytesPerSec &&
    trend.growthRatio < ACCEPTANCE_THRESHOLDS.memoryGrowthRatioMax
  );
}

/** 合否判定の入力（各サンプルは計測ドライバーが採取）。 */
export interface AcceptanceInput {
  readonly frameIntervalsMs: readonly number[];
  readonly stoppedRedrawMs: readonly number[];
  readonly selectionLatencyMs: readonly number[];
  readonly memorySamples: readonly MemorySample[];
  /** anchor 検証の実施結果。未実施は null（＝AC5 は n/a）。 */
  readonly anchorMaintained: boolean | null;
  readonly visibleCellCount: number;
}

export type Verdict = 'pass' | 'fail' | 'n/a';

export interface AcceptanceResult {
  readonly ac1FrameP95: { value: number; threshold: number; verdict: Verdict };
  readonly ac2StoppedRedraw: { value: number; threshold: number; verdict: Verdict };
  readonly ac3SelectionLatency: { value: number; threshold: number; verdict: Verdict };
  readonly ac4MemoryStable: {
    slopeBytesPerSec: number;
    growthRatio: number;
    threshold: number;
    verdict: Verdict;
  };
  readonly ac5AnchorMaintained: { verdict: Verdict };
  /** 計測条件（可視セル数が目標帯にあるか）。範囲外だと overall を n/a に落とす。 */
  readonly conditions: { visibleCellCount: number; inTargetBand: boolean };
  readonly overall: Verdict;
}

function verdictFrom(pass: boolean, hasData: boolean): Verdict {
  if (!hasData) {
    return 'n/a';
  }
  return pass ? 'pass' : 'fail';
}

/** §18.2 の合格条件1〜5を自動判定する。データ未採取の基準・条件未達は 'n/a'。 */
export function evaluateAcceptance(input: AcceptanceInput): AcceptanceResult {
  const frame = frameStats(input.frameIntervalsMs);
  const stoppedMean =
    input.stoppedRedrawMs.length === 0
      ? 0
      : input.stoppedRedrawMs.reduce((a, b) => a + b, 0) / input.stoppedRedrawMs.length;
  const selectionWorst =
    input.selectionLatencyMs.length === 0 ? 0 : Math.max(...input.selectionLatencyMs);
  const trend = memoryTrend(input.memorySamples);

  const ac1 = verdictFrom(
    frame.p95 < ACCEPTANCE_THRESHOLDS.frameP95Ms,
    input.frameIntervalsMs.length > 0,
  );
  const ac2 = verdictFrom(
    stoppedMean <= ACCEPTANCE_THRESHOLDS.stoppedRedrawMaxMs,
    input.stoppedRedrawMs.length > 0,
  );
  const ac3 = verdictFrom(
    selectionWorst < ACCEPTANCE_THRESHOLDS.selectionLatencyMs,
    input.selectionLatencyMs.length > 0,
  );
  const ac4 = verdictFrom(isMemoryStable(input.memorySamples), input.memorySamples.length >= 2);
  // AC5: 未実施（null）は n/a、実施済みは真偽で pass/fail。
  const ac5: Verdict =
    input.anchorMaintained === null ? 'n/a' : input.anchorMaintained ? 'pass' : 'fail';

  // 計測条件: 可視セル数が目標帯（2,000〜4,000）にあるか。未計測(0)は判定対象外（他の n/a に委ねる）。
  const inTargetBand =
    input.visibleCellCount >= ACCEPTANCE_THRESHOLDS.visibleCellMin &&
    input.visibleCellCount <= ACCEPTANCE_THRESHOLDS.visibleCellMax;
  const conditionsUnmet = input.visibleCellCount > 0 && !inTargetBand;

  const verdicts = [ac1, ac2, ac3, ac4, ac5];
  const overall: Verdict = verdicts.includes('fail')
    ? 'fail'
    : conditionsUnmet
      ? 'n/a' // 負荷条件（可視セル数）未達の測定は合格根拠にしない
      : verdicts.every((v) => v === 'pass')
        ? 'pass'
        : 'n/a';

  return {
    ac1FrameP95: { value: frame.p95, threshold: ACCEPTANCE_THRESHOLDS.frameP95Ms, verdict: ac1 },
    ac2StoppedRedraw: {
      value: stoppedMean,
      threshold: ACCEPTANCE_THRESHOLDS.stoppedRedrawMaxMs,
      verdict: ac2,
    },
    ac3SelectionLatency: {
      value: selectionWorst,
      threshold: ACCEPTANCE_THRESHOLDS.selectionLatencyMs,
      verdict: ac3,
    },
    ac4MemoryStable: {
      slopeBytesPerSec: trend.slopeBytesPerSec,
      growthRatio: trend.growthRatio,
      threshold: ACCEPTANCE_THRESHOLDS.memorySlopeBytesPerSec,
      verdict: ac4,
    },
    ac5AnchorMaintained: { verdict: ac5 },
    conditions: { visibleCellCount: input.visibleCellCount, inTargetBand },
    overall,
  };
}

export interface AutoScrollPlanConfig {
  readonly maxScrollTop: number;
  readonly maxScrollLeft: number;
  readonly speedPxPerSec: number;
}

export interface ScrollPosition {
  readonly top: number;
  readonly left: number;
}

/**
 * 自動スクロールドライバーの位置計画（純粋関数）。縦方向を三角波で往復させ、
 * 10 分連続スクロール（AC4）や通常速度スクロール（AC1）を決定論的に再現する。
 */
export function createAutoScrollPlan(config: AutoScrollPlanConfig): (elapsedMs: number) => ScrollPosition {
  const { maxScrollTop, maxScrollLeft, speedPxPerSec } = config;
  const triangle = (distance: number, span: number): number => {
    if (span <= 0) {
      return 0;
    }
    const period = 2 * span;
    const phase = ((distance % period) + period) % period;
    return phase <= span ? phase : period - phase;
  };
  return (elapsedMs: number): ScrollPosition => {
    const distance = (Math.max(elapsedMs, 0) / 1000) * speedPxPerSec;
    return {
      top: triangle(distance, maxScrollTop),
      // 横は縦の 1/4 速度でゆっくり往復させ、横スクロール描画も混ぜる。
      left: triangle(distance / 4, maxScrollLeft),
    };
  };
}
