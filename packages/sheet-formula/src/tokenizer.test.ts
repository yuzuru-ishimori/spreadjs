// Phase 2 Red→Green: トークナイザ（scenarios.md §1）。

import { describe, expect, it } from 'vitest';
import { tokenize, type Token } from './tokenizer';

function kinds(src: string): string[] {
  const r = tokenize(src);
  if (!r.ok) return ['ERR'];
  return r.tokens.map((t) => t.kind);
}
function toks(src: string): readonly Token[] {
  const r = tokenize(src);
  if (!r.ok) throw new Error(`tokenize failed: ${src}`);
  return r.tokens;
}

describe('tokenizer 数値', () => {
  it('12 / 12.5 / .5 / 0 を数値トークン化', () => {
    expect(toks('12')).toEqual([{ kind: 'number', value: 12, pos: 0 }]);
    expect((toks('12.5')[0] as { value: number }).value).toBe(12.5);
    expect((toks('.5')[0] as { value: number }).value).toBe(0.5);
    expect((toks('0')[0] as { value: number }).value).toBe(0);
  });
  it('小数点2つ 12.3.4 はエラー', () => {
    expect(tokenize('12.3.4').ok).toBe(false);
  });
});

describe('tokenizer 文字列', () => {
  it('"abc" を文字列化', () => {
    expect(toks('"abc"')).toEqual([{ kind: 'string', value: 'abc', pos: 0 }]);
  });
  it('"a""b" は埋め込み引用で a"b', () => {
    expect((toks('"a""b"')[0] as { value: string }).value).toBe('a"b');
  });
  it('閉じない文字列はエラー', () => {
    expect(tokenize('"abc').ok).toBe(false);
  });
});

describe('tokenizer セル参照・識別子', () => {
  it('A1 / AA100 / $A$1 / A$1 / $A1 をセル参照化', () => {
    expect(toks('A1')).toEqual([{ kind: 'cell', ref: { col: 0, row: 0, colAbs: false, rowAbs: false }, pos: 0 }]);
    expect(toks('AA100')).toEqual([{ kind: 'cell', ref: { col: 26, row: 99, colAbs: false, rowAbs: false }, pos: 0 }]);
    expect(toks('$A$1')).toEqual([{ kind: 'cell', ref: { col: 0, row: 0, colAbs: true, rowAbs: true }, pos: 0 }]);
    expect(toks('A$1')).toEqual([{ kind: 'cell', ref: { col: 0, row: 0, colAbs: false, rowAbs: true }, pos: 0 }]);
    expect(toks('$A1')).toEqual([{ kind: 'cell', ref: { col: 0, row: 0, colAbs: true, rowAbs: false }, pos: 0 }]);
  });
  it('大文字小文字は非区別（a1 == A1）', () => {
    expect(toks('a1')).toEqual(toks('A1'));
  });
  it('SUM は識別子', () => {
    expect(toks('SUM')).toEqual([{ kind: 'ident', name: 'SUM', pos: 0 }]);
  });
  it('$ に数字が続かないのは不正（$A → エラー）', () => {
    expect(tokenize('$A').ok).toBe(false);
    expect(tokenize('A0').ok).toBe(false); // 行番号 0 は不正
  });
});

describe('tokenizer 記号・空白・ロケール', () => {
  it('演算子と括弧・コロン・カンマ', () => {
    expect(kinds('+-*/^(),:')).toEqual(
      ['punct', 'punct', 'punct', 'punct', 'punct', 'punct', 'punct', 'punct', 'punct'],
    );
  });
  it('比較演算子をトークン化（parser が拒否）', () => {
    const r = tokenize('<=>=<><>=');
    expect(r.ok).toBe(true);
  });
  it('空白は読み飛ばす（= 1 + 2 と 1+2 が同一トークン列・位置以外一致）', () => {
    const norm = (src: string): unknown[] => toks(src).map((t) => ({ ...t, pos: 0 }));
    expect(norm(' 1 +  2 ')).toEqual(norm('1+2'));
  });
  it('全角数字を含む式は不正（ロケール非依存 §14.8）', () => {
    expect(tokenize('１+２').ok).toBe(false);
  });
  it('未定義文字 @ はエラー', () => {
    expect(tokenize('@').ok).toBe(false);
  });
});
