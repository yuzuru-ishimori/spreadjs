// 性能予算 不変条件スイート（§2.3 性能回帰予算・通常DDは軽量スモーク）。DD-011 設置・実予算は DD-012。
//
// 最小ケース: Document State 表現（core cell-store 経由の apply）へ大きめの setCells を投入し、
// 機能的に成立し（全セル読み戻せる）、緩い予算内で完了する軽量スモーク。
// 【閾値の根拠】本ケースは「フル再計測の発動条件を持つ常設スモーク」の骨格であり、
// 閾値は暫定（CI の CPU 競合でも落ちない緩い上限＝3000ms）。初期ロード経路・replay 方式・
// Axis 再構築などを変えたDD（DD-012 ほか）が実予算とフル計測を定義する（§2.3）。
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
