// 再帰下降パーサ（§14.2 文法・scenarios.md §2〜§3）。canonical AST を生成する。
// 演算子優先順位・べき乗左結合（Excel 準拠）・単項・比較演算子拒否・関数呼び出し・資源制限。
// エラーは例外（ParseError）で内部伝播し、最上位で対応エラー値へ変換（例外を外へ出さない）。
// DOM/Node 非依存。

import type { BinaryOp, Expr, FunctionName, UnaryOp } from './ast';
import { KNOWN_FUNCTIONS } from './ast';
import type { ErrorValue } from './errors';
import type { FormulaLimits } from './limits';
import { DEFAULT_LIMITS } from './limits';
import { tokenize, type Token } from './tokenizer';

export type ParseResult =
  | { readonly ok: true; readonly ast: Expr }
  | { readonly ok: false; readonly error: ErrorValue };

class ParseError {
  constructor(readonly error: ErrorValue) {}
}

const COMPARISON_OPS = ['<', '>', '<=', '>=', '=', '<>'] as const;

export function parse(formula: string, limits: FormulaLimits = DEFAULT_LIMITS): ParseResult {
  // L1 数式長。
  if (formula.length > limits.maxFormulaChars) return { ok: false, error: '#ERROR!' };
  if (formula[0] !== '=') return { ok: false, error: '#ERROR!' };
  const tk = tokenize(formula.slice(1));
  if (!tk.ok) return { ok: false, error: tk.error };
  const tokens = tk.tokens;
  if (tokens.length === 0) return { ok: false, error: '#ERROR!' };

  let pos = 0;
  let nodeCount = 0;
  let depth = 0;

  const peek = (): Token | undefined => tokens[pos];
  const isPunct = (p: string): boolean => {
    const t = tokens[pos];
    return t !== undefined && t.kind === 'punct' && t.punct === p;
  };
  const matchOp = (ops: readonly string[]): string | undefined => {
    const t = tokens[pos];
    if (t !== undefined && t.kind === 'punct' && ops.includes(t.punct)) {
      pos += 1;
      return t.punct;
    }
    return undefined;
  };
  const node = <T extends Expr>(e: T): T => {
    nodeCount += 1;
    if (nodeCount > limits.maxAstNodes) throw new ParseError('#ERROR!');
    return e;
  };
  const enter = (): void => {
    depth += 1;
    if (depth > limits.maxNestDepth) throw new ParseError('#ERROR!');
  };
  const leave = (): void => {
    depth -= 1;
  };

  const parseExpression = (): Expr => parseComparison();

  function parseComparison(): Expr {
    const left = parseAdditive();
    const t = peek();
    if (t !== undefined && t.kind === 'punct' && (COMPARISON_OPS as readonly string[]).includes(t.punct)) {
      throw new ParseError('#ERROR!'); // 比較演算子は MVP 予約のみ・拒否。
    }
    return left;
  }

  function parseAdditive(): Expr {
    let left = parseMultiplicative();
    for (;;) {
      const op = matchOp(['+', '-']);
      if (op === undefined) break;
      const right = parseMultiplicative();
      left = node({ kind: 'binary', op: op as BinaryOp, left, right });
    }
    return left;
  }

  function parseMultiplicative(): Expr {
    let left = parsePower();
    for (;;) {
      const op = matchOp(['*', '/']);
      if (op === undefined) break;
      const right = parsePower();
      left = node({ kind: 'binary', op: op as BinaryOp, left, right });
    }
    return left;
  }

  function parsePower(): Expr {
    // 左結合（Excel 準拠: 2^3^2 = (2^3)^2）。
    let left = parseUnary();
    for (;;) {
      const op = matchOp(['^']);
      if (op === undefined) break;
      const right = parseUnary();
      left = node({ kind: 'binary', op: '^', left, right });
    }
    return left;
  }

  function parseUnary(): Expr {
    // 単項演算子列は反復収集する（`----…5` の深い再帰でスタック枯渇しない・AC8/Codex P1）。
    const ops: UnaryOp[] = [];
    for (;;) {
      const op = matchOp(['+', '-']);
      if (op === undefined) break;
      ops.push(op as UnaryOp);
      if (ops.length > limits.maxNestDepth) throw new ParseError('#ERROR!'); // L3: 単項連鎖も深さ制限
    }
    let expr = parsePrimary();
    for (let i = ops.length - 1; i >= 0; i -= 1) {
      expr = node({ kind: 'unary', op: ops[i] ?? '-', operand: expr });
    }
    return expr;
  }

  function parseFunctionCall(name: string): Expr {
    pos += 1; // consume '('
    enter();
    const upper = name.toUpperCase();
    if (!(KNOWN_FUNCTIONS as readonly string[]).includes(upper)) {
      throw new ParseError('#NAME?');
    }
    const args: Expr[] = [];
    if (!isPunct(')')) {
      args.push(parseExpression());
      while (isPunct(',')) {
        pos += 1;
        args.push(parseExpression());
        if (args.length > limits.maxFunctionArgs) throw new ParseError('#ERROR!');
      }
    }
    if (!isPunct(')')) throw new ParseError('#ERROR!');
    pos += 1;
    leave();
    if (args.length === 0) throw new ParseError('#ERROR!'); // 最小1引数。
    return node({ kind: 'func', name: upper as FunctionName, args });
  }

  function parsePrimary(): Expr {
    const t = peek();
    if (t === undefined) throw new ParseError('#ERROR!');
    if (t.kind === 'number') {
      pos += 1;
      return node({ kind: 'number', value: t.value });
    }
    if (t.kind === 'string') {
      pos += 1;
      return node({ kind: 'string', value: t.value });
    }
    if (t.kind === 'cell') {
      pos += 1;
      if (isPunct(':')) {
        pos += 1;
        const t2 = peek();
        if (t2 === undefined || t2.kind !== 'cell') throw new ParseError('#ERROR!');
        pos += 1;
        // L5 単一範囲の最大矩形セル数（超過→ #REF!）。
        const cells =
          (Math.abs(t2.ref.col - t.ref.col) + 1) * (Math.abs(t2.ref.row - t.ref.row) + 1);
        if (cells > limits.maxRangeCells) throw new ParseError('#REF!');
        return node({ kind: 'range', start: t.ref, end: t2.ref });
      }
      return node({ kind: 'cell', ref: t.ref });
    }
    if (t.kind === 'ident') {
      pos += 1;
      if (!isPunct('(')) throw new ParseError('#NAME?'); // 裸の識別子 = 未知の名前。
      return parseFunctionCall(t.name);
    }
    if (t.kind === 'punct' && t.punct === '(') {
      pos += 1;
      enter();
      const inner = parseExpression();
      if (!isPunct(')')) throw new ParseError('#ERROR!');
      pos += 1;
      leave();
      return inner;
    }
    throw new ParseError('#ERROR!');
  }

  try {
    const ast = parseExpression();
    if (pos !== tokens.length) return { ok: false, error: '#ERROR!' }; // 余りトークン。
    return { ok: true, ast };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, error: e.error };
    throw e;
  }
}
