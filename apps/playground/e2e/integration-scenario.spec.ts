// DD-005 Phase 4: 統合シナリオ E2E（IME × Canvas × 共同編集）。
//
// 構成:
//   - 実 WS サーバー（apps/collaboration-server の `dev:integration`・50,000行×200列シード・E2E は非空 3,000 に縮小）を
//     Playwright webServer で Vite と一緒に起動する（playwright.config.ts）。
//   - 2 つのブラウザーコンテキスト（Alice / Bob）＝別ユーザー。各コンテキストが同一 WS ドキュメントへ join し、
//     ClientSession（唯一の正本）→ DocumentView → Canvas / IME の本番配線で相互反映する。
//   - IME は **synthetic composition**（compositionstart/update/end を dispatch）。実 IME は Playwright で通せないため、
//     ⚠️ これは「状態遷移・追従・#9 レイアウト」の実ブラウザー回帰確認であって **実 IME の成立ではない**（§11.8/§20.5）。
//     実 IME の候補ウィンドウ・確定 Enter 実発火順 A/B・ブラウザー差は **Phase 5 実機ゲート**で判定する。
//
// カバレッジ（統合シナリオ 10 項目・受け入れ基準 AC1〜4）:
//   AC1 通常入力と同期        … シナリオ 1・2・5・8 の非競合版（A 入力→確定→B 反映→hash 一致）
//   AC2 同一セル競合（中核）   … シナリオ 1〜8（A 変換中→B 確定→A の Canvas に B 値・draft/selection 不変・#9 →
//                                A 確定→beforeRevision 不一致 reject→Conflict Queue→収束）
//   AC3 Canvas 統合            … シナリオ 9（変換中に縦横スクロール→同一 RowId/ColumnId へ追従・値/selection 不変）
//   AC4 構造変更              … 行挿入→編集継続（RowId 安定）／行削除→draft を退避（無効 RowId へ Commit しない）
//   Presence                 … シナリオ 10（activeCell・selectionRanges・editingCell が他クライアントへ届く）

import { expect, test, type Page } from '@playwright/test';

import {
  colIdAt,
  committedCell,
  composeContinue,
  composeFinalizeAndCommit,
  composeOpen,
  editorProbe,
  evidencePath,
  highlightCell,
  highlightSelector,
  openClient,
  plainTypeAndCommit,
  rowIdAt,
  rowIndexOf,
  scrollTo,
  selectCell,
  snapshot,
  submitDeleteRow,
  submitInsertRowsAfter,
} from './integration-helpers';
import type { BrowserContext } from '@playwright/test';

// クロスラン/クロステストで共有 WS ドキュメントの累積状態に依存しないよう、値は毎回ユニークにする。
function uniq(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

const contexts: BrowserContext[] = [];
async function client(browser: Parameters<typeof openClient>[0], name: string): Promise<Page> {
  const { context, page } = await openClient(browser, name);
  contexts.push(context);
  return page;
}

test.afterEach(async () => {
  for (const context of contexts.splice(0)) {
    await context.close();
  }
});

test('AC1: 通常入力の同期（A 入力・確定 → B 反映 → A/B の committed hash 一致）', async ({ browser }) => {
  const alice = await client(browser, 'Alice');
  const bob = await client(browser, 'Bob');

  // 対象セル（両者で同一 RowId/ColumnId に解決される）。
  const rowId = await rowIdAt(alice, 5);
  const columnId = await colIdAt(alice, 2);
  expect(rowId, 'rowId(5)').toBeDefined();
  expect(columnId, 'columnId(2)').toBeDefined();
  const value = uniq('にほん'); // 日本語 IME 入力の確定値（ユニーク）

  // A: セル選択 → synthetic 変換 → 確定 Commit（beforeRevision は編集開始時 = fresh なので受理される）。
  await selectCell(alice, 5, 2);
  await composeOpen(alice, ['にほ', value]);
  await composeFinalizeAndCommit(alice, value);

  // A 側で ACK（pending 0）まで待ち、committed に確定値が入る。
  await expect
    .poll(async () => (await snapshot(alice)).pendingCount, { message: 'Alice ACK 待ち' })
    .toBe(0);
  await expect.poll(async () => committedCell(alice, rowId!, columnId!)).toBe(value);

  // B: 同一セルにサーバー経由で反映（シナリオ 2・8）。
  await expect
    .poll(async () => committedCell(bob, rowId!, columnId!), { message: 'Bob へ反映' })
    .toBe(value);

  // A/B/サーバーの文書 hash 一致（committed は server 確定＝両者一致で server とも一致）。
  const a = await snapshot(alice);
  const b = await snapshot(bob);
  expect(b.committedHash, 'A/B committed hash 一致').toBe(a.committedHash);
  expect(b.committedRevision).toBe(a.committedRevision);
  expect(a.rowCount, '50,000行 Canvas').toBeGreaterThanOrEqual(50_000);

  await highlightCell(bob, 5, 2);
  await bob.screenshot({ path: evidencePath('dd005-p4-e2e-ac1-bob-synced.png') });
});

test('AC2: 同一セル競合（A 変換中に B 確定 → Canvas=B・draft 保持・#9 → A 確定で reject → Conflict Queue → 収束）', async ({
  browser,
}) => {
  const alice = await client(browser, 'Alice');
  const bob = await client(browser, 'Bob');

  const rowId = await rowIdAt(alice, 12);
  const columnId = await colIdAt(alice, 4);
  expect(rowId).toBeDefined();
  expect(columnId).toBeDefined();
  const aliceDraft = uniq('あさ'); // A の未確定ドラフト（変換中）
  const bobValue = uniq('BOB'); // B の確定値

  // シナリオ 1: A が同一セルで日本語 IME 変換を開始し、変換中のまま留める（editingTarget と beforeRevision を凍結）。
  await selectCell(alice, 12, 4);
  await composeOpen(alice, ['あさ', aliceDraft]);
  const editingBefore = (await snapshot(alice)).editingTarget;
  expect(editingBefore, 'A editingTarget').toEqual({ rowId: rowId!, columnId: columnId! });

  // シナリオ 2: B が同じセルを更新・確定する（beforeRevision は B の編集開始時 = 現行なので受理される）。
  await selectCell(bob, 12, 4);
  await plainTypeAndCommit(bob, bobValue);

  // シナリオ 3: A の Canvas（committed = server 確定）へ B の値が反映される。
  await expect
    .poll(async () => committedCell(alice, rowId!, columnId!), { message: 'A の Canvas に B 値' })
    .toBe(bobValue);

  // 変換を続行して #9 の競合視覚（赤枠＋badge）を再評価させる（A はまだ変換中）。
  await composeContinue(alice, aliceDraft);

  // シナリオ 4: A の常駐 textarea と未確定ドラフトは維持される（#8: サーバー値で上書きしない）。
  const probe = await editorProbe(alice);
  expect(probe.value, 'A の textarea draft 保持').toBe(aliceDraft);
  const aliceConflict = await snapshot(alice);
  expect(aliceConflict.draft, 'A の状態機械 draft 保持').toBe(aliceDraft);
  expect(aliceConflict.isComposing, 'A は変換中のまま（IME 不変）').toBe(true);
  expect(aliceConflict.editingTarget, 'A の editingTarget 不変').toEqual(editingBefore);
  expect(aliceConflict.isConflicting, 'A は競合検知（#9）').toBe(true);

  // #9: 競合 badge が他者確定値を表示し、textarea を隠さず同時識別できる。
  const badge = alice.locator('.int-conflict-badge');
  await expect(badge).toBeVisible();
  await expect(badge).toContainText(bobValue);

  // 証跡: A の Canvas（B 値）・textarea（A draft）・競合 badge を同時に赤枠強調して撮る。
  await highlightSelector(alice, '.int-cell-editor, .int-conflict-badge');
  await alice.screenshot({ path: evidencePath('dd005-p4-e2e-ac2-alice-conflict.png') });

  // シナリオ 5・6・7: A が変換を確定 → beforeRevision（凍結した旧 revision）不一致で reject → 入力は Conflict Queue へ。
  const conflictsBefore = aliceConflict.conflictCount;
  await composeFinalizeAndCommit(alice, aliceDraft);
  await expect
    .poll(async () => (await snapshot(alice)).conflictCount, { message: 'reject → Conflict Queue' })
    .toBe(conflictsBefore + 1);

  // シナリオ 8: 全クライアントとサーバーの文書が B の値へ収束し hash 一致（A の 朝 は committed に入らない）。
  await expect
    .poll(async () => committedCell(alice, rowId!, columnId!))
    .toBe(bobValue);
  await expect
    .poll(async () => {
      const a = await snapshot(alice);
      const b = await snapshot(bob);
      return a.committedHash === b.committedHash && a.pendingCount === 0 ? a.committedHash : '';
    }, { message: 'A/B hash 収束' })
    .not.toBe('');
  expect(await committedCell(bob, rowId!, columnId!)).toBe(bobValue);
});

test('AC3: Canvas 統合（変換中に縦横スクロール → 同一 RowId/ColumnId へ追従・値/selection 不変）', async ({
  browser,
}) => {
  const alice = await client(browser, 'Alice');

  const rowId = await rowIdAt(alice, 8);
  const columnId = await colIdAt(alice, 6);
  const draft = uniq('さくら');

  // A が下方のセルで変換を開始（変換中）。
  await selectCell(alice, 8, 6);
  await composeOpen(alice, ['さくら', draft]);
  const before = await editorProbe(alice);
  const editingBefore = (await snapshot(alice)).editingTarget;
  expect(editingBefore).toEqual({ rowId: rowId!, columnId: columnId! });
  expect(before.display, 'textarea 可視').toBe('block');
  const indexBefore = await rowIndexOf(alice, rowId!);

  // 変換中に縦横スクロール（セルは可視範囲に留まる程度）。
  await scrollTo(alice, 66, 80);

  // rAF で textarea が新しい位置へ追従するまで待つ（位置が変わる = 追従した）。
  await expect
    .poll(async () => (await editorProbe(alice)).top, { message: 'textarea が縦スクロールへ追従' })
    .not.toBe(before.top);
  const after = await editorProbe(alice);
  const afterSnap = await snapshot(alice);

  // 追従した先は同一 RowId/ColumnId（display index も不変・スクロールは index を変えない）。
  expect(afterSnap.editingTarget, '同一セルへ追従').toEqual(editingBefore);
  expect(await rowIndexOf(alice, rowId!), 'display index 不変（スクロールは index を変えない）').toBe(indexBefore);
  expect(after.left, '横スクロールへ追従').not.toBe(before.left);
  expect(after.display, '追従後も可視').toBe('block');

  // 値・selection・変換状態は不変（#8: 位置だけ更新し value/selection/DOM 親は触らない）。
  expect(after.value, '値不変').toBe(before.value);
  expect(after.selectionStart, 'selectionStart 不変').toBe(before.selectionStart);
  expect(after.selectionEnd, 'selectionEnd 不変').toBe(before.selectionEnd);
  expect(afterSnap.isComposing, '変換中のまま').toBe(true);

  await highlightSelector(alice, '.int-cell-editor');
  await alice.screenshot({ path: evidencePath('dd005-p4-e2e-ac3-scroll-follow.png') });
});

test('AC4-a: 行挿入で編集継続（編集セルより上に挿入 → 同一 RowId のセルを編集継続・RowId 安定）', async ({
  browser,
}) => {
  const alice = await client(browser, 'Alice');
  const bob = await client(browser, 'Bob');

  const editRowId = await rowIdAt(alice, 14);
  const editColId = await colIdAt(alice, 3);
  const draft = uniq('あ');
  await selectCell(alice, 14, 3);
  await composeOpen(alice, ['あ', draft]);
  const editingBefore = (await snapshot(alice)).editingTarget;
  expect(editingBefore).toEqual({ rowId: editRowId!, columnId: editColId! });
  const indexBefore = await rowIndexOf(alice, editRowId!);
  const rowCountBefore = (await snapshot(alice)).rowCount;

  // B が「編集セルより上」（先頭行 index 0 の直後 = 全体を 1 行下へ押し下げる）に 1 行挿入する。
  const anchor = await rowIdAt(bob, 0);
  await submitInsertRowsAfter(bob, anchor ?? null, uniq('e2e-ins'));

  // A へ伝播 → 行数 +1・A の編集行の display index が +1（RowId は不変）。
  await expect
    .poll(async () => (await snapshot(alice)).rowCount, { message: '行挿入が A へ伝播' })
    .toBe(rowCountBefore + 1);
  await expect
    .poll(async () => rowIndexOf(alice, editRowId!), { message: 'RowId 追従（index 再解決）' })
    .toBe(indexBefore + 1);

  // 編集は継続（同一 RowId・draft・変換状態が不変。挿入は対象セル revision を変えないので競合にならない）。
  const afterSnap = await snapshot(alice);
  expect(afterSnap.editingTarget, '同一 RowId のセルを編集継続').toEqual(editingBefore);
  expect(afterSnap.draft, 'draft 不変').toBe(draft);
  expect(afterSnap.isComposing, '変換中のまま').toBe(true);
  expect(afterSnap.isConflicting, '行挿入は競合にしない').toBe(false);
  expect((await editorProbe(alice)).display, 'textarea 追従して可視').toBe('block');

  await highlightSelector(alice, '.int-cell-editor');
  await alice.screenshot({ path: evidencePath('dd005-p4-e2e-ac4-insert-continue.png') });
});

test('AC4-b/K4: 編集対象行の削除 → 編集継続（draft 非破壊）→ commit 時に退避＋公開 rejected 通知・無効 RowId へ Commit しない（DD-021-2 で挙動更新）', async ({
  browser,
}) => {
  // 旧 DD-005 挙動（削除受信で即 abortToDiverted＝composition 破棄）は DD-021-2 の K4（親④/D7）で
  // 「編集継続・draft/textarea/composition 非破壊・行消失インジケーター・commit 時退避」へ置換された。
  const alice = await client(browser, 'Alice');
  const bob = await client(browser, 'Bob');

  const editRowId = await rowIdAt(alice, 18);
  const editColId = await colIdAt(alice, 5);
  const draft = uniq('ひので');
  await selectCell(alice, 18, 5);
  await composeOpen(alice, ['ひので', draft]);
  const editingBefore = (await snapshot(alice)).editingTarget;
  expect(editingBefore).toEqual({ rowId: editRowId!, columnId: editColId! });
  const before = await snapshot(alice);
  expect(before.divertedCount).toBe(0);

  // rejected 通知（row-unavailable）を公開契約（subscribe）で捕捉する。
  await alice.evaluate(() => {
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

  // B が A の編集対象行を削除する。
  await submitDeleteRow(bob, editRowId!);

  // A へ伝播 → 行は tombstone 化するが、編集は**継続**する（draft/composition 非破壊・行消失インジケーター）。
  await expect
    .poll(async () => rowIndexOf(alice, editRowId!), { message: '編集行が消失（tombstone）' })
    .toBe(-1);
  await expect.poll(async () => (await snapshot(alice)).isTargetLost, { message: 'K4 行消失を検知' }).toBe(true);
  const afterDelete = await snapshot(alice);
  expect(afterDelete.editingTarget, '編集対象は保持（編集継続・K4）').toEqual({ rowId: editRowId!, columnId: editColId! });
  expect(afterDelete.divertedCount, 'commit までは退避しない（draft は利用者のもの）').toBe(0);
  expect(afterDelete.isComposing, 'composition 非破壊').toBe(true);
  expect(afterDelete.draft, 'draft 非破壊').toBe(draft);

  // 利用者が確定（finalize→Enter 相当）→ 無効 RowId へ submit せず退避＋公開 rejected（row-unavailable）。
  await composeFinalizeAndCommit(alice, draft);
  await expect
    .poll(async () => (await snapshot(alice)).divertedCount, { message: 'commit 時に draft 退避（K4）' })
    .toBe(1);
  await expect
    .poll(
      async () => alice.evaluate(() => (window as unknown as { __rejectedCodes?: string[] }).__rejectedCodes ?? []),
      { message: '退避が公開 rejected（row-unavailable）で通知される' },
    )
    .toContain('row-unavailable');
  const afterCommit = await snapshot(alice);
  expect(afterCommit.editingTarget, 'commit で編集終了').toBeNull();
  expect(afterCommit.pendingCount, '無効 RowId への submit なし').toBe(0);
  // A の未確定ドラフト（ユニーク）は committed に一切書かれない（＝黙って上書き/Commit しない）。
  expect(await committedCell(alice, editRowId!, editColId!), '削除セルへ draft を Commit しない').not.toBe(draft);

  await highlightSelector(alice, '#int-status');
  await alice.screenshot({ path: evidencePath('dd005-p4-e2e-ac4-delete-divert.png') });
});

test('Presence: シナリオ 10（A の activeCell・selectionRanges・editingCell が B へ届く）', async ({ browser }) => {
  const alice = await client(browser, 'Alice');
  const bob = await client(browser, 'Bob');

  const rowId = await rowIdAt(alice, 3);
  const columnId = await colIdAt(alice, 2);

  // A がセルを選択（activeCell/selectionRanges を発行）→ 変換開始（editingCell を発行）。
  await selectCell(alice, 3, 2);
  await composeOpen(alice, ['て', uniq('てすと')]);

  // B の knownPresences に A が activeCell/editingCell 付きで届く（シナリオ 10）。
  await expect
    .poll(async () => (await snapshot(bob)).knownPresenceCount, { message: 'B が A の Presence を受信' })
    .toBeGreaterThanOrEqual(1);
  const bobView = await snapshot(bob);
  const alicePresence = bobView.presences.find((p) => p.displayName === 'Alice');
  expect(alicePresence, 'B から見た A の Presence').toBeDefined();
  expect(alicePresence?.activeCell, 'A の activeCell').toEqual({ rowId: rowId!, columnId: columnId! });
  expect(alicePresence?.editingCell, 'A の editingCell').toEqual({ rowId: rowId!, columnId: columnId! });
  // selectionRanges も届く（シナリオ10・Codex P2）。単一セル選択なので start==end の 1 レンジ。
  expect(alicePresence?.selectionRanges, 'A の selectionRanges').toEqual([
    { startRowId: rowId!, startColumnId: columnId!, endRowId: rowId!, endColumnId: columnId! },
  ]);

  // Presence 受信は overlay の再描画契機（session-sync が dirty を立てる・Codex P1 修正）。手動 nudge なしで名前タグが出る。
  await bob.waitForTimeout(200);
  await highlightCell(bob, 3, 2);
  await bob.screenshot({ path: evidencePath('dd005-p4-e2e-presence.png') });
});
