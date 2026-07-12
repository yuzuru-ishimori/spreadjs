// Phase 3 Red→Green: 評価器・5関数・特殊値・エラー伝播（scenarios.md §6・function-spec §2〜§4）。

import { describe, expect, it } from 'vitest';
import { parse } from './parser';
import { DEFAULT_LIMITS } from './limits';
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

describe('Codexレビュー反映（2026-07-12）', () => {
  it('P1: MIN/MAX は大範囲（20万件）で RangeError を出さず正しい最小/最大', () => {
    const bigReader: CellReader = {
      read: () => blank,
      readRange: (r0, r1, c0, _c1, visit) => {
        for (let r = r0; r < r1; r += 1) visit(r, c0, num(r));
      },
    };
    const p = parse('=MIN(A1:A200000)');
    if (!p.ok) throw new Error(p.error);
    expect(cellValueToString(evaluate(p.ast, bigReader))).toBe('0');
    const q = parse('=MAX(A1:A200000)');
    if (!q.ok) throw new Error(q.error);
    expect(cellValueToString(evaluate(q.ast, bigReader))).toBe('199999');
  });

  it('P2: 数値変換は10進数のみ（0x10/1e3/前後空白は #VALUE!）', () => {
    expect(ev('=SUM("0x10",1)')).toBe('#VALUE!');
    expect(ev('=SUM("1e3",1)')).toBe('#VALUE!');
    expect(ev('=SUM(" 12 ",1)')).toBe('#VALUE!');
    expect(ev('=SUM("12",1)')).toBe('13'); // 正当な10進はOK
    expect(ev('=SUM("12.5",1)')).toBe('13.5');
  });

  it('P2: 文字列リテラルのエラー表記は文字列（SUM("#REF!",1) は #VALUE!）', () => {
    expect(ev('=SUM("#REF!",1)')).toBe('#VALUE!'); // #REF! ではない
  });

  it('P2: セルの非有限値は #VALUE! に正規化', () => {
    const inf: Record<string, CellValue> = { '0,0': num(Infinity) };
    expect(ev('=A1', inf)).toBe('#VALUE!');
    expect(ev('=A1+1', inf)).toBe('#VALUE!');
    expect(ev('=COUNT(A1:A1)', inf)).toBe('0'); // 非有限は数えない
  });

  it('P2: 左辺エラーは右辺を評価せず短絡（低L6でも #DIV/0!）', () => {
    const p = parse('=1/0+SUM(A1:A100)');
    if (!p.ok) throw new Error(p.error);
    const reader: CellReader = { read: () => blank, readRange: () => {} };
    // maxEvalSteps を極小にしても、左辺 #DIV/0! が先に確定して返る。
    expect(cellValueToString(evaluate(p.ast, reader, { ...DEFAULT_LIMITS, maxEvalSteps: 5 }))).toBe('#DIV/0!');
  });
});
