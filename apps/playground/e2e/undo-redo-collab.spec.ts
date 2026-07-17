// DD-020-3 E2E（共同編集モード）: Undo/Redo の server round-trip（補償 SetCells の ACK）と、
// 2 クライアント OCC 競合での Undo 全体拒否＝undo-blocked 通知（AC3・強制 Undo なし）。
//
// 単独モード（standalone）の基本 undo/redo・cell-commit 整合は undo-redo.spec.ts。ここは共同編集固有の
// 「補償 op がサーバー確定/競合 reject する経路」を実ブラウザー＋実 WS で固定する。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
  colIdAt,
  committedCell,
  connectionState,
  openClient,
  plainTypeAndCommit,
  redoDepth,
  rowIdAt,
  selectCell,
  simulateDrop,
  simulateReconnect,
  snapshot,
  undoDepth,
} from './integration-helpers';

test.describe.configure({ mode: 'serial' });

/** __gridInstance.subscribe で rejected の公開コードを収集し始める（CL-3 と同型）。 */
async function collectRejectedCodes(page: Page): Promise<void> {
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
}
async function rejectedCodes(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __rejectedCodes?: string[] }).__rejectedCodes ?? []);
}

async function commitValue(page: Page, row: number, col: number, value: string): Promise<void> {
  const rowId = (await rowIdAt(page, row))!;
  const columnId = (await colIdAt(page, col))!;
  await selectCell(page, row, col);
  await plainTypeAndCommit(page, value);
  await expect.poll(async () => committedCell(page, rowId, columnId), { message: `(${row},${col})=${value}` }).toBe(value);
}

test('UE-6: 共同編集で commit→Ctrl+Z→前値へ（補償 op を server が確定）・Ctrl+Y→再適用', async ({ browser }) => {
  const { context, page } = await openClient(browser, 'undo-collab');
  try {
    const rowId = (await rowIdAt(page, 12))!;
    const columnId = (await colIdAt(page, 1))!;
    const initial = await committedCell(page, rowId, columnId);

    await commitValue(page, 12, 1, 'v-new');
    await expect.poll(async () => (await snapshot(page)).pendingCount, { message: 'ACK 済み' }).toBe(0);
    await expect.poll(async () => undoDepth(page), { message: 'undo 記録' }).toBe(1);

    // Ctrl+Z → 補償 SetCells を submit → server 確定 → committed が初期値へ戻る。
    await selectCell(page, 12, 1);
    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => committedCell(page, rowId, columnId), { message: 'undo で前値へ（server 確定）' })
      .toBe(initial);
    await expect.poll(async () => (await snapshot(page)).pendingCount, { message: '補償 ACK 済み' }).toBe(0);
    await expect.poll(async () => redoDepth(page), { message: 'redo へ' }).toBe(1);

    // Ctrl+Y → 再適用。
    await page.keyboard.press('Control+y');
    await expect.poll(async () => committedCell(page, rowId, columnId), { message: 'redo で再適用' }).toBe('v-new');
  } finally {
    await context.close();
  }
});

test('UE-5: 2 クライアント OCC — 他者が対象セルを後続変更 → Ctrl+Z 全体拒否・undo-blocked 通知・文書は他者値（AC3）', async ({
  browser,
}) => {
  const a = await openClient(browser, 'undo-occ-A');
  const b = await openClient(browser, 'undo-occ-B');
  try {
    await collectRejectedCodes(a.page);
    const rowId = (await rowIdAt(a.page, 15))!;
    const columnId = (await colIdAt(a.page, 1))!;

    // A が (15,1)='a-val' を確定（ACK 済み＝undo 対象）。B にも伝播を確認。
    await commitValue(a.page, 15, 1, 'a-val');
    await expect.poll(async () => (await snapshot(a.page)).pendingCount, { message: 'A ACK' }).toBe(0);
    await expect.poll(async () => committedCell(b.page, rowId, columnId), { message: 'B が A を受信' }).toBe('a-val');

    // A: 対象セルを選択 → 切断。
    await selectCell(a.page, 15, 1);
    await simulateDrop(a.page);
    await expect.poll(() => connectionState(a.page), { message: 'A offline' }).toBe('offline');

    // B: 同一セルを後続変更（committed 前進＝A の undo 補償が stale になる）。
    await commitValue(b.page, 15, 1, 'b-val');

    // A（offline）が Ctrl+Z → 補償 SetCells を pending に積む（楽観適用）。
    await a.page.keyboard.press('Control+z');
    await expect.poll(async () => (await snapshot(a.page)).pendingCount, { message: 'A の undo が pending' }).toBe(1);

    // A 再接続 → catch-up で B の確定を取り込み、A の補償は stale-cell-revision で全体 reject。
    await simulateReconnect(a.page);
    await expect.poll(() => connectionState(a.page), { timeout: 30_000, message: 'A online' }).toBe('online');

    // undo-blocked 通知が発火し、文書は B の値のまま（強制 Undo なし・部分適用なし）で収束。
    await expect
      .poll(async () => rejectedCodes(a.page), { timeout: 15_000, message: 'undo-blocked 通知' })
      .toContain('undo-blocked');
    await expect
      .poll(
        async () =>
          (await committedCell(a.page, rowId, columnId)) === 'b-val' && (await snapshot(a.page)).pendingCount === 0,
        { timeout: 15_000, message: 'A は他者値のまま収束（undo は適用されない）' },
      )
      .toBe(true);
    // 収束（A/B の committed hash 一致）。
    expect((await snapshot(a.page)).committedHash).toBe((await snapshot(b.page)).committedHash);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test('UE-8: 他者変更がローカル committed へ反映済み → Ctrl+Z は実行前 OCC 拒否・undo-blocked・busy を残さない（Codex P1）', async ({
  browser,
}) => {
  const a = await openClient(browser, 'undo-sync-A');
  const b = await openClient(browser, 'undo-sync-B');
  try {
    await collectRejectedCodes(a.page);
    const rowId = (await rowIdAt(a.page, 20))!;
    const columnId = (await colIdAt(a.page, 1))!;

    // A が (20,1)='a-val' を確定（ACK 済み＝undo 対象）。
    await commitValue(a.page, 20, 1, 'a-val');
    await expect.poll(async () => (await snapshot(a.page)).pendingCount, { message: 'A ACK' }).toBe(0);
    await expect.poll(async () => committedCell(b.page, rowId, columnId), { message: 'B 受信' }).toBe('a-val');

    // B が同セルを変更 → A が受信（A の committed が b-val へ前進＝A の undo 補償が**事前に** stale）。
    await commitValue(b.page, 20, 1, 'b-val');
    await expect.poll(async () => committedCell(a.page, rowId, columnId), { message: 'A が B を受信' }).toBe('b-val');

    // A が Ctrl+Z → 実行前 OCC（validateOperation）で拒否（submit せず undo-blocked・同期 reject 経路に落とさない）。
    await a.page.keyboard.press('Control+z');
    await expect
      .poll(async () => rejectedCodes(a.page), { message: 'undo-blocked（pre-check）' })
      .toContain('undo-blocked');
    expect(await committedCell(a.page, rowId, columnId), 'undo は他者値を上書きしない').toBe('b-val');

    // busy を残さない: 別セルを commit して undo できる（in-flight が解除されている＝limbo permanently busy でない）。
    await commitValue(a.page, 21, 1, 'again');
    await expect.poll(async () => (await snapshot(a.page)).pendingCount, { message: 'ACK' }).toBe(0);
    const r21 = (await rowIdAt(a.page, 21))!;
    await selectCell(a.page, 21, 1);
    await a.page.keyboard.press('Control+z');
    await expect
      .poll(async () => committedCell(a.page, r21, columnId), { message: 'busy 未残留＝後続 undo 成立' })
      .toBe('');
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
