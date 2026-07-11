# Codex レビュー依頼書 — DD-002 PoC-A 日本語IME（Phase 3〜5）

## 重要: レビュー対象範囲（厳守）

**このリポジトリは複数 DD が同一作業ツリーで並行実装中です。レビュー対象は DD-002 の
`apps/playground/**` と `doc/DD/DD-002/**` の差分のみ**。以下は **別 DD（DD-003 共同編集）の
所有物なのでレビュー対象外**とし、findings に含めないでください:

- `packages/**`（sheet-types 以外の変更）・`apps/collaboration-server/**`
- `doc/DD/DD-003*`・`doc/plan/*`・ルート `package.json` / `package-lock.json`

未コミット差分の中にこれらが含まれていても無視してください。

### レビュー対象ファイル（DD-002 の実装差分）

- `apps/playground/src/ime/editor-state-machine.ts`（新規・中核）
- `apps/playground/src/ime/editor-state-machine.test.ts`（新規・シナリオ TDD）
- `apps/playground/src/ime/resident-textarea.ts`（改修・状態機械統合）
- `apps/playground/src/sim/remote-update-simulator.ts`（新規）
- `apps/playground/src/sim/remote-update-simulator.test.ts`（新規）
- `apps/playground/src/main.ts`（改修・配線）
- `apps/playground/index.html`（改修・シミュレーター UI）
- `doc/DD/DD-002/manual-ime-test-guide.md`（新規・手順書）

## 目的

「常駐 textarea で Excel に近い日本語連続入力が成立するか」を検証する PoC-A（計画書 §18.1）。
リスク R-01（IME イベント順の OS・ブラウザー差）の成立性確認が主眼。今回の差分は **編集状態機械
（TDD）＋常駐 textarea 本統合（Phase 3）／リモート更新シミュレーター・スクロール追従（Phase 4）／
実機手動試験手順書（Phase 5・E2E は別途保留）**。

## スコープと設計意図（計画書 §11）

- **§11.2 編集状態機械**: `Navigation / EditingReplace / EditingExisting / Composing /
  EditingAwaitFinalInput` の 5 状態。`editor-state-machine.ts` は **DOM 型に非依存**（入力 =
  `EditorEvent`、出力 = `Effect`）。UI アダプタ（`resident-textarea.ts`）が DOM イベント→
  `EditorEvent` 変換と `Effect` 適用を担う。`activeCell` の所有権は状態機械に一本化（main は
  `getActiveCell()` を読むだけ）。
- **§11.5 原則（不変条件 I-1〜I-5）**:
  - I-1: 値の正は `input` 後の `textarea.value`（keydown で文字を推測しない）。
  - I-2: `isComposing` と内部 composing フラグを併用。`keyCode 229` / `key:"Process"` を主判定にしない。
  - I-3: composition 中は textarea の value/selection/DOM 親を変更しない（背景・アウトライン paint と
    §11.6 方式2 の位置追従のみ許容）。
  - I-4: IME 確定 Enter を通常 Enter として扱わない。**順序A**（`keydown{Enter,isComposing:true}` が
    compositionend より前）と **順序B**（compositionend 後の `keydown{Enter,isComposing:false}` を
    `suppressCommitUntilKeyup` で keyup まで抑止）の両方を実装。
  - I-5: セル移動で別 input へ focus を移さない（常駐 textarea 1 個を使い回す）。
- **§11.6 pendingNavigation**: 変換中に別セルクリック → `SetPendingNavigation`。最終 input 後に競合が
  なければ commit してクリック先へ移動、競合ありなら留まり pendingNavigation を破棄（Q-3）。
  スクロール追従は方式2（textarea をセルへ位置追従）。
- **§11.7 MarkConflictOnly**: リモート更新で cell-store（Canvas の正）は更新するが textarea/draft は
  不変。編集中セルへの更新は競合マークのみ。`remote-update-simulator.ts` は必ず
  `editor.applyRemoteUpdate` 経由で書く。
- **§11.9 禁止事項**: 文字キー検出後の input 生成・focus／composition 中の再マウント・value 整形・
  サーバー値反映／確定 Enter の通常 Enter 扱い／セル移動ごとの focus 付け替え。

## 制約

- **新規依存を追加しない**（並行セッションと package-lock 競合を避けるため）。テストは既存の
  vitest（node 環境）。状態機械は DOM 非依存で node テスト可能。
- コーディング基準 `doc/templates/coding-standards.md`（P01 `any` 禁止 / P02 unsafe `as` / P03 `!` /
  P19 型迂回 / P20 スタブ / P21 デバッグコード）。
- 実 IME の候補ウィンドウ・ブラウザー間イベント順は synthetic では再現不可 → 実機判定は Phase 6。

## 重点的に見てほしい点（findings 優先で）

1. **仕様一致**: §11.2 の遷移・§11.5 の I-1〜I-5・§11.6/§11.7 に反する挙動がないか。特に確定 Enter
   抑止（順序A/B）と「確定の次の Enter で下移動（受け入れ #2）」が正しいか。`suppressCommitUntilKeyup`
   の解除条件（keyup{Enter}）が短すぎ/長すぎて legit な Enter を誤って飲む/漏らすケースはないか。
2. **回帰・エッジ**: commit-on-blur（Q-4）と pointerdown 選択が二重に commit しても破綻しないか。
   競合中の commit 保留（S-F5）で newline 挿入や無限保留に陥らないか。Backspace 開始（Q-1）で
   データ消失（Escape 復帰）に問題はないか。pendingNavigation × 競合 × Escape の後始末（S-E3/E4）。
3. **§11.9 混入**: composition 中の value 書き換え・再マウント・focus 付け替え・サーバー値反映が
   紛れ込んでいないか（`resident-textarea.ts` の applyEffect/reconcile/followScroll）。
4. **テスト不足**: `editor-state-machine.test.ts` の 44 シナリオ＋順序A/B/direct 再生で、抜けている
   遷移やアサート漏れ（特に受け入れ #2/#3/#5 に関わる分岐）はないか。
5. **バリデーション/堅牢性**: `keydown` の preventDefault 条件（`effects.length > 0`）が過剰/不足に
   なるキーはないか。`remote-update-simulator.ts` の `pickDistinctCell` が avoid と衝突する縮退が
   実害を生まないか。

型/テストは通過済み（`npm run typecheck` / `lint` / `test`＝102 件 / `build` すべて green）。
指摘は上記 5 観点の findings を優先し、なぜ問題か・どの §/不変条件に反するかを添えてください。
