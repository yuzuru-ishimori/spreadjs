// 計測ドライバー（計画書 §18.2 合格条件の自動採取）。metrics.ts の純粋関数へ実測サンプルを供給する。
// 実ブラウザーでの採取（rAF 間隔・performance.memory・自動スクロール）を担うため DOM/perf に依存する。
//
// 役割分担: 本ドライバーは「採取と自動判定の仕組み」まで。合否の実測値記入（headed 実ウィンドウでの
// fps/メモリ）は主セッションが Playwright MCP で本ドライバーを操作して行う（DD-002 と同運用）。

import {
  createAutoScrollPlan,
  evaluateAcceptance,
  frameStats,
  memoryTrend,
  type AcceptanceInput,
  type AcceptanceResult,
  type MemorySample,
} from './metrics';

interface PerfMemory {
  readonly usedJSHeapSize: number;
  readonly totalJSHeapSize: number;
  readonly jsHeapSizeLimit: number;
}

/** performance.memory（Chromium 限定）から usedJSHeapSize を読む。非対応なら null。 */
export function readUsedHeapBytes(): number | null {
  const perf = performance as Performance & { memory?: PerfMemory };
  return perf.memory?.usedJSHeapSize ?? null;
}

/** 計測レポートに残す端末・環境情報（要確認1: 参照端末＝本機）。 */
export interface HarnessEnv {
  readonly userAgent: string;
  readonly devicePixelRatio: number;
  readonly hardwareConcurrency: number;
  readonly deviceMemoryGb: number | null;
  readonly windowInnerWidth: number;
  readonly windowInnerHeight: number;
  readonly capturedAt: string;
}

export function collectEnv(): HarnessEnv {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGb: nav.deviceMemory ?? null,
    windowInnerWidth: window.innerWidth,
    windowInnerHeight: window.innerHeight,
    capturedAt: new Date().toISOString(),
  };
}

export interface AutoScrollConfig {
  readonly maxScrollTop: number;
  readonly maxScrollLeft: number;
  readonly speedPxPerSec: number;
}

/** onFrame の戻り: 自動スクロール中なら適用すべきスクロール位置。 */
export interface FrameOutcome {
  readonly scroll: { top: number; left: number } | null;
}

export interface MeasurementHarness {
  /** rAF ごとに呼ぶ。フレーム間隔記録・メモリ定期サンプリング・自動スクロール位置算出を行う。 */
  onFrame(nowMs: number): FrameOutcome;
  startAutoScroll(config: AutoScrollConfig): void;
  stopAutoScroll(): void;
  isAutoScrolling(): boolean;
  /** 停止中 full 再描画の所要（ms）を記録する。 */
  recordStoppedRedraw(ms: number): void;
  /** pointer→選択枠表示の遅延（ms）を記録する。 */
  recordSelectionLatency(ms: number): void;
  /** 現在の採取をクリアする。 */
  reset(): void;
  /** 採取済みサンプルから合否判定入力を組み立てる（anchor 未実施は null）。 */
  buildInput(anchorMaintained: boolean | null, visibleCellCount: number): AcceptanceInput;
  /** 合否判定＋環境＋サマリを JSON 文字列で返す（エクスポート用。anchor 未実施は null）。 */
  toReportJson(anchorMaintained: boolean | null, visibleCellCount: number): string;
  /** ライブ表示用の要約。 */
  summary(): HarnessSummary;
}

export interface HarnessSummary {
  readonly frameCount: number;
  readonly frameP95: number;
  readonly frameWorst: number;
  readonly stoppedRedrawMean: number;
  readonly selectionWorst: number;
  readonly memorySampleCount: number;
  readonly memorySlopeBytesPerSec: number;
  readonly autoScrolling: boolean;
}

const MEMORY_SAMPLE_INTERVAL_MS = 10_000;

export function createMeasurementHarness(): MeasurementHarness {
  let frameIntervals: number[] = [];
  let stoppedRedrawMs: number[] = [];
  let selectionLatencyMs: number[] = [];
  let memorySamples: MemorySample[] = [];

  let lastFrameNow: number | null = null;
  // フレーム間隔は「自動スクロール中」だけ記録する（AC1 はスクロール fps。停止中の rAF で p95 を薄めない）。
  let scrollFrameLastNow: number | null = null;
  let startNow: number | null = null;
  let lastMemorySampleAt = Number.NEGATIVE_INFINITY;

  let autoScrollPlan: ((elapsedMs: number) => { top: number; left: number }) | null = null;
  let autoScrollStart = 0;

  const sampleMemory = (nowMs: number): void => {
    const used = readUsedHeapBytes();
    if (used === null) {
      return;
    }
    if (startNow === null) {
      startNow = nowMs;
    }
    memorySamples.push({ t: nowMs - startNow, usedBytes: used });
  };

  const buildInput = (
    anchorMaintained: boolean | null,
    visibleCellCount: number,
  ): AcceptanceInput => ({
    frameIntervalsMs: frameIntervals,
    stoppedRedrawMs,
    selectionLatencyMs,
    memorySamples,
    anchorMaintained,
    visibleCellCount,
  });

  return {
    onFrame(nowMs) {
      if (startNow === null) {
        startNow = nowMs;
      }
      lastFrameNow = nowMs;

      if (nowMs - lastMemorySampleAt >= MEMORY_SAMPLE_INTERVAL_MS) {
        lastMemorySampleAt = nowMs;
        sampleMemory(nowMs);
      }

      if (autoScrollPlan !== null) {
        // 自動スクロール中のみフレーム間隔を記録（AC1）。
        if (scrollFrameLastNow !== null) {
          frameIntervals.push(nowMs - scrollFrameLastNow);
        }
        scrollFrameLastNow = nowMs;
        return { scroll: autoScrollPlan(nowMs - autoScrollStart) };
      }
      scrollFrameLastNow = null;
      return { scroll: null };
    },
    startAutoScroll(config) {
      autoScrollPlan = createAutoScrollPlan(config);
      autoScrollStart = lastFrameNow ?? performance.now();
      scrollFrameLastNow = null; // 開始直後の idle ギャップを 1 件目に混ぜない
    },
    stopAutoScroll() {
      autoScrollPlan = null;
      scrollFrameLastNow = null;
    },
    isAutoScrolling() {
      return autoScrollPlan !== null;
    },
    recordStoppedRedraw(ms) {
      stoppedRedrawMs.push(ms);
    },
    recordSelectionLatency(ms) {
      selectionLatencyMs.push(ms);
    },
    reset() {
      frameIntervals = [];
      stoppedRedrawMs = [];
      selectionLatencyMs = [];
      memorySamples = [];
      lastFrameNow = null;
      scrollFrameLastNow = null;
      startNow = null;
      lastMemorySampleAt = Number.NEGATIVE_INFINITY;
    },
    buildInput,
    toReportJson(anchorMaintained, visibleCellCount) {
      const input = buildInput(anchorMaintained, visibleCellCount);
      const result: AcceptanceResult = evaluateAcceptance(input);
      const stats = frameStats(frameIntervals);
      const report = {
        env: collectEnv(),
        visibleCellCount,
        frame: stats,
        stoppedRedrawMs,
        selectionLatencyMs,
        memory: {
          sampleCount: memorySamples.length,
          trend: memoryTrend(memorySamples),
          samples: memorySamples,
        },
        acceptance: result,
      };
      return JSON.stringify(report, null, 2);
    },
    summary() {
      const stats = frameStats(frameIntervals);
      const stoppedMean =
        stoppedRedrawMs.length === 0
          ? 0
          : stoppedRedrawMs.reduce((a, b) => a + b, 0) / stoppedRedrawMs.length;
      return {
        frameCount: stats.count,
        frameP95: stats.p95,
        frameWorst: stats.worst,
        stoppedRedrawMean: stoppedMean,
        selectionWorst: selectionLatencyMs.length === 0 ? 0 : Math.max(...selectionLatencyMs),
        memorySampleCount: memorySamples.length,
        memorySlopeBytesPerSec: memoryTrend(memorySamples).slopeBytesPerSec,
        autoScrolling: autoScrollPlan !== null,
      };
    },
  };
}
