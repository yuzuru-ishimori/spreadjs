# Codex レビュー依頼書 — DD-005 統合実装（Phase 2＋3＋4 の integration 差分）

## レビュー対象差分の取得手順（重要・これが本レビューのスコープ）

本レビューは **コミット `dc0d014` 直後 〜 現在の作業ツリー** の全差分（Phase 2＋3＋4）が対象。冒頭のスコープ行の
三点ドット表記だけに頼らず、次の 3 つを合算して取得すること:

1. `git diff dc0d014...HEAD` … コミット済みの **Phase 2**（`870e945`）＋ **Phase 3**（`812c035`）。
2. `git diff HEAD` … 未コミットの **Phase 4** のうち tracked ファイルの変更（`main.ts`・`server.ts`・
   `playwright.config.ts` 等）。
3. `git status --porcelain` … untracked を列挙し、各ファイルの内容を読むこと（新規 `e2e/integration-scenario.spec.ts`・
   `e2e/integration-helpers.ts`・`doc/DD/DD-005/*.md`・`doc/DD/DD-005/dd005-p4-e2e-*.png`）。

（1）＋（2）＋（3）＝本レビュー対象。**Phase 1（`bbd7f49`・sheet-collaboration 抽出）は別途レビュー済みゆえ対象外**。

## DD の目的

DD-002（IME・常駐 textarea）・DD-004（Canvas 仮想スクロール・ViewportTransform）・DD-003（共同編集・Operation 収束）を
**一つのセル編集フロー**として結線し、統合シナリオ 10 項目＋受け入れ基準 AC1〜4 が成立することを実装・検証する。
本 PoC の**最重要原則＝「ClientSession だけを Document State の唯一の正本とし、Canvas・IME に第二・第三の文書状態を
作らない」**（単一正本）。

## 重点観点（findings 優先で確認してほしい順）

1. **挙動一致（統合シナリオ 10 項目・AC1〜4 の仕様どおりか）**
   - AC1 通常入力の同期／AC2 同一セル競合（A 変換中に B 確定→A の Canvas=B 値・IME draft/selection 不変・#9 →
     A 確定で beforeRevision 不一致 reject → Conflict Queue → 収束）／AC3 変換中スクロール追従／AC4 行挿入で編集継続・
     行削除で draft 退避。実装（`src/integration/*`）と E2E（`e2e/integration-scenario.spec.ts`）が仕様どおり結線されているか。
2. **状態所有権 #1〜#9（DD 本文「Phase 2/3 詳細設計・状態所有権」節）**
   - **#1 単一正本 / #2 document-view が第二 CellStore になっていないか**（read-through Adapter・`store.set` 禁止）。
   - **#3 beforeRevision がセル単位**（`captureEditStartRevision`＝編集開始時の `lastChangedRevision` を凍結・文書全体
     revision ではない）。編集開始で凍結し以後サーバー更新で変えない（#12 取り違え防止）。
   - **#4 構造Op後の RowId 再解決**（`refreshPlacement` が `editingTarget.rowId` から表示 index を再解決・削除は tombstone 判定）。
   - **#7 Commit 順序**（最終 input→生存確認→凍結 beforeRevision→SetCells→submit→ACK/reject）。compositionend だけで Commit しない。
   - **#8 rollback/replay・リモートOp 中の IME 不変**（`noteServerUpdate` が生存セルでは textarea を触らない・draft へサーバー値を入れない）。
   - **#9 競合表示の同時識別**（textarea より上の z-index の badge にサーバー値・textarea には draft）。
3. **単一正本の破れ・二重状態の混入**: Canvas/IME/Presence が ClientSession とは別の永続セル状態を持っていないか。
   派生 State（Axis・dirty flag）が「いつでも ClientSession から再構築可」を満たすか。
4. **E2E の妥当性（テストのための実装に依存していないか・§20.5）**
   - `window.__integrationTestApi`（main.ts の E2E フック）は **読み取り専用の観測** ＋ AC4 の構造Op投入
     （`submitInsertRowsAfter`/`submitDeleteRow` は本番 `ClientSession.submitLocalOperation` を呼ぶだけ）に留まり、
     **成立を捏造していないか**。synthetic composition を「実 IME 成立」と誤表示していないか（コメント・命名で明示しているか）。
   - E2E が本番配線（selectCell=実 pointerdown・commit=実 Enter・scroll=実 DOM）を通しているか、
     read-only フックが挙動を変えていないか。
5. **回帰・スコープ**: `src/{grid,ime,pocb}`・`index.html`・`poc-b.html`・`packages/*` を改変していないか
   （凍結維持）。E2E 用の server.ts 追加（`SEED_ROWS/COLS/NONEMPTY` env）が既定挙動を変えていないか。
6. **バリデーション/権限**: 本 PoC は §8.7 で認証・認可をスコープ外にしている（両端自製境界＝DD-003 で確定）。
   その前提でよいが、beforeRevision 検証（server `validate.ts` の `stale-cell-revision`）が競合の唯一の砦なので、
   クライアント側で競合を握り潰す経路がないかは見てほしい。

## スコープ（対象ファイル）

- **Phase 2（コミット済み `870e945`）**: `apps/playground/src/integration/{browser-transport,document-view,session-sync,initial-load-metrics}.ts`＋各 test・
  `poc-integration.html`・`apps/playground/vite.config.ts`・`apps/collaboration-server/src/{seed-dataset.ts,server.ts}`（seed/CORS/config）。
- **Phase 3（コミット済み `812c035`）**: `apps/playground/src/integration/{commit-bridge,editor-placement,presence-adapter,ime-editing-session,integration-editor}.ts`＋各 test・
  `src/integration/main.ts`（plain input→IME editor 結線）・`document-view.ts`（rowIdAt/columnIdAt public 化）。
- **Phase 4（未コミット・本レビューの新規分）**:
  - `apps/playground/e2e/integration-scenario.spec.ts`（新規・統合シナリオ E2E）
  - `apps/playground/e2e/integration-helpers.ts`（新規・E2E ヘルパー）
  - `apps/playground/playwright.config.ts`（WS サーバー webServer 追加）
  - `apps/playground/src/integration/main.ts`（末尾に **読み取り専用フック `window.__integrationTestApi`** ＋ AC4 構造Op投入。挙動不変）
  - `apps/collaboration-server/src/server.ts`（`isMainModule` 起動ブロックに **E2E 起動用の env シード規模override**。既定挙動は不変）
  - `doc/DD/DD-005/integration-evidence.md`・スクショ・本 DD 本文更新

## 設計意図・制約

- **状態所有権**: Document State＝ClientSession のみ。Render State（Axis/Canvas）は Document State の派生・純ローカル。
  IME Draft は常駐 textarea（ローカルが正・共有しない）。Editing Target は RowId＋ColumnId＋編集開始 revision で保持。
  Presence は activeCell/selectionRanges/editingCell のみ共有（textarea 文字列/caret は共有しない）。
- **competition は server beforeRevision に一本化**: 統合ではリモート更新を状態機械へ dispatch せず（`MarkConflict` 未使用）、
  A は確定でき server reject を受ける（AC2 に忠実）。`isEditTargetStale`（committed の per-cell revision と凍結 revision の乖離）で
  #9 の競合インジケーターを出す。
- **resident-textarea/src/ime は零改変**（DD-002/004 の受入環境凍結）。統合側に新規 DOM アダプタ＋DOM 非依存コアを実装
  （editor-state-machine は無改変で再利用）。この判断は DD 本文 DA #10 に記録済み。
- **E2E**: 実 WS サーバー（integration seed）＋2 ブラウザーコンテキスト（Alice/Bob）＋synthetic composition。
  実 IME は Playwright で通せないため候補ウィンドウ・確定 Enter 実発火順 A/B は **Phase 5 実機ゲート**（対象外）。

## 検証済み（参考・二重チェック不要だが結果の妥当性は見てよい）

`npm run typecheck`／`npm run lint`／`npm run test`（**45 files / 434 tests** green）／`npm run test:e2e`
（**17 passed**＝DD-002 の 11 に統合 6 追加・DD-002 回帰 0）／`npm run build`（integration 39.93KB）／`bash scripts/doc-check.sh`＝全 green。
