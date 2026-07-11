# DD-002: PoC-A日本語IME

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-11 | 2026-07-11 | 進行中 | Phase 2完了・対話スモーク/エビデンス取得済み。実機トレース採取待ち（ユーザー作業・ゲート1） |

> アプローチ: トレース先行（実IMEの生イベントを先に採取し、scenarios.md と状態機械を実挙動から確定）＋TDD（確定後の編集状態機械）＋標準（Canvasグリッド土台・手順書・実機試験）

## 目的

「常駐textareaでExcelに近い日本語連続入力が成立するか」を検証するPoC-A（計画書 §18.1）を `apps/playground` に実装し、Windows 11 実機の実IME受入試験で合格条件を判定する。リスクR-01（IMEイベント順のOS・ブラウザー差＝致命的×高）の成立性を Phase 0 の最優先で確認する。

## 背景・課題

- 正典は計画書 `doc/plan/nanairo_realtime_spreadsheet_development_plan_v1.md` の **§18.1（PoC-A実装範囲・合格条件）と §11（日本語IME操作仕様）**。R-01 は Phase 0 No-Go 条件の筆頭であり、`doc/plan/phase0-dd-roadmap.md` ②は「②を最優先する」と定める。
- DD-001 で monorepo 基盤は構築済み。`apps/playground` は Phase 1 でグリッド土台（20×10 Canvas・選択・移動）まで実装済み。IME処理は未実装。
- 実IME（候補ウィンドウ・イベント順）は synthetic composition イベントでは再現できない（§11.8/§20.5）。**状態機械を机上の想定で先に固定すると、実挙動（特に確定Enterの発火順）とズレる**恐れがあるため、先に生イベントを実機採取して設計の土台にする（下記「トレース先行方針」）。

## 検討内容

- **トレース先行方針（2026-07-11 ユーザー指摘で採用）**: 状態機械を確定する前に、**最小の常駐textarea＋生イベントrecorder**（Appendix B `ImeEventTrace` 形式）を先に作り、Microsoft IME／Google日本語入力 × Chrome／Edge の**実イベントトレースを短時間採取**する。そのトレースを確認してから `scenarios.md` と編集状態機械を確定する。これにより、計画書 §11.5 が警告する composition 境界・確定Enter発火順のブラウザー/IME差を「実測」に基づいて設計へ織り込む。
- **実装先**: playground 内で完結（§17.1 の playground 役割＝「単体検証・IME event recorder」）。編集状態機械・event recorder は **DOM型に依存しない分離モジュール**（`src/ime/`）とし、将来 `sheet-editor-ime` へ移設しやすくする。UI配線（DOMイベント→状態機械入力の変換）は薄いアダプタに隔離する。
- **検証は二層**: (a) 自動＝状態機械ユニットテスト（vitest・synthetic イベント列で駆動。**実採取トレースを再生素材に使う**）＋基本操作E2E（Playwright・dev依存のみ）。(b) 手動＝ユーザーの Windows 11 実機での実IME受入試験（手順書 `DD-002/manual-ime-test-guide.md` を成果物に含める）。
- **ユーザー確認ゲートは2回のみ**（下記 Phase 2末・Phase 6）。それ以外の Phase（状態機械・シミュレーター・E2E 等の内部詳細）は、合意済みスコープ内であれば DA・テスト・Codexレビューを通過した時点で**停止せず継続**する。仕様・受け入れ基準・ユーザー体験を変える必要が生じたときのみ停止する。
- **変換中スクロール**: §11.6 の3方式比較は行わず、1方式（textarea のセル追従＝方式2）＋残り方式の比較メモに留める（過剰実装回避。方式確定は Phase 4）。
- **スコープ外**: paste（recorderでは記録のみ）・セル内改行（Alt+Enter は手動試験の観察項目のみ）・複数セル選択・undo・数式・仮想スクロール/大量行（PoC-B）・実サーバー同期（PoC-C。リモート更新はローカルシミュレーターで代替）。
- **ADR**: PoC-A 固有の新規ADRなし（ADR-002「Canvas 2D＋常駐textarea」は Accepted 済みで、本PoCはその成立性検証。結果はDD本文・トレース・手順書に記録し、Phase 0 判定〔ロードマップ⑥〕の材料にする）。

## 決定事項

- **§11.3 常駐textarea原則を厳守**: グリッド生成時に1個だけ生成し破棄しない / `display:none`・`visibility:hidden`・ゼロサイズにしない / アクティブセル位置へ配置（IME候補ウィンドウ基準位置をセル近傍に保つ）/ Navigation中は値を空に / F2・ダブルクリック時だけ既存値を設定 / composition中に value・selection・DOM親を変更しない。
- **編集状態機械は §11.2 をそのまま採用**: Navigation / EditingReplace / EditingExisting / Composing / EditingAwaitFinalInput。§11.5 原則＝値の正は input 後の `textarea.value` / `keyCode === 229` 非依存（限定fallbackのみ）/ `isComposing`＋内部state併用 / IME確定Enter抑止は `suppressCommitUntilKeyup` 等の互換層で行う。**具体的な抑止条件は Phase 2 の実トレースで確認してから Phase 3 で確定する。**
- **リモート更新は §11.7/§10.4 準拠**: Canvas再描画は可・textareaのDOM/値/selectionは不変・編集中セルへのリモート書込はセル枠へ競合インジケーター表示（競合解決ダイアログはスコープ外）。
- **トレースは Appendix B `ImeEventTrace` 形式**（timestamp/browser/os/ime/state/eventType/key/code/isComposing/inputType/data/value/selection/activeCell）。保存先は `doc/DD/DD-002/traces/`（Phase 2 生トレース＝`traces/phase2-raw/`、Phase 6 受入＝`traces/phase6-acceptance/`）。
- **§11.9 禁止事項を DA・Codexレビューの必須観点とする**: 文字キー検出後の input 生成・focus / composition中の textarea 再マウント・value整形・サーバー値反映 / IME確定Enterの通常Enter扱い / セル移動ごとの別inputへのfocus移動。

### 試験対象環境（2026-07-11 ユーザー合意で確定。起票時「要確認」3点の回答）

1. **対象IME = Microsoft IME ＋ Google日本語入力の両方**。Google日本語入力が未導入ならユーザーがインストールして試験する前提で手順書を書く。
2. **対象ブラウザー = Chrome ＋ Edge の両方**（D-001 の最優先2ブラウザー）。
3. **macOS・Firefox は本PoCの判定対象外**（A-02/D-001 の次順位。§11.8 マトリクスの残り〔Firefox・macOS/Safari〕とともに Phase 0 後半以降へ送る）。

## 受け入れ基準

計画書 §18.1 合格条件をそのまま使う（1〜5 の判定主体は Phase 6 のユーザー実機試験）。
**「対象環境」= Windows 11 ＋ {Microsoft IME, Google日本語入力} × {Chrome, Edge}**（上記「試験対象環境」）。macOS・Firefox は対象外。

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | 対象環境で50回連続日本語入力 → 先頭文字欠落0件 | Phase 6 手動（手順書 手順A） |
| 2 | IME確定Enter → セル確定・移動しない（誤移動0件）。次のEnterで確定・下移動 | Phase 3 ユニットテスト＋Phase 6 手動（手順B） |
| 3 | 矢印・Enter・Shift+Enter・Tab・Shift+Tab 移動後に日本語再入力 → 成功率100% | Phase 3 ユニット＋Phase 5 E2E＋Phase 6 手動（手順C） |
| 4 | 変換中にCanvas再描画（シミュレーター連続書込）→ 変換中文字列の消失0件 | Phase 4 🔬スモーク＋Phase 6 手動（手順D） |
| 5 | 変換中に編集中セル・他セルへリモート更新 → ドラフト消失0件・競合インジケーター表示 | Phase 3 ユニット＋Phase 6 手動（手順E） |
| 6 | イベントトレースを保存し、再現手順を文書化 | Phase 2 生トレース採取＋Phase 5 手順書＋Phase 6 `traces/` 保存 |

## タスク一覧

### Phase 0: 事前精査
- [x] 📋 **各Phaseのタスク精査・詳細化**（受け入れ基準#1〜6 が各Phaseの検証タスクに対応することを確認済み。ファイルパス・🔬の有無 OK。2026-07-11 トレース先行方針への再構成に合わせPhaseをRe-map）
- [x] 📐 **実装前詳細化トリガー判定**: **Phase 1=要**（下記「Phase 1 詳細設計」で実施済み）／**Phase 2=要（軽）**（最小textarea＋recorder。新規モジュール）／**Phase 3=要**（DOM非依存状態機械＋§11.5互換層。実トレース確認後に詳細化）／**Phase 4=要**（simulator/scroll）／**Phase 5=要（軽）**（Playwright導入・E2E・手順書）／**Phase 6=不要**（ユーザー手動作業中心）
- [x] 🧪 **テスト設計（Red）**: §11.2 遷移・§11.4 操作・§11.5 原則・§11.7 リモート更新・確定Enter抑止・pendingNavigation を `doc/DD/DD-002/scenarios.md` に自然言語で作成済み（44シナリオ＋未確定Q-1〜5・仮決めユーザー合意済み）。**Phase 2 の実トレースで確定・調整してから Phase 3 でコード化**する（トレース先行方針）
- [x] 🧑‍⚖️ **Codexレビュー要否判定**: **必須**〔複雑な状態遷移＋TDD対象〕・effort: **high**〔xhighトリガー非該当〕で確定。実行は Phase 5 で全差分に1回
- [x] 😈 **Devil's Advocate調査**（下記「DA批判レビュー記録」#1〜5。§11.9 混入経路を重点確認）

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

### Phase 2: 最小常駐textarea＋生イベントrecorder（実トレース採取）★ユーザー実機ゲート1
> 目的は「状態機械を作る前に実挙動を採取する」こと。ここでは高度な制御（確定Enter抑止等）を入れず、**生イベントをそのまま記録**する。

#### Phase 2 詳細設計（📐 → モジュール境界・責務）

依存: `event-recorder`（DOM非依存・純粋関数＋ストア）← `resident-textarea`（DOMアダプタ）／`trace-panel`（DOM UI）← `main`（配線）。整形ロジックは event-recorder に集約し node 環境で単体テスト可能にする。

- **event-recorder.ts（UI非依存・DOMに一切触れない）**: `ImeEventTrace`（Appendix B 形式）/ `RecorderEventSnapshot`（DOMイベント＋textareaから抽出した構造的スナップショット）/ `RecorderContext`（環境・状態ラベル・activeCell）。`formatTrace()`＝イベント種別ごとに意味のあるフィールドだけを載せる純粋関数（keydown/keyup→key/code/isComposing、beforeinput/input→inputType/data/isComposing、composition→data、focus/blur/pointerdown→補足なし）。`detectEnvironment(ua)`＝browser/os 推定（Edge を Chrome より先に判定）。`createEventRecorder()`＝蓄積/getTraces/getRecent/size/clear/subscribe。将来 `sheet-editor-ime` へ移設しやすい。
- **resident-textarea.ts（DOMアダプタ・最小版）**: §11.3 準拠の textarea を1個生成しアクティブセルへ配置（transparent、編集中のみ白背景=paintのみ）。購読点＝textarea の compositionstart/update/end・beforeinput・input・keydown・keyup・focus・blur、および host（スクロールコンテナ）capture の pointerdown。**各リスナー冒頭（preventDefault より前）に record**（DA #5）。最小 commit/cancel のみ（Enter=確定+下／Tab=確定+右／Esc=取消／F2・dblclick=既存値編集／Delete=クリア）。**変換中（`event.isComposing`）は一切介入しない**（確定 Enter を通常 Enter 扱いしない・生挙動観察・§11.9 I-4）。状態機械・`suppressCommitUntilKeyup`・pendingNavigation・スクロール追従は入れない（Phase 3/4）。
- **trace-panel.ts（DOM UI）**: 直近 N 件を新しい順で表示（idx/state/event/detail/value）、件数、環境（UA・browser/os 自動・ime 手入力欄）、JSONエクスポート（`{meta, traces}` を `{ime}-{browser}.json` でダウンロード）、クリア。`getEnvironment()` を editor へ供給し record 文脈の環境にする。
- **main.ts**: recorder/editor/panel を生成・配線。keydown/IME 受け口を textarea 一本へ（`scroll.focus()`・`tabindex` 撤去・DA #3）。pointerdown→選択（変換中は移動しない）、dblclick→既存値編集。activeCell は main 保持（Phase 3 で machine へ一本化・DA #2）。

- [x] 📐 **実装前詳細化**（上記「Phase 2 詳細設計」に記載）
- [x] `apps/playground/src/ime/resident-textarea.ts`（新規・最小版）: §11.3 準拠の常駐textarea を1個生成しアクティブセル位置へ配置。直接入力/F2で編集開始・Enter/Escで最小 commit/cancel のみ（状態機械なし）。keydown/IME入力受け口をこの textarea 一本にし、Phase 1 の `scroll.focus()` を撤去（DA #3）
- [x] `apps/playground/src/ime/event-recorder.ts`（新規・UI非依存）: Appendix B `ImeEventTrace` 形式で compositionstart/update/end・beforeinput・input・keydown・keyup・focus・blur・pointerdown を記録。**preventDefault より前に記録**し、recorder 自身が入力挙動へ干渉しない（DA #5）
- [x] `apps/playground/src/ui/trace-panel.ts`（新規）＋ `index.html`: トレースの画面表示（直近件数）・JSONエクスポート（ダウンロード）・クリア・環境情報（UA）付与
- [x] 🔬 **機械検証（自動）**: `npm run test`（recorderの整形ユニット16件＝計49件 pass）/ `typecheck` / `lint` / `build` → green。dev-serve スモーク＝各モジュールが HTTP 200 で配信・変換OK。**対話スモーク（主セッション Playwright）実施済み**: セル選択→キー入力（x/y/Enter）で keydown/beforeinput/input/keyup が種別ごとに整形記録（16件）・state/value 追従・preventDefault前記録を確認。JSONエクスポートが `{meta, traces}`（Appendix B 全フィールド）の有効JSONを出力することを Blob 横取りで検証（下記ログ）
- [x] 📸 **エビデンス**: グリッド＋常駐textarea＋trace-panel のキャプチャ（`DD-002/phase2-recorder-smoke.png`。主セッション Playwright で取得・trace-panel を赤枠強調）
- [x] 😈 **DA批判レビュー**（recorderの取りこぼし・最小textareaのcommitがイベント観察を妨げないか → 下記記録 #6・#7）
- [ ] 🧑‍🔬 **ユーザー実機トレース採取（実機作業）**: 手順メモ `DD-002/phase2-trace-collection.md` に従い、Microsoft IME／Google日本語入力 × Chrome／Edge で代表操作（直接入力→変換→確定→移動→再入力／確定Enter／変換中クリック／変換中スクロール）の生トレースを `DD-002/traces/phase2-raw/` へ保存
- [ ] 📊 **トレース分析**: 確定Enterの発火順（順序A/B）・先頭文字挙動・composition境界のブラウザー/IME差を観察記録にまとめ、`scenarios.md`（特にQ-1〜5・S-D3/D5）へ反映 → **ユーザー確認**（テスト設計の確定＝guides.md §8）

### Phase 3: 編集状態機械（TDD）＋常駐textarea本統合
- [ ] 📐 **実装前詳細化**（Phase 2トレースを踏まえ、状態機械の入出力・§11.5互換層〔suppressCommitUntilKeyup 等〕の具体条件・activeCell所有権の machine 一本化〔DA #2〕を確定）
- [ ] **Red**: 確定済み `DD-002/scenarios.md` を `apps/playground/src/ime/editor-state-machine.test.ts`（新規）へコード化（synthetic composition/keyboard/input 列＝**実採取トレースを再生素材に使う**）→ 全件失敗を確認。S-D3（順序A）とS-D5（順序B）は必ず両方コード化（DA #1）
- [ ] **Green**: `apps/playground/src/ime/editor-state-machine.ts`（新規・DOM型非依存）: §11.2 の5状態と遷移、§11.5 原則（input後value正・keyCode 229非依存・isComposing＋内部state併用・`suppressCommitUntilKeyup` 互換層）、変換中クリックの pendingNavigation（§11.6）、リモート更新時 MarkConflictOnly（§11.7）を実装 → 全件成功
- [ ] `apps/playground/src/ime/resident-textarea.ts`（改修）: 最小版を状態機械と本統合（DOMイベント→状態機械入力への変換アダプタ・状態機械出力に応じた value/配置更新）
- [ ] `apps/playground/src/main.ts`: 状態機械の出力（編集開始・commit・cancel・移動・置換/既存値編集）を cell-store / navigation / grid-view へ配線（直接入力・F2・ダブルクリック・Escape・Delete を含む）
- [ ] **Refactor** + 🔬 **機械検証**: `npm run test` → 状態機械テスト全pass / `typecheck` / `lint` → green
- [ ] 😈 **DA批判レビュー**（§11.9 禁止事項への違反がないかを必須観点にする）

### Phase 4: リモート更新シミュレーター・スクロール追従
- [ ] `apps/playground/src/sim/remote-update-simulator.ts`（新規）: 「編集中セルへ書込」「他セルへ書込」「インターバル連続書込（再描画誘発）」操作 → cell-store 更新。§11.7 準拠（textarea不変・Canvas再描画・競合インジケーター表示）
- [ ] スクロール追従（§11.6）: コンテナスクロール時に textarea をセル位置へ再配置（composition中も value/selection/DOM は不変）。採用1方式（方式2）と残り2方式の比較メモを本DD検討内容へ追記
- [ ] 📸 **エビデンス**: シミュレーターUI＋競合インジケーター表示のキャプチャ（`DD-002/` へ配置）
- [ ] 🔬 **機械検証**: `npm run dev` → 変換中相当の編集中に他セル書込→編集値保持、連続書込で再描画されても draft 不変、スクロール追従をスモーク確認。`test`/`typecheck`/`lint` → green
- [ ] 😈 **DA批判レビュー**（シミュレーターと§11.7の乖離・スクロール中のtextarea座標ズレ）

### Phase 5: 基本操作E2E・手動試験手順書・Codexレビュー
- [ ] Playwright 導入（ルート devDependencies に `@playwright/test`・`apps/playground/e2e/`＋設定。vitest 対象と分離。ランタイム依存は追加しない。webServer は明示ポート＋strictPort でポート競合を避ける）
- [ ] `apps/playground/e2e/basic-operations.spec.ts`（新規）: クリック選択→矢印/Enter/Shift+Enter/Tab/Shift+Tab→直接入力で既存値置換→F2既存値編集→Escape取消→移動直後の再入力（受け入れ#3の自動分）
- [ ] `apps/playground/e2e/synthetic-composition.spec.ts`（新規）: synthetic composition 列の再生で状態遷移・確定Enter抑止をスモーク確認（実IMEの代替ではない旨をコメント明記）
- [ ] `doc/DD/DD-002/manual-ime-test-guide.md`（新規）: 実機手動試験手順書 — 環境情報の記録欄（OS/ブラウザー/IME各バージョン）、受け入れ基準1〜5の手順A〜E（操作・確認項目・回数）、トレースJSONの保存方法（`traces/phase6-acceptance/`）、観察項目（Backspace開始挙動・Alt+Enter・変換中クリック・変換中スクロール・長文変換・文節移動・再変換）
- [ ] 🔬 **機械検証**: E2E全pass ＋ `npm run test` / `typecheck` / `lint` / `build` → green
- [ ] 😈 **DA批判レビュー**（E2Eが実IME差を担保しない前提の確認・手順書だけで第三者が再現できるか）
- [ ] Codexレビュー自動実行（Phase 2〜5 の実装差分。依頼書 `DD-002/codex-review-request.md`〔目的・スコープ・§11.2/11.5/11.9 の設計意図・制約・**対象はDD-002実装差分のみ**を含める〕→ `bash scripts/codex-review.sh` → `DD-002/codex-review-result.md`。effort: high）
- [ ] Codexレビュー指摘への対応、または見送り理由をログに記録

### Phase 6: 実機受入試験・合格判定（ユーザー実機作業を含む）★ユーザー実機ゲート2
- [ ] ユーザーへ実機試験を依頼（Windows 11・手順書 `DD-002/manual-ime-test-guide.md` に従う。対象IME・ブラウザーは決定事項「試験対象環境」＝Microsoft IME／Google日本語入力 × Chrome／Edge）
- [ ] 試験結果の記録: トレースJSONを `doc/DD/DD-002/traces/phase6-acceptance/` へ保存し、環境情報・合否・不具合時の再現イベント列を手順書の記録欄へ記入
- [ ] 合格条件判定: 受け入れ基準表1〜6と照合して本DDへ記録。不合格項目はイベントトレースから原因分析→修正→再試験（本Phase内で反復）
- [ ] §11.4 の未確定挙動（Backspace のNavigation開始挙動・Alt+Enter のOS差・変換中スクロール方式）の観察結果と推奨を「決定事項」へ追記
- [ ] 🔬 **機械検証**: 最終 `npm run test` / `typecheck` / `lint` → green、`bash scripts/doc-check.sh` → エラー0
- [ ] 😈 **DA批判レビュー**（合格判定の根拠がトレースで再現可能か・「IMEが変」で片付けた項目がないか）

## ログ

### 2026-07-11
- DD作成（`doc/plan/phase0-dd-roadmap.md` ②「PoC-A 日本語IME」に対応。同ロードマップの実DD列に DD-002 を記入）
- Codex CLI 利用可否チェック: 利用可（codex-cli 0.144.0-alpha.4）→ 起票時暫定判定: 必須（複雑な状態遷移＋TDD対象）・effort high
- Playwright MCP: 起票エージェントからは利用可否を確認できず。実装Phase開始時に確認し、利用不可ならエビデンスは手動キャプチャで代替
- 要確認3点（IME/ブラウザー/対象外環境）→ 下記セッションでユーザー合意により確定

### 2026-07-11（Phase 0＋Phase 1 実装セッション）
- **ユーザー合意反映**: 起票時「要確認」3点を確定（IME=Microsoft＋Google両方／ブラウザー=Chrome＋Edge両方／macOS・Firefoxは対象外）
- **Phase 0 完了**: タスク精査・詳細化トリガー判定・Codex要否=必須/high確定・DA調査
- **テスト設計（scenarios.md）**: 編集状態機械の自然言語シナリオ44件を作成（A〜H・8カテゴリ）＋未確定Q-1〜5
- **Phase 1 実装**: `grid/{geometry,cell-store,navigation,grid-view}.ts`＋`main.ts`/`index.html`。ロジックはDOM非依存で分離、Canvas/配線のみDOM依存に隔離
- **機械検証**: `npm run test` 33 pass（新規29）／`typecheck` clean／`lint` clean／`build` 成功
- **Phase 1 目視スモーク（主セッション）**: Playwright MCP で playground を確認（グリッド描画・クリック選択・ArrowDown移動OK → `DD-002/phase1-grid-smoke.png`）。コンソールは favicon 404 のみ（想定内）

### 2026-07-11（スコープ改名・実装順変更）
- **パッケージスコープ改名**: `@spreadjs/*` → `@nanairo-sheet/*`（商用SpreadJSとの混同回避。decisions.md D-003。コミット済み。以降のimport/依存は `@nanairo-sheet/*`）
- **実装順の変更（ユーザー指摘）**: 状態機械を先に確定せず、**Phase 2 で最小常駐textarea＋生イベントrecorderを先に作り、実IMEトレースを短時間採取 → その結果で scenarios.md と状態機械を確定**する「トレース先行」へ再構成。旧Phase 2（状態機械TDD）は新Phase 3へ、旧Phase 3（recorder等）はrecorder部分を新Phase 2へ前倒し・simulator/scrollを新Phase 4へ、旧Phase 4（E2E/手順書/Codex）は新Phase 5、旧Phase 5（受入試験）は新Phase 6。受け入れ基準の検証Phaseと DA表のPhase参照も更新
- **プロセス方針（ユーザー指摘）**: 合意済みスコープ内の内部詳細は各Phaseで停止せず、DA・テスト・Codex通過で継続。停止は仕様・受け入れ基準・UX変更時とユーザー実機ゲート（Phase 2末のトレース確認・Phase 6受入）のみ
- **scenarios.md 合意**: 44シナリオ＋Q-1〜5を仮決めどおりユーザー合意（Q-1 Backspace=クリア後に空EditingReplace／Q-2 競合はマーク＋draft保持でcommit保留／Q-3 pendingNavigationは破棄／Q-4 非composing blur=commit／Q-5 スクロールは方式2先行）。ただしトレース先行方針により、**Phase 2の実トレースで最終確定**する

### 2026-07-11（Phase 2 実装セッション：最小常駐textarea＋生recorder）

- **実装（新規）**:
  - `apps/playground/src/ime/event-recorder.ts` — DOM非依存の生イベントレコーダー。`ImeEventTrace`（Appendix B 形式）・`formatTrace()`（種別ごとにフィールドを整形）・`detectEnvironment(ua)`・`createEventRecorder()`（蓄積/getRecent/clear/subscribe）。
  - `apps/playground/src/ime/resident-textarea.ts` — §11.3 準拠の最小常駐textarea（DOMアダプタ）。compositionstart/update/end・beforeinput・input・keydown・keyup・focus・blur・host capture の pointerdown を**受信直後（preventDefault前）に記録**。最小 commit/cancel のみ（Enter/Tab/Esc/F2/dblclick/Delete）。**変換中は一切介入しない**（生挙動観察）。状態機械・確定Enter抑止・pendingNavigation・スクロール追従は入れない（Phase 3/4）。
  - `apps/playground/src/ui/trace-panel.ts` — 直近トレース表示・JSONエクスポート（`{ime}-{browser}.json`）・クリア・環境情報（UA/browser/os自動・ime手入力）。
  - `apps/playground/src/ime/event-recorder.test.ts` — 整形ロジックのユニット16件（synthetic オブジェクト駆動・node）。
- **改修**: `main.ts`／`index.html` — recorder/editor/panel を配線。**`scroll.focus()`・`tabindex` を撤去し入力受け口を textarea 一本へ**（DA #3・§11.9 I-5）。`#grid-scroll` を `position:relative` にして textarea をセル追従の absolute 配置に。activeCell は main 保持（Phase 3 で machine へ一本化・DA #2）。
- **機械検証**: `npm run test` **49 pass**（新規16）／`typecheck` clean／`lint` clean（`console.log`・`any`・`as`不使用）／`build` 成功。dev-serve スモーク＝index.html・4モジュールが HTTP 200 で配信・TS変換OK。**対話目視（composition記録・JSONエクスポート）とスクリーンショットは主セッション Playwright 作業**（本エージェントに Playwright MCP なし＝手動キャプチャ要。📸未チェック）。
- **DA（#6/#7）**: recorder は全リスナー冒頭・preventDefault前に record／変換中は preventDefault しない（確定Enter生挙動を無改変で記録）／§11.5 監視対象を網羅購読（copy/cut/pasteはスコープ外）。取りこぼし最終目視は主セッションスモーク。
- **成果物**: 実機採取手順メモ `DD-002/phase2-trace-collection.md`、保存先 `DD-002/traces/phase2-raw/`（.gitkeep）を用意。
- **停止点（ユーザー実機ゲート1）**: ここで一旦戻る。次は**ユーザーが実機で生トレースを採取**（MS IME/Google × Chrome/Edge、手順メモ参照）→ `traces/phase2-raw/` へ保存 → 📊トレース分析で scenarios.md 確定 → Phase 3（状態機械 TDD）。Phase 3 へは進めていない。
- **コミット**: 本セッションでは行っていない（主セッションでユーザー確認後）。

### 2026-07-11（Phase 2 対話スモーク・エビデンス / 主セッション）
- Playwright MCP で playground（:5173）を開き、実装エージェントが委譲した対話スモークを実施:
  - セル選択 → キー入力（x/y/Enter）で **keydown/beforeinput/input/keyup が種別ごとに整形記録**（16件）・state（Navigation/Editing）・value 追従・**preventDefault前記録**を確認
  - **JSONエクスポート**を Blob 横取りで検証 → `{meta:{browser,os,ime,userAgent,exportedAt,traceCount}, traces:[…]}` の有効JSON、各 trace は Appendix B 全フィールド（timestamp/browser/os/ime/state/eventType/value/selection/activeCell）
  - エビデンス `DD-002/phase2-recorder-smoke.png`（trace-panel を赤枠強調）取得 → 📸完了
- コンソールエラーは favicon 404（想定内）と、検証で `URL.createObjectURL` をモックしたことによる `blob:mock` 拒否（＝スモーク由来。実挙動では実blob URLで正常DL）の2件のみ。**実バグなし**
- DA #7（recorder取りこぼし最終目視）・#6（commitが観察を妨げないか）を本スモークで確認済み。Phase 2 の主セッション作業完了 → ユーザー実機トレース採取（ゲート1）へ

---

## DA批判レビュー記録

> 手順・品質フィルター・再チェック条件は `doc/da-method.md` を参照。

### 共通DA観点（全Phase必須）

**§11.9 禁止事項への違反混入**（composition中の再マウント・value変更・サーバー値反映 / 確定Enterの通常Enter扱い / keydownでの文字推測 / セル移動ごとのfocus付け替え）と、**recorder自身が入力挙動へ干渉していないか**を毎Phaseで確認する。

| # | Phase | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------|-------------------|--------|----------------------|--------|------|
| 1 | 0/3 | 確定Enter抑止はブラウザーで発火順が2通り（順序A: Enterがcomposing中／順序B: compositionend後にEnter）。片方だけテスト化すると他方のブラウザー差で受け入れ#2が漏れる | 高（運用ルール） | S-D3(順序A)とS-D5(順序B)を両方 synthetic 列で再生／実IMEは Phase 6 | 将来脆弱性・§11.9 I-4 | **Phase 3 で S-D3 と S-D5 を必ず両方コード化**（`suppressCommitUntilKeyup` の keyup 解除まで検証）。発火順は Phase 2 実トレースで確認。運用ルールとして本表に固定 |
| 2 | 0/3 | activeCell の所有権が Phase 1 は main、Phase 3 は編集状態機械（Move/MoveTo 出力）に跨る。二重管理すると commit 後の移動先がズレる | 中 | Phase 3 で machine が MoveTo を出す一方 main も activeCell を更新すると競合 | 依存関係の波及 | scenarios を「machine が Move/MoveTo を出す・main は反映のみ」で設計済み。**Phase 3 詳細化で activeCell を machine 出力へ一本化** |
| 3 | 0/2 | Phase 1 の keydown 受け口は `#grid-scroll`（tabindex）。常駐 textarea 導入時に移行しないと、二重フォーカス／§11.9 I-5「セル移動ごとに別inputへfocus」違反になりうる | 中 | textarea 追加後も scroll.focus() が残ると入力受け口が2系統 | 将来脆弱性・§11.9 I-5 | **Phase 2 で keydown/IME を常駐 textarea 一本へ移し `scroll.focus()` を撤去**（最小textareaタスクのチェック項目） |
| 4 | 0/5 | Codex は Phase 5 で全差分1回の予定。状態機械が肥大化するとレビュー粒度が粗くなる | Info | — | スコープ判断 | 現状は枠節約優先で Phase 5 一括。Phase 3 が想定超に膨らんだ場合のみ中間 Codex を検討 |
| 5 | 0/2 | 生イベントrecorderが `preventDefault` 後に記録すると、抑止されたキーやブラウザー既定挙動が観察できず、トレース先行の目的（実挙動採取）を損なう | 中 | Phase 2 で recorder を preventDefault の後段に置くと確定Enterの生挙動が採れない | テストのための実装・観察妥当性 | **Phase 2 で recorder はイベント受信直後（preventDefault前）に記録**。最小textareaは生挙動を極力変えない（commit最小化）。recorderタスクのチェック項目 → **Phase 2 実装で担保済**（#6） |
| 6 | 2 | 最小 textarea の commit（Enter/Tab の preventDefault）がイベント順・生挙動を変え、確定Enterの観察を妨げないか | 中 | dev で確定Enter → keydown記録→commit の順、変換中Enterで移動しないことを確認 | テストのための実装・観察妥当性 | record を全リスナー冒頭（preventDefault前）で実行（コードで担保）。**変換中（`event.isComposing`）は preventDefault しない**ため確定Enterの生挙動は無改変で記録される。commit は非composingの Enter/Tab のみ（その生キー列も記録済み）。順序B環境で確定Enterが下移動しうるのは既知・観察対象（手順メモに明記） |
| 7 | 2 | recorder の取りこぼし（§11.5 監視対象の記録漏れ）で実挙動確定を損なう | 中 | dev で composition→input→keydown 列が漏れなく並ぶか（主セッション Playwright スモーク） | 観察妥当性・回帰 | compositionstart/update/end・beforeinput・input・keydown・keyup・focus・blur・pointerdown を購読（§11.5 準拠）。copy/cut/paste は本Phaseスコープ外（検討内容の scope-out）。整形の網羅は `event-recorder.test.ts`（16件）で検証。取りこぼし最終目視は主セッション Playwright スモークで確認 |
