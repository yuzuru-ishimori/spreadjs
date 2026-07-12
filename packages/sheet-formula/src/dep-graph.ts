// 依存グラフ・差分再計算の順序付け（§14.4・scenarios.md §5）。
// formula cell → precedent cells/ranges。cell 変更 → 依存 formula を dirty 化し topological order で再計算。
// 範囲依存は2戦略（expand=範囲をセルへ展開／interval=列別 interval index）を比較できる。
// cycle は DFS coloring（gray スタック）で検出し、循環に含まれる全セルを #CYCLE! 対象にする。
// DOM/Node 非依存。

import type { A1Ref, Expr } from './ast';

/** セルの数値キー（row*cols + col）。 */
export type CellKey = number;

/** 正規化済みの矩形範囲（inclusive index）。 */
export interface RangeDep {
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly colStart: number;
  readonly colEnd: number;
}

export type RangeStrategy = 'expand' | 'interval';

export function normalizeRange(a: A1Ref, b: A1Ref): RangeDep {
  return {
    rowStart: Math.min(a.row, b.row),
    rowEnd: Math.max(a.row, b.row),
    colStart: Math.min(a.col, b.col),
    colEnd: Math.max(a.col, b.col),
  };
}

/** AST から precedent（参照セル・範囲）を抽出する。 */
export function precedentsOf(ast: Expr): { cells: A1Ref[]; ranges: RangeDep[] } {
  const cells: A1Ref[] = [];
  const ranges: RangeDep[] = [];
  const walk = (e: Expr): void => {
    switch (e.kind) {
      case 'cell':
        cells.push(e.ref);
        break;
      case 'range':
        ranges.push(normalizeRange(e.start, e.end));
        break;
      case 'unary':
        walk(e.operand);
        break;
      case 'binary':
        walk(e.left);
        walk(e.right);
        break;
      case 'func':
        e.args.forEach(walk);
        break;
      case 'number':
      case 'string':
        break;
    }
  };
  walk(ast);
  return { cells, ranges };
}

interface FormulaEntry {
  readonly cells: CellKey[];
  readonly ranges: RangeDep[];
}
interface Interval {
  readonly r0: number;
  readonly r1: number;
  readonly formula: CellKey;
}

export class DependencyGraph {
  private readonly formulas = new Map<CellKey, FormulaEntry>();
  private readonly directDependents = new Map<CellKey, Set<CellKey>>();
  private readonly columnIntervals = new Map<number, Interval[]>();

  constructor(
    private readonly cols: number,
    private readonly strategy: RangeStrategy = 'expand',
  ) {}

  keyOf(row: number, col: number): CellKey {
    return row * this.cols + col;
  }
  rowOf(key: CellKey): number {
    return Math.floor(key / this.cols);
  }
  colOf(key: CellKey): number {
    return key % this.cols;
  }

  private addDependent(cell: CellKey, formula: CellKey): void {
    let set = this.directDependents.get(cell);
    if (set === undefined) {
      set = new Set();
      this.directDependents.set(cell, set);
    }
    set.add(formula);
  }

  /** formula cell の precedent を登録する（A1Ref/範囲を index キーへ）。 */
  setFormula(row: number, col: number, ast: Expr): void {
    const formula = this.keyOf(row, col);
    const { cells: refCells, ranges } = precedentsOf(ast);
    const cellKeys = refCells.map((r) => this.keyOf(r.row, r.col));
    this.formulas.set(formula, { cells: cellKeys, ranges });
    for (const c of cellKeys) this.addDependent(c, formula);
    for (const range of ranges) {
      if (this.strategy === 'expand') {
        for (let r = range.rowStart; r <= range.rowEnd; r += 1) {
          for (let c = range.colStart; c <= range.colEnd; c += 1) {
            this.addDependent(this.keyOf(r, c), formula);
          }
        }
      } else {
        for (let c = range.colStart; c <= range.colEnd; c += 1) {
          let list = this.columnIntervals.get(c);
          if (list === undefined) {
            list = [];
            this.columnIntervals.set(c, list);
          }
          list.push({ r0: range.rowStart, r1: range.rowEnd, formula });
        }
      }
    }
  }

  /** cell を直接/範囲経由で参照している formula cell を列挙する。 */
  private dependentsOf(cell: CellKey): CellKey[] {
    const result = new Set<CellKey>();
    const direct = this.directDependents.get(cell);
    if (direct !== undefined) for (const f of direct) result.add(f);
    if (this.strategy === 'interval') {
      const row = this.rowOf(cell);
      const col = this.colOf(cell);
      const intervals = this.columnIntervals.get(col);
      if (intervals !== undefined) {
        for (const iv of intervals) {
          if (row >= iv.r0 && row <= iv.r1) result.add(iv.formula);
        }
      }
    }
    return [...result];
  }

  /**
   * 変更セルから、影響を受ける formula cell を「precedent が先」の順序で返す。
   * 循環に含まれる formula は cycle 集合へ（#CYCLE! 対象）。
   */
  recalcOrder(changed: Iterable<CellKey>): { order: CellKey[]; cycle: Set<CellKey> } {
    // 影響を受ける formula 集合を BFS で収集。
    const affected = new Set<CellKey>();
    const queue: CellKey[] = [];
    for (const c of changed) {
      for (const f of this.dependentsOf(c)) {
        if (!affected.has(f)) {
          affected.add(f);
          queue.push(f);
        }
      }
    }
    while (queue.length > 0) {
      const cell = queue.shift();
      if (cell === undefined) break;
      for (const f of this.dependentsOf(cell)) {
        if (!affected.has(f)) {
          affected.add(f);
          queue.push(f);
        }
      }
    }
    return this.topoSort(affected);
  }

  /** 全 formula cell を topological order で返す（初回一括再計算用）。 */
  orderAll(): { order: CellKey[]; cycle: Set<CellKey> } {
    return this.topoSort(new Set(this.formulas.keys()));
  }

  // affected 内の precedent formula を固定ID昇順で返す（function-spec §5・Codex P2）。
  // cell 参照は集合照合・範囲は affected を走査。f 自身も含める（自己参照・範囲自己包含＝自己ループ）。
  private precedentsIn(affected: Set<CellKey>, f: CellKey): CellKey[] {
    const entry = this.formulas.get(f);
    if (entry === undefined) return [];
    const result = new Set<CellKey>();
    for (const c of entry.cells) if (affected.has(c)) result.add(c);
    if (entry.ranges.length > 0) {
      for (const g of affected) {
        const row = this.rowOf(g);
        const col = this.colOf(g);
        if (
          entry.ranges.some(
            (r) => row >= r.rowStart && row <= r.rowEnd && col >= r.colStart && col <= r.colEnd,
          )
        ) {
          result.add(g);
        }
      }
    }
    return [...result].sort((a, b) => a - b);
  }

  /**
   * 反復 Tarjan で SCC を求め、precedent 先の順序と循環集合を返す。
   * - **強連結成分の全メンバー**を検出し循環へ含める（gray-path 方式の検出漏れを解消・Codex P1）。
   * - SCC は完了順＝precedent 先で order へ並べる（sink SCC が先＝依存されない側が先）。
   * - 循環＝SCCサイズ>1 または自己ループ。開始順・precedent 順は固定ID昇順で安定（function-spec §5）。
   * - 反復実装で深い依存チェーンでもスタック枯渇しない（AC8 の系）。
   */
  private topoSort(affected: Set<CellKey>): { order: CellKey[]; cycle: Set<CellKey> } {
    const order: CellKey[] = [];
    const cycle = new Set<CellKey>();
    const index = new Map<CellKey, number>();
    const low = new Map<CellKey, number>();
    const onStack = new Set<CellKey>();
    const selfLoop = new Set<CellKey>();
    const tarjanStack: CellKey[] = [];
    let counter = 0;

    const starts = [...affected].sort((a, b) => a - b); // 固定ID昇順で開始（決定性）
    for (const start of starts) {
      if (index.has(start)) continue;
      interface Frame { node: CellKey; preds: CellKey[]; i: number }
      const work: Frame[] = [];
      const push = (v: CellKey): void => {
        index.set(v, counter);
        low.set(v, counter);
        counter += 1;
        tarjanStack.push(v);
        onStack.add(v);
        const preds = this.precedentsIn(affected, v);
        if (preds.includes(v)) selfLoop.add(v);
        work.push({ node: v, preds, i: 0 });
      };
      push(start);
      while (work.length > 0) {
        const frame = work[work.length - 1];
        if (frame === undefined) break;
        if (frame.i < frame.preds.length) {
          const w = frame.preds[frame.i];
          frame.i += 1;
          if (w === undefined) continue;
          if (!index.has(w)) {
            push(w);
          } else if (onStack.has(w)) {
            low.set(frame.node, Math.min(low.get(frame.node) ?? 0, index.get(w) ?? 0));
          }
        } else {
          const v = frame.node;
          if ((low.get(v) ?? 0) === (index.get(v) ?? 0)) {
            // SCC 根: v まで pop（完了順＝precedent 先）。
            const scc: CellKey[] = [];
            for (;;) {
              const w = tarjanStack.pop();
              if (w === undefined) break;
              onStack.delete(w);
              scc.push(w);
              if (w === v) break;
            }
            const isCycle = scc.length > 1 || selfLoop.has(v);
            // SCC 内も固定ID昇順で order へ（決定性）。
            for (const w of scc.sort((a, b) => a - b)) {
              order.push(w);
              if (isCycle) cycle.add(w);
            }
          }
          work.pop();
          const parent = work[work.length - 1];
          if (parent !== undefined) {
            low.set(parent.node, Math.min(low.get(parent.node) ?? 0, low.get(v) ?? 0));
          }
        }
      }
    }
    return { order, cycle };
  }

  /** 影響を受ける formula の集合（順序なし・等価性比較用）。 */
  affectedSet(changed: Iterable<CellKey>): Set<CellKey> {
    return new Set(this.recalcOrder(changed).order);
  }
}
