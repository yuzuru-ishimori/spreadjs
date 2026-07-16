// DD-020-2 E2E: clipboard copy/cut/paste（共同編集モード）。
//
// 2 系統で検証する（親 Manual Gate の synthetic 自動化方針）:
//   ① 実 Ctrl+C/V/X＋実 Clipboard API（grantPermissions(['clipboard-read','clipboard-write'])）で round-trip
//      （CL-1 値/型保持・CL-2 敷き詰め・CL-4 cut・CL-6 OCC 2 クライアント）
//   ② 合成 ClipboardEvent（DataTransfer）で Excel 方言 fixture を byte 精密に注入（CL-5 引用内改行）・
//      composition 非干渉（CL-7）。
// 選択・値は Canvas に描かれ DOM から読めないため debug API（committedCell/committedCellKind/selectionRange）で観測する。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
  colIdAt,
  committedCell,
  committedCellKind,
  composeFinalizeAndCommit,
  composeOpen,
  connectionState,
  dispatchSyntheticPaste,
  dragSelect,
  grantClipboard,
  openClient,
  plainTypeAndCommit,
  readClipboard,
  rowIdAt,
  scrollTo,
  selectCell,
  selectionRange,
  simulateDrop,
  simulateReconnect,
  snapshot,
  writeClipboard,
} from './integration-helpers';

test.describe.configure({ mode: 'serial' });

/** (row,col) を選択して値を入力・確定し committed に反映されるまで待つ。 */
async function commitValue(page: Page, row: number, col: number, value: string): Promise<void> {
  const rowId = await rowIdAt(page, row);
  const columnId = await colIdAt(page, col);
  await selectCell(page, row, col);
  await plainTypeAndCommit(page, value);
  await expect
    .poll(async () => committedCell(page, rowId!, columnId!), { message: `(${row},${col})=${value} committed` })
    .toBe(value);
}

test('CL-1: グリッド内 copy→paste round-trip（実 Ctrl+C/V）→ 値と型（number/date/string）が保持される（AC3）', async ({
  browser,
}) => {
  const { context, page } = await openClient(browser, 'clip-roundtrip');
  await grantClipboard(context);
  try {
    // ソース 2×2 に型が分かれる値を committed 済みにする（number/date/string/number）。
    await commitValue(page, 5, 1, '123');
    await commitValue(page, 5, 2, '2026-07-16');
    await commitValue(page, 6, 1, 'hello');
    await commitValue(page, 6, 2, '42');

    // 範囲 (5,1)〜(6,2) をドラッグ選択して実 Ctrl+C。
    await dragSelect(page, { row: 5, col: 1 }, { row: 6, col: 2 });
    expect(await selectionRange(page)).toEqual({ rowStart: 5, rowEnd: 7, colStart: 1, colEnd: 3 });
    await page.keyboard.press('Control+c');

    // 実クリップボードに TSV が入る（EOL は正規化して比較）。
    await expect
      .poll(async () => (await readClipboard(page)).replace(/\r\n/g, '\n'), { message: 'copy TSV が clipboard へ' })
      .toBe('123\t2026-07-16\nhello\t42');

    // 貼り付け先 (10,1) を単一選択して実 Ctrl+V（左上アンカーから 2×2）。
    await selectCell(page, 10, 1);
    await page.keyboard.press('Control+v');

    const t = [
      [10, 1, '123', 'number'],
      [10, 2, '2026-07-16', 'date'],
      [11, 1, 'hello', 'string'],
      [11, 2, '42', 'number'],
    ] as const;
    for (const [row, col, value, kind] of t) {
      const rowId = await rowIdAt(page, row);
      const columnId = await colIdAt(page, col);
      await expect
        .poll(async () => committedCell(page, rowId!, columnId!), { message: `paste (${row},${col})=${value}` })
        .toBe(value);
      expect(await committedCellKind(page, rowId!, columnId!), `型 (${row},${col})`).toBe(kind);
    }
  } finally {
    await context.close();
  }
});

test('CL-2: 1×1 copy → 複数セル選択 paste → 選択範囲全体へ敷き詰め（AC7・実 Ctrl+C/V）', async ({ browser }) => {
  const { context, page } = await openClient(browser, 'clip-tile');
  await grantClipboard(context);
  try {
    await commitValue(page, 5, 1, 'fill');
    await selectCell(page, 5, 1);
    await page.keyboard.press('Control+c');
    await expect.poll(async () => readClipboard(page), { message: '1×1 TSV' }).toBe('fill');

    // (8,1)〜(9,2) の 4 セルを選択して paste → 全セルへ 'fill'。
    await dragSelect(page, { row: 8, col: 1 }, { row: 9, col: 2 });
    await page.keyboard.press('Control+v');
    for (const [row, col] of [[8, 1], [8, 2], [9, 1], [9, 2]] as const) {
      const rowId = await rowIdAt(page, row);
      const columnId = await colIdAt(page, col);
      await expect
        .poll(async () => committedCell(page, rowId!, columnId!), { message: `敷き詰め (${row},${col})` })
        .toBe('fill');
    }
  } finally {
    await context.close();
  }
});

test('CL-4: cut（実 Ctrl+X）→ clipboard へ TSV・元範囲は原子クリア・貼り付け先で値再現（AC8）', async ({
  browser,
}) => {
  const { context, page } = await openClient(browser, 'clip-cut');
  await grantClipboard(context);
  try {
    await commitValue(page, 5, 1, 'cut1');
    await commitValue(page, 5, 2, 'cut2');
    const srcRow = await rowIdAt(page, 5);
    const col1 = await colIdAt(page, 1);
    const col2 = await colIdAt(page, 2);

    await dragSelect(page, { row: 5, col: 1 }, { row: 5, col: 2 });
    await page.keyboard.press('Control+x');

    // clipboard に TSV・元範囲は空へ（原子クリア）。
    await expect.poll(async () => readClipboard(page), { message: 'cut TSV' }).toBe('cut1\tcut2');
    await expect.poll(async () => committedCell(page, srcRow!, col1!), { message: '元 (5,1) クリア' }).toBe('');
    await expect.poll(async () => committedCell(page, srcRow!, col2!), { message: '元 (5,2) クリア' }).toBe('');

    // 貼り付け先で再現。
    await selectCell(page, 12, 1);
    await page.keyboard.press('Control+v');
    const dstRow = await rowIdAt(page, 12);
    await expect.poll(async () => committedCell(page, dstRow!, col1!), { message: 'paste (12,1)' }).toBe('cut1');
    await expect.poll(async () => committedCell(page, dstRow!, col2!), { message: 'paste (12,2)' }).toBe('cut2');
  } finally {
    await context.close();
  }
});

test('CL-3: 下端はみ出し paste → 実行前拒否（AC6・paste-out-of-bounds・submit なし・通知）', async ({ browser }) => {
  const { context, page } = await openClient(browser, 'clip-oob');
  await grantClipboard(context);
  try {
    // rejected 通知を公開契約（subscribe）で捕捉する。
    await page.evaluate(() => {
      const w = window as unknown as {
        __gridInstance?: { subscribe(l: (e: unknown) => void): () => void };
        __rejectedCodes?: string[];
      };
      w.__rejectedCodes = [];
      w.__gridInstance?.subscribe((e) => {
        const ev = e as { type: string; conflict?: { code: string } };
        if (ev.type === 'rejected' && ev.conflict !== undefined) {
          w.__rejectedCodes?.push(ev.conflict.code);
        }
      });
    });

    // 最下行付近へスクロールして (49999,1) を選択。2 行 TSV を貼ると行末を越える。
    await scrollTo(page, 49_999 * 22, 0);
    await expect
      .poll(async () => selectCell(page, 49_999, 1).then(() => true).catch(() => false), { message: '最下行可視' })
      .toBe(true);
    const before = await snapshot(page);
    await writeClipboard(page, 'x\ny'); // 2 行（parseClipboardText→[['x'],['y']]）
    await page.keyboard.press('Control+v');

    await expect
      .poll(
        async () => page.evaluate(() => (window as unknown as { __rejectedCodes?: string[] }).__rejectedCodes ?? []),
        { message: 'paste-out-of-bounds 通知' },
      )
      .toContain('paste-out-of-bounds');
    // submit されない（committedRevision・pendingCount 不変）。
    const after = await snapshot(page);
    expect(after.committedRevision).toBe(before.committedRevision);
    expect(after.pendingCount).toBe(0);
  } finally {
    await context.close();
  }
});

test('CL-5: Excel 方言 fixture 注入（引用内改行）→ セル内改行として正しく貼り付け（AC1・合成 ClipboardEvent）', async ({
  browser,
}) => {
  const { context, page } = await openClient(browser, 'clip-dialect');
  try {
    await selectCell(page, 14, 1);
    // "line1\nline2"\tplain（引用内改行＝Excel Alt+Enter 相当）。DataTransfer で byte 精密に注入する。
    const prevented = await dispatchSyntheticPaste(page, '"line1\nline2"\tplain');
    expect(prevented, 'グリッドが paste を消費（preventDefault）').toBe(true);

    const rowId = await rowIdAt(page, 14);
    const col1 = await colIdAt(page, 1);
    const col2 = await colIdAt(page, 2);
    await expect
      .poll(async () => committedCell(page, rowId!, col1!), { message: 'セル内改行が保持される' })
      .toBe('line1\nline2');
    await expect.poll(async () => committedCell(page, rowId!, col2!), { message: '隣接セル' }).toBe('plain');
  } finally {
    await context.close();
  }
});

test('CL-6: 2 クライアント OCC — 範囲内セルの先行変更で paste 全体 reject・収束・文書無変更（AC5）', async ({
  browser,
}) => {
  const a = await openClient(browser, 'clip-occ-A');
  const b = await openClient(browser, 'clip-occ-B');
  await grantClipboard(a.context);
  try {
    // A が (25,1)(25,2) を committed 済みにし、コピー元 TSV を実クリップボードへ用意する。
    await commitValue(a.page, 25, 1, 'srcP');
    await commitValue(a.page, 25, 2, 'srcQ');
    const rowId = await rowIdAt(a.page, 25);
    const col1 = await colIdAt(a.page, 1);
    const col2 = await colIdAt(a.page, 2);
    await commitValue(a.page, 26, 1, 'baseR'); // 貼り付け先 (26,1)(26,2) の初期値
    await commitValue(a.page, 26, 2, 'baseS');
    await expect.poll(async () => (await snapshot(a.page)).pendingCount, { message: 'A pending 空' }).toBe(0);
    await expect.poll(async () => committedCell(b.page, rowId!, col1!), { message: 'B が A を受信' }).toBe('srcP');

    // A が (25,*) をコピー → 貼り付け先 (26,1) を選択 → 切断。
    await dragSelect(a.page, { row: 25, col: 1 }, { row: 25, col: 2 });
    await a.page.keyboard.press('Control+c');
    await expect.poll(async () => readClipboard(a.page), { message: 'copy TSV' }).toBe('srcP\tsrcQ');
    await selectCell(a.page, 26, 1);
    await simulateDrop(a.page);
    await expect.poll(() => connectionState(a.page), { message: 'A offline' }).toBe('offline');

    // B が貼り付け範囲内 (26,1) を先に確定（サーバー committed 前進）。
    const dstRow = await rowIdAt(b.page, 26);
    await commitValue(b.page, 26, 1, 'occ-b');

    // A（offline）が paste → ローカル楽観適用（pending=1）。
    await a.page.keyboard.press('Control+v');
    await expect
      .poll(async () => (await snapshot(a.page)).pendingCount, { message: 'A の paste が pending' })
      .toBe(1);

    // 再接続 → catch-up で B の確定を取り込み、A の paste SetCells は stale で全体 reject。
    await simulateReconnect(a.page);
    await expect.poll(() => connectionState(a.page), { timeout: 30_000, message: 'A online' }).toBe('online');
    await expect
      .poll(
        async () =>
          (await committedCell(a.page, dstRow!, col1!)) === 'occ-b' &&
          (await committedCell(a.page, dstRow!, col2!)) === 'baseS' &&
          (await snapshot(a.page)).pendingCount === 0,
        { timeout: 15_000, message: 'A が全体 reject 後も文書無変更で収束（部分適用なし）' },
      )
      .toBe(true);
    // A/B の committed hash 一致（収束）。
    expect((await snapshot(a.page)).committedHash).toBe((await snapshot(b.page)).committedHash);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test('CL-7: composition 中の paste はグリッド paste を発火しない（AC10・IME 非干渉・合成）', async ({ browser }) => {
  const { context, page } = await openClient(browser, 'clip-ime');
  try {
    const rowId = await rowIdAt(page, 30);
    const columnId = await colIdAt(page, 1);
    await selectCell(page, 30, 1);
    await composeOpen(page, ['に', 'にほ', 'にほん']);
    await expect.poll(async () => (await snapshot(page)).isComposing, { message: '変換中' }).toBe(true);
    const revBefore = (await snapshot(page)).committedRevision;

    // 変換中に paste イベント → グリッドは消費しない（clipboardActive=false）・draft/composing 不変。
    const prevented = await dispatchSyntheticPaste(page, 'PASTED');
    expect(prevented, 'composition 中はグリッドが消費しない（ブラウザ既定へ委譲）').toBe(false);
    const s = await snapshot(page);
    expect(s.committedRevision, 'paste で committed が動かない').toBe(revBefore);
    expect(s.isComposing).toBe(true);
    expect(s.draft).toBe('にほん');

    // 変換確定 → 通常どおり commit できる（draft が失われていない）。
    await composeFinalizeAndCommit(page, 'にほん');
    await expect
      .poll(async () => committedCell(page, rowId!, columnId!), { message: '確定値が committed へ' })
      .toBe('にほん');
  } finally {
    await context.close();
  }
});
