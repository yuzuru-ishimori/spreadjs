// DD-002 Phase 5: 実行時バグ回帰（DA #10）。
//
// ユニット（node）は DOM 配線順・ブラウザー既定挙動を検証できず、Phase 3-4 の dev 目視で
// 見つかった 2 件の実行時バグ（緑テストをすり抜けた）を実ブラウザーで固定する:
//   (a) ロード時の TDZ 初期化バグ（createResidentEditor 構築中の初期 focus が代入前の
//       const editor を参照 → Reference|Cannot access 'editor' before initialization）。
//       → ページロードでコンソールエラー / 未捕捉例外が 0 件（favicon 404 は許容除外）。
//   (b) クリック時フォーカス喪失バグ（canvas mousedown 既定で focus が body へ落ち、
//       「クリック後に入力」§11.4 が壊れる）。
//       → セルクリック → printable 打鍵で編集が開始する（textarea が focus・値が入る）。

import { test, expect } from '@playwright/test';
import { EDITING_BG, background, cellCenter, editor } from './helpers';

/**
 * Vite dev サーバーは favicon を配信しないため、ブラウザーが自動リクエストする
 * /favicon.ico は 404 になる（アプリのバグではない）。この既知の 1 ケースだけを回帰
 * ゲートから除外する。「favicon への言及」かつ「リソース読込失敗(404)」の両方を満たす
 * ものに限定するので、favicon を含む本物の console.error や 404 以外の取得失敗は
 * 除外されず、ゲートに残る（Codex 指摘: substring 一致だけの除外は広すぎる）。
 */
function isFaviconNotFound(text: string, url: string): boolean {
  const mentionsFavicon = /favicon\.ico/i.test(url) || /favicon\.ico/i.test(text);
  const isResourceLoad404 = /failed to load resource/i.test(text) && /\b404\b/.test(text);
  return mentionsFavicon && isResourceLoad404;
}

test('(a) ロード時にコンソールエラー・未捕捉例外が出ない（TDZ 初期化バグ回帰）', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  // リスナーは goto より前に張る（初期化時の同期エラーを取りこぼさない）。
  page.on('console', (msg) => {
    if (msg.type() !== 'error') {
      return;
    }
    const url = msg.location().url;
    const text = msg.text();
    if (isFaviconNotFound(text, url)) {
      return;
    }
    consoleErrors.push(`${text} @ ${url}`);
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await page.goto('/');
  // アプリが完全起動した目印（常駐 textarea 生成 + 初期 focus）。TDZ バグ時はここへ到達しない。
  await expect(editor(page)).toBeVisible();
  await expect(editor(page)).toBeFocused();
  // 遅延して届く未捕捉 rejection / エラーを拾うため少し待つ。
  await page.waitForTimeout(300);

  expect(pageErrors, `未捕捉例外: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(consoleErrors, `コンソールエラー: ${consoleErrors.join(' | ')}`).toEqual([]);
});

test('(b) セルをクリックして打鍵すると編集が始まる（クリック時フォーカス喪失バグ回帰）', async ({ page }) => {
  await page.goto('/');
  const ta = editor(page);
  await expect(ta).toBeFocused();

  // canvas は非フォーカス要素。mousedown 既定を止めていないと click で focus が body へ落ちる。
  await page.locator('#grid').click({ position: cellCenter(2, 1) });
  await expect(ta).toBeFocused();

  // printable キーで置換編集が開始する（activeElement=textarea へ値が入る）。
  await page.keyboard.type('a');
  await expect(ta).toBeFocused();
  await expect(ta).toHaveValue('a');
  expect(await background(ta)).toBe(EDITING_BG); // 白背景 = EditingReplace（Navigation ではない）
});
