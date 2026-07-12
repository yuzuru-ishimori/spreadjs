// CellStore ベンチCLI（DD-006 Phase 1・bench-protocol.md 準拠）。
// ウォームアップ→本計測（中央値/p95/worst）・GC明示・実行順ローテーション・生JSON出力。
// 実行: node --expose-gc --import tsx src/bench-cellstore.ts [--rows N --cols N --nonEmpty N --seed N
//        --warmup N --trials N --dist a,b --stores a,b --pretty]
// 主評価は Node 22（要確認3）。採用候補のブラウザ確認は Phase 5（pocd-browser-bench）。
// 本CLIは Phase 1 の計測土台。合否用の 500,000 セル本計測は Phase 5 で実施する。

import os from 'node:os';
import v8 from 'node:v8';
import { STORE_CANDIDATES, type StoreCandidate } from './stores/index';
import { DISTRIBUTIONS, generateCells, type Distribution } from './data-gen';
import { createPrng } from './prng';
import type { CellStoreCandidate, CellStoreConfig, GeneratedCell } from './cell-store';

interface Args {
  rows: number;
  cols: number;
  nonEmpty: number;
  seed: number;
  warmup: number;
  trials: number;
  chunkRows: number;
  dists: Distribution[];
  stores: string[];
  pretty: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a !== undefined && a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (key === 'pretty') {
        map.set(key, 'true');
      } else if (next !== undefined) {
        map.set(key, next);
        i += 1;
      }
    }
  }
  const num = (k: string, d: number): number => {
    const v = map.get(k);
    return v === undefined ? d : Number(v);
  };
  const list = (k: string, d: string[]): string[] => {
    const v = map.get(k);
    return v === undefined ? d : v.split(',').map((s) => s.trim()).filter((s) => s !== '');
  };
  return {
    // 既定は Phase 1 の smoke 規模。合否用の本計測（50,000×200・非空500,000）は CLI 引数で指定。
    rows: num('rows', 5000),
    cols: num('cols', 50),
    nonEmpty: num('nonEmpty', 20000),
    seed: num('seed', 20260712),
    warmup: num('warmup', 3),
    trials: num('trials', 10),
    chunkRows: num('chunkRows', 256),
    dists: list('dist', DISTRIBUTIONS as unknown as string[]) as Distribution[],
    stores: list('stores', STORE_CANDIDATES.map((s) => s.label)),
    pretty: map.get('pretty') === 'true',
  };
}

function median(nums: readonly number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function percentile(nums: readonly number[], p: number): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}

interface MetricStat {
  median: number;
  p95: number;
  worst: number;
  raw: number[];
}

function summarize(raw: number[]): MetricStat {
  return {
    median: Number(median(raw).toFixed(4)),
    p95: Number(percentile(raw, 95).toFixed(4)),
    worst: Number(Math.max(0, ...raw).toFixed(4)),
    raw: raw.map((x) => Number(x.toFixed(4))),
  };
}

function forceGc(): void {
  globalThis.gc?.();
}

/** 計測区間の直前に GC を明示し、fn の所要 ms を返す。 */
function timed(fn: () => void): number {
  forceGc();
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

/** ランダム読み取り/書き込みで使う位置列（決定論・ヒット寄り）。 */
function makeProbes(
  cells: readonly GeneratedCell[],
  rows: number,
  cols: number,
  seed: number,
  count: number,
): Array<{ row: number; col: number }> {
  const prng = createPrng(seed);
  const probes: Array<{ row: number; col: number }> = [];
  for (let i = 0; i < count; i += 1) {
    if (cells.length > 0 && prng.next() < 0.7) {
      const cell = cells[prng.nextInt(cells.length)];
      if (cell !== undefined) {
        probes.push({ row: cell.row, col: cell.col });
        continue;
      }
    }
    probes.push({ row: prng.nextInt(rows), col: prng.nextInt(cols) });
  }
  return probes;
}

interface StoreResult {
  store: string;
  category: string;
  metrics: {
    loadMs: MetricStat;
    randomReadMs: MetricStat;
    randomWriteMs: MetricStat;
    rangeScanMs: MetricStat;
    memoryBytes: { rss: number; heapUsed: number; external: number; approxStore: number };
  };
  nonEmptyCount: number;
}

function benchStore(
  candidate: StoreCandidate,
  storeConfig: CellStoreConfig,
  cells: readonly GeneratedCell[],
  args: Args,
): StoreResult {
  const readProbes = makeProbes(cells, storeConfig.rows, storeConfig.cols, args.seed + 1, 100_000);
  const writeProbes = makeProbes(cells, storeConfig.rows, storeConfig.cols, args.seed + 2, 100_000);
  const windowCount = 200;

  const load: number[] = [];
  const read: number[] = [];
  const write: number[] = [];
  const scan: number[] = [];
  let nonEmptyCount = 0;

  const totalRuns = args.warmup + args.trials;
  for (let run = 0; run < totalRuns; run += 1) {
    const isWarmup = run < args.warmup;
    // ロード計測（毎回新しいストア。store はループブロックスコープで次 run 前に GC 対象）。
    const store: CellStoreCandidate = candidate.create(storeConfig);
    const loadMs = timed(() => {
      store.bulkLoad(cells);
    });
    nonEmptyCount = store.nonEmptyCount();

    const readMs = timed(() => {
      let sink = 0;
      for (const p of readProbes) sink += store.get(p.row, p.col).length;
      if (sink < 0) throw new Error('unreachable');
    });

    const writeMs = timed(() => {
      for (let i = 0; i < writeProbes.length; i += 1) {
        const p = writeProbes[i];
        if (p !== undefined) store.set(p.row, p.col, i % 7 === 0 ? '' : `v${i}`);
      }
    });

    // 走査は可視窓（40行×全列）を windowCount 回。
    const prng = createPrng(args.seed + 3 + run);
    const scanMs = timed(() => {
      let visited = 0;
      for (let w = 0; w < windowCount; w += 1) {
        const r0 = prng.nextInt(Math.max(1, storeConfig.rows - 40));
        visited += store.queryRange(r0, r0 + 40, 0, storeConfig.cols, () => {});
      }
      if (visited < 0) throw new Error('unreachable');
    });

    if (!isWarmup) {
      load.push(loadMs);
      read.push(readMs);
      write.push(writeMs);
      scan.push(scanMs);
    }
  }

  // メモリは新しいストアを1つだけ保持して概算。
  forceGc();
  const memStore = candidate.create(storeConfig);
  memStore.bulkLoad(cells);
  forceGc();
  const mu = process.memoryUsage();

  return {
    store: candidate.label,
    category: candidate.category,
    metrics: {
      loadMs: summarize(load),
      randomReadMs: summarize(read),
      randomWriteMs: summarize(write),
      rangeScanMs: summarize(scan),
      memoryBytes: {
        rss: mu.rss,
        heapUsed: mu.heapUsed,
        external: mu.external,
        approxStore: memStore.approxMemoryBytes(),
      },
    },
    nonEmptyCount,
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const storeConfig: CellStoreConfig = { rows: args.rows, cols: args.cols, chunkRows: args.chunkRows };
  const candidates = STORE_CANDIDATES.filter((s) => args.stores.includes(s.label));

  const results: Array<{ distribution: Distribution; stores: StoreResult[] }> = [];
  for (const distribution of args.dists) {
    const { cells, count } = generateCells({
      rows: args.rows,
      cols: args.cols,
      nonEmpty: args.nonEmpty,
      seed: args.seed,
      distribution,
    });
    // 実行順ローテーション（分布ごとに開始位置をずらす）。
    const offset = args.dists.indexOf(distribution) % Math.max(1, candidates.length);
    const rotated = [...candidates.slice(offset), ...candidates.slice(0, offset)];
    const storeResults = rotated.map((c) => benchStore(c, storeConfig, cells, args));
    // 出力はラベル順に整える。
    storeResults.sort((a, b) => a.store.localeCompare(b.store));
    results.push({ distribution, stores: storeResults });
    if (count !== storeResults[0]?.nonEmptyCount) {
      // 生成件数と非空件数の不一致は異常（等価性の前提崩れ）。
      throw new Error(`nonEmpty mismatch for ${distribution}: gen=${count}`);
    }
  }

  const heap = v8.getHeapStatistics();
  const output = {
    meta: {
      seed: args.seed,
      runtime: 'node',
      runtimeVersion: process.version,
      host: {
        os: `${os.type()} ${os.release()}`,
        cpu: os.cpus()[0]?.model ?? 'unknown',
        cpus: os.cpus().length,
        ramGB: Math.round(os.totalmem() / 1024 ** 3),
      },
      warmup: args.warmup,
      trials: args.trials,
      gcExposed: typeof globalThis.gc === 'function',
      heapSizeLimit: heap.heap_size_limit,
      acRelevant: args.nonEmpty >= 500_000,
      config: { rows: args.rows, cols: args.cols, nonEmpty: args.nonEmpty, chunkRows: args.chunkRows },
    },
    results,
  };

  process.stdout.write(JSON.stringify(output, null, args.pretty ? 2 : 0) + '\n');
}

main();
