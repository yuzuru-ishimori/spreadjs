// DD-020-1 E2E: 矩形範囲選択（ドラッグ / Shift+クリック / Shift+矢印）・解除・範囲クリア。
//
// シナリオ正本: doc/DD/DD-020-1/e2e-scenarios.md（S1〜S9）。選択状態は Canvas に描かれ DOM から読めないため、
// debug API（selectionRange/dragRange・test-support 経由）で観測する。矩形の幾何・解除の不変条件の細目は
// ユニット（selection-controller.test.ts）が担保し、ここでは「実ブラウザーで入力配線が成立する」ことに集中する。
// S6〜S9 は範囲クリア（Delete=原子 SetCells・OCC 全体 reject・上限拒否・composition 非干渉）。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
  cellCenter,
  colIdAt,
  committedCell,
  composeFinalizeAndCommit,
  composeOpen,
  connectionState,
  dragRange,
  dragSelect,
  openClient,
  plainTypeAndCommit,
  rowIdAt,
  scrollTo,
  selectCell,
  selectionRange,
  shiftClickCell,
  simulateDrop,
  simulateReconnect,
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

test('S1補: ドラッグが viewport 外（下端の外）へ出ても不可視セルへ拡張しない（Codex P1）', async ({
  browser,
}) => {
  const { context, page } = await openClient(browser, '範囲-外側ドラッグ');
  try {
    const start = await cellCenter(page, 2, 2);
    const mid = await cellCenter(page, 4, 3);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(mid.x, mid.y, { steps: 3 });
    await expect
      .poll(async () => dragRange(page), { message: 'viewport 内で dragRange が形成される' })
      .toEqual({ rowStart: 2, rowEnd: 5, colStart: 2, colEnd: 4 });

    // pointer capture 中に scroller の下端の外（stage 外）へ move。hitTest は下端外も Axis セルへ
    // 解決してしまうため、境界検査が無いと不可視セルまで範囲が伸びる（→ Delete で画面外を消す事故）。
    // steps は指定しない（単一ジャンプ）: 中間点が viewport 内を通ると正当な focus 更新が起きるため。
    const box = await page.locator('.nsheet-scroller').boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 300, box!.y + box!.height + 6);
    expect(await dragRange(page), 'viewport 外では直近 focus を保持する').toEqual({
      rowStart: 2,
      rowEnd: 5,
      colStart: 2,
      colEnd: 4,
    });

    await page.mouse.up();
    expect(await selectionRange(page)).toEqual({ rowStart: 2, rowEnd: 5, colStart: 2, colEnd: 4 });
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

/** (row,col) を選択して値を入力・確定し、committed に反映されるまで待つ。 */
async function commitCellValue(page: Page, row: number, col: number, value: string): Promise<void> {
  const rowId = await rowIdAt(page, row);
  const columnId = await colIdAt(page, col);
  expect(rowId, `rowId(${row})`).toBeDefined();
  expect(columnId, `colId(${col})`).toBeDefined();
  await selectCell(page, row, col);
  await plainTypeAndCommit(page, value);
  await expect
    .poll(async () => committedCell(page, rowId!, columnId!), { message: `(${row},${col})=${value} が committed` })
    .toBe(value);
}

test('S6: 範囲 Delete＝1 SetCells の原子クリア（AC5 正常系・revision +1・他クライアント収束・選択維持）', async ({
  browser,
}) => {
  const a = await openClient(browser, '範囲-Delete-A');
  const b = await openClient(browser, '範囲-Delete-B');
  try {
    // 前提: (10,2)〜(11,3) の 4 セルへ既知の値を committed 済みにする。
    const rowIds = [await rowIdAt(a.page, 10), await rowIdAt(a.page, 11)] as const;
    const colIds = [await colIdAt(a.page, 2), await colIdAt(a.page, 3)] as const;
    await commitCellValue(a.page, 10, 2, 'del-1');
    await commitCellValue(a.page, 11, 2, 'del-2');
    await commitCellValue(a.page, 10, 3, 'del-3');
    await commitCellValue(a.page, 11, 3, 'del-4');
    await expect.poll(async () => (await snapshot(a.page)).pendingCount, { message: 'A pending 空' }).toBe(0);

    // 範囲 {10,12,2,4} をドラッグ選択して Delete。
    await dragSelect(a.page, { row: 10, col: 2 }, { row: 11, col: 3 });
    expect(await selectionRange(a.page)).toEqual({ rowStart: 10, rowEnd: 12, colStart: 2, colEnd: 4 });
    const revBefore = (await snapshot(a.page)).committedRevision;
    await a.page.keyboard.press('Delete');

    // 4 セルすべてが committed で '' へ（A・B の両方＝収束）。
    for (const page of [a.page, b.page]) {
      for (const rowId of rowIds) {
        for (const columnId of colIds) {
          await expect
            .poll(async () => committedCell(page, rowId!, columnId!), { message: '範囲内セルが原子クリアされる' })
            .toBe('');
        }
      }
    }
    // committedRevision はちょうど +1（= 1 つの SetCells batch。非空 4 セルのみを含む）。
    expect((await snapshot(a.page)).committedRevision).toBe(revBefore + 1);
    // 選択範囲は維持される（Delete は解除トリガーではない）。activeCell も anchor のまま。
    expect(await selectionRange(a.page)).toEqual({ rowStart: 10, rowEnd: 12, colStart: 2, colEnd: 4 });
    expect((await snapshot(a.page)).activeCell).toEqual({ row: 10, col: 2 });
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test('S7: 範囲 Delete の OCC 全体 reject（AC5 競合系・部分適用なし・文書無変更・rejected 通知）', async ({
  browser,
}) => {
  const a = await openClient(browser, '範囲-OCC-A');
  const b = await openClient(browser, '範囲-OCC-B');
  try {
    // 前提: A が (20,2)・(20,3) を committed 済み。
    const rowId = await rowIdAt(a.page, 20);
    const col2 = await colIdAt(a.page, 2);
    const col3 = await colIdAt(a.page, 3);
    await commitCellValue(a.page, 20, 2, 'occ-a1');
    await commitCellValue(a.page, 20, 3, 'occ-a2');
    await expect.poll(async () => (await snapshot(a.page)).pendingCount, { message: 'A pending 空' }).toBe(0);
    await expect
      .poll(async () => committedCell(b.page, rowId!, col2!), { message: 'B が A の値を受信' })
      .toBe('occ-a1');

    // A が範囲 {20,21,2,4} を選択 → 切断（offline 保持）。
    await dragSelect(a.page, { row: 20, col: 2 }, { row: 20, col: 3 });
    expect(await selectionRange(a.page)).toEqual({ rowStart: 20, rowEnd: 21, colStart: 2, colEnd: 4 });
    await simulateDrop(a.page);
    await expect.poll(() => connectionState(a.page), { message: 'A offline' }).toBe('offline');

    // B が範囲内の (20,2) を先に確定（サーバー committed が前進）。
    await commitCellValue(b.page, 20, 2, 'occ-b');

    // rejected イベント（公開契約）を GridInstance.subscribe で捕捉する（#int-status は後続の
    // connection/pending イベントで上書きされるため、通知の観測は consumer API 経由で行う）。
    await a.page.evaluate(() => {
      const w = window as unknown as {
        __gridInstance?: { subscribe(listener: (e: unknown) => void): () => void };
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

    // A（offline）が範囲 Delete → ローカル楽観適用（pending=1・A の見た目はクリア）。
    const conflictsBefore = (await snapshot(a.page)).conflictCount;
    await a.page.keyboard.press('Delete');
    await expect
      .poll(async () => (await snapshot(a.page)).pendingCount, { message: 'A の Delete が pending に積まれる' })
      .toBe(1);

    // 再接続 → catch-up で B の確定を取り込み、A の SetCells は stale-cell-revision で**全体 reject**。
    await simulateReconnect(a.page);
    await expect.poll(() => connectionState(a.page), { timeout: 30_000, message: 'A online 復帰' }).toBe('online');
    await expect
      .poll(async () => (await snapshot(a.page)).conflictCount, { message: '全体 reject → Conflict Queue' })
      .toBe(conflictsBefore + 1);

    // 文書は無変更のまま収束: (20,2)=B の値・(20,3)=A の元の値（部分適用なし）。A/B の committed hash 一致。
    await expect
      .poll(
        async () =>
          (await committedCell(a.page, rowId!, col2!)) === 'occ-b' &&
          (await committedCell(a.page, rowId!, col3!)) === 'occ-a2' &&
          (await snapshot(a.page)).pendingCount === 0,
        { timeout: 15_000, message: 'A が reject 後も文書無変更で収束' },
      )
      .toBe(true);
    expect((await snapshot(a.page)).committedHash).toBe((await snapshot(b.page)).committedHash);

    // rejected 通知が利用側（subscribe 購読者）へ届く。公開 code は reject 経路により
    // revalidation-failed（catch-up 後のローカル再検証）または cell-conflict（server 判定 stale-cell-revision）。
    const rejectedCodes = await a.page.evaluate(
      () => (window as unknown as { __rejectedCodes?: string[] }).__rejectedCodes ?? [],
    );
    expect(rejectedCodes.length).toBeGreaterThanOrEqual(1);
    expect(rejectedCodes[0]).toMatch(/^(revalidation-failed|cell-conflict)$/);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test('S8: 上限（100,000 セル）超過の範囲 Delete は実行前拒否（AC6・submit なし・通知あり・選択維持）', async ({
  browser,
}) => {
  const { context, page } = await openClient(browser, '範囲-上限');
  try {
    // A1 (0,0) を anchor に、最下行 (49999,2) まで Shift+クリックで拡張 → 50,000行×3列 = 150,000 セル。
    await selectCell(page, 0, 0);
    await scrollTo(page, 50_000 * 22, 0); // 最下部へ（行高 22px 既定）
    await expect
      .poll(async () => cellCenter(page, 49_999, 2).then(() => true).catch(() => false), {
        message: '最下行が可視になる',
      })
      .toBe(true);
    await shiftClickCell(page, 49_999, 2);
    expect(await selectionRange(page)).toEqual({ rowStart: 0, rowEnd: 50_000, colStart: 0, colEnd: 3 });

    const before = await snapshot(page);
    await page.keyboard.press('Delete');

    // 実行前拒否: 公開 code=range-too-large が rejected イベントとして通知され #int-status に出る。
    await expect(page.locator('#int-status')).toContainText('range-too-large');
    // submit されない（committedRevision・pendingCount 不変）。
    const after = await snapshot(page);
    expect(after.committedRevision).toBe(before.committedRevision);
    expect(after.pendingCount).toBe(0);
    // 選択範囲は維持される（縮めて再実行できる）。
    expect(await selectionRange(page)).toEqual({ rowStart: 0, rowEnd: 50_000, colStart: 0, colEnd: 3 });
  } finally {
    await context.close();
  }
});

test('S9: composition 中は選択操作・範囲 Delete が発火しない（AC7・IME 非干渉・synthetic）', async ({
  browser,
}) => {
  const { context, page } = await openClient(browser, '範囲-IME');
  try {
    const rowId = await rowIdAt(page, 30);
    const columnId = await colIdAt(page, 2);
    await selectCell(page, 30, 2);
    await composeOpen(page, ['に', 'にほ', 'にほん']);
    await expect.poll(async () => (await snapshot(page)).isComposing, { message: '変換中に入る' }).toBe(true);
    const revBefore = (await snapshot(page)).committedRevision;

    // 1) Shift+ArrowDown → 範囲拡張は起きない・draft/composing 不変（状態機械が SuppressKey）。
    await page.keyboard.press('Shift+ArrowDown');
    expect(await selectionRange(page)).toBeNull();
    let s = await snapshot(page);
    expect(s.isComposing).toBe(true);
    expect(s.draft).toBe('にほん');

    // 2) Delete → グリッドの範囲クリア/単一クリアは発火しない（committedRevision 不変）・composing 維持。
    await page.keyboard.press('Delete');
    s = await snapshot(page);
    expect(s.committedRevision).toBe(revBefore);
    expect(s.isComposing).toBe(true);
    expect(s.draft).toBe('にほん');

    // 3) 変換確定 → 通常どおり commit できる（draft が失われていない）。
    await composeFinalizeAndCommit(page, 'にほん');
    await expect
      .poll(async () => committedCell(page, rowId!, columnId!), { message: '確定値が committed へ' })
      .toBe('にほん');
  } finally {
    await context.close();
  }
});
