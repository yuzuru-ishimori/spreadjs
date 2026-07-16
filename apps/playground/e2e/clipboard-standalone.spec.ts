// DD-020-2 E2E: 単独グリッドモード（DD-024）の clipboard paste/cut → cell-commit（AC9）。
//
// 共同編集サーバーを使わず standalone.html だけで成立する。paste/cut は SetCells batch 単位の cell-commit
// （利用側保存契約＝DD-024）を発火し、server 系イベント（connection/pending/rejected）は 1 件も出ない。

import { expect, test } from '@playwright/test';

import {
  colIdAt,
  composeCommitAtCell,
  displayCell,
  events,
  openStandalone,
  rowIdAt,
  selectCell,
  waitReady,
} from './standalone-helpers';

test.describe.configure({ mode: 'serial' });

test('#1 単独モードで copy→paste が cell-commit（SetCells batch）を発火する（AC9）', async ({ browser }) => {
  const { context, page } = await openStandalone(browser);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  try {
    // 独立性のため保存を掃除して再 mount。
    await page.evaluate(() => {
      window.__standalone?.destroy();
      window.__standalone?.clearSaved();
      window.__standalone?.mount();
    });
    await waitReady(page);

    // ソース (2,0=col-a) に値を確定（IME 経由）。
    await composeCommitAtCell(page, 2, 0, 'clipdata');
    await expect
      .poll(async () => (await events(page)).filter((e) => e.type === 'cell-commit').length, { message: 'source commit' })
      .toBeGreaterThanOrEqual(1);

    // (2,0) をコピー → (5,1=col-b) へ貼り付け。
    await selectCell(page, 2, 0);
    await page.keyboard.press('Control+c');
    await selectCell(page, 5, 1);
    await page.keyboard.press('Control+v');

    const dstRow = (await rowIdAt(page, 5))!;
    const dstCol = (await colIdAt(page, 1))!;
    expect(dstCol).toBe('col-b');

    // paste の cell-commit が発火し batch に (r5, col-b, 'clipdata') を含む。
    await expect
      .poll(
        async () =>
          (await events(page))
            .filter((e) => e.type === 'cell-commit')
            .some((e) => e.changes?.some((c) => c.rowId === dstRow && c.columnId === dstCol && c.value === 'clipdata')),
        { message: 'paste の cell-commit（DD-024 保存契約）' },
      )
      .toBe(true);
    expect(await displayCell(page, dstRow, dstCol)).toBe('clipdata');

    // server 系イベントは 1 件も出ない（単独モード）。
    expect(
      (await events(page)).filter((e) => ['connection', 'pending', 'rejected', 'divergence'].includes(e.type)),
    ).toHaveLength(0);
  } finally {
    await context.close();
  }
});

test('#2 単独モードで cut → 範囲クリアの cell-commit（before/after）が発火する（AC9）', async ({ browser }) => {
  const { context, page } = await openStandalone(browser);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  try {
    await page.evaluate(() => {
      window.__standalone?.destroy();
      window.__standalone?.clearSaved();
      window.__standalone?.mount();
    });
    await waitReady(page);

    await composeCommitAtCell(page, 3, 2, 'cutme'); // (3, col-c)
    const row = (await rowIdAt(page, 3))!;
    const col = (await colIdAt(page, 2))!;
    await expect.poll(async () => displayCell(page, row, col), { message: 'source set' }).toBe('cutme');

    // (3,2) を選択して実 Ctrl+X → クリップボードへ TSV・元セルはクリア。
    await selectCell(page, 3, 2);
    await page.keyboard.press('Control+x');

    await expect.poll(async () => displayCell(page, row, col), { message: 'cut で元セルがクリア' }).toBe('');
    // クリアの cell-commit が before='cutme'・after='' で発火する（DD-024 保存契約）。
    await expect
      .poll(
        async () =>
          (await events(page))
            .filter((e) => e.type === 'cell-commit')
            .some((e) => e.changes?.some((c) => c.rowId === row && c.columnId === col && c.value === '' && c.previousValue === 'cutme')),
        { message: 'cut クリアの cell-commit' },
      )
      .toBe(true);
  } finally {
    await context.close();
  }
});
