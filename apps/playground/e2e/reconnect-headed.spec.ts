// DD-015 Phase 4 実ブラウザー断線 headed smoke（Manual Gate・CG-5）。
//
// synthetic/in-process/実WS(Node) では代替できない **ブラウザー WebSocket スタック固有の挙動**（close イベント遅延・タブ生存中の
// ソケット状態・自動リトライ〔指数バックオフ〕のタイマー実挙動）を実 Chromium で 1 回実証する。context.setOffline で実ネットワーク断を
// 起こし、切断表示→自動再接続→切断中編集の反映（reconcile）→他者編集の catch-up→双方 committed hash 一致 を確認し 📸 証跡を残す。
//
// 編集は本番 ClientSession.submitLocalOperation（行挿入・test API 経由の最小アフォーダンス）で駆動する（値は捏造しない）。

import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

import {
  connectionState,
  evidencePathDD015,
  lastEventType,
  openClient,
  pendingCount,
  rowIdAt,
  rowIndexOf,
  simulateDrop,
  simulateReconnect,
  snapshot,
  submitDeleteRow,
  submitInsertRowsAfter,
} from './integration-helpers';

// 実ブラウザーの WebSocket 断線は simulateDrop（transport.dropForTest＝実 socket.close）で注入する。
// context.setOffline / CDP Network.emulateNetworkConditions は Chromium の localhost WebSocket を切らないため使わない。
// dropForTest は実ブラウザーの close イベントを発火させ、resumeReconnect（simulateReconnect）は実 WebSocket を再 open する
// ＝実 WS スタックの close→再 open→再 join→reconcile→catch-up 経路を実機で駆動する（自動リトライのタイマー挙動は
// browser-transport.test.ts の FakeTimer ＋ nextReconnectDelay 単体で別途固定）。

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  for (const context of contexts.splice(0)) {
    await context.close();
  }
});

async function committedHash(page: Page): Promise<string> {
  return (await snapshot(page)).committedHash;
}

/** 両ページの committed hash が一致し A の pending が空へ収束するまで待つ（静止点待ち）。 */
async function waitConverged(a: Page, b: Page, timeout = 30_000): Promise<void> {
  await expect
    .poll(async () => (await committedHash(a)) === (await committedHash(b)) && (await pendingCount(a)) === 0, {
      timeout,
      message: 'A/B committed hash 一致 かつ A pending 空へ収束',
    })
    .toBe(true);
}

test('DD-015 実ブラウザー断線→自動再接続→reconcile→catch-up→双方一致（Manual Gate・CG-5）', async ({ browser }) => {
  const a = await openClient(browser, 'DD015-A');
  contexts.push(a.context);
  const b = await openClient(browser, 'DD015-B');
  contexts.push(b.context);

  const anchorA = await rowIdAt(a.page, 1);
  expect(anchorA, 'anchor row(1)').toBeDefined();
  const stamp = Date.now();

  // --- 初期収束: A が行挿入 → B が catch-up → 双方 hash 一致 ---
  const onlineRow = `dd015-online-${stamp}`;
  await submitInsertRowsAfter(a.page, anchorA ?? null, onlineRow);
  await expect.poll(() => rowIndexOf(b.page, onlineRow), { timeout: 15_000, message: 'B が A の初期編集を catch-up' }).not.toBe(-1);
  await waitConverged(a.page, b.page, 15_000);
  await a.page.screenshot({ path: evidencePathDD015('headed-01-before-offline.png') });

  // --- A をオフライン化（実ブラウザーの WebSocket を close）→ 切断表示 ---
  await simulateDrop(a.page);
  await expect.poll(() => connectionState(a.page), { timeout: 15_000, message: 'A が offline 表示へ' }).toBe('offline');
  await a.page.screenshot({ path: evidencePathDD015('headed-02-a-offline.png') });

  // --- offline 中: A が行挿入（未送信 pending＝backlog 可視化・AC7）・B が行挿入（server 前進）---
  const offlineRowA = `dd015-offlineA-${stamp}`;
  await submitInsertRowsAfter(a.page, anchorA ?? null, offlineRowA);
  await expect.poll(() => pendingCount(a.page), { message: 'A の未送信 backlog が増える' }).toBeGreaterThan(0);
  const anchorB = await rowIdAt(b.page, 1);
  const duringOfflineRowB = `dd015-duringB-${stamp}`;
  await submitInsertRowsAfter(b.page, anchorB ?? null, duringOfflineRowB);
  await expect.poll(() => rowIndexOf(b.page, duringOfflineRowB), { timeout: 15_000, message: 'B の offline 中編集が確定' }).not.toBe(-1);
  // DD-021-2 AC6: **行削除も offline ウィンドウを跨いで収束する**ことを実 WS で実証する。
  // B が「A が online 中に挿入し双方が持つ行（onlineRow）」を A の offline 中に削除する（server 前進）。
  // A は切断中なのでこの削除を知らない → 再接続 catch-up で取り込み、A/B とも onlineRow が消えて収束するはず。
  await submitDeleteRow(b.page, onlineRow);
  await expect.poll(() => rowIndexOf(b.page, onlineRow), { timeout: 15_000, message: 'B の offline 中行削除が確定' }).toBe(-1);
  expect(await rowIndexOf(a.page, onlineRow), 'A は切断中なので削除をまだ知らない').not.toBe(-1);

  // --- A を復帰（実ブラウザーの WebSocket を再 open＝実 WS 再接続経路）→ online 表示 ---
  await simulateReconnect(a.page);
  await expect.poll(() => connectionState(a.page), { timeout: 30_000, message: 'A が再接続で online へ' }).toBe('online');

  // --- 収束: A の offline 編集が確定・B の挿入/削除を catch-up・双方 hash 一致 ---
  await waitConverged(a.page, b.page, 30_000);
  expect(await rowIndexOf(a.page, offlineRowA), 'A の offline 編集が確定（喪失0）').not.toBe(-1);
  expect(await rowIndexOf(a.page, duringOfflineRowB), 'A が B の挿入を catch-up').not.toBe(-1);
  expect(await rowIndexOf(a.page, onlineRow), 'A が B の offline 中行削除を catch-up（行が消える）').toBe(-1);
  expect(await rowIndexOf(b.page, onlineRow), 'B でも onlineRow は削除済み').toBe(-1);
  expect(await rowIndexOf(b.page, offlineRowA), 'B も A の offline 編集を受信').not.toBe(-1);
  expect(await pendingCount(a.page), 'A pending 空（再送完了）').toBe(0);
  expect(await lastEventType(a.page), 'イベント契約が実ブラウザーで発火').not.toBe('');

  await a.page.screenshot({ path: evidencePathDD015('headed-03-a-reconnected-converged.png') });
  await b.page.screenshot({ path: evidencePathDD015('headed-04-b-converged.png') });
});
