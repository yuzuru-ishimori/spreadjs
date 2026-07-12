// 差分再計算エンジン（§14.4）。入力値＋formula AST＋計算値を保持し、dep-graph の順序で再計算する。
// CellReader を実装し、評価器へ現在値を供給する。index ベース（構造変更は伴わない＝AC2 再計算用）。
// 固定ID参照維持（AC3/4）は bind.ts／sheet-core 結合試験が担う。DOM/Node 非依存。

import type { Expr } from './ast';
import { evaluate, blank, type CellReader, type CellValue } from './evaluator';
import { DependencyGraph, type CellKey, type RangeStrategy } from './dep-graph';
import type { FormulaLimits } from './limits';
import { DEFAULT_LIMITS } from './limits';

export class FormulaSheet implements CellReader {
  private readonly inputs = new Map<CellKey, CellValue>();
  private readonly formulaAst = new Map<CellKey, Expr>();
  private readonly computed = new Map<CellKey, CellValue>();
  private readonly nonEmpty = new Set<CellKey>();
  private readonly graph: DependencyGraph;

  constructor(
    private readonly cols: number,
    strategy: RangeStrategy = 'expand',
    private readonly limits: FormulaLimits = DEFAULT_LIMITS,
  ) {
    this.graph = new DependencyGraph(cols, strategy);
  }

  private keyOf(row: number, col: number): CellKey {
    return row * this.cols + col;
  }

  read(row: number, col: number): CellValue {
    const key = this.keyOf(row, col);
    if (this.formulaAst.has(key)) return this.computed.get(key) ?? blank;
    return this.inputs.get(key) ?? blank;
  }

  readRange(
    rowStart: number,
    rowEnd: number,
    colStart: number,
    colEnd: number,
    visit: (row: number, col: number, value: CellValue) => void,
  ): void {
    for (let row = rowStart; row < rowEnd; row += 1) {
      for (let col = colStart; col < colEnd; col += 1) {
        const v = this.read(row, col);
        if (v.kind !== 'blank') visit(row, col, v);
      }
    }
  }

  /** 入力値を設定（非formula セル）。依存 formula を差分再計算する。 */
  setInput(row: number, col: number, value: CellValue): void {
    const key = this.keyOf(row, col);
    if (value.kind === 'blank') {
      this.inputs.delete(key);
      this.nonEmpty.delete(key);
    } else {
      this.inputs.set(key, value);
      this.nonEmpty.add(key);
    }
    this.recalcFrom([key]);
  }

  /** formula を設定。全依存を再計算する。 */
  setFormula(row: number, col: number, ast: Expr): void {
    const key = this.keyOf(row, col);
    this.formulaAst.set(key, ast);
    this.nonEmpty.add(key);
    this.graph.setFormula(row, col, ast);
    // この formula 自身＋それに依存する formula を再計算。
    this.evaluateOne(key);
    this.recalcFrom([key]);
  }

  /** 全 formula を一括再計算（初回セットアップ後に呼ぶ）。 */
  recalcAll(): void {
    const { order, cycle } = this.graph.orderAll();
    this.applyOrder(order, cycle);
  }

  private evaluateOne(key: CellKey): void {
    const ast = this.formulaAst.get(key);
    if (ast === undefined) return;
    this.computed.set(key, evaluate(ast, this, this.limits));
  }

  private recalcFrom(changed: CellKey[]): void {
    const { order, cycle } = this.graph.recalcOrder(changed);
    this.applyOrder(order, cycle);
  }

  private applyOrder(order: readonly CellKey[], cycle: ReadonlySet<CellKey>): void {
    for (const key of order) {
      if (cycle.has(key)) {
        this.computed.set(key, { kind: 'error', error: '#CYCLE!' });
        continue;
      }
      const ast = this.formulaAst.get(key);
      if (ast !== undefined) this.computed.set(key, evaluate(ast, this, this.limits));
    }
  }

  /** 表示値（テスト/デバッグ用）。 */
  valueAt(row: number, col: number): CellValue {
    return this.read(row, col);
  }
}
