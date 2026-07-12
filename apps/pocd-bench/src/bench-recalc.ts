// 差分再計算ベンチ（DD-006 Phase 3・AC2・bench-protocol 準拠）。影響式数別に p95/worst を計測する。
// 合否対象=影響100式以下（通常入力）: p95 16ms未満・worst 33ms未満。影響1,000/10,000式・
// 10,000行範囲SUM・10,000式チェーンは Worker 分離閾値の素材（合否対象外）。
// 依存表現2方式（expand/interval）の構築・更新時間も比較する。
// 実行: node --expose-gc --import tsx src/bench-recalc.ts [--full] [--warmup N --trials N --pretty]

import os from 'node:os';
import {
  DEFAULT_LIMITS,
  FormulaSheet,
  parse,
  type Expr,
  type RangeStrategy,
} from '@nanairo-sheet/formula';
import { num, type CellValue } from '@nanairo-sheet/formula';
import { createPrng } from './prng';

const COLS = 200;

function ast(formula: string): Expr {
  const p = parse(formula, DEFAULT_LIMITS);
  if (!p.ok) throw new Error(`parse ${formula}: ${p.error}`);
  return p.ast;
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1] ?? 0;
}
function p95(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] ?? 0;
}
const round = (x: number): number => Number(x.toFixed(4));
function forceGc(): void {
  globalThis.gc?.();
}

interface RecalcStat {
  scenario: string;
  formulasAffected: number;
  median: number;
  p95: number;
  worst: number;
  acRelevant: boolean;
}

/** 単一セル変更×trials を計測（各変更の所要 ms を収集）。 */
function measureUpdate(
  build: () => { sheet: FormulaSheet; poke: (v: CellValue, i: number) => void },
  warmup: number,
  trials: number,
): number[] {
  const { poke } = build();
  const prng = createPrng(20260712);
  for (let i = 0; i < warmup; i += 1) poke(num(prng.nextInt(1000)), i);
  const times: number[] = [];
  for (let i = 0; i < trials; i += 1) {
    forceGc();
    const t0 = performance.now();
    poke(num(prng.nextInt(1000)), warmup + i);
    times.push(performance.now() - t0);
  }
  return times;
}

/** fanout: A1 を N 個の formula（=A1+k）が参照。A1 変更で N 式が再計算。 */
function fanoutScenario(n: number, warmup: number, trials: number): RecalcStat {
  const times = measureUpdate(
    () => {
      const sheet = new FormulaSheet(COLS);
      sheet.setInput(0, 0, num(1)); // A1
      for (let k = 0; k < n; k += 1) {
        const row = 1 + Math.floor(k / COLS);
        const col = k % COLS;
        sheet.setFormula(row, col, ast('=A1+' + String(k)));
      }
      sheet.recalcAll();
      return { sheet, poke: (v) => sheet.setInput(0, 0, v) };
    },
    warmup,
    trials,
  );
  return {
    scenario: `fanout-${n}`,
    formulasAffected: n,
    median: round(median(times)),
    p95: round(p95(times)),
    worst: round(Math.max(0, ...times)),
    acRelevant: n <= 100,
  };
}

/** range-sum: =SUM(A1:A{rows}) を 1 式・入力 rows 個。入力1つ変更で SUM 再計算。 */
function rangeSumScenario(rows: number, warmup: number, trials: number): RecalcStat {
  const times = measureUpdate(
    () => {
      const sheet = new FormulaSheet(COLS);
      for (let r = 0; r < rows; r += 1) sheet.setInput(r, 0, num(r % 100));
      sheet.setFormula(0, 1, ast(`=SUM(A1:A${rows})`)); // B1
      sheet.recalcAll();
      return { sheet, poke: (v, i) => sheet.setInput(i % rows, 0, v) };
    },
    warmup,
    trials,
  );
  return {
    scenario: `range-sum-${rows}`,
    formulasAffected: 1,
    median: round(median(times)),
    p95: round(p95(times)),
    worst: round(Math.max(0, ...times)),
    acRelevant: false,
  };
}

/** chain: (i,0) = =A{i}（1つ上を参照）の深さ depth。A1 変更で全段再計算。 */
function chainScenario(depth: number, warmup: number, trials: number): RecalcStat {
  const times = measureUpdate(
    () => {
      const sheet = new FormulaSheet(COLS);
      sheet.setInput(0, 0, num(1)); // A1
      for (let i = 1; i < depth; i += 1) sheet.setFormula(i, 0, ast(`=A${i}`)); // (i,0)=上を参照
      sheet.recalcAll();
      return { sheet, poke: (v) => sheet.setInput(0, 0, v) };
    },
    warmup,
    trials,
  );
  return {
    scenario: `chain-${depth}`,
    formulasAffected: depth - 1,
    median: round(median(times)),
    p95: round(p95(times)),
    worst: round(Math.max(0, ...times)),
    acRelevant: false,
  };
}

/** 依存表現2方式（expand/interval）の構築＋更新時間比較（range-sum で計測）。 */
function strategyComparison(rows: number): Record<RangeStrategy, { buildMs: number; updateMs: number }> {
  const run = (strategy: RangeStrategy): { buildMs: number; updateMs: number } => {
    forceGc();
    const t0 = performance.now();
    const sheet = new FormulaSheet(COLS, strategy);
    for (let r = 0; r < rows; r += 1) sheet.setInput(r, 0, num(r % 100));
    sheet.setFormula(0, 1, ast(`=SUM(A1:A${rows})`));
    sheet.recalcAll();
    const buildMs = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < 50; i += 1) sheet.setInput(i % rows, 0, num(i));
    const updateMs = (performance.now() - t1) / 50;
    return { buildMs: round(buildMs), updateMs: round(updateMs) };
  };
  return { expand: run('expand'), interval: run('interval') };
}

function main(): void {
  const argv = process.argv.slice(2);
  const has = (f: string): boolean => argv.includes(f);
  const argNum = (f: string, d: number): number => {
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : d;
  };
  const full = has('--full');
  const warmup = argNum('--warmup', 3);
  const trials = argNum('--trials', 20);
  const pretty = has('--pretty');

  const fanoutSizes = full ? [100, 1000, 10000] : [100, 1000];
  const rangeRows = full ? 10000 : 2000;
  const chainDepth = full ? 10000 : 2000;

  const stats: RecalcStat[] = [
    ...fanoutSizes.map((n) => fanoutScenario(n, warmup, trials)),
    rangeSumScenario(rangeRows, warmup, trials),
    chainScenario(chainDepth, warmup, trials),
  ];

  const ac2 = stats.find((s) => s.scenario === 'fanout-100');
  const output = {
    meta: {
      runtime: 'node',
      runtimeVersion: process.version,
      host: { os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model ?? 'unknown' },
      warmup,
      trials,
      full,
      gcExposed: typeof globalThis.gc === 'function',
    },
    // AC2 合否（影響100式以下・p95 16ms未満・worst 33ms未満）。
    ac2Judgment:
      ac2 === undefined
        ? null
        : { p95: ac2.p95, worst: ac2.worst, pass: ac2.p95 < 16 && ac2.worst < 33 },
    scenarios: stats,
    strategyComparison: strategyComparison(rangeRows),
  };
  process.stdout.write(JSON.stringify(output, null, pretty ? 2 : 0) + '\n');
}

main();
