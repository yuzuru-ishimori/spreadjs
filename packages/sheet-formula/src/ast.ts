// canonical AST（§14.2）。空白違いの式は同一 AST になる（トークン列から構造のみを保持）。
// セル参照は解析時に A1Ref（col/row 0始まり＋$属性）で保持し、bind.ts で BoundCellReference へ束縛する。

import { colToLetters } from './a1';

/** A1 参照（0 始まり col/row・絶対相対属性）。$ は構文解釈のみ保持（rebind 適用は Phase 1）。 */
export interface A1Ref {
  readonly col: number;
  readonly row: number;
  readonly colAbs: boolean;
  readonly rowAbs: boolean;
}

export const KNOWN_FUNCTIONS = ['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT'] as const;
export type FunctionName = (typeof KNOWN_FUNCTIONS)[number];

export type BinaryOp = '+' | '-' | '*' | '/' | '^';
export type UnaryOp = '+' | '-';

export type Expr =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'cell'; readonly ref: A1Ref }
  | { readonly kind: 'range'; readonly start: A1Ref; readonly end: A1Ref }
  | { readonly kind: 'unary'; readonly op: UnaryOp; readonly operand: Expr }
  | { readonly kind: 'binary'; readonly op: BinaryOp; readonly left: Expr; readonly right: Expr }
  | { readonly kind: 'func'; readonly name: FunctionName; readonly args: readonly Expr[] };

/** A1Ref を A1 文字列へ（$ 属性反映）。 */
export function refToA1(ref: A1Ref): string {
  const c = `${ref.colAbs ? '$' : ''}${colToLetters(ref.col)}`;
  const r = `${ref.rowAbs ? '$' : ''}${ref.row + 1}`;
  return c + r;
}

/** canonical シリアライズ（同一 AST → 同一文字列。テスト/デバッグ用）。 */
export function serialize(expr: Expr): string {
  switch (expr.kind) {
    case 'number':
      return String(expr.value);
    case 'string':
      return JSON.stringify(expr.value);
    case 'cell':
      return refToA1(expr.ref);
    case 'range':
      return `${refToA1(expr.start)}:${refToA1(expr.end)}`;
    case 'unary':
      return `(${expr.op}${serialize(expr.operand)})`;
    case 'binary':
      return `(${serialize(expr.left)}${expr.op}${serialize(expr.right)})`;
    case 'func':
      return `${expr.name}(${expr.args.map(serialize).join(',')})`;
  }
}
