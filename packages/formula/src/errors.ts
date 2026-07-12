// 数式エラー値（6種・要確認5回答・function-spec.md §4）。エラーは値として伝播する。

export type ErrorValue =
  | '#REF!' // 参照先削除・範囲外
  | '#CYCLE!' // 循環参照
  | '#DIV/0!' // 0除算・AVERAGE 数値0件
  | '#VALUE!' // 型不一致・非有限化（暫定・将来 #NUM!）
  | '#NAME?' // 未知関数
  | '#ERROR!'; // 構文エラー・資源制限超過

export const ERROR_VALUES: readonly ErrorValue[] = [
  '#REF!',
  '#CYCLE!',
  '#DIV/0!',
  '#VALUE!',
  '#NAME?',
  '#ERROR!',
];

/** 文字列がエラー値か。 */
export function isErrorValue(s: string): s is ErrorValue {
  return (ERROR_VALUES as readonly string[]).includes(s);
}
