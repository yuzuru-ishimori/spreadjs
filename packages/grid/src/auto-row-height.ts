// 自動行高の高さ算出（DD-012-5 D5・Excel 風）。DOM 非依存の純関数で TDD する。
// wrap 列に非空値を持つ行の必要高 = max(各 wrap セルの行数) × lineHeight + padding×2。
// 1 行で収まる行は自動拡張しない（undefined＝既定高のまま）。値削除・短縮で行数が 1 以下へ戻れば undefined＝自動縮小。

/** 自動行高算出の入力（行内の wrap 非空セルごとの折り返し行数）。 */
export interface AutoRowHeightInput {
  /** 行内の各 wrap 非空セルの折り返し行数（空セルは含めない）。 */
  readonly lineCounts: readonly number[];
  /** 1 行あたりの高さ（px・base-layer の描画 lineHeight と一致）。 */
  readonly lineHeight: number;
  /** セル上下パディング（px・片側）。 */
  readonly padding: number;
  /** 既定行高（px）。これ以下になる自動高は採用しない（拡張のみ・Excel 風）。 */
  readonly defaultHeight: number;
}

/**
 * 自動行高（px）を返す。拡張不要（最大行数 <= 1）なら undefined（＝既定高／自動高なし）。
 * 手動 override の優先判定は呼び出し側（DocumentView）が行う（ここは高さ算出のみ）。
 */
export function autoRowHeight(input: AutoRowHeightInput): number | undefined {
  let maxLines = 0;
  for (const n of input.lineCounts) {
    if (n > maxLines) {
      maxLines = n;
    }
  }
  if (maxLines <= 1) {
    return undefined;
  }
  const height = maxLines * input.lineHeight + input.padding * 2;
  return height > input.defaultHeight ? height : undefined;
}
