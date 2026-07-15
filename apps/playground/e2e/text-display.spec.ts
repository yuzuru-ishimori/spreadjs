// DD-012-5 E2E: 折り返し（wrap）列の自動行高（AC4/AC5）。
//
// 実ブラウザーで wrap 列（col-2）へ長文を入力すると行高が自動拡張され、短い値へ編集すると自動縮小することを、
// 本番 transform のセル矩形高（cellRectAt().height）で検証する。オーバーフロー描画（AC1〜3）は Canvas ピクセル
// 依存のため走査純関数のユニット（text-overflow.test.ts）＋実機 Manual Gate に委ね、ここでは配線＝自動行高の
// トリガー（ローカル楽観適用）が実ブラウザーで成立することに集中する。

import { expect, test } from '@playwright/test';

import { cellRectAt, openClient, plainTypeAndCommit, selectCell } from './integration-helpers';

test('wrap 列へ長文入力 → 行高が自動拡張し、短い値へ編集 → 自動縮小する（AC4/AC5）', async ({ browser }) => {
  // wrap=col-2 を有効化して mount（利用側 GridMountOptions.wrapColumns の実演）。
  const { context, page } = await openClient(browser, 'テキスト表示', { wrap: 'col-2' });
  try {
    const row = 3;
    const wrapCol = 2; // col-2（折り返し列）
    const before = (await cellRectAt(page, row, wrapCol))!;

    // 長文を入力・確定 → 折り返しで複数行になり行高が自動拡張される。
    await selectCell(page, row, wrapCol);
    await plainTypeAndCommit(page, 'this-is-a-very-long-wrapped-text-that-needs-multiple-lines-in-a-narrow-column');

    await expect
      .poll(async () => (await cellRectAt(page, row, wrapCol))!.height, {
        message: '長文入力で行高が自動拡張される',
      })
      .toBeGreaterThan(before.height);

    // 短い値へ編集 → 1 行に収まり行高が既定へ自動縮小する。
    await selectCell(page, row, wrapCol);
    await plainTypeAndCommit(page, 'x');

    await expect
      .poll(async () => (await cellRectAt(page, row, wrapCol))!.height, {
        message: '短い値へ編集で行高が自動縮小する',
      })
      .toBe(before.height);
  } finally {
    await context.close();
  }
});
