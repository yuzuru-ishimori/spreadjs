// DD-002 Phase 5: synthetic composition スモーク（確定 Enter 抑止・順序A/B）。
//
// ⚠️ これは SYNTHETIC（手で dispatch した DOM イベント列）であり、実機の OS IME
// （Microsoft IME / Google 日本語入力）の代替ではない。Playwright/Chromium は文字を
// insertText で挿入するため本物の composition/isComposing を再現できない（計画書 §11.8/§20.5）。
// 実 IME の確定 Enter 実発火順・候補ウィンドウ・ブラウザー差は Phase 6 実機受入試験で判定する
// （doc/DD/DD-002/manual-ime-test-guide.md）。本 spec の目的は「DOM 配線（resident-textarea →
// 状態機械 → エフェクト）が実ブラウザーで成立し、確定 Enter が移動を起こさない」ことの回帰確認。
//
// イベント列は doc/DD/DD-002/traces/synthetic-reference/ の orderA/orderB に一致させている。

import { test, expect, type Page } from '@playwright/test';
import { EDITING_BG, background, clickCell, editor, expectActiveCell } from './helpers';

/**
 * 常駐 textarea へ synthetic な変換シーケンスを dispatch する。
 * - order 'A': 確定 Enter が compositionend より前（変換中・isComposing:true）= scenarios.md S-D3
 * - order 'B': 確定 Enter が compositionend の後（isComposing:false）= scenarios.md S-D5
 * どちらも確定 Enter は「移動しない」ことが期待挙動（状態機械が抑止）。
 */
async function dispatchComposition(page: Page, order: 'A' | 'B'): Promise<void> {
  await page.evaluate((ord) => {
    const ta = document.querySelector('textarea.cell-editor');
    if (!(ta instanceof HTMLTextAreaElement)) {
      throw new Error('resident textarea (.cell-editor) が見つかりません');
    }
    const fire = (event: Event): void => {
      ta.dispatchEvent(event);
    };
    // 変換中はブラウザーが textarea.value を更新する（状態機械は I-3 で value を触らない）。
    const compositionUpdate = (data: string): void => {
      ta.value = data;
      fire(new CompositionEvent('compositionupdate', { data, bubbles: true }));
    };

    fire(new CompositionEvent('compositionstart', { bubbles: true }));
    compositionUpdate('にほ');
    compositionUpdate('日本');

    if (ord === 'A') {
      // 確定 Enter が変換中（isComposing:true）→ 状態機械は SuppressKey で抑止。
      fire(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true }));
      fire(new CompositionEvent('compositionend', { data: '日本', bubbles: true }));
      ta.value = '日本';
      fire(new InputEvent('input', { inputType: 'insertCompositionText', data: '日本', isComposing: false, bubbles: true }));
      fire(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', isComposing: false, bubbles: true }));
    } else {
      // 確定 Enter が compositionend 後（isComposing:false）→ suppressCommitUntilKeyup で 1 回抑止。
      fire(new CompositionEvent('compositionend', { data: '日本', bubbles: true }));
      ta.value = '日本';
      fire(new InputEvent('input', { inputType: 'insertCompositionText', data: '日本', isComposing: false, bubbles: true }));
      fire(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: false, bubbles: true }));
      fire(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', isComposing: false, bubbles: true }));
    }
  }, order);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(editor(page)).toBeFocused();
});

test('順序A: 確定 Enter が変換中に来ても移動せず、次の Enter で確定・下移動', async ({ page }) => {
  const ta = editor(page);
  await clickCell(page, 3, 2);
  await expect(ta).toHaveValue('');

  await dispatchComposition(page, 'A');

  // 確定 Enter は抑止され移動しない（受け入れ #2）＝アクティブセルは (3,2) のまま・まだ編集中。
  await expectActiveCell(ta, 3, 2);
  await expect(ta).toHaveValue('日本');
  expect(await background(ta)).toBe(EDITING_BG);

  // 次の独立した Enter で確定・下移動。
  await page.keyboard.press('Enter');
  await expectActiveCell(ta, 4, 2);
  await expect(ta).toHaveValue('');

  // 確定値の検証: (3,2) を開き直すと "日本"。
  await clickCell(page, 3, 2);
  await page.keyboard.press('F2');
  await expect(ta).toHaveValue('日本');
});

test('順序B: 確定 Enter が compositionend 後に来ても移動せず、次の Enter で確定・下移動', async ({ page }) => {
  const ta = editor(page);
  await clickCell(page, 3, 2);
  await expect(ta).toHaveValue('');

  await dispatchComposition(page, 'B');

  // suppressCommitUntilKeyup により確定 Enter は 1 回抑止＝移動しない・まだ編集中。
  await expectActiveCell(ta, 3, 2);
  await expect(ta).toHaveValue('日本');
  expect(await background(ta)).toBe(EDITING_BG);

  // 次の独立した Enter で確定・下移動。
  await page.keyboard.press('Enter');
  await expectActiveCell(ta, 4, 2);
  await expect(ta).toHaveValue('');

  await clickCell(page, 3, 2);
  await page.keyboard.press('F2');
  await expect(ta).toHaveValue('日本');
});
