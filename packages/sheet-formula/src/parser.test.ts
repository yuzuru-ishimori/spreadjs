// Phase 2 Red→Green: パーサ・canonical AST（scenarios.md §2）。

import { describe, expect, it } from 'vitest';
import { parse } from './parser';
import { serialize } from './ast';

/** 成功時は canonical シリアライズ、失敗時は例外。 */
function ser(formula: string): string {
  const r = parse(formula);
  if (!r.ok) throw new Error(`parse failed ${formula}: ${r.error}`);
  return serialize(r.ast);
}
/** 失敗時のエラー値（成功なら null）。 */
function err(formula: string): string | null {
  const r = parse(formula);
  return r.ok ? null : r.error;
}

describe('演算子優先順位・結合（Excel 準拠）', () => {
  it('乗除 > 加減', () => {
    expect(ser('=1+2*3')).toBe('(1+(2*3))');
    expect(ser('=(1+2)*3')).toBe('((1+2)*3)');
  });
  it('べき乗は左結合（2^3^2 = (2^3)^2）', () => {
    expect(ser('=2^3^2')).toBe('((2^3)^2)');
  });
  it('単項マイナスはべき乗より先（-2^2 = (-2)^2）', () => {
    expect(ser('=-2^2')).toBe('((-2)^2)');
  });
  it('単項連鎖 --5 / -+-5 / - - 5', () => {
    expect(ser('=--5')).toBe('(-(-5))');
    expect(ser('=-+-5')).toBe('(-(+(-5)))');
    expect(ser('=- - 5')).toBe('(-(-5))');
  });
  it('減算・除算は左結合', () => {
    expect(ser('=10-2-3')).toBe('((10-2)-3)');
    expect(ser('=10/2/5')).toBe('((10/2)/5)');
  });
  it('括弧', () => {
    expect(ser('=((1+2))')).toBe('(1+2)');
  });
});

describe('リテラル・比較拒否', () => {
  it('文字列・数値リテラル', () => {
    expect(ser('="abc"')).toBe('"abc"');
    expect(ser('=1.5')).toBe('1.5');
  });
  it('比較演算子は予約のみ・拒否', () => {
    expect(err('=1<2')).toBe('#ERROR!');
    expect(err('=A1=B1')).toBe('#ERROR!');
    expect(err('=1<>2')).toBe('#ERROR!');
  });
});

describe('関数呼び出し', () => {
  it('SUM(1,2,3)', () => {
    expect(ser('=SUM(1,2,3)')).toBe('SUM(1,2,3)');
  });
  it('入れ子 SUM(A1:A3, MAX(B1:B2), 10)', () => {
    expect(ser('=SUM(A1:A3, MAX(B1:B2), 10)')).toBe('SUM(A1:A3,MAX(B1:B2),10)');
  });
  it('引数0個 SUM() はエラー（最小1引数）', () => {
    expect(err('=SUM()')).toBe('#ERROR!');
  });
  it('未知関数 FOO(1) は #NAME?', () => {
    expect(err('=FOO(1)')).toBe('#NAME?');
  });
  it('裸の識別子 FOO は #NAME?', () => {
    expect(err('=FOO')).toBe('#NAME?');
  });
  it('関数名・セル参照は大文字小文字非区別', () => {
    expect(ser('=sum(1,2)')).toBe('SUM(1,2)');
    expect(ser('=a1')).toBe('A1');
  });
});

describe('canonical AST', () => {
  it('空白違いは同一 AST', () => {
    expect(ser('= 1 + 2 ')).toBe(ser('=1+2'));
    expect(ser('=SUM( A1 : B2 )')).toBe(ser('=SUM(A1:B2)'));
  });
  it('$ の有無は区別される', () => {
    expect(ser('=$A$1+A1')).toBe('($A$1+A1)');
  });
  it('範囲参照', () => {
    expect(ser('=SUM(A1:B10)')).toBe('SUM(A1:B10)');
  });
  it('指数表記は非対応（1e3 → #ERROR!）', () => {
    expect(err('=1e3')).toBe('#ERROR!');
  });
});
