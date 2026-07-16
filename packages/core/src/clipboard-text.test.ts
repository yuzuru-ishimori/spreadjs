// clipboard-text（DD-020-2 Phase 1）: TSV parser / serializer の unit＋fuzz＋round-trip property。
//
// EOL 依存の厳密検証は**明示エスケープ定数**（'\r\n' 等）で決定化する（git core.autocrlf=true の影響を受けない）。
// fixture ファイル（doc/DD/DD-020-2/fixtures/）経由の parse も 1 ケース実証する（実 Excel 方言の書き起こし＝L5 証跡）。
// シナリオ正本: doc/DD/DD-020-2/scenarios.md §1（P-1〜P-15）・§2（serializer/round-trip）。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseClipboardText, serializeMatrix } from './clipboard-text';

// ---- 1. parse 受理仕様（§1・P-1〜P-15） -------------------------------------------------------

describe('parseClipboardText: TSV 方言受理（AC1）', () => {
  it('P-1: 基本 TSV・LF 行区切り', () => {
    expect(parseClipboardText('a\tb\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('P-2: CRLF 行区切り（Excel 標準）', () => {
    expect(parseClipboardText('a\tb\r\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('P-3: 末尾 CRLF1個は空行にしない', () => {
    expect(parseClipboardText('a\tb\r\n')).toEqual([['a', 'b']]);
    expect(parseClipboardText('a\tb\n')).toEqual([['a', 'b']]);
  });

  it('P-4: 内部の空行は保持（末尾のみ trim）', () => {
    expect(parseClipboardText('a\tb\r\n\r\nc')).toEqual([['a', 'b'], [''], ['c']]);
  });

  it('P-5: 末尾タブ＝末尾に空セル', () => {
    expect(parseClipboardText('a\t')).toEqual([['a', '']]);
  });

  it('P-6: 中間の空セルを保持', () => {
    expect(parseClipboardText('a\t\tb')).toEqual([['a', '', 'b']]);
  });

  it('P-7: 引用内タブは区切りにしない（リテラル）', () => {
    expect(parseClipboardText('"a\tb"\tc')).toEqual([['a\tb', 'c']]);
  });

  it('P-8: 引用内改行はセル内改行（行にしない・Excel Alt+Enter）', () => {
    expect(parseClipboardText('"line1\nline2"\tc')).toEqual([['line1\nline2', 'c']]);
    // 引用内 CRLF もセル内改行としてそのまま保持する。
    expect(parseClipboardText('"line1\r\nline2"\tc')).toEqual([['line1\r\nline2', 'c']]);
  });

  it('P-9: 引用内 "" は 1 個の " へアンエスケープ', () => {
    expect(parseClipboardText('"a""b"')).toEqual([['a"b']]);
    expect(parseClipboardText('""""')).toEqual([['"']]); // "" のみ＝1 個の "
  });

  it('P-10: 空の引用セル＝1 個の空セル', () => {
    expect(parseClipboardText('""')).toEqual([['']]);
    expect(parseClipboardText('""\t""')).toEqual([['', '']]);
  });

  it('P-11: 単一セル・行終端なし', () => {
    expect(parseClipboardText('abc')).toEqual([['abc']]);
  });

  it('P-12: 空文字列＝matrix 空（paste は noop）', () => {
    expect(parseClipboardText('')).toEqual([]);
  });

  it('P-13: 列数不整合＝jagged 保持（欠けは skip 対象=決定(d)）', () => {
    expect(parseClipboardText('a\tb\tc\nd\te')).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e'],
    ]);
  });

  it('P-14: 巨大単一セルで壊れない（§20.2）', () => {
    const big = 'x'.repeat(100_000);
    const parsed = parseClipboardText(big);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toHaveLength(1);
    expect(parsed[0]![0]).toHaveLength(100_000);
  });

  it('P-15: 未終端引用は残りをリテラル扱い（寛容）', () => {
    expect(parseClipboardText('"unterminated')).toEqual([['unterminated']]);
    expect(parseClipboardText('a\t"open\tstill')).toEqual([['a', 'open\tstill']]);
  });

  it('lone CR も行区切りとして扱う（古い Mac 方言の防御）', () => {
    expect(parseClipboardText('a\rb')).toEqual([['a'], ['b']]);
  });

  it('引用は非先頭では開始しない（セル途中の " はリテラル）', () => {
    // 非引用セル途中の " はそのまま文字（Excel は引用が必要なセルは必ず先頭から引用する）。
    expect(parseClipboardText('a"b\tc')).toEqual([['a"b', 'c']]);
  });
});

// ---- 2. serializer（§2） ---------------------------------------------------------------------

describe('serializeMatrix: 引用規約（AC2）', () => {
  it('特殊文字を含まないセルは素通し・行=CRLF・列=タブ', () => {
    expect(serializeMatrix([['a', 'b'], ['c', 'd']])).toBe('a\tb\r\nc\td');
  });

  it('タブ / 改行 / " を含むセルのみ引用し、内部 " は "" へエスケープ', () => {
    expect(serializeMatrix([['a\tb']])).toBe('"a\tb"');
    expect(serializeMatrix([['a\nb']])).toBe('"a\nb"');
    expect(serializeMatrix([['a\r\nb']])).toBe('"a\r\nb"');
    expect(serializeMatrix([['a"b']])).toBe('"a""b"');
    expect(serializeMatrix([['plain']])).toBe('plain');
  });

  it('空セルは空文字列（引用しない）', () => {
    expect(serializeMatrix([['a', '', 'b']])).toBe('a\t\tb');
  });

  it('空 matrix は空文字列', () => {
    expect(serializeMatrix([])).toBe('');
  });
});

// ---- 3. round-trip property（§2・fuzz） -------------------------------------------------------

/** 決定論 PRNG（mulberry32・依存ゼロ。core テストは render の createPrng に依存しない）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 特殊文字（タブ・改行・引用）と通常文字を混ぜたセル部品。round-trip の難所を必ず踏む。
const CELL_PARTS = ['a', 'あ', '1', '\t', '\n', '\r\n', '"', ' ', '""', 'x'.repeat(20)];

describe('round-trip: serialize→parse で値が保存される（AC2・fuzz）', () => {
  it('ランダム矩形 matrix（末尾列非空）で parse(serialize(M))===M（seed 掃引）', () => {
    for (const seed of [1, 7, 42, 1337, 20260717, 99999]) {
      const rand = mulberry32(seed);
      const rows = 1 + Math.floor(rand() * 6);
      const cols = 1 + Math.floor(rand() * 6);
      const matrix: string[][] = [];
      for (let r = 0; r < rows; r += 1) {
        const row: string[] = [];
        for (let c = 0; c < cols; c += 1) {
          const parts = 1 + Math.floor(rand() * 3);
          let cell = '';
          for (let p = 0; p < parts; p += 1) {
            cell += CELL_PARTS[Math.floor(rand() * CELL_PARTS.length)]!;
          }
          row.push(cell);
        }
        // 末尾行・末尾セルが空だと TSV の末尾 trim 曖昧性で復元されない（既知の degenerate）。
        // 生成器側で最終列を必ず非空にして property の前提（矩形・末尾非空）を満たす。
        row[cols - 1] = `s${row[cols - 1] ?? ''}`;
        matrix.push(row);
      }
      const serialized = serializeMatrix(matrix);
      expect(parseClipboardText(serialized), `seed=${seed}`).toEqual(matrix);
    }
  });
});

// ---- 4. fixture ファイル経由の parse（実 Excel 方言の書き起こし＝L5 証跡） ----------------------

describe('fixture 経由 parse（doc/DD/DD-020-2/fixtures/）', () => {
  function readFixture(name: string): string {
    return readFileSync(fileURLToPath(new URL(`../../../doc/DD/DD-020-2/fixtures/${name}`, import.meta.url)), 'utf8');
  }

  it('jagged.tsv: 列数不整合の手書きテキストが jagged matrix になる（欠けは paste で skip）', () => {
    const matrix = parseClipboardText(readFixture('jagged.tsv'));
    // 1 行目 3 列・2 行目 1 列・3 行目 2 列（末尾改行は行にしない）。
    expect(matrix.map((r) => r.length)).toEqual([3, 1, 2]);
  });

  it('excel-quotes.tsv: "" エスケープ・引用内タブが正しく復元される', () => {
    const matrix = parseClipboardText(readFixture('excel-quotes.tsv'));
    // 1 行目: [a"b, c] （"a""b" と c）。2 行目: [tab\tinside, d]（引用内タブ）。
    expect(matrix[0]).toEqual(['a"b', 'c']);
    expect(matrix[1]).toEqual(['tab\tinside', 'd']);
  });
});
