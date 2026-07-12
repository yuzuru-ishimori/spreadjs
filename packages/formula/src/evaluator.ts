// 評価器（§14.7・function-spec.md §2〜§5・scenarios.md §6）。CellReader 抽象上で AST を評価する。
// 5関数（SUM/AVERAGE/MIN/MAX/COUNT）・空白/文字列/エラー伝播・特殊値（非有限→#VALUE!・0除算優先・
// 負の0正規化）・ロケール不変・評価時資源制限 L6（処理量カウンタ）。DOM/Node 非依存。

import type { A1Ref, BinaryOp, Expr, FunctionName } from './ast';
import type { ErrorValue } from './errors';
import type { FormulaLimits } from './limits';
import { DEFAULT_LIMITS } from './limits';

/** セル値（§6.4 CellScalar に対応）。評価の入力・出力の共通表現。 */
export type CellValue =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'blank' }
  | { readonly kind: 'error'; readonly error: ErrorValue };

export const blank: CellValue = { kind: 'blank' };
export const num = (value: number): CellValue => ({ kind: 'number', value });
export const str = (value: string): CellValue => ({ kind: 'string', value });
export const err = (error: ErrorValue): CellValue => ({ kind: 'error', error });

/** セル値アクセス抽象（core 文書モデルとの結合は Phase 1）。index ベースで読む。 */
export interface CellReader {
  read(row: number, col: number): CellValue;
  /** [rowStart,rowEnd)×[colStart,colEnd) の非空セルだけを visit する（範囲集計用）。 */
  readRange(
    rowStart: number,
    rowEnd: number,
    colStart: number,
    colEnd: number,
    visit: (row: number, col: number, value: CellValue) => void,
  ): void;
}

class EvalError {
  constructor(readonly error: ErrorValue) {}
}

/** -0 を +0 へ正規化。 */
const normZero = (n: number): number => (n === 0 ? 0 : n);

/** 非有限（Infinity/NaN）を値化しない: 有限なら number 値、そうでなければ #VALUE!（§2.1）。 */
function finiteOrValueError(n: number): CellValue {
  return Number.isFinite(n) ? num(normZero(n)) : err('#VALUE!');
}

/**
 * ロケール非依存の10進数パース（function-spec §2.2）。ASCII の `[+-]?(d+(.d*)?|.d+)` のみ受理。
 * `Number` が受ける 16進(`0x10`)・指数(`1e3`)・前後空白・`Infinity` 等は**受理しない**（null を返す）。
 */
function parseDecimal(s: string): number | null {
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** セルから読んだ number の健全化（非有限→#VALUE!・-0 正規化）。§2.1。 */
function normalizeCell(v: CellValue): CellValue {
  if (v.kind === 'number') return Number.isFinite(v.value) ? num(normZero(v.value)) : err('#VALUE!');
  return v;
}

/** 算術オペランドを数値へ強制（blank→0・文字列→10進変換・error→伝播）。 */
function toNumber(v: CellValue): { readonly n: number } | { readonly error: ErrorValue } {
  switch (v.kind) {
    case 'number':
      return { n: v.value };
    case 'blank':
      return { n: 0 };
    case 'error':
      return { error: v.error };
    case 'string': {
      const n = parseDecimal(v.value);
      return n === null ? { error: '#VALUE!' } : { n };
    }
  }
}

interface FnSpec {
  readonly propagateError: boolean; // true=SUM/AVG/MIN/MAX、false=COUNT
  readonly coerceScalarString: boolean; // スカラー文字列を数値変換するか（COUNT は skip）
}
const FN_SPEC: Record<FunctionName, FnSpec> = {
  SUM: { propagateError: true, coerceScalarString: true },
  AVERAGE: { propagateError: true, coerceScalarString: true },
  MIN: { propagateError: true, coerceScalarString: true },
  MAX: { propagateError: true, coerceScalarString: true },
  COUNT: { propagateError: false, coerceScalarString: false },
};

export function evaluate(
  ast: Expr,
  reader: CellReader,
  limits: FormulaLimits = DEFAULT_LIMITS,
): CellValue {
  let steps = 0;
  const tick = (n = 1): void => {
    steps += n;
    if (steps > limits.maxEvalSteps) throw new EvalError('#ERROR!');
  };

  const readCell = (ref: A1Ref): CellValue => {
    tick();
    return normalizeCell(reader.read(ref.row, ref.col));
  };

  /** 関数の引数列から数値を収集（範囲は非空のみ走査・文字列/空白/日付は無視）。 */
  function collect(
    args: readonly Expr[],
    spec: FnSpec,
  ): { readonly numbers: number[] } | { readonly error: ErrorValue } {
    const numbers: number[] = [];
    for (const arg of args) {
      if (arg.kind === 'range') {
        const r0 = Math.min(arg.start.row, arg.end.row);
        const r1 = Math.max(arg.start.row, arg.end.row) + 1;
        const c0 = Math.min(arg.start.col, arg.end.col);
        const c1 = Math.max(arg.start.col, arg.end.col) + 1;
        // L6: 範囲走査は矩形セル数分の処理量として計上（空セル走査も含め有界化・Codex P2）。
        tick((r1 - r0) * (c1 - c0));
        let rangeError: ErrorValue | undefined;
        reader.readRange(r0, r1, c0, c1, (_row, _col, value) => {
          if (rangeError !== undefined) return;
          const nv = normalizeCell(value);
          if (nv.kind === 'number') numbers.push(nv.value);
          else if (nv.kind === 'error' && spec.propagateError) rangeError = nv.error;
          // 範囲内の文字列・空白は無視（COUNT のエラーも無視）。
        });
        if (rangeError !== undefined) return { error: rangeError };
      } else {
        const v = ev(arg);
        if (v.kind === 'number') {
          numbers.push(v.value);
        } else if (v.kind === 'error') {
          if (spec.propagateError) return { error: v.error };
        } else if (v.kind === 'string') {
          if (spec.coerceScalarString) {
            const n = parseDecimal(v.value);
            if (n !== null) numbers.push(n);
            else return { error: '#VALUE!' };
          }
          // COUNT はスカラー文字列を無視。
        }
        // blank はスカラーでも数値0件扱い（skip）。
      }
    }
    return { numbers };
  }

  function callFunction(name: FunctionName, args: readonly Expr[]): CellValue {
    const spec = FN_SPEC[name];
    const collected = collect(args, spec);
    if ('error' in collected) return err(collected.error);
    const nums = collected.numbers;
    switch (name) {
      case 'SUM':
        return finiteOrValueError(nums.reduce((a, b) => a + b, 0));
      case 'AVERAGE':
        return nums.length === 0 ? err('#DIV/0!') : finiteOrValueError(nums.reduce((a, b) => a + b, 0) / nums.length);
      case 'MIN': {
        if (nums.length === 0) return num(0);
        let m = nums[0] ?? 0;
        for (const x of nums) if (x < m) m = x; // spread しない（大範囲で RangeError を出さない・Codex P1）
        return finiteOrValueError(m);
      }
      case 'MAX': {
        if (nums.length === 0) return num(0);
        let m = nums[0] ?? 0;
        for (const x of nums) if (x > m) m = x;
        return finiteOrValueError(m);
      }
      case 'COUNT':
        return num(nums.length);
    }
  }

  function ev(e: Expr): CellValue {
    tick();
    switch (e.kind) {
      case 'number':
        return num(normZero(e.value));
      case 'string':
        // 文字列リテラルは常に文字列（エラー表記もそのまま文字列。セル由来エラーは CellValue.kind==='error'）。
        return str(e.value);
      case 'cell':
        return readCell(e.ref);
      case 'range':
        return err('#VALUE!'); // 範囲はスカラー文脈では使えない。
      case 'unary': {
        const operand = toNumber(ev(e.operand));
        if ('error' in operand) return err(operand.error);
        return finiteOrValueError(e.op === '-' ? -operand.n : operand.n);
      }
      case 'binary': {
        // 左辺を先に評価し、エラーなら短絡（右辺の資源超過等より左辺エラーを優先・Codex P2）。
        const left = ev(e.left);
        if (left.kind === 'error') return left;
        return evalBinary(e.op, left, ev(e.right));
      }
      case 'func':
        return callFunction(e.name, e.args);
    }
  }

  function evalBinary(op: BinaryOp, left: CellValue, right: CellValue): CellValue {
    const a = toNumber(left);
    if ('error' in a) return err(a.error);
    const b = toNumber(right);
    if ('error' in b) return err(b.error);
    switch (op) {
      case '+':
        return finiteOrValueError(a.n + b.n);
      case '-':
        return finiteOrValueError(a.n - b.n);
      case '*':
        return finiteOrValueError(a.n * b.n);
      case '/':
        return b.n === 0 ? err('#DIV/0!') : finiteOrValueError(a.n / b.n);
      case '^':
        return finiteOrValueError(Math.pow(a.n, b.n));
    }
  }

  try {
    return ev(ast);
  } catch (e) {
    if (e instanceof EvalError) return err(e.error);
    throw e;
  }
}

/** CellValue を表示文字列へ（レポート/デバッグ用）。 */
export function cellValueToString(v: CellValue): string {
  switch (v.kind) {
    case 'number':
      return String(v.value);
    case 'string':
      return v.value;
    case 'blank':
      return '';
    case 'error':
      return v.error;
  }
}
