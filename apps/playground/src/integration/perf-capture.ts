// CG-6 精密メモリ＋frame 計測ハーネス（DD-016-2 Phase 4・`?perf=1` でのみ有効化）。
//
// 統合ページ（Facade consumer）に perf/memory 計測を仕込み、`scripts/cg-perf/judge-perf-report.mjs` が
// 読む report schema（frame / stoppedRedrawMs / selectionLatencyMs / memory{samples,trend} / visibleCellCount）を
// エクスポートする。DD-016-1 の apps 書換えで旧 pocb ハーネス（apps/playground/src/pocb/）は削除されたため、
// Facade 配線後の統合経路で計測するには本ハーネスを新設する必要があった（judge 前提の pocb は不在）。
//
// 精密メモリ: `performance.memory.usedJSHeapSize` は既定では粗い丸め値。実 Chrome を
// `--enable-precise-memory-info` 付きで起動すると精密値になる（CG-6 の要件・要確認④）。
// 起動は `scripts/cg-perf/run-cg6.mjs`（Playwright で flag 付き launch）。
//
// 内部 @nanairo-sheet/* は import しない（R1 維持＝boundary new=0）。DOM とグローバルのみ使用。

interface MemorySample {
  t: number;
  usedBytes: number;
}

interface PerfReport {
  env: { userAgent: string; dpr: number; preciseMemory: boolean };
  visibleCellCount: number;
  frame: { count: number; p50: number; p95: number; worst: number };
  stoppedRedrawMs: number[];
  selectionLatencyMs: number[];
  memory: {
    sampleCount: number;
    trend: { slopeBytesPerSec: number; growthRatio: number };
    samples: MemorySample[];
  };
  meta: { durationMs: number; scrollFrames: number; note: string };
}

function readUsedBytes(): number | null {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
  return mem?.usedJSHeapSize ?? null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/** 最小二乗で slope（bytes/sec）を求める（x=秒, y=bytes）。 */
function linregSlopeBytesPerSec(samples: MemorySample[]): number {
  const n = samples.length;
  if (n < 2) return 0;
  const xs = samples.map((s) => s.t / 1000);
  const ys = samples.map((s) => s.usedBytes);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

const raf = (): Promise<number> => new Promise((r) => requestAnimationFrame((t) => r(t)));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** `?perf=1` のとき main.ts から呼ばれる。window.__cg6Run(durationMs) を公開する。 */
export function installPerfCapture(scroller: HTMLDivElement, stage: HTMLElement): void {
  async function measureScrollFrames(scrollMs: number): Promise<number[]> {
    // 自動スクロール（下→上ループ）で frame 間隔を測る。grid の masterLoop が scroll で再描画する。
    const frames: number[] = [];
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    const start = await raf();
    let last = start;
    let elapsed = 0;
    let dir = 1;
    const stepPx = Math.max(8, Math.round(scroller.clientHeight / 24)); // 1 フレームあたりの移動量
    while (elapsed < scrollMs) {
      let next = scroller.scrollTop + dir * stepPx;
      if (next >= maxScroll) {
        next = maxScroll;
        dir = -1;
      } else if (next <= 0) {
        next = 0;
        dir = 1;
      }
      scroller.scrollTop = next;
      const now = await raf();
      frames.push(now - last);
      last = now;
      elapsed = now - start;
    }
    // 最初の 1 フレーム（初期化ノイズ）を除外。
    return frames.slice(1);
  }

  async function measureSelectionLatency(count: number): Promise<number[]> {
    // 常駐 textarea へ ArrowDown を送る → grid が activeCell 移動→onChange→再描画。
    // 送出から次フレーム完了までを selection latency の近似とする。
    const ta = stage.querySelector('textarea') as HTMLTextAreaElement | null;
    const out: number[] = [];
    if (ta === null) return out;
    ta.focus({ preventScroll: true });
    for (let i = 0; i < count; i += 1) {
      const t0 = performance.now();
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      await raf();
      out.push(performance.now() - t0);
      await sleep(30);
    }
    return out;
  }

  async function measureStoppedRedraw(count: number): Promise<number[]> {
    // 静止状態で markViewportDirty を誘発（scroll イベント）→ 次フレームの再描画コストを測る。
    const out: number[] = [];
    for (let i = 0; i < count; i += 1) {
      await sleep(40);
      const t0 = performance.now();
      scroller.dispatchEvent(new Event('scroll')); // markViewportDirty → 次 flush で再描画
      await raf();
      await raf();
      out.push((performance.now() - t0) / 2);
    }
    return out;
  }

  function estimateVisibleCellCount(): number {
    // ヘッダー/セル寸法は Facade 既定（HEADER 52x24・COL 80・ROW 22）。overscan（縦0.6vh・横3列）込みで概算。
    const vw = scroller.clientWidth;
    const vh = scroller.clientHeight;
    const HEADER_W = 52;
    const HEADER_H = 24;
    const COL_W = 80;
    const ROW_H = 22;
    const bodyW = Math.max(0, vw - HEADER_W);
    const bodyH = Math.max(0, vh - HEADER_H);
    const visCols = Math.ceil(bodyW / COL_W) + 3 * 2; // overscanX = 3 列（両側）
    const visRows = Math.ceil(bodyH / ROW_H) + Math.ceil((vh * 0.6) / ROW_H) * 2; // overscanY = 0.6vh（両側）
    return visCols * visRows;
  }

  async function run(durationMs: number): Promise<PerfReport> {
    const t0 = performance.now();
    const samples: MemorySample[] = [];
    const sampleAt = (): void => {
      const used = readUsedBytes();
      if (used !== null) samples.push({ t: Math.round(performance.now() - t0), usedBytes: used });
    };

    // ウォームアップ選択・停止再描画（初期状態で計測）。
    const selectionLatencyMs = await measureSelectionLatency(8);
    const stoppedRedrawMs = await measureStoppedRedraw(6);

    // 連続自動スクロール中に memory を約 10 秒間隔でサンプルする（clean run＝並行負荷なし）。
    sampleAt();
    let nextSampleAt = 10_000;
    const allFrames: number[] = [];
    while (performance.now() - t0 < durationMs) {
      const chunk = await measureScrollFrames(2_000);
      allFrames.push(...chunk);
      if (performance.now() - t0 >= nextSampleAt) {
        sampleAt();
        nextSampleAt += 10_000;
      }
    }
    sampleAt(); // 末尾サンプル

    const sortedFrames = [...allFrames].sort((a, b) => a - b);
    const first = samples[0]?.usedBytes ?? 0;
    const lastS = samples[samples.length - 1]?.usedBytes ?? 0;

    const report: PerfReport = {
      env: {
        userAgent: navigator.userAgent,
        dpr: window.devicePixelRatio || 1,
        preciseMemory: (performance as unknown as { memory?: unknown }).memory !== undefined,
      },
      visibleCellCount: estimateVisibleCellCount(),
      frame: {
        count: sortedFrames.length,
        p50: Number(percentile(sortedFrames, 50).toFixed(2)),
        p95: Number(percentile(sortedFrames, 95).toFixed(2)),
        worst: Number((sortedFrames[sortedFrames.length - 1] ?? 0).toFixed(2)),
      },
      stoppedRedrawMs: stoppedRedrawMs.map((x) => Number(x.toFixed(3))),
      selectionLatencyMs: selectionLatencyMs.map((x) => Number(x.toFixed(2))),
      memory: {
        sampleCount: samples.length,
        trend: {
          slopeBytesPerSec: Math.round(linregSlopeBytesPerSec(samples)),
          growthRatio: first > 0 ? Number((lastS / first).toFixed(4)) : 1,
        },
        samples,
      },
      meta: {
        durationMs: Math.round(performance.now() - t0),
        scrollFrames: allFrames.length,
        note: 'DD-016-2 CG-6: Facade 統合経路の精密メモリ＋frame 計測。--enable-precise-memory-info 付き実 Chrome 前提。',
      },
    };
    return report;
  }

  (window as unknown as { __cg6Run?: (ms: number) => Promise<PerfReport> }).__cg6Run = run;
}
