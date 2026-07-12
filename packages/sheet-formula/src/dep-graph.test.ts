// Phase 3 Red→Green: 依存グラフ・差分再計算・cycle（scenarios.md §5）。

import { describe, expect, it } from 'vitest';
import { parse } from './parser';
import { DependencyGraph, type RangeStrategy } from './dep-graph';
import { FormulaSheet } from './recalc';
import { num, cellValueToString } from './evaluator';
import type { Expr } from './ast';

function ast(formula: string): Expr {
  const p = parse(formula);
  if (!p.ok) throw new Error(`parse ${formula}: ${p.error}`);
  return p.ast;
}

const COLS = 100;
const key = (row: number, col: number): number => row * COLS + col;

describe('依存グラフの順序付け', () => {
  it('単純依存: A1 変更で C1（=A1+B1）が dirty・順序は precedent 先', () => {
    const g = new DependencyGraph(COLS);
    g.setFormula(0, 2, ast('=A1+B1')); // C1
    const { order } = g.recalcOrder([key(0, 0)]); // A1 変更
    expect(order).toContain(key(0, 2));
  });

  it('チェーン: B1=A1, C1=B1 → 順序は B1 が C1 より先', () => {
    const g = new DependencyGraph(COLS);
    g.setFormula(0, 1, ast('=A1')); // B1
    g.setFormula(0, 2, ast('=B1')); // C1
    const { order } = g.recalcOrder([key(0, 0)]);
    expect(order.indexOf(key(0, 1))).toBeLessThan(order.indexOf(key(0, 2)));
  });

  it('範囲依存: 範囲内セル変更で SUM が dirty', () => {
    const g = new DependencyGraph(COLS);
    g.setFormula(0, 1, ast('=SUM(A1:A100)')); // B1
    expect(g.affectedSet([key(50, 0)]).has(key(0, 1))).toBe(true);
    expect(g.affectedSet([key(0, 5)]).has(key(0, 1))).toBe(false); // 範囲外
  });
});

describe('2戦略（expand / interval）の等価性', () => {
  const strategies: RangeStrategy[] = ['expand', 'interval'];
  it('同一グラフで dependents 集合が一致', () => {
    const build = (s: RangeStrategy): DependencyGraph => {
      const g = new DependencyGraph(COLS, s);
      g.setFormula(0, 1, ast('=SUM(A1:A50)')); // B1
      g.setFormula(0, 2, ast('=SUM(A25:A75)')); // C1（重なり）
      g.setFormula(0, 3, ast('=A1+B1')); // D1（連鎖）
      return g;
    };
    const [expand, interval] = strategies.map(build);
    if (expand === undefined || interval === undefined) throw new Error('no graph');
    for (const changed of [key(30, 0), key(0, 0), key(60, 0), key(80, 0)]) {
      expect(interval.affectedSet([changed])).toEqual(expand.affectedSet([changed]));
    }
  });
});

describe('差分再計算（FormulaSheet）', () => {
  it('ダイヤモンド依存: D=B+C, B=A, C=A → 値が正しく1回で収束', () => {
    const sheet = new FormulaSheet(COLS);
    sheet.setInput(0, 0, num(5)); // A1
    sheet.setFormula(0, 1, ast('=A1')); // B1
    sheet.setFormula(0, 2, ast('=A1')); // C1
    sheet.setFormula(0, 3, ast('=B1+C1')); // D1
    sheet.recalcAll();
    expect(cellValueToString(sheet.valueAt(0, 3))).toBe('10');
    sheet.setInput(0, 0, num(7)); // A1 変更 → 差分再計算
    expect(cellValueToString(sheet.valueAt(0, 3))).toBe('14');
  });

  it('範囲 SUM の差分再計算', () => {
    const sheet = new FormulaSheet(COLS);
    for (let r = 0; r < 10; r += 1) sheet.setInput(r, 0, num(r + 1)); // A1..A10 = 1..10
    sheet.setFormula(0, 1, ast('=SUM(A1:A10)')); // B1
    sheet.recalcAll();
    expect(cellValueToString(sheet.valueAt(0, 1))).toBe('55');
    sheet.setInput(0, 0, num(100)); // A1: 1→100
    expect(cellValueToString(sheet.valueAt(0, 1))).toBe('154');
  });
});

describe('循環検出（#CYCLE!）', () => {
  it('相互参照 A1=B1, B1=A1 → 両方 #CYCLE!', () => {
    const sheet = new FormulaSheet(COLS);
    sheet.setFormula(0, 0, ast('=B1'));
    sheet.setFormula(0, 1, ast('=A1'));
    sheet.recalcAll();
    expect(cellValueToString(sheet.valueAt(0, 0))).toBe('#CYCLE!');
    expect(cellValueToString(sheet.valueAt(0, 1))).toBe('#CYCLE!');
  });
  it('自己参照 A1=A1+1 → #CYCLE!', () => {
    const sheet = new FormulaSheet(COLS);
    sheet.setFormula(0, 0, ast('=A1+1'));
    sheet.recalcAll();
    expect(cellValueToString(sheet.valueAt(0, 0))).toBe('#CYCLE!');
  });
  it('範囲経由の自己包含 A1=SUM(A1:A3) → #CYCLE!', () => {
    const sheet = new FormulaSheet(COLS);
    sheet.setFormula(0, 0, ast('=SUM(A1:A3)'));
    sheet.recalcAll();
    expect(cellValueToString(sheet.valueAt(0, 0))).toBe('#CYCLE!');
  });
  it('3項循環 A=B, B=C, C=A → 全て #CYCLE!', () => {
    const sheet = new FormulaSheet(COLS);
    sheet.setFormula(0, 0, ast('=B1'));
    sheet.setFormula(0, 1, ast('=C1'));
    sheet.setFormula(0, 2, ast('=A1'));
    sheet.recalcAll();
    expect(cellValueToString(sheet.valueAt(0, 0))).toBe('#CYCLE!');
    expect(cellValueToString(sheet.valueAt(0, 1))).toBe('#CYCLE!');
    expect(cellValueToString(sheet.valueAt(0, 2))).toBe('#CYCLE!');
  });
});
