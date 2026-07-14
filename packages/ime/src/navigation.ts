// アクティブセルの移動計算。DOM 非依存の純粋関数で、キー入力の方向解釈と
// 端クランプ付きの移動先算出を提供する。
//
// Phase 1（Navigation 状態のみ）では Enter=下 / Shift+Enter=上 / Tab=右 /
// Shift+Tab=左 / 矢印 をそのままセル移動に対応させる。編集中（Phase 2）の
// Enter/Tab は「確定して移動」等の別意味になるが、その分岐は編集状態機械が
// 担い、最終的な移動方向の算出だけを本モジュールへ委譲する。

import { type CellPosition, type GridLayout, clampCell } from './geometry';

/** セル移動の方向。 */
export type NavigationDirection = 'up' | 'down' | 'left' | 'right';

/** キー入力（DOM 非依存の素の値）。DOM の KeyboardEvent から抽出して渡す。 */
export interface NavigationKeyInput {
  /** `KeyboardEvent.key`（例: 'ArrowDown', 'Enter', 'Tab'）。 */
  readonly key: string;
  /** Shift 併用フラグ。 */
  readonly shiftKey: boolean;
}

const DELTA: Record<NavigationDirection, { readonly dRow: number; readonly dCol: number }> = {
  up: { dRow: -1, dCol: 0 },
  down: { dRow: 1, dCol: 0 },
  left: { dRow: 0, dCol: -1 },
  right: { dRow: 0, dCol: 1 },
};

/**
 * ナビゲーションキーを移動方向へ変換する。該当しないキーは null。
 * Enter/Tab は Shift 併用で逆方向になる（Excel 準拠）。
 */
export function keyToDirection(input: NavigationKeyInput): NavigationDirection | null {
  switch (input.key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'Enter':
      return input.shiftKey ? 'up' : 'down';
    case 'Tab':
      return input.shiftKey ? 'left' : 'right';
    default:
      return null;
  }
}

/** 現在位置から指定方向へ 1 セル移動する（グリッド端でクランプ）。 */
export function moveActiveCell(
  layout: GridLayout,
  from: CellPosition,
  direction: NavigationDirection,
): CellPosition {
  const delta = DELTA[direction];
  return clampCell(layout, {
    row: from.row + delta.dRow,
    col: from.col + delta.dCol,
  });
}
