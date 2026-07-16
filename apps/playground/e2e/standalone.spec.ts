// DD-024 Phase 3 E2E: 単独グリッドモード（共同編集サーバー不要）。
//
// #1 表示/初期注入・setData 再注入（AC1/AC2）／#2 IME 入力→cell-commit（AC3）／#3 保存→F5 復元（AC4）。
// 実 WS サーバーを一切使わず standalone.html だけで成立する（server 系イベントが 1 件も出ないことを確認）。

import { expect, test } from '@playwright/test';

import {
  activeCell,
  colIdAt,
  composeCommitAtCell,
  connectionState,
  displayCell,
  events,
  evidencePath,
  openStandalone,
  rowCount,
  rowIdAt,
  selectCell,
  waitReady,
} from './standalone-helpers';

test('#1 単独 mount で描画・初期注入が反映され、server 系イベントが出ない＋setData 再注入（AC1/AC2）', async ({
  browser,
}) => {
  const { context, page } = await openStandalone(browser);
  try {
    // AC1: 描画され connectionState は 'standalone'。
    expect(await connectionState(page)).toBe('standalone');
    expect(await rowCount(page)).toBe(20);

    // AC2: 初期注入（シード）値が表示される。
    expect(await displayCell(page, 'r3', 'col-a')).toBe('行3');

    // AC1: connection/pending/rejected/divergence/error が 1 件も無い。
    const evs = await events(page);
    const serverish = evs.filter((e) =>
      ['connection', 'pending', 'rejected', 'divergence', 'error'].includes(e.type),
    );
    expect(serverish, `server 系イベントは発火しない（実際: ${JSON.stringify(serverish)}）`).toHaveLength(0);

    await page.screenshot({ path: evidencePath('e2e-standalone-1-initial.png') });

    // AC2 決定③: setData 再注入 → 行数・値が新データへ更新される。
    await page.evaluate(() => {
      window.__standalone?.reinject({
        rows: [
          { rowId: 'x1', cells: { 'col-a': 'AAA', 'col-b': 'BBB' } },
          { rowId: 'x2', cells: { 'col-a': 'CCC' } },
        ],
      });
    });
    await expect.poll(async () => rowCount(page), { message: '再注入で行数が 2 になる' }).toBe(2);
    expect(await displayCell(page, 'x1', 'col-a')).toBe('AAA');
    expect(await displayCell(page, 'x1', 'col-b')).toBe('BBB');
    expect(await displayCell(page, 'x2', 'col-a')).toBe('CCC');
    await page.screenshot({ path: evidencePath('e2e-standalone-1-reinject.png') });
  } finally {
    await context.close();
  }
});

test('#1b mount 直後（boot 前）の同期 setData が捨てられず反映される（Codex[P1]）', async ({ browser }) => {
  const { context, page } = await openStandalone(browser);
  try {
    // destroy → mount と同一 evaluate 内で（＝standalone backend 構築の microtask 前に）setData を呼ぶ。
    await page.evaluate(() => {
      window.__standalone?.destroy();
      window.__standalone?.clearSaved();
      window.__standalone?.mount();
      // mount 直後の同期呼び出し（react-query キャッシュ即時注入の典型）。
      window.__standalone?.reinject({
        rows: [
          { rowId: 'boot1', cells: { 'col-a': 'ZZZ' } },
          { rowId: 'boot2', cells: { 'col-a': 'YYY' } },
        ],
      });
    });
    await waitReady(page);
    // 保留された setData が構築後に適用され、mount の initialData ではなく再注入データが見える。
    await expect.poll(async () => rowCount(page), { message: '保留 setData が適用され行数 2' }).toBe(2);
    expect(await displayCell(page, 'boot1', 'col-a')).toBe('ZZZ');
    expect(await displayCell(page, 'boot2', 'col-a')).toBe('YYY');
  } finally {
    await context.close();
  }
});

test('#1c 行を縮める再注入後も入力が正しいセルへ確定する（Codex[P2] active cell クランプ）', async ({
  browser,
}) => {
  const { context, page } = await openStandalone(browser);
  try {
    await page.evaluate(() => {
      window.__standalone?.destroy();
      window.__standalone?.clearSaved();
      window.__standalone?.mount();
    });
    await waitReady(page);
    // 末尾付近（行 15）を選択してから 2 行へ縮める再注入 → active cell が範囲外に取り残される状況を作る。
    await selectCell(page, 15, 1);
    await page.evaluate(() => {
      window.__standalone?.reinject({
        rows: [
          { rowId: 'k1', cells: { 'col-a': '一' } },
          { rowId: 'k2', cells: { 'col-a': '二' } },
        ],
      });
    });
    await expect.poll(async () => rowCount(page), { message: '再注入で 2 行' }).toBe(2);
    // active cell が新範囲（0..1 行）へクランプされている（旧 index 15 に取り残されない）。
    const active = await activeCell(page);
    expect(active.row, `active row が新範囲内（実際: ${active.row}）`).toBeLessThanOrEqual(1);
    // 縮小後の実在セルへ入力・確定 → cell-commit が新文書の実在行へ届く（無言消失しない）。
    await composeCommitAtCell(page, 1, 1, '確定値');
    await expect
      .poll(async () => (await events(page)).filter((e) => e.type === 'cell-commit').length)
      .toBeGreaterThanOrEqual(1);
    const commit = (await events(page)).find((e) => e.type === 'cell-commit');
    expect(['k1', 'k2']).toContain(commit?.changes?.[0]?.rowId);
    expect(commit?.changes?.[0]?.value).toBe('確定値');
  } finally {
    await context.close();
  }
});

test('#2 IME 入力・確定で cell-commit が確定値 batch で発火する（AC3）', async ({ browser }) => {
  const { context, page } = await openStandalone(browser);
  try {
    // 前ケースの localStorage 保存が残らないよう掃除して再 mount する（独立性）。
    await page.evaluate(() => {
      window.__standalone?.destroy();
      window.__standalone?.clearSaved();
      window.__standalone?.mount();
    });
    await waitReady(page);

    const row = 3;
    const col = 2; // col-c
    const rowId = (await rowIdAt(page, row))!;
    const columnId = (await colIdAt(page, col))!;
    expect(columnId).toBe('col-c');

    await composeCommitAtCell(page, row, col, 'テスト値');

    // cell-commit が発火し、確定値 batch（rowId/columnId/value）を含む。
    await expect
      .poll(async () => (await events(page)).filter((e) => e.type === 'cell-commit').length, {
        message: 'cell-commit が発火する',
      })
      .toBeGreaterThanOrEqual(1);
    const commit = (await events(page)).find((e) => e.type === 'cell-commit');
    expect(commit?.changes?.[0]).toMatchObject({ rowId, columnId, value: 'テスト値' });

    // グリッド表示も確定値へ更新される。
    expect(await displayCell(page, rowId, columnId)).toBe('テスト値');

    // server 系イベントは出ない。
    expect((await events(page)).filter((e) => e.type === 'connection' || e.type === 'error')).toHaveLength(0);
    await page.screenshot({ path: evidencePath('e2e-standalone-2-commit.png') });
  } finally {
    await context.close();
  }
});

test('#3 cell-commit を保存し F5 再mount（initialData 再注入）で値が復元される（AC4）', async ({ browser }) => {
  const { context, page } = await openStandalone(browser);
  try {
    await page.evaluate(() => {
      window.__standalone?.destroy();
      window.__standalone?.clearSaved();
      window.__standalone?.mount();
    });
    await waitReady(page);

    const row = 5;
    const col = 1; // col-b
    const rowId = (await rowIdAt(page, row))!;
    const columnId = (await colIdAt(page, col))!;

    await composeCommitAtCell(page, row, col, '復元テスト');
    await expect
      .poll(async () => (await events(page)).filter((e) => e.type === 'cell-commit').length)
      .toBeGreaterThanOrEqual(1);
    expect(await displayCell(page, rowId, columnId)).toBe('復元テスト');

    // F5 相当: ページ reload → consumer が localStorage 保存値を initialData として再注入する。
    await page.reload();
    await expect(page.locator('textarea.int-cell-editor')).toBeAttached({ timeout: 30_000 });
    await waitReady(page);

    // 保存値が復元されている。
    expect(await displayCell(page, rowId, columnId)).toBe('復元テスト');
    await page.screenshot({ path: evidencePath('e2e-standalone-3-restore.png') });

    // 後始末（保存モックを消す）。
    await page.evaluate(() => window.__standalone?.clearSaved());
  } finally {
    await context.close();
  }
});
