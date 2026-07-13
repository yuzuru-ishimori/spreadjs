// DD-012-2 統合性能回帰ゲート／CG-6 の判定コア（純関数・DOM 非依存）。
//
// headed 実測（人手セッション）で pocb 計測ハーネス（apps/playground/src/pocb/{harness,metrics}.ts）の
// エクスポート JSON を採取し、本コアが DD-004 実測予算（scripts/cg-perf/perf-budget.json）で再判定する。
// pocb の evaluateAcceptance は §18.2 の緩い機能上限（33/12/50ms）で判定するため、本コアは
// それより厳しい「回帰予算（DD-004 実測＝16.8/16.9/0.33ms・300MB）」で二段判定する:
//   - regression budget 超過（noiseMargin 込み）  → verdict='over-budget'（回帰の疑い・再ゲート）
//   - hardCeiling（§18.2 機能上限）超過           → verdict='fail'（機能不成立）
//   - いずれも満たす                              → verdict='pass'
//
// CG-6（メモリ）は単発ピーク（memoryPeakMB）と リーク傾向（slope・growthRatio）の AND で判定する。
//
// 判定ロジックは fixtures（scripts/cg-perf/fixtures/）と tests/invariants/perf/perf-judge.test.ts で
// 機械検証済み。headed 実測前でも判定器の正しさは常設テストで担保する。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUDGET_PATH = path.join(HERE, 'perf-budget.json');

/** 正典の性能予算を読む。 */
export function loadBudget() {
  return JSON.parse(fs.readFileSync(BUDGET_PATH, 'utf8'));
}

function withMargin(value, marginPct) {
  return value * (1 + marginPct / 100);
}

function mean(xs) {
  if (!xs || xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function max(xs) {
  if (!xs || xs.length === 0) return null;
  return Math.max(...xs);
}

/**
 * pocb ハーネスのエクスポート JSON（{ frame, stoppedRedrawMs, selectionLatencyMs, memory, ... }）を
 * 回帰予算で判定する。1 メトリクスの結果は { name, value, budget, ceiling, verdict, hasData }。
 */
export function judgePerfReport(report, budget = loadBudget()) {
  const b = budget.budget;
  const ceil = budget.hardCeiling;
  const tMargin = budget.noiseMargin.timingPct;

  // scroll p95 は frame.count > 0（自動スクロール中フレームを採取した）ときのみ有効。
  // 未採取だと frame.p95=0 が来て「0 ≤ 予算」で誤 pass する（Codex P1）。
  const frameCount = report?.frame?.count ?? 0;
  const scrollP95 = frameCount > 0 ? (report?.frame?.p95 ?? null) : null;
  const selectionWorst = max(report?.selectionLatencyMs);
  const redrawMean = mean(report?.stoppedRedrawMs);

  const metrics = [
    // scroll・selection は §18.2 が `<33ms`・`<50ms`＝上限ちょうども fail（strict）。再描画は `≤12ms`。
    metric('scrollFrameP95Ms', scrollP95, b.scrollFrameP95Ms, ceil.scrollFrameP95Ms, tMargin, true),
    metric('selectionLatencyMs', selectionWorst, b.selectionLatencyMs, ceil.selectionLatencyMs, tMargin, true),
    metric('stoppedRedrawMeanMs', redrawMean, b.stoppedRedrawMeanMs, ceil.stoppedRedrawMeanMs, tMargin, false),
  ];

  // 可視セル帯（負荷条件）チェック: 帯外・未取得（0/欠落）は条件未達＝合格根拠にしない（Codex P2）。
  const visible = report?.visibleCellCount ?? report?.acceptance?.conditions?.visibleCellCount ?? 0;
  const band = budget.conditions.visibleCellBand;
  const inBand = visible >= band.min && visible <= band.max;
  const conditionUnmet = !inBand; // 0/欠落も !inBand ＝未達

  const overall = rollup(metrics, conditionUnmet);
  return { kind: 'perf', metrics, conditions: { visibleCellCount: visible, inBand }, overall };
}

function metric(name, value, budgetVal, ceilingVal, marginPct, ceilingStrict) {
  if (value === null || value === undefined) {
    return { name, value: null, budget: budgetVal, ceiling: ceilingVal, verdict: 'n/a', hasData: false };
  }
  let verdict = 'pass';
  const ceilingExceeded = ceilingStrict ? value >= ceilingVal : value > ceilingVal;
  if (ceilingExceeded) verdict = 'fail';
  else if (value > withMargin(budgetVal, marginPct)) verdict = 'over-budget';
  return {
    name,
    value,
    budget: budgetVal,
    budgetWithMargin: Number(withMargin(budgetVal, marginPct).toFixed(4)),
    ceiling: ceilingVal,
    ceilingStrict,
    verdict,
    hasData: true,
  };
}

function rollup(metrics, conditionUnmet) {
  const withData = metrics.filter((m) => m.hasData);
  if (withData.some((m) => m.verdict === 'fail')) return 'fail';
  if (withData.some((m) => m.verdict === 'over-budget')) return 'over-budget';
  if (conditionUnmet) return 'n/a';
  // pass は 3 メトリクスすべてに標本があるときのみ（未計測を pass にしない・Codex P1）。
  if (withData.length < metrics.length) return 'n/a';
  return withData.every((m) => m.verdict === 'pass') ? 'pass' : 'n/a';
}

/**
 * CG-6 メモリ判定。report.memory.samples（[{t,usedBytes}]）と trend（slope/growthRatio）を使う。
 * 単発ピーク ≤ memoryPeakMB かつ リーク傾向（slope・growthRatio）内 の AND。
 */
export function judgeMemoryReport(report, budget = loadBudget()) {
  const b = budget.budget;
  const lt = budget.leakTrend;
  const mMargin = budget.noiseMargin.memoryPct;
  const samples = report?.memory?.samples ?? [];
  const trend = report?.memory?.trend ?? {};

  const peakBytes = samples.length > 0 ? Math.max(...samples.map((s) => s.usedBytes)) : null;
  const peakMB = peakBytes === null ? null : peakBytes / (1024 * 1024);
  const peakBudget = withMargin(b.memoryPeakMB, mMargin);

  const slope = trend.slopeBytesPerSec ?? null;
  const growth = trend.growthRatio ?? null;
  // 計測時間（時系列の張る秒数）。10 秒だけ平坦な標本で誤解除しないための下限（Codex P1）。
  const times = samples.map((s) => s.t).filter((t) => typeof t === 'number');
  const durationSec = times.length >= 2 ? (Math.max(...times) - Math.min(...times)) / 1000 : 0;
  // リーク判定は「十分な標本数 AND 十分な計測時間 AND slope・growthRatio が両方とも有限」でのみ可能。
  const hasTrend =
    samples.length >= lt.minSamples &&
    durationSec >= lt.minDurationSec &&
    Number.isFinite(slope) &&
    Number.isFinite(growth);

  const peakVerdict = peakMB === null ? 'n/a' : peakMB <= peakBudget ? 'pass' : 'fail';
  // growthRatio 欠落は n/a（slope だけで通さない・Codex P2）。両方が有限で範囲内のときのみ pass。
  const leakOk = hasTrend && slope < lt.slopeBytesPerSecMax && growth < lt.growthRatioMax;
  const leakVerdict = !hasTrend ? 'n/a' : leakOk ? 'pass' : 'fail';

  let overall = 'n/a';
  if (peakVerdict === 'fail' || leakVerdict === 'fail') overall = 'fail';
  else if (peakVerdict === 'pass' && leakVerdict === 'pass') overall = 'pass';

  return {
    kind: 'memory',
    peak: { valueMB: peakMB === null ? null : Number(peakMB.toFixed(1)), budgetMB: b.memoryPeakMB, verdict: peakVerdict },
    leak: {
      slopeBytesPerSec: slope,
      growthRatio: growth,
      slopeMax: lt.slopeBytesPerSecMax,
      growthRatioMax: lt.growthRatioMax,
      sampleCount: samples.length,
      durationSec: Number(durationSec.toFixed(1)),
      minSamples: lt.minSamples,
      minDurationSec: lt.minDurationSec,
      verdict: leakVerdict,
    },
    overall,
  };
}
