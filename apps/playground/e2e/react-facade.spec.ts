// React Facade（DD-025）E2E #1〜#3（実ブラウザー・公開契約のみ）。
//
// 対象: react-standalone.html（<NanairoSheetView mode="standalone"> を StrictMode 下で mount）。
// GridInstance は Facade が隠蔽するため、初期注入/再注入の landed は onCellCommit.previousValue で間接検証する。
// #4（mount/unmount 反復リーク）は react-facade-lifecycle.spec.ts。

import { expect, test } from '@playwright/test';

import {
  commitCount,
  composeCommitR0ColA,
  connectionState,
  eventTypes,
  evidencePath,
  lastCommit,
  openReactStandalone,
  reactRootCounts,
  waitReactReady,
} from './react-facade-helpers';

test('#1 AC1/AC4: 初期注入の表示 → ref.setData 再注入（previousValue の round-trip で検証）', async ({
  browser,
}) => {
  const { context, page } = await openReactStandalone(browser);
  try {
    // StrictMode 下でも grid が 1 セット描画される（canvas 2 / textarea 1）。
    const counts = await reactRootCounts(page);
    expect(counts.canvas, 'base+overlay canvas').toBe(2);
    expect(counts.textarea, '常駐 textarea').toBe(1);
    expect(counts.scroller, 'scroller は 1 つ（StrictMode で重複しない）').toBe(1);

    // standalone は接続系が発火しない。connectionState は 'standalone'。
    expect(await connectionState(page)).toBe('standalone');
    expect(await eventTypes(page)).not.toContain('error');
    expect(await eventTypes(page)).not.toContain('connection');

    // r0/col-a の初期表示 = '行0'。確定すると previousValue に旧表示が入る＝初期注入が表示に landed した証跡。
    await composeCommitR0ColA(page, 'あ一');
    await expect.poll(async () => commitCount(page)).toBe(1);
    const first = await lastCommit(page);
    expect(first?.[0]).toMatchObject({
      rowId: 'r0',
      columnId: 'col-a',
      value: 'あ一',
      previousValue: '行0',
    });

    // ref.setData で丸ごと再注入 → 表示が置き換わる（landed を previousValue で確認）。
    await page.evaluate(() =>
      window.__reactStandalone?.reinject({
        rows: [
          { rowId: 'r0', cells: { 'col-a': '再注入Z' } },
          { rowId: 'r1', cells: { 'col-a': '再注入1' } },
          { rowId: 'r2', cells: { 'col-a': '再注入2' } },
        ],
      }),
    );
    await composeCommitR0ColA(page, 'い二');
    await expect.poll(async () => commitCount(page)).toBe(2);
    const second = await lastCommit(page);
    expect(second?.[0]).toMatchObject({
      rowId: 'r0',
      columnId: 'col-a',
      value: 'い二',
      previousValue: '再注入Z', // 再注入した値が表示に反映されていた
    });

    await page.screenshot({ path: evidencePath('e2e-react-1-inject.png') });
  } finally {
    await context.close();
  }
});

test('#2 AC2: synthetic IME 入力 → onCellCommit（1 確定 = 1 コールバック）', async ({ browser }) => {
  const { context, page } = await openReactStandalone(browser);
  try {
    expect(await commitCount(page)).toBe(0);

    await composeCommitR0ColA(page, 'かな漢字');

    await expect.poll(async () => commitCount(page)).toBe(1);
    const changes = await lastCommit(page);
    expect(changes).toHaveLength(1);
    expect(changes?.[0]).toMatchObject({ rowId: 'r0', columnId: 'col-a', value: 'かな漢字' });

    // 確定は cell-commit のみ。接続系は発火しない（standalone）。
    const types = await eventTypes(page);
    expect(types).toContain('cell-commit');
    expect(types).not.toContain('connection');
    expect(types).not.toContain('pending');

    await page.screenshot({ path: evidencePath('e2e-react-2-commit.png') });
  } finally {
    await context.close();
  }
});

test('#3 AC5: StrictMode 二重 mount 正常（購読重複なし・確定は 1 回）', async ({ browser }) => {
  const { context, page } = await openReactStandalone(browser);
  try {
    // 二重 mount/cleanup を経ても DOM は 1 セット（canvas 2 / textarea 1 / scroller 1）。
    const counts = await reactRootCounts(page);
    expect(counts.canvas).toBe(2);
    expect(counts.textarea).toBe(1);
    expect(counts.scroller).toBe(1);

    // 1 回の確定 → onCellCommit は 1 回だけ（options.onEvent の購読が重複していない）。
    await composeCommitR0ColA(page, 'テスト');
    await expect.poll(async () => commitCount(page)).toBe(1);

    // 追加でもう 1 回確定 → 2 回（毎回 1 増＝重複購読による多重発火がない）。
    await composeCommitR0ColA(page, 'ニ回目');
    await expect.poll(async () => commitCount(page)).toBe(2);

    // console error が出ていないこと（StrictMode の警告含む重大エラーなし）。
    await waitReactReady(page);
  } finally {
    await context.close();
  }
});
