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

  private topoSort(affected: Set<CellKey>): { order: CellKey[]; cycle: Set<CellKey> } {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<CellKey, number>();
    const order: CellKey[] = [];
    const cycle = new Set<CellKey>();

    // affected 内の precedent formula を返す（cell 参照は集合照合・範囲は affected を走査）。
    // g===f も含める（自己参照 A1=A1+1・範囲自己包含 A1=SUM(A1:A3) は自己ループ＝循環）。
    const precedentsIn = (f: CellKey): CellKey[] => {
      const entry = this.formulas.get(f);
      if (entry === undefined) return [];
      const result: CellKey[] = [];
      for (const c of entry.cells) if (affected.has(c)) result.push(c);
      if (entry.ranges.length > 0) {
        for (const g of affected) {
          const row = this.rowOf(g);
          const col = this.colOf(g);
          if (
            entry.ranges.some(
              (r) => row >= r.rowStart && row <= r.rowEnd && col >= r.colStart && col <= r.colEnd,
            )
          ) {
            result.push(g);
          }
        }
      }
      return result;
    };

    // 反復 DFS（深い依存チェーンでもスタック枯渇しない＝AC8 の系）。
    for (const start of affected) {
      if ((color.get(start) ?? WHITE) !== WHITE) continue;
      const frames: Array<{ node: CellKey; preds: CellKey[]; i: number }> = [];
      const path: CellKey[] = [];
      color.set(start, GRAY);
      frames.push({ node: start, preds: precedentsIn(start), i: 0 });
      path.push(start);
      while (frames.length > 0) {
        const top = frames[frames.length - 1];
        if (top === undefined) break;
        if (top.i < top.preds.length) {
          const g = top.preds[top.i];
          top.i += 1;
          if (g === undefined) continue;
          const gc = color.get(g) ?? WHITE;
          if (gc === WHITE) {
            color.set(g, GRAY);
            frames.push({ node: g, preds: precedentsIn(g), i: 0 });
            path.push(g);
          } else if (gc === GRAY) {
            const idx = path.lastIndexOf(g);
            if (idx >= 0) for (let k = idx; k < path.length; k += 1) cycle.add(path[k] ?? g);
          }
        } else {
          color.set(top.node, BLACK);
          order.push(top.node);
          frames.pop();
          path.pop();
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
