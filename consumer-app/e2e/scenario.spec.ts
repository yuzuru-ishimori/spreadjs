// DD-016-2 Phase 3 — 独立 consumer の実挙動シナリオ（AC1）。
//
// serve（@nanairo-sheet/server-hono）→ 2 client の grid mount → 日本語入力（synthetic composition）→
// 共同編集反映 → connection state / error notification 受信 → destroy を、pack 済み tarball 経由の独立 consumer で実挙動確認する。
//
// 検証は consumer 公開 API（GridInstance イベント/connectionState）と DOM/canvas の外部観測のみ（test-support 不使用）。
// ⚠️ synthetic composition は実 IME 成立ではない（実 IME・確定 Enter 順 A/B は Phase 4 実機 Manual Gate）。
// クライアント間の値一致（byte 単位）は Facade 経路の playground E2E AC1 で担保済み。本 spec は
// 「独立 consumer 経由で共同編集の書込/反映経路が成立する」ことを base canvas の変化と公開イベントで確認する。

import { expect, test } from '@playwright/test';

import {
  baseCanvasSignature,
  composeCommitAtBodyCell,
  connState,
  evidencePath,
  hasErrorOrDivergence,
  openClient,
  pendingCount,
  waitOnline,
} from './helpers';

test('AC1: serve→2client mount→日本語入力(synthetic)→共同編集反映→events→destroy', async ({ browser }) => {
  const alice = await openClient(browser, 'Alice');
  const bob = await openClient(browser, 'Bob');

  // 2 client が同一 serve へ接続（両者 online＝公開イベント connection online を受信）。
  await waitOnline(alice);
  await waitOnline(bob);
  expect(await hasErrorOrDivergence(alice), 'A に error/divergence なし').toBe(false);
  expect(await hasErrorOrDivergence(bob), 'B に error/divergence なし').toBe(false);

  // B の反映前 base canvas シグネチャ。
  const bobBefore = await baseCanvasSignature(bob);
  expect(bobBefore.length, 'B の base canvas は描画済み').toBeGreaterThan(0);

  // A: 日本語入力（synthetic composition）→ 確定 Commit。
  const value = `にほんご${Math.random().toString(36).slice(2, 6)}`;
  await composeCommitAtBodyCell(alice, value);

  // A: pending が 0 に戻る＝server が受理（共同編集の書込経路が独立 consumer で成立）。
  await expect
    .poll(async () => pendingCount(alice), { message: 'A の編集が server に受理される（pending→0）' })
    .toBe(0);
  expect(await hasErrorOrDivergence(alice), 'A の確定で error/divergence なし').toBe(false);

  // B: A の編集が反映され base canvas が変化（同一 doc・同一初期表示のため編集セルは B の可視範囲）。
  await expect
    .poll(async () => (await baseCanvasSignature(bob)) !== bobBefore, {
      message: 'B へ共同編集が反映（base canvas 変化）',
      timeout: 20_000,
    })
    .toBe(true);
  expect(await connState(bob), 'B は online のまま').toBe('online');
  expect(await hasErrorOrDivergence(bob), 'B に error/divergence なし').toBe(false);

  // 証跡（Evidence full）: A の入力後の B（共同編集反映）と A のスクリーンショット。
  await bob.screenshot({ path: evidencePath('consumer-app-scenario-bob-reflected.png') });
  await alice.screenshot({ path: evidencePath('consumer-app-scenario-alice-input.png') });

  // destroy（両者）。ここで例外が出ないこと自体も lifecycle 契約の一部。
  await alice.evaluate(() => window.__consumer?.destroy());
  await bob.evaluate(() => window.__consumer?.destroy());
  expect(await connState(alice), 'A destroy 後は none').toBe('none');
  expect(await connState(bob), 'B destroy 後は none').toBe('none');
});
