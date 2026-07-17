// DD-020-3 E2E: 単独グリッドモード（DD-024）の Undo/Redo（AC1/AC2/AC4/AC7/AC8）。
//
// 共同編集サーバーを使わず standalone.html だけで成立する。Undo/Redo は補償 SetCells を submit し、
// standalone では cell-commit（SetCells batch 単位・DD-024 保存契約）を発火する。server 系イベント
// （connection/pending/rejected）は 1 件も出ない。2 クライアント OCC 拒否（AC3）は undo-redo-collab.spec.ts。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
  canUndo,
  colIdAt,
  composeCommitAtCell,
  composeOpen,
  displayCell,
  draft,
  events,
  isComposing,
  openStandalone,
  redoDepth,
  rowIdAt,
  selectCell,
  undoDepth,
  waitReady,
} from './standalone-helpers';
import { dispatchSyntheticPaste } from './integration-helpers';

test.describe.configure({ mode: 'serial' });

async function remount(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__standalone?.destroy();
    window.__standalone?.clearSaved();
    window.__standalone?.mount();
  });
  await waitReady(page);
}

/** cell-commit batch に (rowId,columnId,value,previousValue) を含むイベントが少なくとも1件あるか。 */
async function hasCommit(
  page: Page,
  rowId: string,
  columnId: string,
  value: string,
  previousValue: string,
): Promise<boolean> {
  return (await events(page))
    .filter((e) => e.type === 'cell-commit')
    .some((e) =>
      e.changes?.some(
        (c) => c.rowId === rowId && c.columnId === columnId && c.value === value && c.previousValue === previousValue,
      ),
    );
}

test('UE-1: commit→Ctrl+Z→前値・Ctrl+Y→再適用（cell-commit 整合・AC1/AC4/AC7）', async ({ browser }) => {
  const { context, page } = await openStandalone(browser);
  try {
    await remount(page);
    // (2, col-b) は初期空。IME 確定で "abc"。
    await composeCommitAtCell(page, 2, 1, 'abc');
    const row = (await rowIdAt(page, 2))!;
    const col = (await colIdAt(page, 1))!;
    expect(col).toBe('col-b');
    await expect.poll(async () => displayCell(page, row, col), { message: 'commit' }).toBe('abc');
    await expect.poll(async () => undoDepth(page), { message: 'undo 記録' }).toBe(1);

    // Ctrl+Z → 前値（空）へ・undo の cell-commit（after=''・previousValue='abc'）発火。
    await selectCell(page, 2, 1);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => displayCell(page, row, col), { message: 'undo→空' }).toBe('');
    await expect
      .poll(async () => hasCommit(page, row, col, '', 'abc'), { message: 'undo の cell-commit（DD-024 保存契約）' })
      .toBe(true);
    await expect.poll(async () => redoDepth(page), { message: 'redo へ' }).toBe(1);

    // Ctrl+Y → "abc" 再適用・redo の cell-commit。
    await page.keyboard.press('Control+y');
    await expect.poll(async () => displayCell(page, row, col), { message: 'redo→再適用' }).toBe('abc');
    await expect.poll(async () => hasCommit(page, row, col, 'abc', ''), { message: 'redo の cell-commit' }).toBe(true);

    // server 系イベントは 1 件も出ない（単独モード・DD-024 契約）。
    expect(
      (await events(page)).filter((e) => ['connection', 'pending', 'rejected', 'divergence'].includes(e.type)),
    ).toHaveLength(0);
  } finally {
    await context.close();
  }
});

test('UE-2: paste→Ctrl+Z→範囲全体が前値（原子・AC2/AC7）', async ({ browser }) => {
  const { context, page } = await openStandalone(browser);
  try {
    await remount(page);
    const row = (await rowIdAt(page, 4))!;
    const colB = (await colIdAt(page, 1))!;
    const colC = (await colIdAt(page, 2))!;

    // (4, col-b) を選択して 1×2 TSV を貼り付け → (4,col-b)='p'・(4,col-c)='q'。
    await selectCell(page, 4, 1);
    await dispatchSyntheticPaste(page, 'p\tq');
    await expect.poll(async () => displayCell(page, row, colB), { message: 'paste col-b' }).toBe('p');
    await expect.poll(async () => displayCell(page, row, colC), { message: 'paste col-c' }).toBe('q');

    // Ctrl+Z → 範囲全体が前値（両セル空）。原子＝両方戻る。
    await selectCell(page, 4, 1);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => displayCell(page, row, colB), { message: 'undo col-b' }).toBe('');
    await expect.poll(async () => displayCell(page, row, colC), { message: 'undo col-c' }).toBe('');
    // undo の cell-commit batch に両セルの復元が含まれる。
    await expect
      .poll(
        async () =>
          (await events(page))
            .filter((e) => e.type === 'cell-commit')
            .some(
              (e) =>
                (e.changes?.some((c) => c.rowId === row && c.columnId === colB && c.value === '') ?? false) &&
                (e.changes?.some((c) => c.rowId === row && c.columnId === colC && c.value === '') ?? false),
            ),
        { message: 'paste undo は 1 batch で両セル復元（原子）' },
      )
      .toBe(true);
  } finally {
    await context.close();
  }
});

test('UE-3: 新規操作で Redo 破棄（AC4）', async ({ browser }) => {
  const { context, page } = await openStandalone(browser);
  try {
    await remount(page);
    const row6 = (await rowIdAt(page, 6))!;
    const col = (await colIdAt(page, 1))!;

    await composeCommitAtCell(page, 6, 1, 'a');
    await selectCell(page, 6, 1);
    await page.keyboard.press('Control+z'); // (6,col-b) → 空
    await expect.poll(async () => displayCell(page, row6, col), { message: 'undo' }).toBe('');
    await expect.poll(async () => redoDepth(page), { message: 'redo 1' }).toBe(1);

    // 新規操作（別セル (7,col-b) へ commit）→ redo 破棄。
    await composeCommitAtCell(page, 7, 1, 'b');
    await expect.poll(async () => redoDepth(page), { message: 'redo 破棄' }).toBe(0);

    // Ctrl+Y は無効（(6,col-b) は空のまま）。
    await selectCell(page, 6, 1);
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(120);
    expect(await displayCell(page, row6, col)).toBe('');
  } finally {
    await context.close();
  }
});

test('UE-7: setData（文書差し替え）で Undo 履歴が消去される（Codex P1・旧文書の逆値を新文書へ適用しない）', async ({
  browser,
}) => {
  const { context, page } = await openStandalone(browser);
  try {
    await remount(page);
    // (10, col-b) を 'orig' に確定 → undo 対象。
    await composeCommitAtCell(page, 10, 1, 'orig');
    const row = (await rowIdAt(page, 10))!;
    const col = (await colIdAt(page, 1))!;
    expect(row).toBe('r10');
    await expect.poll(async () => undoDepth(page), { message: 'undo 記録' }).toBe(1);

    // setData で文書を丸ごと差し替え（同じ rowId r10 だが col-b は 'fresh'）。
    await page.evaluate(() => {
      window.__standalone?.reinject({
        rows: Array.from({ length: 20 }, (_, i) => ({
          rowId: `r${i}`,
          cells: { 'col-a': `行${i}`, 'col-b': i === 10 ? 'fresh' : '' },
        })),
      });
    });
    await expect.poll(async () => displayCell(page, row, col), { message: '再注入で fresh' }).toBe('fresh');
    // 履歴消去 → undoDepth 0・canUndo false（旧文書の逆値を保持しない）。
    await expect.poll(async () => undoDepth(page), { message: 'setData で履歴消去' }).toBe(0);
    expect(await canUndo(page)).toBe(false);

    // Ctrl+Z は no-op（'orig'→前値 を fresh へ適用してサイレント上書きしない）。
    await selectCell(page, 10, 1);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(120);
    expect(await displayCell(page, row, col), 'undo は fresh を上書きしない').toBe('fresh');
  } finally {
    await context.close();
  }
});

test('UE-4: composition 中の Ctrl+Z はグリッド Undo を発火しない（AC8・IME 非干渉）', async ({ browser }) => {
  const { context, page } = await openStandalone(browser);
  try {
    await remount(page);
    const row8 = (await rowIdAt(page, 8))!;
    const col = (await colIdAt(page, 1))!;

    // 先に (8,col-b)='base' を確定（undo 対象を 1 件用意）。
    await composeCommitAtCell(page, 8, 1, 'base');
    await expect.poll(async () => undoDepth(page), { message: 'undo 記録' }).toBe(1);

    // (9,col-b) で変換中（isComposing=true）にして Ctrl+Z。
    await selectCell(page, 9, 1);
    await composeOpen(page, 'にほん');
    await expect.poll(async () => isComposing(page), { message: '変換中' }).toBe(true);
    await page.keyboard.press('Control+z');

    // グリッド Undo は発火しない: (8,col-b) は 'base' のまま・undoDepth 不変・draft/composing 非破壊。
    await page.waitForTimeout(120);
    expect(await displayCell(page, row8, col), 'undo 未発火（前の commit を戻さない）').toBe('base');
    expect(await undoDepth(page), 'undo スタック不変').toBe(1);
    expect(await isComposing(page), 'composition 継続').toBe(true);
    expect(await draft(page), 'draft 非破壊').toBe('にほん');
  } finally {
    await context.close();
  }
});
