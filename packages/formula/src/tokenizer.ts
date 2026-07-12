// トークナイザ（§14.2・scenarios.md §1）。ロケール非依存（ASCII のみ・全角は不正）。
// 空白は読み飛ばす。比較演算子はトークン化するが parser が拒否する（MVP 予約のみ）。
// DOM/Node 非依存・純関数。

import type { A1Ref } from './ast';
import type { ErrorValue } from './errors';
import { lettersToCol } from './a1';

export type Punct =
  | '+' | '-' | '*' | '/' | '^' | '(' | ')' | ',' | ':'
  | '<' | '>' | '<=' | '>=' | '=' | '<>';

export type Token =
  | { readonly kind: 'number'; readonly value: number; readonly pos: number }
  | { readonly kind: 'string'; readonly value: string; readonly pos: number }
  | { readonly kind: 'cell'; readonly ref: A1Ref; readonly pos: number }
  | { readonly kind: 'ident'; readonly name: string; readonly pos: number }
  | { readonly kind: 'punct'; readonly punct: Punct; readonly pos: number };

export type TokenizeResult =
  | { readonly ok: true; readonly tokens: readonly Token[] }
  | { readonly ok: false; readonly error: ErrorValue };

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isLetter = (c: string): boolean => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
const isSpace = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';

const fail = (): TokenizeResult => ({ ok: false, error: '#ERROR!' });

export function tokenize(src: string): TokenizeResult {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i] ?? '';
    if (isSpace(c)) {
      i += 1;
      continue;
    }
    const start = i;

    // 数値: [0-9.]+（小数点は1つまで・数字1つ以上）。指数表記は非対応（後段で構文エラー）。
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? ''))) {
      let dots = 0;
      let digits = 0;
      let text = '';
      while (i < n) {
        const ch = src[i] ?? '';
        if (ch === '.') {
          dots += 1;
          text += ch;
          i += 1;
        } else if (isDigit(ch)) {
          digits += 1;
          text += ch;
          i += 1;
        } else {
          break;
        }
      }
      if (dots > 1 || digits === 0) return fail();
      const value = Number(text);
      if (!Number.isFinite(value)) return fail();
      tokens.push({ kind: 'number', value, pos: start });
      continue;
    }

    // 文字列: "..."（"" で埋め込み引用）。
    if (c === '"') {
      i += 1;
      let text = '';
      let closed = false;
      while (i < n) {
        const ch = src[i] ?? '';
        if (ch === '"') {
          if (src[i + 1] === '"') {
            text += '"';
            i += 2;
          } else {
            i += 1;
            closed = true;
            break;
          }
        } else {
          text += ch;
          i += 1;
        }
      }
      if (!closed) return fail();
      tokens.push({ kind: 'string', value: text, pos: start });
      continue;
    }

    // セル参照 or 識別子: $?letters$?digits。
    if (c === '$' || isLetter(c)) {
      const colAbs = c === '$';
      if (colAbs) i += 1;
      let letters = '';
      while (i < n && isLetter(src[i] ?? '')) {
        letters += src[i];
        i += 1;
      }
      let rowAbs = false;
      if (src[i] === '$') {
        rowAbs = true;
        i += 1;
      }
      let digits = '';
      while (i < n && isDigit(src[i] ?? '')) {
        digits += src[i];
        i += 1;
      }
      if (digits.length > 0) {
        if (letters.length === 0) return fail();
        const rowNum = Number(digits);
        if (rowNum < 1) return fail();
        const ref: A1Ref = {
          col: lettersToCol(letters),
          row: rowNum - 1,
          colAbs,
          rowAbs,
        };
        tokens.push({ kind: 'cell', ref, pos: start });
      } else {
        // 数字なし: $ が付いていれば不正な参照、そうでなければ識別子（関数名候補）。
        if (colAbs || rowAbs || letters.length === 0) return fail();
        tokens.push({ kind: 'ident', name: letters, pos: start });
      }
      continue;
    }

    // 記号・演算子（比較は2文字を先に判定）。
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') {
      tokens.push({ kind: 'punct', punct: two, pos: start });
      i += 2;
      continue;
    }
    if ('+-*/^(),:<>='.includes(c)) {
      tokens.push({ kind: 'punct', punct: c as Punct, pos: start });
      i += 1;
      continue;
    }

    // 未定義文字（全角数字・全角記号・@ # ; 等）。
    return fail();
  }

  return { ok: true, tokens };
}
