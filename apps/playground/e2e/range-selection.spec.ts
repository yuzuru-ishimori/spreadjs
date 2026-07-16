// DD-020-1 E2E: 矩形範囲選択（ドラッグ / Shift+クリック / Shift+矢印）・解除・範囲クリア。
//
// シナリオ正本: doc/DD/DD-020-1/e2e-scenarios.md（S1〜S9）。選択状態は Canvas に描かれ DOM から読めないため、
// debug API（selectionRange/dragRange・test-support 経由）で観測する。矩形の幾何・解除の不変条件の細目は
// ユニット（selection-controller.test.ts）が担保し、ここでは「実ブラウザーで入力配線が成立する」ことに集中する。

import { expect, test } from '@playwright/test';

import {
  cellCenter,
  dragRange,
  openClient,
  selectCell,
  selectionRange,
  shiftClickCell,
  snapshot,
} from './integration-helpers';

test.describe.configure({ mode: 'serial' });

test('S1/S2: ドラッグで dragRange が描かれ pointerup で確定・クリックで単一選択へ戻る（AC1）', async ({
  browser,
}) => {
  const { context, page } = await openClient(browser, '範囲-ドラッグ');
  try {
    // ドラッグ中: dragRange がライブ更新され、確定レンジはまだ無い。
    const start = await cellCenter(page, 2, 2);
    const mid = await cellCenter(page, 4, 3);
    const end = await cellCenter(page, 5, 4);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(mid.x, mid.y, { steps: 3 });
    await expect
      .poll(async () => dragRange(page), { message: 'ドラッグ中は dragRange がライブ更新される' })
      .toEqual({ rowStart: 2, rowEnd: 5, colStart: 2, colEnd: 4 });
    expect(await selectionRange(page)).toBeNull(); // 確定前
    await page.mouse.move(end.x, end.y, { steps: 3 });
    await page.mouse.up();

    // pointerup で確定: selectionRange へ昇格・dragRange は消える・activeCell は anchor のまま。
    expect(await selectionRange(page)).toEqual({ rowStart: 2, rowEnd: 6, colStart: 2, colEnd: 5 });
    expect(await dragRange(page)).toBeNull();
    expect((await snapshot(page)).activeCell).toEqual({ row: 2, col: 2 });

    // 通常クリックで単一選択へ戻る（S2）。
    await selectCell(page, 3, 3);
    expect(await selectionRange(page)).toBeNull();
    expect((await snapshot(page)).activeCell).toEqual({ row: 3, col: 3 });
  } finally {
    await context.close();
  }
});

test('S3: Shift+クリックで activeCell（anchor）〜クリック位置の矩形が選択される（AC2）', async ({
  browser,
}) => {
  const { context, page } = await openClient(browser, '範囲-Shiftクリック');
  try {
    await selectCell(page, 2, 2);
    await shiftClickCell(page, 4, 3);
    expect(await selectionRange(page)).toEqual({ rowStart: 2, rowEnd: 5, colStart: 2, colEnd: 4 });
    // activeCell は anchor のまま動かない。
    expect((await snapshot(page)).activeCell).toEqual({ row: 2, col: 2 });
    // 続けて Shift+クリックで置き換え（anchor 固定のまま逆方向へも張れる）。
    await shiftClickCell(page, 1, 4);
    expect(await selectionRange(page)).toEqual({ rowStart: 1, rowEnd: 3, colStart: 2, colEnd: 5 });
    expect((await snapshot(page)).activeCell).toEqual({ row: 2, col: 2 });
  } finally {
    await context.close();
  }
});

test('S4: Shift+矢印で focus 端のみ拡張・anchor と activeCell は不変（AC3）', async ({ browser }) => {
  const { context, page } = await openClient(browser, '範囲-Shift矢印');
  try {
    await selectCell(page, 2, 2);
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowRight');
    expect(await selectionRange(page)).toEqual({ rowStart: 2, rowEnd: 5, colStart: 2, colEnd: 4 });
    expect((await snapshot(page)).activeCell).toEqual({ row: 2, col: 2 });

    // 逆方向で focus 端が縮む（anchor は固定のまま）。
    await page.keyboard.press('Shift+ArrowUp');
    await page.keyboard.press('Shift+ArrowUp');
    expect(await selectionRange(page)).toEqual({ rowStart: 2, rowEnd: 3, colStart: 2, colEnd: 4 });
    expect((await snapshot(page)).activeCell).toEqual({ row: 2, col: 2 });
  } finally {
    await context.close();
  }
});

test('S5: 通常矢印／クリック／Escape／編集開始で単一選択へ戻る（AC4）', async ({ browser }) => {
  const { context, page } = await openClient(browser, '範囲-解除');
  try {
    // 1) 通常矢印: レンジ解除＋activeCell 移動。
    await selectCell(page, 2, 2);
    await page.keyboard.press('Shift+ArrowDown');
    expect(await selectionRange(page)).not.toBeNull();
    await page.keyboard.press('ArrowDown');
    expect(await selectionRange(page)).toBeNull();
    expect((await snapshot(page)).activeCell).toEqual({ row: 3, col: 2 });

    // 2) Escape: レンジ解除・activeCell 不変。
    await page.keyboard.press('Shift+ArrowRight');
    expect(await selectionRange(page)).not.toBeNull();
    await page.keyboard.press('Escape');
    expect(await selectionRange(page)).toBeNull();
    expect((await snapshot(page)).activeCell).toEqual({ row: 3, col: 2 });

    // 3) 同一セル（anchor）の再クリックでも解除される。
    await page.keyboard.press('Shift+ArrowRight');
    expect(await selectionRange(page)).not.toBeNull();
    await selectCell(page, 3, 2);
    expect(await selectionRange(page)).toBeNull();

    // 4) 編集開始（印字入力）: レンジ解除。Escape で編集を取り消してもレンジは復活しない。
    await page.keyboard.press('Shift+ArrowDown');
    expect(await selectionRange(page)).not.toBeNull();
    await page.keyboard.type('x');
    expect(await selectionRange(page)).toBeNull();
    await page.keyboard.press('Escape'); // 編集取消（draft 破棄・値は書かれない）
    expect(await selectionRange(page)).toBeNull();
    expect((await snapshot(page)).draft).toBe('');
  } finally {
    await context.close();
  }
});
