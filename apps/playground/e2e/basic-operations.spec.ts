// DD-002 Phase 5: 基本操作 E2E（受け入れ基準 #3 の自動分）。
//
// 実ブラウザー（Chromium）で PoC-A の DOM 配線を検証する:
//   クリック選択 → 矢印/Enter/Shift+Enter/Tab/Shift+Tab 移動 → 直接入力で既存値置換 →
//   F2 で既存値編集 → Escape 取消 → 移動直後の再入力。
//
// セル値は Canvas に描かれ DOM から読めないため、確定結果は「移動後にそのセルを F2 で開き直し
// textarea.value を読む」ことで検証する。アクティブセルは常駐 textarea のインライン位置で確認する。
// 実 IME（日本語変換）は本 spec の対象外（Phase 6 実機試験。synthetic-composition.spec.ts も参照）。

import { test, expect } from '@playwright/test';
import { EDITING_BG, NAVIGATION_BG, background, clickCell, editor, expectActiveCell } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // 常駐 textarea が生成され初期フォーカスされるまで待つ（アプリ起動完了の目印）。
  await expect(editor(page)).toBeFocused();
});

test('クリックでセルを選択でき、常駐 textarea が追従する', async ({ page }) => {
  const ta = editor(page);
  // 初期アクティブセルは (0,0)。
  await expectActiveCell(ta, 0, 0);
  await clickCell(page, 2, 3);
  await expectActiveCell(ta, 2, 3);
  await clickCell(page, 5, 1);
  await expectActiveCell(ta, 5, 1);
});

test('矢印キーでアクティブセルが移動する（端はクランプ）', async ({ page }) => {
  const ta = editor(page);
  await clickCell(page, 3, 3);
  await page.keyboard.press('ArrowDown');
  await expectActiveCell(ta, 4, 3);
  await page.keyboard.press('ArrowRight');
  await expectActiveCell(ta, 4, 4);
  await page.keyboard.press('ArrowUp');
  await expectActiveCell(ta, 3, 4);
  await page.keyboard.press('ArrowLeft');
  await expectActiveCell(ta, 3, 3);

  // 左上端でのクランプ（範囲外へ出ない）。
  await clickCell(page, 0, 0);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowLeft');
  await expectActiveCell(ta, 0, 0);
});

test('Enter/Shift+Enter/Tab/Shift+Tab で移動する（Navigation・改行/フォーカス移動は起きない）', async ({ page }) => {
  const ta = editor(page);
  await clickCell(page, 4, 4);
  await page.keyboard.press('Enter'); // 下
  await expectActiveCell(ta, 5, 4);
  await page.keyboard.press('Shift+Enter'); // 上
  await expectActiveCell(ta, 4, 4);
  await page.keyboard.press('Tab'); // 右
  await expectActiveCell(ta, 4, 5);
  await page.keyboard.press('Shift+Tab'); // 左
  await expectActiveCell(ta, 4, 4);

  // Navigation の Enter は改行を挿入しない（preventDefault 済み）＝ textarea は空のまま。
  await expect(ta).toHaveValue('');
  // Tab はフォーカスを別要素へ移さない（入力受け口は textarea 一本・§11.9 I-5）。
  await expect(ta).toBeFocused();
});

test('直接入力は既存値を置換して確定する（replace モード）', async ({ page }) => {
  const ta = editor(page);
  // (1,0) はサンプル値 "田中 太郎"。
  await clickCell(page, 1, 0);
  await expect(ta).toHaveValue(''); // Navigation では textarea は空・下地の値は Canvas 側
  await page.keyboard.type('z');
  await expect(ta).toHaveValue('z'); // replace: 既存値を捨てて打鍵文字のみ
  expect(await background(ta)).toBe(EDITING_BG);
  await page.keyboard.press('Enter'); // 確定 + 下移動
  await expectActiveCell(ta, 2, 0);
  await expect(ta).toHaveValue('');

  // (1,0) を開き直すと確定値は "z"（"田中 太郎z" ではない）。
  await clickCell(page, 1, 0);
  await page.keyboard.press('F2');
  await expect(ta).toHaveValue('z');
});

test('F2 で既存値を編集開始できる（キャレット末尾・白背景）', async ({ page }) => {
  const ta = editor(page);
  // (2,0) はサンプル値 "鈴木 花子"。
  await clickCell(page, 2, 0);
  await page.keyboard.press('F2');
  await expect(ta).toHaveValue('鈴木 花子');
  expect(await background(ta)).toBe(EDITING_BG);
});

test('Escape は編集を取り消し、元の値を保持する', async ({ page }) => {
  const ta = editor(page);
  await clickCell(page, 2, 0); // "鈴木 花子"
  await page.keyboard.press('F2');
  await expect(ta).toHaveValue('鈴木 花子');
  await page.keyboard.type('X'); // 末尾に追記
  await expect(ta).toHaveValue('鈴木 花子X');

  await page.keyboard.press('Escape');
  await expect(ta).toHaveValue(''); // Navigation へ戻る
  expect(await background(ta)).toBe(NAVIGATION_BG);
  await expectActiveCell(ta, 2, 0); // 取消では移動しない

  // 開き直すと元値のまま（追記は commit されていない）。
  await page.keyboard.press('F2');
  await expect(ta).toHaveValue('鈴木 花子');
});

test('移動直後に打鍵すると移動先セルで編集が始まる（受け入れ #3 自動分）', async ({ page }) => {
  const ta = editor(page);
  await clickCell(page, 6, 2);
  await page.keyboard.press('ArrowDown'); // (7,2) へ
  await expectActiveCell(ta, 7, 2);

  // 移動直後の再入力（フォーカスは textarea に残っているので即編集開始）。
  await page.keyboard.type('q');
  await expect(ta).toBeFocused();
  await expect(ta).toHaveValue('q');
  expect(await background(ta)).toBe(EDITING_BG);

  await page.keyboard.press('Enter'); // (7,2) に確定
  await clickCell(page, 7, 2);
  await page.keyboard.press('F2');
  await expect(ta).toHaveValue('q');
});
