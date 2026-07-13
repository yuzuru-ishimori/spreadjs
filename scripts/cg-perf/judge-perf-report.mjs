// DD-012-2 headed 実測レポートの CLI 判定器（Phase 2 性能／Phase 3 CG-6 メモリ）。
//
// 使い方（headed セッションで pocb ハーネスがエクスポートした JSON を渡す）:
//   node scripts/cg-perf/judge-perf-report.mjs <report.json> [report2.json ...]
//
// 各レポートを回帰予算（scripts/cg-perf/perf-budget.json）で再判定し、性能＋メモリの verdict を
// JSON で stdout へ出す。全レポートの perf/memory が pass なら exit 0、over-budget/fail があれば exit 1。
// （over-budget は「回帰予算超過＝再ゲート」・fail は「§18.2 機能上限超過 or メモリ超過」）

import fs from 'node:fs';
import { judgePerfReport, judgeMemoryReport, loadBudget } from './perf-judge-core.mjs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node scripts/cg-perf/judge-perf-report.mjs <report.json> [...]');
  process.exit(2);
}

const budget = loadBudget();
const results = [];
let ok = true;

for (const file of files) {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const perf = judgePerfReport(report, budget);
  const memory = judgeMemoryReport(report, budget);
  const passed = perf.overall === 'pass' && memory.overall === 'pass';
  if (!passed) ok = false;
  results.push({ file, perf, memory, passed });
}

const summary = {
  budgetSource: budget.source,
  conditions: budget.conditions,
  noiseMargin: budget.noiseMargin,
  reports: results,
  overallPass: ok,
};
console.log(JSON.stringify(summary, null, 2));
process.exit(ok ? 0 : 1);
