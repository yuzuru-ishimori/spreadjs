// DD-002 Phase 5 E2E の共有ヘルパー（テスト本体は *.spec.ts のみ・本ファイルは testMatch 外）。
//
// E2E は src/ から意図的に切り離す（本タスクのスコープ制約）。そのためグリッド座標は
// apps/playground/src/grid/geometry.ts の DEFAULT_GRID_LAYOUT を「写経」して持つ。
// geometry.ts を変えたらここも合わせる（値がズレたら位置アサートが赤くなり気付ける）。

import { expect, type Locator, type Page } from '@playwright/test';

/** DEFAULT_GRID_LAYOUT（geometry.ts）と一致させる固定レイアウト。 */
export const LAYOUT = {
  rowHeaderWidth: 44,
  columnHeaderHeight: 24,
  cellWidth: 96,
  cellHeight: 28,
} as const;

/** 編集中セルの白背景（§11.3: 下地の確定値を隠すため paint する）。getComputedStyle の直列化形。 */
export const EDITING_BG = 'rgb(255, 255, 255)';
/** Navigation（非編集）中の透明背景。'transparent' は getComputedStyle で rgba(0,0,0,0) になる。 */
export const NAVIGATION_BG = 'rgba(0, 0, 0, 0)';

/** データセル左端の x（CSS px・ヘッダー分オフセット済み）。 */
export function cellLeft(col: number): number {
  return LAYOUT.rowHeaderWidth + col * LAYOUT.cellWidth;
}

/** データセル上端の y（CSS px・ヘッダー分オフセット済み）。 */
export function cellTop(row: number): number {
  return LAYOUT.columnHeaderHeight + row * LAYOUT.cellHeight;
}

/** データセル中心の Canvas ローカル座標（locator.click の position に渡す）。 */
export function cellCenter(row: number, col: number): { x: number; y: number } {
  return {
    x: cellLeft(col) + LAYOUT.cellWidth / 2,
    y: cellTop(row) + LAYOUT.cellHeight / 2,
  };
}

/** グリッドに 1 個だけ存在する常駐 textarea（§11.3）。 */
export function editor(page: Page): Locator {
  return page.locator('textarea.cell-editor');
}

/**
 * (row, col) のデータセルをクリックして選択する。
 * クリック座標は Canvas ローカル（スクロール 0 前提）なので、可視ビューポート内のセルに限る。
 */
export async function clickCell(page: Page, row: number, col: number): Promise<void> {
  await page.locator('#grid').click({ position: cellCenter(row, col) });
}

/** 常駐 textarea の算出背景色（編集=白 / Navigation=透明 の判別に使う）。 */
export async function background(target: Locator): Promise<string> {
  return target.evaluate((el) => getComputedStyle(el).backgroundColor);
}

/**
 * アクティブセルを textarea のインライン位置で検証する。
 * place() は非 composing 時に textarea を cellRect(activeCell) へ動かすため、left/top が
 * アクティブセルを決定的に反映する（activeCell の所有権は状態機械にあり DOM から直接読めない）。
 */
export async function expectActiveCell(target: Locator, row: number, col: number): Promise<void> {
  await expect
    .poll(async () => target.evaluate((el) => `${el.style.left},${el.style.top}`))
    .toBe(`${cellLeft(col)}px,${cellTop(row)}px`);
}
