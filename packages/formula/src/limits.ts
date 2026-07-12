// parser/evaluator の資源制限（function-spec.md §1・DD-006 AC8）。
// 数式は外部入力。入力量・構造深さ・処理量を明示上限で有界化し、超過時は例外を投げず
// 対応エラー値で安全に停止する（スタック枯渇・フリーズ・暴走を起こさない）。

export interface FormulaLimits {
  /** L1 数式文字列の最大長（`=` 含む全長）。超過→ #ERROR! */
  readonly maxFormulaChars: number;
  /** L2 AST 最大ノード数。超過→ #ERROR! */
  readonly maxAstNodes: number;
  /** L3 括弧・関数呼び出しの合成ネスト最大深さ。超過→ #ERROR!（スタック枯渇防止） */
  readonly maxNestDepth: number;
  /** L4 1関数あたり最大引数数。超過→ #ERROR! */
  readonly maxFunctionArgs: number;
  /** L5 単一範囲参照の最大矩形セル数。超過→ #REF! */
  readonly maxRangeCells: number;
  /** L6 1式あたり evaluate 処理量上限（step）。超過→ #ERROR! */
  readonly maxEvalSteps: number;
}

/** 提案上限値（function-spec §1・Excel 準拠。実測後に確定余地）。 */
export const DEFAULT_LIMITS: FormulaLimits = {
  maxFormulaChars: 8192,
  maxAstNodes: 8192,
  maxNestDepth: 64,
  maxFunctionArgs: 255,
  maxRangeCells: 10_000_000,
  maxEvalSteps: 4_000_000,
};
