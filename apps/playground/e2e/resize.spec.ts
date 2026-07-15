// DD-012-4 E2E: 列幅・行高リサイズ（ヘッダー境界の実ドラッグ）。
//
// 実ブラウザーで pointerdown→move→up の実ドラッグを発生させ、①列幅・行高が変わる（セル矩形が追従する）
// ②確定時の layout が override のみを保持する（AC3）③リロードで復元される（AC4＝利用側 localStorage 保存→
// 次回 mount の初期値注入）を検証する。座標変換・クランプ・hit 判定の細目はユニット（resize-interaction.test.ts）
// が担保するため、ここでは「実ブラウザーで配線が成立する」ことに集中する。

import { expect, test } from '@playwright/test';

import {
  cellRectAt,
  columnHeaderRectAt,
  columnWidthOverrides,
  openClient,
  rowHeaderRectAt,
  rowHeightOverrides,
  snapshot,
} from './integration-helpers';

test.describe.configure({ mode: 'serial' });

test('列ヘッダー境界のドラッグで列幅が広がり、セル矩形が追従する（AC1）', async ({ browser }) => {
  const { context, page } = await openClient(browser, 'リサイズ-列');
  try {
    const box = (await page.locator('.nsheet-scroller').boundingBox())!;
    const col = 2;
    const before = (await columnHeaderRectAt(page, col))!;
    // 右端境界の掴み代内（width-2px）へ。stage-local → page 座標へ変換。
    const startX = box.x + before.x + before.width - 2;
    const y = box.y + before.y + before.height / 2;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + 100, y, { steps: 6 });
    await page.mouse.up();

    await expect
      .poll(async () => (await columnHeaderRectAt(page, col))!.width, { message: '列幅が広がる' })
      .toBeGreaterThan(before.width + 60);

    // セル矩形の幅も同じだけ広がる（ヘッダー/セル/選択枠が同一座標系で追従・AC1）。
    const cell = (await cellRectAt(page, 3, col))!;
    expect(cell.width).toBe((await columnHeaderRectAt(page, col))!.width);
  } finally {
    await context.close();
  }
});

test('行ヘッダー境界のドラッグで行高が広がる（AC2）', async ({ browser }) => {
  const { context, page } = await openClient(browser, 'リサイズ-行');
  try {
    const box = (await page.locator('.nsheet-scroller').boundingBox())!;
    const row = 3;
    const before = (await rowHeaderRectAt(page, row))!;
    const x = box.x + before.x + before.width / 2;
    const startY = box.y + before.y + before.height - 2;

    await page.mouse.move(x, startY);
    await page.mouse.down();
    await page.mouse.move(x, startY + 50, { steps: 6 });
    await page.mouse.up();

    await expect
      .poll(async () => (await rowHeaderRectAt(page, row))!.height, { message: '行高が広がる' })
      .toBeGreaterThan(before.height + 30);
  } finally {
    await context.close();
  }
});

test('確定 layout は override のみを保持し、リロードで復元される（AC3・AC4）', async ({ browser }) => {
  const { context, page } = await openClient(browser, 'リサイズ-復元');
  try {
    const box = (await page.locator('.nsheet-scroller').boundingBox())!;
    const col = 2;
    const before = (await columnHeaderRectAt(page, col))!;
    const startX = box.x + before.x + before.width - 2;
    const y = box.y + before.y + before.height / 2;

    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + 120, y, { steps: 6 });
    await page.mouse.up();

    // override は 1 列だけ（既定値の列は含まない・AC3）。行は未変更ゆえ空。
    const cw = await columnWidthOverrides(page);
    expect(Object.keys(cw)).toHaveLength(1);
    expect(await rowHeightOverrides(page)).toEqual({});
    const resizedWidth = (await columnHeaderRectAt(page, col))!.width;
    expect(resizedWidth).toBeGreaterThan(before.width + 80);

    // 利用側（playground）が layout イベントを localStorage へ保存済み。リロードで初期値注入され復元される（AC4）。
    await page.reload();
    await expect
      .poll(async () => (await snapshot(page)).ready, { timeout: 30_000, message: 'reload 後 ready' })
      .toBe(true);
    await expect
      .poll(async () => (await columnHeaderRectAt(page, col))!.width, { message: 'リロードで列幅が復元される' })
      .toBe(resizedWidth);
  } finally {
    await context.close();
  }
});
