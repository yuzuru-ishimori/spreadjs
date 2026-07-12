// A1 形式の列表記 ↔ 0 始まり列 index の相互変換。ロケール非依存（§14.8）。

/** 列文字（"A"→0・"Z"→25・"AA"→26…）を 0 始まり index へ。大文字小文字非区別。 */
export function lettersToCol(letters: string): number {
  let col = 0;
  const upper = letters.toUpperCase();
  for (let i = 0; i < upper.length; i += 1) {
    col = col * 26 + (upper.charCodeAt(i) - 64); // 'A'=65 → 1
  }
  return col - 1;
}

/** 0 始まり index を列文字へ（0→"A"）。 */
export function colToLetters(col: number): string {
  let n = col + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
