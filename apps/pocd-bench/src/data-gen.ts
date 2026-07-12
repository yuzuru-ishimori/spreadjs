// 決定論データ生成（DD-006・bench-protocol.md §4）。同一 seed から常に同一の (row,col,value) 集合。
// 4分布を生成: uniform-sparse / dense-block / top-left-cluster / column-typed。
// 数値は「正準文字列」（String(Number(s))===s）で生成し、列指向ストアの Float64Array 経路が
// 元文字列を厳密復元できる（＝等価性を壊さない）ようにする。DOM/Node 非依存。

import { createPrng, type Prng } from './prng';
import type { GeneratedCell } from './cell-store';

/** 4分布（bench-protocol §4）。 */
export type Distribution =
  | 'uniform-sparse'
  | 'dense-block'
  | 'top-left-cluster'
  | 'column-typed';

export const DISTRIBUTIONS: readonly Distribution[] = [
  'uniform-sparse',
  'dense-block',
  'top-left-cluster',
  'column-typed',
] as const;

export interface GenerateConfig {
  readonly rows: number;
  readonly cols: number;
  /** 非空セル数（rows×cols を超える場合は上限へクランプ）。 */
  readonly nonEmpty: number;
  readonly seed: number;
  readonly distribution: Distribution;
}

export interface GenerateResult {
  /** (row, col) 昇順に整列済み（一括ロード用）。 */
  readonly cells: readonly GeneratedCell[];
  readonly count: number;
  readonly rows: number;
  readonly cols: number;
  readonly distribution: Distribution;
}

const SHORT_ASCII = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
const JP_WORDS = [
  '氏名', '営業部', '開発部', '田中 太郎', '鈴木 花子', '承認済み',
  '保留中', '要確認', '対応中', '完了', '未着手', '見積提出',
] as const;
const JP_LONG = [
  '来期の予算計画に基づく見直し案（担当部署の確認待ち）',
  '長文セルの折り返しと clip の負荷確認用テキスト。measureText キャッシュを検証する。',
  '備考: 前回のレビュー指摘を反映済み。次回打ち合わせで最終確認する予定です。',
] as const;

/** 正準数値文字列（String(Number(s))===s を保証）。整数・2桁小数を混ぜる。 */
function makeNumber(prng: Prng): string {
  if (prng.next() < 0.5) {
    return String(prng.nextInt(1_000_000));
  }
  // int/100 を String 化すると正準表現になる（例 1250→"12.5"）。
  return String(prng.nextInt(1_000_000) / 100);
}

function makeShort(prng: Prng): string {
  const len = prng.nextIntBetween(3, 6);
  let s = '';
  for (let i = 0; i < len; i += 1) {
    s += SHORT_ASCII[prng.nextInt(SHORT_ASCII.length)] ?? 'X';
  }
  return s;
}

/** 混在値（数値/短文/日本語/長文）。 */
function makeMixedValue(prng: Prng): string {
  const r = prng.next();
  if (r < 0.4) return makeNumber(prng);
  if (r < 0.65) return makeShort(prng);
  if (r < 0.9) return prng.pick(JP_WORDS);
  return prng.pick(JP_LONG);
}

/** column-typed 用: 列が数値列か（2/3 を数値列・1/3 をテキスト列に決定論割当）。 */
export function isNumericColumn(col: number): boolean {
  return col % 3 !== 0;
}

function makeColumnTypedValue(prng: Prng, col: number): string {
  if (isNumericColumn(col)) {
    return makeNumber(prng);
  }
  // テキスト列は純粋に非数値（日本語）にして、列ごとの型の偏りを明確にする
  // （列指向ストアの数値列=Float64Array／テキスト列=文字列の対比を素直に検証できる）。
  return prng.next() < 0.8 ? prng.pick(JP_WORDS) : prng.pick(JP_LONG);
}

function sortCells(cells: GeneratedCell[]): void {
  cells.sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row));
}

/**
 * 決定論的に非空セルを生成する。同一 (config) から常に同一集合（位置は重複なし・(row,col) 昇順）。
 */
export function generateCells(config: GenerateConfig): GenerateResult {
  const { rows, cols, seed, distribution } = config;
  const capacity = rows * cols;
  const target = Math.min(Math.max(config.nonEmpty, 0), capacity);
  const prng = createPrng(seed);
  const seen = new Set<number>();
  const cells: GeneratedCell[] = [];

  const tryAdd = (row: number, col: number, value: () => string): boolean => {
    const key = row * cols + col;
    if (seen.has(key)) {
      value(); // 衝突時も draw を消費して決定論を保つ（列がずれない）。
      return false;
    }
    seen.add(key);
    cells.push({ row, col, value: value() });
    return true;
  };

  if (distribution === 'dense-block') {
    // 先頭から連続矩形（row-major）を密に埋める。位置は決定論（乱数は値のみ）。
    for (let i = 0; i < target; i += 1) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      seen.add(row * cols + col);
      cells.push({ row, col, value: makeMixedValue(prng) });
    }
  } else {
    while (cells.length < target) {
      let row: number;
      let col: number;
      if (distribution === 'top-left-cluster') {
        // p^3 で 0 近傍へ強く偏らせる（上部・左側集中）。
        row = Math.min(rows - 1, Math.floor(rows * Math.pow(prng.next(), 3)));
        col = Math.min(cols - 1, Math.floor(cols * Math.pow(prng.next(), 3)));
      } else {
        // uniform-sparse / column-typed は一様位置。
        row = prng.nextInt(rows);
        col = prng.nextInt(cols);
      }
      const valueFn =
        distribution === 'column-typed'
          ? () => makeColumnTypedValue(prng, col)
          : () => makeMixedValue(prng);
      tryAdd(row, col, valueFn);
    }
  }

  sortCells(cells);
  return { cells, count: cells.length, rows, cols, distribution };
}
