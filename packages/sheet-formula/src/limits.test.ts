// Phase 2 Red→Green: 資源制限の境界・超過（scenarios.md §3・AC8）。
// いかなる超過入力でも例外送出・スタック枯渇・フリーズを起こさず対応エラー値を返す。

import { describe, expect, it } from 'vitest';
import { parse } from './parser';
import { DEFAULT_LIMITS, type FormulaLimits } from './limits';

const withLimit = (over: Partial<FormulaLimits>): FormulaLimits => ({ ...DEFAULT_LIMITS, ...over });

describe('L1 数式長', () => {
  it('8192文字ちょうどは通過・8193は #ERROR!', () => {
    const at = '="' + 'a'.repeat(8189) + '"'; // 長さ 8192
    expect(at.length).toBe(8192);
    expect(parse(at).ok).toBe(true);
    const over = '="' + 'a'.repeat(8190) + '"'; // 長さ 8193
    expect(over.length).toBe(8193);
    const r = parse(over);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('#ERROR!');
  });
});

describe('L2 ASTノード数', () => {
  it('上限内は通過・超過は #ERROR!', () => {
    expect(parse('=1+1', withLimit({ maxAstNodes: 3 })).ok).toBe(true); // 3 ノード
    const r = parse('=1+1+1', withLimit({ maxAstNodes: 3 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('#ERROR!');
  });
});

describe('L3 ネスト深さ（スタック枯渇防止）', () => {
  it('深さ64は通過・65は #ERROR!', () => {
    const ok = '=' + '('.repeat(64) + '1' + ')'.repeat(64);
    expect(parse(ok).ok).toBe(true);
    const over = '=' + '('.repeat(65) + '1' + ')'.repeat(65);
    const r = parse(over);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('#ERROR!');
  });
  it('極端に深いネストでもクラッシュせずエラー値を返す', () => {
    const deep = '=' + '('.repeat(100_000) + '1' + ')'.repeat(100_000);
    const r = parse(deep);
    expect(r.ok).toBe(false); // 例外/スタックオーバーフローで落ちない
  });
});

describe('L4 関数引数数', () => {
  it('255個は通過・256個は #ERROR!', () => {
    const args255 = '=SUM(' + Array<string>(255).fill('1').join(',') + ')';
    expect(parse(args255).ok).toBe(true);
    const args256 = '=SUM(' + Array<string>(256).fill('1').join(',') + ')';
    const r = parse(args256);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('#ERROR!');
  });
});

describe('L5 範囲セル数', () => {
  it('上限超過の範囲は #REF!', () => {
    const r = parse('=SUM(A1:B10)', withLimit({ maxRangeCells: 5 })); // 2×10=20 > 5
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('#REF!');
  });
});
