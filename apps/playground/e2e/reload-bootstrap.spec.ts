// DD-014-1 Phase 3 / AC8: 実ブラウザー再読込 → snapshot bootstrap で復元（全 replay 非依存）。
//
// 統合ページ（実 WS サーバー・50,000行シード）で「編集→確定→ブラウザー再読込→復元」を検証する。
// 再読込後の新しい ClientSession は fresh join（lastAppliedRevision=0）でサーバーから bootstrap（document@R）を
// 1 通受け取り、全 operationLog を replay せずに committed@R を確立する（P1-6/P1-7・§8 既知制約回収）。
//   - bootstrapRevision > 0                 … snapshot bootstrap で committed を確立した（全 replay していない）
//   - appliedServerOpCount == 0             … 再読込直後に適用したサーバー op = 0（tail 無し＝全 replay 非依存）
//   - committedCell(rowId,columnId)==value  … 編集済みの確定値が復元された
//
// ⚠️ 統合 E2E サーバーは非永続（in-memory）。本テストが検証するのは **クライアント側 bootstrap**（再読込復元）。
//    サーバー再起動をまたぐ durable 復元は server.persistence.test.ts（node・fsync＋snapshot＋tail）が担う。

import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import {
  appliedServerOpCount,
  bootstrapRevision,
  colIdAt,
  committedCell,
  openClient,
  plainTypeAndCommit,
  rowIdAt,
  selectCell,
  snapshot,
} from './integration-helpers';
import type { BrowserContext } from '@playwright/test';

const contexts: BrowserContext[] = [];

test.afterEach(async () => {
  for (const context of contexts.splice(0)) {
    await context.close();
  }
});

/** DD-014-1/ 直下へ証跡スクショを保存する絶対パス。 */
function evidencePath(fileName: string): string {
  return fileURLToPath(new URL(`../../../doc/DD/DD-014-1/${fileName}`, import.meta.url));
}

function uniq(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

test('AC8: 編集→確定→ブラウザー再読込→snapshot bootstrap で復元（大規模文書・全 replay 非依存）', async ({ browser }) => {
  const { context, page } = await openClient(browser, 'Reloader');
  contexts.push(context);

  // 対象セル（reload をまたいで安定する RowId/ColumnId で解決）。
  const rowId = await rowIdAt(page, 7);
  const columnId = await colIdAt(page, 3);
  expect(rowId, 'rowId(7)').toBeDefined();
  expect(columnId, 'columnId(3)').toBeDefined();
  const value = uniq('保存値');

  // 編集 → 確定（durable ACK 相当＝サーバー committed 反映まで待つ）。
  await selectCell(page, 7, 3);
  await plainTypeAndCommit(page, value);
  await expect
    .poll(async () => (await snapshot(page)).pendingCount, { timeout: 15_000, message: '編集 ACK 反映' })
    .toBe(0);
  await expect
    .poll(async () => committedCell(page, rowId!, columnId!), { timeout: 15_000, message: '確定値が committed に載る' })
    .toBe(value);

  await page.screenshot({ path: evidencePath('reload-01-before-edit-committed.png'), fullPage: false });

  // --- ブラウザー再読込（新しい ClientSession が fresh join → bootstrap で復元）---
  await page.reload();
  await expect(page.locator('textarea.int-cell-editor')).toBeAttached({ timeout: 30_000 });
  await expect
    .poll(async () => (await snapshot(page)).ready, { timeout: 30_000, message: '再読込後 ready' })
    .toBe(true);

  const after = await snapshot(page);
  expect(after.online, '再読込後 online').toBe(true);
  expect(after.rowCount, '50,000行が復元').toBeGreaterThanOrEqual(50_000);

  // ★ snapshot bootstrap で復元した（全 operationLog を replay していない）ことの機械的確証。
  expect(await bootstrapRevision(page), 'bootstrap で committed を確立').toBeGreaterThan(0);
  expect(await appliedServerOpCount(page), '再読込直後に適用したサーバー op = 0（tail 無し・全 replay 非依存）').toBe(0);

  // ★ 編集済みの確定値が bootstrap 経由で復元される。
  await expect
    .poll(async () => committedCell(page, rowId!, columnId!), { timeout: 15_000, message: '再読込後に確定値が復元' })
    .toBe(value);

  await page.screenshot({ path: evidencePath('reload-02-after-reload-restored.png'), fullPage: false });
});
