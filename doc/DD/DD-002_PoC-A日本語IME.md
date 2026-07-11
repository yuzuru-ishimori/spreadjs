# DD-002: PoC-A日本語IME

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-11 | 2026-07-11 | 確認待ち | Phase 0-1完了。scenarios.md ユーザー合意待ち |

> アプローチ: TDD（編集状態機械＝計画書 §11.2/§11.5 に「正解」が明確な状態遷移）＋標準（Canvasグリッド土台・recorder・実機試験Phase）

## 目的

「常駐textareaでExcelに近い日本語連続入力が成立するか」を検証するPoC-A（計画書 §18.1）を `apps/playground` に実装し、Windows 11 実機の実IME受入試験で合格条件を判定する。リスクR-01（IMEイベント順のOS・ブラウザー差＝致命的×高）の成立性を Phase 0 の最優先で確認する。

## 背景・課題

- 正典は計画書 `doc/plan/nanairo_realtime_spreadsheet_development_plan_v1.md` の **§18.1（PoC-A実装範囲・合格条件）と §11（日本語IME操作仕様）**。R-01 は Phase 0 No-Go 条件の筆頭であり、`doc/plan/phase0-dd-roadmap.md` ②は「②を最優先する」と定める。
- DD-001 で monorepo 基盤は構築済み。`apps/playground` は枠線付き空Canvas土台（`src/main.ts`）のみで、グリッド・IME処理は未実装。
- 実IME（候補ウィンドウ・イベント順）は synthetic composition イベントでは再現できない（§11.8/§20.5）ため、自動テストだけでは合否判定できず、ユーザー実機での手動受入試験とその手順書が必要。

## 検討内容

- **実装先**: playground 内で完結（§17.1 の playground 役割＝「単体検証・IME event recorder」。製品パッケージ `sheet-editor-ime` への昇格は Phase 1）。ただし編集状態機械と event recorder は **DOM型に依存しない分離モジュール**（`src/ime/`）とし、将来の移設を容易にする。UI配線（DOMイベント→状態機械入力の変換）は薄いアダプタに隔離する。
- **検証は二層**: (a) 自動＝状態機械ユニットテスト（vitest・synthetic イベント列で駆動）＋基本操作E2E（Playwright・dev依存のみ）。(b) 手動＝ユーザーの Windows 11 実機での実IME受入試験（手順書 `DD-002/manual-ime-test-guide.md` を成果物に含める）。
- **変換中スクロール**: §11.6 の3方式比較は本PoCでは行わず、1方式（textarea のセル追従）＋残り方式の比較メモに留める（過剰実装回避。方式確定は Phase 1）。スクロールはグリッドコンテナ（overflow）で検証できる範囲でよい。
- **スコープ外**: paste（状態機械では記録のみ）・セル内改行（Alt+Enter は手動試験の観察項目のみ）・複数セル選択・undo・数式・仮想スクロール/大量行（PoC-B）・実サーバー同期（PoC-C。リモート更新はローカルシミュレーターで代替）。
- **ADR**: PoC-A 固有の新規ADRなし（ADR-002「Canvas 2D＋常駐textarea」は Accepted 済みで、本PoCはその成立性検証。結果はDD本文・トレース・手順書に記録し、Phase 0 判定〔ロードマップ⑥〕の材料にする）。

## 決定事項

- **§11.3 常駐textarea原則を厳守**: グリッド生成時に1個だけ生成し破棄しない / `display:none`・`visibility:hidden`・ゼロサイズにしない / アクティブセル位置へ配置（IME候補ウィンドウ基準位置をセル近傍に保つ）/ Navigation中は値を空に / F2・ダブルクリック時だけ既存値を設定 / composition中に value・selection・DOM親を変更しない。
- **編集状態機械は §11.2 をそのまま採用**: Navigation / EditingReplace / EditingExisting / Composing / EditingAwaitFinalInput。§11.5 原則＝値の正は input 後の `textarea.value` / `keyCode === 229` 非依存（限定fallbackのみ）/ `isComposing`＋内部state併用 / IME確定Enter抑止は `suppressCommitUntilKeyup` 等の互換層で行う。
- **リモート更新は §11.7/§10.4 準拠**: Canvas再描画は可・textareaのDOM/値/selectionは不変・編集中セルへのリモート書込はセル枠へ競合インジケーター表示（競合解決ダイアログはスコープ外）。
- **トレースは Appendix B `ImeEventTrace` 形式**（timestamp/browser/os/ime/state/eventType/key/code/isComposing/inputType/data/value/selection/activeCell）。実機試験の保存先は `doc/DD/DD-002/traces/`。
- **§11.9 禁止事項を DA・Codexレビューの必須観点とする**: 文字キー検出後の input 生成・focus / composition中の textarea 再マウント・value整形・サーバー値反映 / IME確定Enterの通常Enter扱い / セル移動ごとの別inputへのfocus移動。

### 試験対象環境（2026-07-11 ユーザー合意で確定。起票時「要確認」3点の回答）

1. **対象IME = Microsoft IME ＋ Google日本語入力の両方**。Google日本語入力が未導入ならユーザーがインストールして試験する前提で Phase 4 手順書を書く。
2. **対象ブラウザー = Chrome ＋ Edge の両方**（D-001 の最優先2ブラウザー）。
3. **macOS・Firefox は本PoCの判定対象外**（A-02/D-001 の次順位。§11.8 マトリクスの残り〔Firefox・macOS/Safari〕とともに Phase 0 後半以降へ送る）。

## 受け入れ基準

計画書 §18.1 合格条件をそのまま使う（1〜5 の判定主体は Phase 5 のユーザー実機試験）。
**「対象環境」= Windows 11 ＋ {Microsoft IME, Google日本語入力} × {Chrome, Edge}**（上記「試験対象環境」）。macOS・Firefox は対象外。

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | 対象環境で50回連続日本語入力 → 先頭文字欠落0件 | Phase 5 手動（手順書 手順A） |
| 2 | IME確定Enter → セル確定・移動しない（誤移動0件）。次のEnterで確定・下移動 | Phase 2 ユニットテスト＋Phase 5 手動（手順B） |
| 3 | 矢印・Enter・Shift+Enter・Tab・Shift+Tab 移動後に日本語再入力 → 成功率100% | Phase 2 ユニット＋Phase 4 E2E＋Phase 5 手動（手順C） |
| 4 | 変換中にCanvas再描画（シミュレーター連続書込）→ 変換中文字列の消失0件 | Phase 3 🔬スモーク＋Phase 5 手動（手順D） |
| 5 | 変換中に編集中セル・他セルへリモート更新 → ドラフト消失0件・競合インジケーター表示 | Phase 2 ユニット＋Phase 5 手動（手順E） |
| 6 | イベントトレースを保存し、再現手順を文書化 | Phase 4 手順書作成＋Phase 5 `DD-002/traces/` 保存 |

## タスク一覧

### Phase 0: 事前精査
- [x] 📋 **各Phaseのタスク精査・詳細化**（受け入れ基準#1〜6 が各Phaseの検証タスクに対応することを確認済み。ファイルパス・🔬の有無 OK）
- [x] 📐 **実装前詳細化トリガー判定**: **Phase 1=要**（下記「Phase 1 詳細設計」で実施済み）／**Phase 2=要**（DOM非依存状態機械＋§11.5互換層。着手時＝scenarios合意後に詳細化）／**Phase 3=要**（recorder/simulator/scroll・複数新規）／**Phase 4=要（軽）**（Playwright導入・E2E・手順書）／**Phase 5=不要**（ユーザー手動作業中心）
- [x] 🧪 **テスト設計（Red）**: §11.2 遷移・§11.4 操作・§11.5 原則・§11.7 リモート更新・確定Enter抑止・pendingNavigation を `doc/DD/DD-002/scenarios.md` に自然言語で作成済み（44シナリオ＋未確定Q-1〜5）→ **ユーザー合意待ち**。合意後に Phase 2 でコード化
- [x] 🧑‍⚖️ **Codexレビュー要否判定**: **必須**〔複雑な状態遷移＋TDD対象〕・effort: **high**〔xhighトリガー非該当〕で確定。実行は Phase 4 で全差分に1回（本セッションは Phase 1 で停止のため未実行）
- [x] 😈 **Devil's Advocate調査**（下記「DA批判レビュー記録」#1〜4。§11.9 混入経路を重点確認）

#### Phase 1 詳細設計（📐 詳細化要 → モジュール境界・シグネチャ）

依存 DAG（循環なし）: `geometry`（型・座標・キー）← `cell-store`／`navigation`／`grid-view` ← `main`。ロジック（geometry/cell-store/navigation）は DOM 非依存＝単体テスト可、DOM 依存は `grid-view`（Canvas）と `main`（配線）に隔離。
- `geometry.ts`: `GridLayout`/`CellPosition`/`Rect`/`Size`・`cellRect`/`hitTestCell`/`clampCell`/`isValidCell`/`cellKey`⇄`parseCellKey`/`columnLabel`/`contentSize`（全て純粋関数・CSS px）
- `cell-store.ts`: `createCellStore()` → `get/set/clear/entries/subscribe`（Map保持・値変化時のみ通知）
- `navigation.ts`: `keyToDirection()`（キー→方向）・`moveActiveCell()`（端クランプ移動）
- `grid-view.ts`: `createGridView(canvas,store,layout)` → `render({activeCell,conflictCells})`（全再描画・DPR吸収）
- `main.ts`: store購読→再描画、pointerdown→hitTest→選択、keydown→方向→移動（クリック選択は geometry.hitTestCell に委譲）

### Phase 1: グリッド土台（20行×10列Canvas・選択・キーボード移動）
- [x] 📐 **実装前詳細化**（Phase 0「Phase 1 詳細設計」に記載済み）
- [x] `apps/playground/src/grid/geometry.ts`（新規）: 固定20行×10列のセル矩形計算と point→cell ヒットテスト（CSS px統一・DPRは描画側で吸収）
- [x] `apps/playground/src/grid/cell-store.ts`（新規）: セル値の保持（Map）と変更通知（再描画・シミュレーターの書込先）
- [x] `apps/playground/src/grid/navigation.ts`（新規）: アクティブセル移動（矢印/Enter=下/Shift+Enter=上/Tab=右/Shift+Tab=左。クリックは main→geometry.hitTestCell。端はクランプ）
- [x] `apps/playground/src/grid/grid-view.ts`（新規）: Canvas描画（罫線・ヘッダー・セル値・アクティブセル枠・競合インジケーター。§12の Base/Overlay 分離はせず1枚全再描画）
- [x] `apps/playground/src/main.ts`・`index.html`: 空グリッド土台を差し替え、スクロール検証用に overflow コンテナ（`#grid-scroll`・tabindex）へ配置
- [x] `apps/playground/src/grid/*.test.ts`（新規）: geometry・navigation ＋ cell-store のユニットテスト（計29件）
- [x] 🔬 **機械検証**: `npm run test`（33 pass）/ `typecheck` / `lint` / `build` → green。`npm run dev` の対話目視（クリック・キー移動）は主セッションの Playwright スモークで確認済み（`DD-002/phase1-grid-smoke.png`・下記ログ）
- [x] 😈 **DA批判レビュー**（基準: da-method.md §3.4 → 下記記録 #1〜4）

### Phase 2: 編集状態機械（TDD）＋常駐textarea
- [ ] **Red**: 合意済み `DD-002/scenarios.md` を `apps/playground/src/ime/editor-state-machine.test.ts`（新規）へコード化（synthetic composition/keyboard/input 列で駆動）→ 全件失敗を確認
- [ ] **Green**: `apps/playground/src/ime/editor-state-machine.ts`（新規・DOM型非依存）: §11.2 の5状態と遷移、§11.5 原則（input後value正・keyCode 229非依存・isComposing＋内部state併用・`suppressCommitUntilKeyup` 互換層）、変換中クリックの pendingNavigation（§11.6）、リモート更新時 MarkConflictOnly（§11.7）を実装 → 全件成功
- [ ] `apps/playground/src/ime/resident-textarea.ts`（新規）: §11.3 準拠の常駐textarea 生成・アクティブセル位置への配置・DOMイベント→状態機械入力への変換アダプタ
- [ ] `apps/playground/src/main.ts`: 状態機械の出力（編集開始・commit・cancel・移動・置換/既存値編集）を cell-store / navigation / grid-view へ配線（直接入力・F2・ダブルクリック・Escape・Delete を含む）
- [ ] **Refactor** + 🔬 **機械検証**: `npm run test` → 状態機械テスト全pass / `typecheck` / `lint` → green
- [ ] 😈 **DA批判レビュー**（§11.9 禁止事項への違反がないかを必須観点にする）

### Phase 3: event recorder・リモート更新シミュレーター・スクロール追従
- [ ] `apps/playground/src/ime/event-recorder.ts`（新規・UI非依存）: Appendix B `ImeEventTrace` 形式で composition*/beforeinput/input/keydown/keyup/focus/blur/pointerdown ＋状態機械stateを記録
- [ ] `apps/playground/src/ui/trace-panel.ts`（新規）＋ `index.html`: トレースの画面表示（直近件数）・JSONエクスポート（ダウンロード）・クリア
- [ ] `apps/playground/src/sim/remote-update-simulator.ts`（新規）: 「編集中セルへ書込」「他セルへ書込」「インターバル連続書込（再描画誘発）」操作 → cell-store 更新。§11.7 準拠（textarea不変・Canvas再描画・競合インジケーター表示）
- [ ] スクロール追従（§11.6）: コンテナスクロール時に textarea をセル位置へ再配置（composition中も value/selection/DOM は不変）。採用1方式と残り2方式の比較メモを本DD検討内容へ追記
- [ ] 📸 **エビデンス**: グリッド＋trace-panel＋シミュレーターUIのキャプチャ（`DD-002/` へ配置）
- [ ] 🔬 **機械検証**: `npm run dev` → recorder記録・JSONエクスポート・シミュレーター書込（変換中相当の編集中に他セル書込→編集値保持）・スクロール追従をスモーク確認。`test`/`typecheck`/`lint` → green
- [ ] 😈 **DA批判レビュー**（記録欠落・recorderのオーバーヘッド・シミュレーターと§11.7の乖離）

### Phase 4: 基本操作E2E・手動試験手順書・Codexレビュー
- [ ] Playwright 導入（ルート devDependencies に `@playwright/test`・`apps/playground/e2e/`＋設定。vitest 対象と分離。ランタイム依存は追加しない）
- [ ] `apps/playground/e2e/basic-operations.spec.ts`（新規）: クリック選択→矢印/Enter/Shift+Enter/Tab/Shift+Tab→直接入力で既存値置換→F2既存値編集→Escape取消→移動直後の再入力（受け入れ#3の自動分）
- [ ] `apps/playground/e2e/synthetic-composition.spec.ts`（新規）: synthetic composition 列の再生で状態遷移・確定Enter抑止をスモーク確認（実IMEの代替ではない旨をコメント明記）
- [ ] `doc/DD/DD-002/manual-ime-test-guide.md`（新規）: 実機手動試験手順書 — 環境情報の記録欄（OS/ブラウザー/IME各バージョン）、受け入れ基準1〜5の手順A〜E（操作・確認項目・回数）、トレースJSONの保存方法（`DD-002/traces/`）、観察項目（Backspace開始挙動・Alt+Enter・変換中クリック・変換中スクロール・長文変換・文節移動・再変換）
- [ ] 🔬 **機械検証**: E2E全pass ＋ `npm run test` / `typecheck` / `lint` / `build` → green
- [ ] 😈 **DA批判レビュー**（E2Eが実IME差を担保しない前提の確認・手順書だけで第三者が再現できるか）
- [ ] Codexレビュー自動実行（Phase 1〜4 全差分。依頼書 `DD-002/codex-review-request.md`〔目的・スコープ・§11.2/11.5/11.9 の設計意図・制約を含める〕→ `bash scripts/codex-review.sh` → `DD-002/codex-review-result.md`。effort: high）
- [ ] Codexレビュー指摘への対応、または見送り理由をログに記録

### Phase 5: 実機受入試験・合格判定（ユーザー実機作業を含む）
- [ ] ユーザーへ実機試験を依頼（Windows 11・手順書 `DD-002/manual-ime-test-guide.md` に従う。対象IME・ブラウザーは決定事項「試験対象環境」に従う＝Microsoft IME／Google日本語入力 × Chrome／Edge）
- [ ] 試験結果の記録: トレースJSONを `doc/DD/DD-002/traces/` へ保存し、環境情報・合否・不具合時の再現イベント列を手順書の記録欄へ記入
- [ ] 合格条件判定: 受け入れ基準表1〜6と照合して本DDへ記録。不合格項目はイベントトレースから原因分析→修正→再試験（本Phase内で反復）
- [ ] §11.4 の未確定挙動（Backspace のNavigation開始挙動・Alt+Enter のOS差・変換中スクロール方式）の観察結果と推奨を「決定事項」へ追記（Phase 1 へのインプット）
- [ ] 🔬 **機械検証**: 最終 `npm run test` / `typecheck` / `lint` → green、`bash scripts/doc-check.sh` → エラー0
- [ ] 😈 **DA批判レビュー**（合格判定の根拠がトレースで再現可能か・「IMEが変」で片付けた項目がないか）

## ログ

### 2026-07-11
- DD作成（`doc/plan/phase0-dd-roadmap.md` ②「PoC-A 日本語IME」に対応。同ロードマップの実DD列に DD-002 を記入）
- Codex CLI 利用可否チェック: 利用可（codex-cli 0.144.0-alpha.4）→ Codexレビュータスクを Phase 4 末尾に配置。起票時暫定判定: 必須（複雑な状態遷移＋TDD対象）・effort high
- Playwright MCP: 起票エージェントからは利用可否を確認できず。実装Phase開始時に確認し、利用不可ならエビデンスは手動キャプチャで代替
- 要確認: 実機試験IMEは Microsoft IME に加え Google日本語入力も試験可能か（決定事項 §要確認1）
- 要確認: 手動試験ブラウザーは Chrome / Edge 両方でよいか（同 §要確認2）
- 要確認: macOS・Firefox は本PoCの判定対象外としてよいか（同 §要確認3）

### 2026-07-11（Phase 0＋Phase 1 実装セッション）

- **ユーザー合意反映**: 起票時「要確認」3点を確定（IME=Microsoft＋Google両方／ブラウザー=Chrome＋Edge両方／macOS・Firefoxは対象外）。決定事項「試験対象環境」・受け入れ基準の対象環境注記・scenarios.md「実IME手動試験の前提」へ反映し「要確認」表記を解消
- **Phase 0 完了**: タスク精査OK・詳細化トリガー判定（Phase 1=要で詳細設計実施／2〜4=着手時に詳細化／5=不要）・Codex要否=必須/high確定（実行はPhase 4）・DA調査4件（下表）
- **テスト設計（scenarios.md）**: 編集状態機械の自然言語シナリオ44件を作成（A:Navigation 6 / B:直接入力 7 / C:既存値編集 5 / D:IME・確定Enter区別 11 / E:pendingNavigation 4 / F:リモート更新 5 / G:移動後再入力 3 / H:境界 3）＋未確定Q-1〜5。★中核= S-D3/D4/D5（確定Enter抑止 順序A/B）・S-E1〜E3（pendingNavigation）・S-F1/F2（MarkConflictOnly）。**ユーザー合意待ち**
- **Phase 1 実装**: `grid/{geometry,cell-store,navigation,grid-view}.ts`＋`main.ts`/`index.html` 差替え。ロジックはDOM非依存で分離、Canvas/配線のみDOM依存に隔離。日本語サンプル値でCanvas描画確認を兼用、overflowコンテナでスクロール検証土台
- **機械検証**: `npm run test` 33 pass（新規29: geometry 13 / navigation 8 / cell-store 8）／`typecheck` clean／`lint` clean／`build` 成功（10 modules）。`npm run dev` の対話目視は未実施（制約: dev常駐しない・ポート5173競合・Playwright=Phase 4）→ ユーザー確認へ委譲
- **Codexレビュー**: 本セッションは Phase 1 停止のため未実行（DD方針どおり Phase 4 で Phase 1〜4 全差分に1回・effort high）
- **停止点**: guides.md §8 とPhase 0方針「シナリオは合意後にコード化」に従い、scenarios.md 合意待ちで停止。**要判断: テストシナリオ（特にQ-1〜5）のユーザー合意**。Phase 2以降（状態機械TDD・常駐textarea・recorder）は未着手

### 2026-07-11（Phase 1 目視スモーク / 主セッション）
- Playwright MCP で playground（:5175）を確認: グリッド描画（日本語サンプル値・列/行ヘッダー）・クリック選択・ArrowDown移動（アクティブ枠が1行下へ）OK → `DD-002/phase1-grid-smoke.png`
- コンソールエラーは favicon 404 のみ（favicon未設定のため想定内・機能影響なし）

---

## DA批判レビュー記録

> 手順・品質フィルター・再チェック条件は `doc/da-method.md` を参照。

### 共通DA観点（全Phase必須）

**§11.9 禁止事項への違反混入**（composition中の再マウント・value変更・サーバー値反映 / 確定Enterの通常Enter扱い / keydownでの文字推測 / セル移動ごとのfocus付け替え）と、**recorder自身が入力挙動へ干渉していないか**を毎Phaseで確認する。

| # | Phase | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------|-------------------|--------|----------------------|--------|------|
| 1 | 0/2 | 確定Enter抑止はブラウザーで発火順が2通り（順序A: Enterがcomposing中／順序B: compositionend後にEnter）。片方だけテスト化すると他方のブラウザー差で受け入れ#2が漏れる | 高（運用ルール） | S-D3(順序A)とS-D5(順序B)を両方 synthetic 列で再生／実IMEは Phase 5 | 将来脆弱性・§11.9 I-4 | **Phase 2 で S-D3 と S-D5 を必ず両方コード化**（`suppressCommitUntilKeyup` の keyup 解除まで検証）。運用ルールとして本表に固定 |
| 2 | 0/2 | activeCell の所有権が Phase 1 は main、Phase 2 は編集状態機械（Move/MoveTo 出力）に跨る。二重管理すると commit 後の移動先がズレる | 中 | Phase 2 で machine が MoveTo を出す一方 main も activeCell を更新すると競合 | 依存関係の波及 | scenarios を「machine が Move/MoveTo を出す・main は反映のみ」で設計済み。**Phase 2 詳細化で activeCell を machine 出力へ一本化**する方針を明記 |
| 3 | 0/2 | Phase 1 の keydown 受け口は `#grid-scroll`（tabindex）。Phase 2 で常駐 textarea 導入時に移行しないと、二重フォーカス／§11.9 I-5「セル移動ごとに別inputへfocus」違反になりうる | 中 | Phase 2 で textarea 追加後も scroll.focus() が残ると入力受け口が2系統 | 将来脆弱性・§11.9 I-5 | **Phase 2 で keydown/IME を常駐 textarea 一本へ移し、`scroll.focus()` を撤去**。resident-textarea タスクのチェック項目にする |
| 4 | 0/4 | Codex は Phase 4 で全差分1回の予定。Phase 2 の状態機械が肥大化するとレビュー粒度が粗くなる | Info | — | スコープ判断 | 現状は枠節約優先で Phase 4 一括。Phase 2 が想定超に膨らんだ場合のみ Phase 2 完了時の中間 Codex を検討（判断は Phase 2 着手時） |
