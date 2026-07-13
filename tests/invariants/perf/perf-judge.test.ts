// DD-012-2 性能／CG-6 判定器の機械検証（headed 実測前でも判定ロジックの正しさを常設テストで担保）。
//
// scripts/cg-perf/perf-judge-core.mjs（回帰予算＝DD-004 実測での再判定）を fixtures で検証する。
// これにより「headed 実測値が来たとき正しく pass/over-budget/fail/n-a を返す」ことを保証し、
// 予算表（perf-budget.json）と判定器がずれていないことを常設スイートで守る。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// @ts-expect-error mjs（型宣言なし・ランタイム純関数）を vitest から読む。
import { judgePerfReport, judgeMemoryReport, loadBudget } from '../../../scripts/cg-perf/perf-judge-core.mjs';

const FIX = (name: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../../scripts/cg-perf/fixtures/${name}`, import.meta.url)), 'utf8'),
  );

describe('invariant/perf: 回帰予算判定器（DD-012-2 headed ゲートの判定コア）', () => {
  it('予算内レポートは perf/memory ともに pass', () => {
    const r = FIX('perf-report-pass.json');
    expect(judgePerfReport(r).overall).toBe('pass');
    expect(judgeMemoryReport(r).overall).toBe('pass');
  });

  it('回帰予算超過（§18.2 上限内）は over-budget＝再ゲート扱い', () => {
    const r = FIX('perf-report-over-budget.json');
    const perf = judgePerfReport(r);
    expect(perf.overall).toBe('over-budget');
    expect(perf.overall).not.toBe('pass');
  });

  it('§18.2 機能上限超過は fail・メモリ 300MB 超も fail', () => {
    const r = FIX('perf-report-fail.json');
    expect(judgePerfReport(r).overall).toBe('fail');
    expect(judgeMemoryReport(r).overall).toBe('fail');
  });

  it('負荷条件（可視セル帯）未達・可視セル未取得は合格根拠にしない（n/a）', () => {
    expect(judgePerfReport(FIX('perf-report-condition-unmet.json')).overall).toBe('n/a');
  });

  it('部分採取（scroll 未計測 frame.count=0）は pass にしない（overall n/a）', () => {
    // Codex P1: 未計測を可視セル/メモリだけで pass にしない。
    expect(judgePerfReport(FIX('perf-report-partial.json')).overall).toBe('n/a');
  });

  it('メモリ短時間・少標本はリーク判定できず memory overall n/a（誤解除防止）', () => {
    // Codex P1: 10 秒平坦標本での CG-6 誤解除を防ぐ。ピークが 300MB 内でも n/a。
    const m = judgeMemoryReport(FIX('memory-short.json'));
    expect(m.leak.verdict).toBe('n/a');
    expect(m.overall).toBe('n/a');
  });

  it('scroll/selection 機能上限はちょうど 33/50ms でも fail（strict・§18.2）', () => {
    const budget = loadBudget();
    const rp95 = { visibleCellCount: 3000, frame: { count: 100, p95: 33 }, stoppedRedrawMs: [0.3], selectionLatencyMs: [10] };
    expect(judgePerfReport(rp95, budget).overall).toBe('fail');
    const rsel = { visibleCellCount: 3000, frame: { count: 100, p95: 10 }, stoppedRedrawMs: [0.3], selectionLatencyMs: [50] };
    expect(judgePerfReport(rsel, budget).overall).toBe('fail');
  });

  it('予算・受け入れ条件の正典値ピン（緩める＝spec 変更・Codex P2）', () => {
    const b = loadBudget() as {
      budget: { scrollFrameP95Ms: number; selectionLatencyMs: number; stoppedRedrawMeanMs: number; memoryPeakMB: number };
      hardCeiling: { scrollFrameP95Ms: number; selectionLatencyMs: number; stoppedRedrawMeanMs: number };
      noiseMargin: { timingPct: number; memoryPct: number };
      conditions: { visibleCellBand: { min: number; max: number }; rows: number; cols: number };
      leakTrend: { slopeBytesPerSecMax: number; growthRatioMax: number; minSamples: number; minDurationSec: number };
    };
    // 合格ライン。
    expect(b.budget.scrollFrameP95Ms).toBe(16.8);
    expect(b.budget.selectionLatencyMs).toBe(16.9);
    expect(b.budget.stoppedRedrawMeanMs).toBe(0.33);
    expect(b.budget.memoryPeakMB).toBe(300);
    // §18.2 機能上限（floor）。
    expect(b.hardCeiling.scrollFrameP95Ms).toBe(33);
    expect(b.hardCeiling.selectionLatencyMs).toBe(50);
    expect(b.hardCeiling.stoppedRedrawMeanMs).toBe(12);
    // ノイズマージン（緩める＝spec 変更）。
    expect(b.noiseMargin.timingPct).toBe(20);
    expect(b.noiseMargin.memoryPct).toBe(0);
    // 計測条件（負荷条件・帯を勝手に広げない）。
    expect(b.conditions.visibleCellBand).toEqual({ min: 2000, max: 4000 });
    expect(b.conditions.rows).toBe(50000);
    expect(b.conditions.cols).toBe(200);
    // リーク傾向しきい値・計測下限。
    expect(b.leakTrend.slopeBytesPerSecMax).toBe(65536);
    expect(b.leakTrend.growthRatioMax).toBe(1.25);
    expect(b.leakTrend.minSamples).toBe(8);
    expect(b.leakTrend.minDurationSec).toBe(90);
  });
});
