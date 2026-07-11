// 正準直列化 ＋ 純TS FNV-1a 64bit（phase1-design §5・DA D1）。
// 収束判定（AC1/AC5）の基盤。Node/ブラウザー間で同一 hash になることが要件のため、
// crypto に依存せず・コードポイントではなく UTF-8 バイト列で計算する。

import { displayRowOrder } from './document';
import type { SheetDocument } from './document';

/**
 * 文書を正準文字列へ直列化する。
 * - 行は displayRowOrder（表示順・tombstone 除外）で列挙。
 * - 各行内は columnOrder 配列順で列挙（Map 反復順に非依存）。
 * - 非空セル（kind !== 'blank'）のみ rowId/columnId/kind/value/lastChangedRevision を出力。
 * - localeCompare や Array.sort の既定比較は使わない（環境依存整列を排除・DA D1）。
 * - 各フィールドは長さ前置（`<length>:<text>`）で連結する。可変長フィールドの境界が一意に
 *   定まるため、値・ID に区切り文字（':' 等）を含んでも別文書と衝突しない（単射・DA 区切り衝突）。
 * - revision 番号自体は含めない（収束判定はセル内容＋各セル lastChangedRevision で行う）。
 */
export function canonicalSerialize(doc: SheetDocument): string {
  const parts: string[] = [];
  for (const rowId of displayRowOrder(doc)) {
    const rowCells = doc.cells.get(rowId);
    if (rowCells === undefined) {
      continue;
    }
    for (const columnId of doc.columnOrder) {
      const record = rowCells.get(columnId);
      if (record === undefined) {
        continue;
      }
      const value = record.value;
      if (value.kind === 'blank') {
        continue; // 非空セルのみ（blank は不在と同一視）
      }
      const valueText = value.kind === 'number' ? String(value.value) : value.value;
      parts.push(
        field(rowId) +
          field(columnId) +
          field(value.kind) +
          field(valueText) +
          field(String(record.lastChangedRevision)),
      );
    }
  }
  return parts.join('');
}

/** 長さ前置エンコード。可変長フィールドを単射に連結するための最小手段。 */
function field(text: string): string {
  return `${text.length}:${text}`;
}

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * FNV-1a 64bit。BigInt で厳密に 64bit を計算し、16桁の hex（ゼロ埋め）を返す。
 * 入力文字列は UTF-8 バイト列相当で回す（コードポイントではない）。これにより
 * Node / ブラウザーで同一結果になる（TextEncoder / Buffer / crypto に依存しない）。
 */
export function fnv1a64(input: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of utf8Bytes(input)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

export function documentHash(doc: SheetDocument): string {
  return fnv1a64(canonicalSerialize(doc));
}

/**
 * 文字列を UTF-8 バイト列へ変換する（標準 UTF-8。標準 FNV-1a と組み合わせて cross-platform 同一）。
 * for..of はコードポイント単位で反復し、サロゲートペアを1コードポイントに合成する。
 */
function* utf8Bytes(input: string): Generator<number> {
  for (const ch of input) {
    const codePoint = ch.codePointAt(0);
    if (codePoint === undefined) {
      continue; // 到達不能（for..of は非空の1コードポイント文字列を返す）。型絞りの保険
    }
    if (codePoint < 0x80) {
      yield codePoint;
    } else if (codePoint < 0x800) {
      yield 0xc0 | (codePoint >> 6);
      yield 0x80 | (codePoint & 0x3f);
    } else if (codePoint < 0x10000) {
      yield 0xe0 | (codePoint >> 12);
      yield 0x80 | ((codePoint >> 6) & 0x3f);
      yield 0x80 | (codePoint & 0x3f);
    } else {
      yield 0xf0 | (codePoint >> 18);
      yield 0x80 | ((codePoint >> 12) & 0x3f);
      yield 0x80 | ((codePoint >> 6) & 0x3f);
      yield 0x80 | (codePoint & 0x3f);
    }
  }
}
