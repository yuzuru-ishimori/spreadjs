// 性能予算 不変条件スイート（§2.3 性能回帰予算）。DD-011 設置・実予算 常設化は DD-012-2。
//
// このファイル（node 実行）= Document State 表現（core cell-store 経由の apply）の軽量スモーク。
// Canvas の scroll/selection/再描画・メモリの「実予算（DD-004 実測＝16.8/16.9/0.33ms・300MB）」は
// node では測れないため、headed 実測（人手）＋判定器で常設化する:
//   - 正典予算: scripts/cg-perf/perf-budget.json（合格ライン・計測条件・ノイズマージン）
//   - 判定器  : scripts/cg-perf/perf-judge-core.mjs（+ CLI judge-perf-report.mjs）
//   - 判定器の機械検証＋予算ピン(tripwire): tests/invariants/perf/perf-judge.test.ts
//   - headed 実測手順: doc/DD/DD-012-2/perf-realmachine-procedure.md（Phase 2）・cg6-memory-procedure.md（Phase 3）
// 本 node スモークは §2.3 L4 フル再計測の発動条件を持つ常設骨格（Document State 経路）。
// 閾値は緩い上限（CI の CPU 競合でも落ちない 3000ms）＝機能不成立の検知が目的。
import { describe, expect, it } from 'vitest';

import { applyOperation, createDocument, getCell } from '@nanairo-sheet/core';
import type { SheetDocument, SetCellsOperation } from '@nanairo-sheet/core';
import { COLUMNS, col, insertRows, num, row } from '@nanairo-sheet/collab/test-support';

const ROWS = 1000;
const BUDGET_MS = 3000; // 暫定・緩い上限（非 flaky）。実予算は DD-012。

function seedRows(count: number): SheetDocument {
  const doc = createDocument([...COLUMNS]);
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) ids.push(`r${i}`);
  // まとめて1 op で InsertRows。
  return applyOperation(doc, insertRows(null, ids), { revision: doc.revision + 1 }).document;
}

describe('invariant/perf: Document State bulk setCells スモーク', () => {
  it(`${ROWS}行 × 2列の bulk setCells が予算内で成立し全セル読み戻せる`, () => {
    const doc = seedRows(ROWS);
    const changes: SetCellsOperation['changes'] = [];
    for (let i = 0; i < ROWS; i += 1) {
      changes.push({ rowId: row(`r${i}`), columnId: col('col-a'), value: num(i) });
      changes.push({ rowId: row(`r${i}`), columnId: col('col-b'), value: num(i * 2) });
    }
    const op: SetCellsOperation = { type: 'setCells', changes, conflictPolicy: 'reject-overlap' };

    const start = performance.now();
    const next = applyOperation(doc, op, { revision: doc.revision + 1 }).document;
    const elapsed = performance.now() - start;

    // 機能検証（形骸化防止）: 代表セルが正しく読み戻せる。
    const first = getCell(next, row('r0'), col('col-a'));
    const last = getCell(next, row(`r${ROWS - 1}`), col('col-b'));
    expect(first?.value).toEqual({ kind: 'number', value: 0 });
    expect(last?.value).toEqual({ kind: 'number', value: (ROWS - 1) * 2 });

    // 予算スモーク（暫定閾値）。
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
