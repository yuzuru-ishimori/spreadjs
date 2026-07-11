// 決定論データ生成（計画書 §21 基準: 50,000行×200列・非空500,000セル）。
// シード付き PRNG（prng.ts）で再現可能に生成し、内容は数値/短文/日本語/長文を混在させて
// measureText キャッシュと clip に実運用相当の負荷を与える（§12.5）。DOM 非依存。

import { createPrng, type Prng } from './prng';

/** 生成された 1 セル。 */
export interface GeneratedCell {
  readonly row: number;
  readonly col: number;
  readonly value: string;
}

/** 生成設定。 */
export interface GenerateConfig {
  readonly rows: number;
  readonly cols: number;
  /** 非空セル数（rows×cols を超える場合は上限へクランプ）。 */
  readonly nonEmpty: number;
  readonly seed: number;
}

/** 生成結果（件数・所要時間を計測フックとして返す）。 */
export interface GenerateResult {
  /** (row, col) 昇順に整列済み（チャンクストアの一括ロード用）。 */
  readonly cells: readonly GeneratedCell[];
  readonly count: number;
  readonly elapsedMs: number;
  readonly rows: number;
  readonly cols: number;
}

// 内容種別の重み（合計 1.0）。数値中心＋日本語・長文で描画負荷を混ぜる。
const SHORT_ASCII = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
const JP_WORDS = [
  '氏名',
  '営業部',
  '開発部',
  '田中 太郎',
  '鈴木 花子',
  '承認済み',
  '保留中',
  '要確認',
  '対応中',
  '完了',
  '未着手',
  '見積提出',
] as const;
const JP_LONG = [
  '来期の予算計画に基づく見直し案（担当部署の確認待ち）',
  '長文セルの折り返しと clip の負荷確認用テキスト。measureText キャッシュを検証する。',
  '備考: 前回のレビュー指摘を反映済み。次回打ち合わせで最終確認する予定です。',
] as const;

function makeNumber(prng: Prng): string {
  // 整数と小数を混ぜる。
  if (prng.next() < 0.5) {
    return String(prng.nextInt(1_000_000));
  }
  return (prng.nextInt(1_000_000) / 100).toFixed(2);
}

function makeShort(prng: Prng): string {
  const len = prng.nextIntBetween(3, 6);
  let s = '';
  for (let i = 0; i < len; i += 1) {
    s += SHORT_ASCII[prng.nextInt(SHORT_ASCII.length)] ?? 'X';
  }
  return s;
}

function makeValue(prng: Prng): string {
  const r = prng.next();
  if (r < 0.4) {
    return makeNumber(prng);
  }
  if (r < 0.65) {
    return makeShort(prng);
  }
  if (r < 0.9) {
    return prng.pick(JP_WORDS);
  }
  return prng.pick(JP_LONG);
}

/**
 * 決定論的に非空セルを生成する。同一 seed から常に同一の (row,col,value) 集合を返す。
 * 位置は重複なし（Set で dedup）、出力は (row,col) 昇順。
 */
export function generateCells(config: GenerateConfig): GenerateResult {
  const start = performance.now();
  const { rows, cols, seed } = config;
  const capacity = rows * cols;
  const target = Math.min(Math.max(config.nonEmpty, 0), capacity);
  const prng = createPrng(seed);

  const seen = new Set<number>();
  const cells: GeneratedCell[] = [];
  // 衝突時は次の位置を引き直す。5% 充填程度なら期待再抽選は僅少。
  while (cells.length < target) {
    const row = prng.nextInt(rows);
    const col = prng.nextInt(cols);
    const key = row * cols + col;
    if (seen.has(key)) {
      // 値生成用の draw も消費して決定論を保つ（衝突しても列がずれないように 1 draw）。
      prng.next();
      continue;
    }
    seen.add(key);
    cells.push({ row, col, value: makeValue(prng) });
  }

  // (row, col) 昇順へ整列（チャンクストアの append 高速化）。
  cells.sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row));

  return {
    cells,
    count: cells.length,
    elapsedMs: performance.now() - start,
    rows,
    cols,
  };
}
