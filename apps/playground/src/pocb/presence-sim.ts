// Presence 模擬（計画書 §9・§18.2 の Presence overlay 20人）。
// タイマー駆動で他者の activeCell/selection を random walk させる。人数は設定可（要確認2: 既定20）。
// step() は決定論（内部 PRNG）で、overlay のみ再描画する検証に使う。DOM 非依存。

import { createPrng, type Prng } from './prng';

/** 他者 1 人の Presence 状態。 */
export interface PresenceUser {
  readonly id: string;
  readonly displayName: string;
  /** 色パレットのインデックス（overlay の色分け用）。 */
  readonly colorKey: number;
  readonly activeRow: number;
  readonly activeCol: number;
  /** 選択範囲（activeCell 起点の小さな矩形）。 */
  readonly selRowStart: number;
  readonly selRowEnd: number;
  readonly selColStart: number;
  readonly selColEnd: number;
}

export interface PresenceSimConfig {
  readonly count: number;
  readonly seed: number;
  readonly rows: number;
  readonly cols: number;
}

export interface PresenceSim {
  users(): readonly PresenceUser[];
  /** 1 tick 進める（全員を ±1 セル範囲で random walk）。 */
  step(): void;
}

const JP_NAMES = [
  '田中',
  '鈴木',
  '佐藤',
  '高橋',
  '渡辺',
  '伊藤',
  '山本',
  '中村',
  '小林',
  '加藤',
] as const;
const PALETTE_SIZE = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function walkUser(user: PresenceUser, prng: Prng, rows: number, cols: number): PresenceUser {
  const dr = prng.nextIntBetween(-1, 1);
  const dc = prng.nextIntBetween(-1, 1);
  const activeRow = clamp(user.activeRow + dr, 0, rows - 1);
  const activeCol = clamp(user.activeCol + dc, 0, cols - 1);
  // 選択範囲は activeCell 起点に 0〜2 セルの小矩形。
  const spanR = prng.nextInt(3);
  const spanC = prng.nextInt(3);
  return {
    ...user,
    activeRow,
    activeCol,
    selRowStart: activeRow,
    selRowEnd: clamp(activeRow + spanR, 0, rows - 1) + 1,
    selColStart: activeCol,
    selColEnd: clamp(activeCol + spanC, 0, cols - 1) + 1,
  };
}

export function createPresenceSim(config: PresenceSimConfig): PresenceSim {
  const { count, seed, rows, cols } = config;
  const prng = createPrng(seed);
  let users: PresenceUser[] = Array.from({ length: Math.max(count, 0) }, (_v, i) => {
    const activeRow = prng.nextInt(Math.max(rows, 1));
    const activeCol = prng.nextInt(Math.max(cols, 1));
    return {
      id: `presence-${i}`,
      displayName: `${JP_NAMES[i % JP_NAMES.length] ?? 'X'}${Math.floor(i / JP_NAMES.length) + 1}`,
      colorKey: i % PALETTE_SIZE,
      activeRow,
      activeCol,
      selRowStart: activeRow,
      selRowEnd: activeRow + 1,
      selColStart: activeCol,
      selColEnd: activeCol + 1,
    };
  });

  return {
    users() {
      return users;
    },
    step() {
      users = users.map((user) => walkUser(user, prng, rows, cols));
    },
  };
}
