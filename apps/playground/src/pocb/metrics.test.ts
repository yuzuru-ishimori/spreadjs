import { describe, expect, it } from 'vitest';

import {
  ACCEPTANCE_THRESHOLDS,
  createAutoScrollPlan,
  evaluateAcceptance,
  frameStats,
  isMemoryStable,
  memoryTrend,
  percentile,
  type AcceptanceInput,
  type MemorySample,
} from './metrics';

describe('metrics: percentile', () => {
  it('既知配列の分位値（nearest-rank）', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(data, 50)).toBe(5);
    expect(percentile(data, 95)).toBe(10);
    expect(percentile(data, 100)).toBe(10);
  });

  it('空配列は 0', () => {
    expect(percentile([], 95)).toBe(0);
  });
});

describe('metrics: frameStats', () => {
  it('p95・worst・33ms超え比率を出す（nearest-rank）', () => {
    // 96 個が 16ms・4 個が 50ms（4% 遅延）→ nearest-rank p95 は 16（上位 5% 未満に遅延が収まる）。
    const intervals = [...Array<number>(96).fill(16), ...Array<number>(4).fill(50)];
    const stats = frameStats(intervals);
    expect(stats.count).toBe(100);
    expect(stats.worst).toBe(50);
    expect(stats.p95).toBe(16);
    expect(stats.over33Ratio).toBeCloseTo(4 / 100, 10);
  });

  it('遅延が 6% を超えると p95 が 33ms 以上へ上がる', () => {
    // 90 個 16ms・10 個 50ms → p95（index 94）は 50。
    const intervals = [...Array<number>(90).fill(16), ...Array<number>(10).fill(50)];
    expect(frameStats(intervals).p95).toBe(50);
  });
});

describe('metrics: memoryTrend / isMemoryStable', () => {
  it('平坦なメモリは傾き≈0で安定', () => {
    const samples: MemorySample[] = Array.from({ length: 10 }, (_v, i) => ({
      t: i * 10000,
      usedBytes: 100_000_000 + (i % 2) * 1000, // ノイズのみ
    }));
    expect(memoryTrend(samples).slopeBytesPerSec).toBeLessThan(
      ACCEPTANCE_THRESHOLDS.memorySlopeBytesPerSec,
    );
    expect(isMemoryStable(samples)).toBe(true);
  });

  it('右肩上がりのメモリは不安定と判定', () => {
    // 10 秒ごとに 10MB 増加 → 1MB/sec ＞ しきい値。
    const samples: MemorySample[] = Array.from({ length: 10 }, (_v, i) => ({
      t: i * 10000,
      usedBytes: 100_000_000 + i * 10_000_000,
    }));
    expect(isMemoryStable(samples)).toBe(false);
  });

  it('毎秒わずかずつの持続的増加も不安定と判定（Codex 指摘の厳格化）', () => {
    // 10 秒ごとに 1MB 増加 → 約 100KB/sec ＞ 64KB/sec しきい値（10 分で約 60MB）。
    const samples: MemorySample[] = Array.from({ length: 60 }, (_v, i) => ({
      t: i * 10000,
      usedBytes: 100_000_000 + i * 1_000_000,
    }));
    expect(isMemoryStable(samples)).toBe(false);
  });
});

describe('metrics: evaluateAcceptance', () => {
  const goodInput: AcceptanceInput = {
    frameIntervalsMs: [...Array<number>(100).fill(16)],
    stoppedRedrawMs: [9, 10, 11],
    selectionLatencyMs: [20, 30, 40],
    memorySamples: Array.from({ length: 5 }, (_v, i) => ({ t: i * 10000, usedBytes: 100_000_000 })),
    anchorMaintained: true,
    visibleCellCount: 2800,
  };

  it('全基準を満たす入力は overall pass', () => {
    const result = evaluateAcceptance(goodInput);
    expect(result.ac1FrameP95.verdict).toBe('pass');
    expect(result.ac2StoppedRedraw.verdict).toBe('pass');
    expect(result.ac3SelectionLatency.verdict).toBe('pass');
    expect(result.ac4MemoryStable.verdict).toBe('pass');
    expect(result.ac5AnchorMaintained.verdict).toBe('pass');
    expect(result.overall).toBe('pass');
  });

  it('遅いフレーム・大きい選択遅延は fail', () => {
    const bad = evaluateAcceptance({
      ...goodInput,
      frameIntervalsMs: [...Array<number>(90).fill(16), ...Array<number>(10).fill(50)],
      selectionLatencyMs: [80],
    });
    expect(bad.ac1FrameP95.verdict).toBe('fail');
    expect(bad.ac3SelectionLatency.verdict).toBe('fail');
    expect(bad.overall).toBe('fail');
  });

  it('データ未採取の基準は n/a（主セッションの実測待ちを表す）', () => {
    const partial = evaluateAcceptance({
      frameIntervalsMs: [],
      stoppedRedrawMs: [],
      selectionLatencyMs: [],
      memorySamples: [],
      anchorMaintained: null,
      visibleCellCount: 0,
    });
    expect(partial.ac1FrameP95.verdict).toBe('n/a');
    expect(partial.ac4MemoryStable.verdict).toBe('n/a');
    expect(partial.ac5AnchorMaintained.verdict).toBe('n/a'); // 未実施
    expect(partial.overall).toBe('n/a'); // fail は無いが全 pass でもない
  });

  it('anchor 未実施（null）だけでも overall は pass にならない', () => {
    const result = evaluateAcceptance({ ...goodInput, anchorMaintained: null });
    expect(result.ac5AnchorMaintained.verdict).toBe('n/a');
    expect(result.overall).toBe('n/a');
  });

  it('可視セル数が目標帯（2,000〜4,000）外なら overall は n/a（負荷条件未達）', () => {
    const outOfBand = evaluateAcceptance({ ...goodInput, visibleCellCount: 500 });
    expect(outOfBand.conditions.inTargetBand).toBe(false);
    expect(outOfBand.ac1FrameP95.verdict).toBe('pass'); // 個別基準は pass のまま
    expect(outOfBand.overall).toBe('n/a'); // が、条件未達なので合格根拠にしない
  });

  it('個別基準が fail なら条件未達より fail が優先', () => {
    const bad = evaluateAcceptance({
      ...goodInput,
      visibleCellCount: 500,
      selectionLatencyMs: [80],
    });
    expect(bad.overall).toBe('fail');
  });
});

describe('metrics: createAutoScrollPlan（三角波往復）', () => {
  const plan = createAutoScrollPlan({ maxScrollTop: 1000, maxScrollLeft: 400, speedPxPerSec: 500 });

  it('t=0 は原点', () => {
    expect(plan(0)).toEqual({ top: 0, left: 0 });
  });

  it('往復して [0,max] に収まる', () => {
    for (let ms = 0; ms <= 20000; ms += 137) {
      const pos = plan(ms);
      expect(pos.top).toBeGreaterThanOrEqual(0);
      expect(pos.top).toBeLessThanOrEqual(1000);
      expect(pos.left).toBeGreaterThanOrEqual(0);
      expect(pos.left).toBeLessThanOrEqual(400);
    }
  });

  it('最初の区間は下方向へ単調増加', () => {
    // speed 500px/s・max1000 → 2 秒で底、その手前は増加。
    expect(plan(1000).top).toBeGreaterThan(plan(500).top);
  });
});
