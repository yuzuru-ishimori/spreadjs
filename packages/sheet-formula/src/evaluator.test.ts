// Phase 3 Red→Green: 評価器・5関数・特殊値・エラー伝播（scenarios.md §6・function-spec §2〜§4）。

import { describe, expect, it } from 'vitest';
import { parse } from './parser';
import {
  blank,
  cellValueToString,
  evaluate,
  num,
  str,
  err,
  type CellReader,
  type CellValue,
} from './evaluator';

function mockReader(cells: Record<string, CellValue>): CellReader {
  const get = (row: number, col: number): CellValue => cells[`${row},${col}`] ?? blank;
  return {
    read: get,
    readRange: (r0, r1, c0, c1, visit) => {
      for (let row = r0; row < r1; row += 1) {
        for (let col = c0; col < c1; col += 1) {
          const v = get(row, col);
          if (v.kind !== 'blank') visit(row, col, v);
        }
      }
    },
  };
}

/** 数式を評価して表示文字列で返す（parse エラーはそのエラー値）。 */
function ev(formula: string, cells: Record<string, CellValue> = {}): string {
  const p = parse(formula);
  if (!p.ok) return p.error;
  return cellValueToString(evaluate(p.ast, mockReader(cells)));
}

describe('算術・特殊値', () => {
  it('優先順位・結合', () => {
    expect(ev('=1+2*3')).toBe('7');
    expect(ev('=(1+2)*3')).toBe('9');
    expect(ev('=2^3^2')).toBe('64'); // 左結合
    expect(ev('=-2^2')).toBe('4'); // (-2)^2
    expect(ev('=10/2/5')).toBe('1');
    expect(ev('=10-2-3')).toBe('5');
  });
  it('0除算 → #DIV/0!（非有限を経由しない）', () => {
    expect(ev('=1/0')).toBe('#DIV/0!');
    expect(ev('=0/0')).toBe('#DIV/0!');
  });
  it('非有限化（オーバーフロー）→ #VALUE!', () => {
    expect(ev('=1e308*10')).toBe('#ERROR!'); // 1e308 は指数表記=構文エラー
    expect(ev('="9e307"*100', { })).toBe('#VALUE!'); // 文字列強制→9e309=Infinity→#VALUE!
  });
  it('負の0 は 0 に正規化', () => {
    expect(ev('=-0')).toBe('0');
    expect(ev('=0*-1')).toBe('0');
  });
  it('文字列の算術 → #VALUE!', () => {
    expect(ev('="a"+1')).toBe('#VALUE!');
  });
});

describe('5関数（範囲・空白・文字列・エラー）', () => {
  const cells = {
    '0,0': num(1), // A1
    '2,0': str('x'), // A3
  };
  it('SUM: 範囲内の空白・文字列は無視', () => {
    expect(ev('=SUM(A1:A3)', cells)).toBe('1');
  });
  it('SUM: スカラー文字列は数値変換／不能で #VALUE!', () => {
    expect(ev('=SUM("12",3)')).toBe('15');
    expect(ev('=SUM("x",3)')).toBe('#VALUE!');
    expect(ev('=SUM(A1:A3)', {})).toBe('0'); // 数値0件 → 0
  });
  it('AVERAGE: 空白は分母に数えない・全て非数値は #DIV/0!', () => {
    expect(ev('=AVERAGE(A1:A3)', { '0,0': num(2), '1,0': num(4) })).toBe('3');
    expect(ev('=AVERAGE(A1:A3)', {})).toBe('#DIV/0!');
  });
  it('MIN/MAX: 数値0件は 0', () => {
    expect(ev('=MIN(A1:A3)', {})).toBe('0');
    expect(ev('=MAX(A1:A3)', {})).toBe('0');
    expect(ev('=MAX(A1:A3)', { '0,0': num(3), '1,0': num(9) })).toBe('9');
  });
  it('COUNT: 数値のみ計数（文字列・空白・エラーは無視）', () => {
    const c = { '0,0': num(1), '1,0': str('x'), '3,0': err('#REF!') };
    expect(ev('=COUNT(A1:A4)', c)).toBe('1');
  });
  it('範囲エラー伝播（COUNT以外）', () => {
    expect(ev('=SUM(A1:A3)', { '0,0': num(1), '1,0': err('#REF!') })).toBe('#REF!');
    expect(ev('=MAX(A1:A2)', { '0,0': err('#DIV/0!') })).toBe('#DIV/0!');
  });
  it('COUNT はエラーを伝播しない', () => {
    expect(ev('=COUNT(A1:A3)', { '0,0': num(1), '1,0': err('#REF!'), '2,0': num(2) })).toBe('2');
  });
});

describe('エラー発生フェーズの優先', () => {
  it('=1/0+FOO() → #NAME?（parse/bind が eval より先）', () => {
    expect(ev('=1/0+FOO()')).toBe('#NAME?');
  });
});
