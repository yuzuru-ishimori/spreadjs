// DD-006 AC9: 採用候補 CellStore（chunked-rowslot）の最小ブラウザ確認。
// Node 計測（bench-cellstore）と同じロジック・同じ store 実装を使い、ブラウザ実測との乖離を見る。
// chunked-rowslot / data-gen は pocd-bench（PoC・純ロジック）から再利用する（apps間の PoC-to-PoC import。
// 製品パッケージではないため許容。product 憲章 §25 の対象外）。

import { createChunkedRowslotStore } from '../../pocd-bench/src/stores/chunked-rowslot-store';
import { generateCells } from '../../pocd-bench/src/data-gen';
import type { CellStoreCandidate } from '../../pocd-bench/src/cell-store';

interface BrowserMemory {
  usedJSHeapSize?: number;
  totalJSHeapSize?: number;
  jsHeapSizeLimit?: number;
}
function readMemory(): BrowserMemory {
  const mem = (performance as unknown as { memory?: BrowserMemory }).memory;
  return mem ?? {};
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1] ?? 0;
}

function bench(rows: number, cols: number, nonEmpty: number, seed: number): unknown {
  const { cells, count } = generateCells({ rows, cols, nonEmpty, seed, distribution: 'uniform-sparse' });

  const loadTimes: number[] = [];
  let store: CellStoreCandidate | undefined;
  for (let t = 0; t < 3; t += 1) {
    store = createChunkedRowslotStore({ rows, cols });
    const t0 = performance.now();
    store.bulkLoad(cells);
    loadTimes.push(performance.now() - t0);
  }
  if (store === undefined) throw new Error('no store');

  // ランダム読み取り10万回。
  const prng = mulberry(seed + 1);
  const t1 = performance.now();
  let sink = 0;
  for (let i = 0; i < 100_000; i += 1) {
    sink += store.get(Math.floor(prng() * rows), Math.floor(prng() * cols)).length;
  }
  const readMs = performance.now() - t1;

  // 範囲走査（40行×全列）を200窓。
  const t2 = performance.now();
  let visited = 0;
  for (let w = 0; w < 200; w += 1) {
    const r0 = Math.floor(prng() * Math.max(1, rows - 40));
    visited += store.queryRange(r0, r0 + 40, 0, cols, () => {});
  }
  const scanMs = performance.now() - t2;

  return {
    runtime: 'browser',
    userAgent: navigator.userAgent,
    config: { rows, cols, nonEmpty: count },
    store: 'chunked-rowslot',
    metrics: {
      loadMsMedian: Number(median(loadTimes).toFixed(2)),
      randomReadMs: Number(readMs.toFixed(2)),
      rangeScanMs: Number(scanMs.toFixed(2)),
      approxStoreMB: Number((store.approxMemoryBytes() / 1e6).toFixed(1)),
      memory: readMemory(),
      sink,
      visited,
    },
    note: 'Node 実測（measurement-report §AC1）と比較。時間2倍超 or メモリ1.5倍超なら原因分析（bench-protocol §5）。',
  };
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const out = document.getElementById('out');
const run = document.getElementById('run');
run?.addEventListener('click', () => {
  if (out) out.textContent = '計測中…（数秒かかります）';
  // 次フレームで実行して「計測中」表示を反映。
  requestAnimationFrame(() => {
    const result = bench(50_000, 200, 500_000, 20260712);
    if (out) out.textContent = JSON.stringify(result, null, 2);
    (window as unknown as { __result: unknown }).__result = result; // Playwright/手動確認用
  });
});
