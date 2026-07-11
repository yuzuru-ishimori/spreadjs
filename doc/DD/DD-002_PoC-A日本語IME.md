# DD-002: PoC-A日本語IME

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-11 | 2026-07-11 | 進行中 | Phase 3-5実装＋dev目視で実行時バグ2件修正・エビデンス取得。E2E保留・実機IME検証はPhase 6 |

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
- **変換中スクロール（§11.6・方式2採用の比較メモ／Phase 4確定）**: 3方式を比較し、PoCは**方式2（textareaをセルへ位置追従）**を採用した。
  - **方式1（編集セルを画面内へクランプ）**: スクロールしても編集セルを常に可視域へ引き戻す。実装は重く、ユーザーのスクロール意図を奪う（見たい別セルを見られない）。変換中の強制スクロールはIMEを乱す恐れ。→不採用。
  - **方式2（textareaをセルへ追従・採用）**: textareaは`#grid-scroll`（position:relative）内の絶対配置で、cellRectのコンテンツ座標に置くためスクロールでCanvasと一体に動く（CSSで自然追従）。`scroll`イベントで位置のみ再アサート（`followScroll`）。**value/selection/DOM親は不変**（I-3）で変換を壊さず、強制blur/commitもしない。実装が最軽量でブラウザー差が最小。
  - **方式3（編集セルをoverlayへ固定表示）**: スクロールは自由だが編集セルだけ別レイヤーで固定。座標の二重管理・zIndex/クリップ処理が増え、候補ウィンドウ基準位置がずれやすい。→過剰。
  - 実機での追従精度・変換中スクロール時の候補ウィンドウ挙動はPhase 6手順書§8で観察する。
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

### Phase 2: 最小常駐textarea＋生イベントrecorder（トレース採取土台）
> 目的は「状態機械を作る前に実挙動の土台を用意する」こと。高度な制御（確定Enter抑止等）を入れず**生イベントをそのまま記録**する。
> 実機の実IMEはClaude/Playwrightで採取できないため（下記）、Phase 3の種は**合成リファレンス＋scenarios.md**とし、実機の実IME検証はPhase 6へ委譲する（2026-07-11 ユーザー選択）。

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
- [x] 🧪 **合成リファレンス生成（2026-07-11 ユーザー選択）**: 実機の実IMEはClaude/Playwrightで採取不可（Playwrightは`insertText`でOS IMEを通らない）と確定。代替として計画書§11.5準拠の合成リファレンストレースを `DD-002/traces/synthetic-reference/` に生成（orderA=確定Enterがcomposition中／orderB=compositionend後／direct-input=確定の次Enterで移動）。**実機の実IME検証はPhase 6受入試験へ委譲**（合格条件1〜5は実機で判定）。合成は明確にラベル（`meta.ime: SYNTHETIC…`）し実機用 `phase2-raw/` と分離
- [ ] 🧑‍🔬 **（任意・後日）ユーザー実機トレース採取**: 余力があれば手順メモ `DD-002/phase2-trace-collection.md` に従い実機4環境（MS IME/Google × Chrome/Edge）を `traces/phase2-raw/` へ採取するとR-01の実挙動が早期に確定できる。未採取でもPhase 3は合成リファレンス＋scenarios.mdで進め、Phase 6で実機確定する
- [x] 📊 **トレース分析（方針確定）**: scenarios.md の Q-1〜5・S-D3/D5 は仮決めどおり確定済み（ユーザー合意）。確定Enterの順序A/B差は合成リファレンスで表現し、Phase 3 で両方コード化（DA #1）。実機での順序差・Chrome/Edge差・Google固有差はPhase 6で確認する（scenarios.md変更が要る差異が出たらそこで反映）

### Phase 3: 編集状態機械（TDD）＋常駐textarea本統合
- [x] 📐 **実装前詳細化**（状態機械の入出力〔`EditorEvent`/`Effect`〕・§11.5互換層〔`suppressCommitUntilKeyup`＝compositionend時セット・keyup{Enter}で解除〕・composition取消/確定の判別〔`escapePressedDuringComposition`〕・activeCell所有権の machine 一本化〔DA #2〕を確定）
- [x] **Red→Green**: `apps/playground/src/ime/editor-state-machine.test.ts`（新規・44シナリオ＋順序A/B/direct再生＝計47件）へ scenarios.md をコード化。S-D3（順序A）とS-D5（順序B）を両方コード化（DA #1）。合成リファレンス3本と同一イベント列をインライン再生素材にした（playground tsconfigは`types:[]`でnode型を含まないためファイル読込ではなくインライン化）
- [x] **Green**: `apps/playground/src/ime/editor-state-machine.ts`（新規・DOM型非依存）: §11.2 の5状態と遷移、§11.5 原則（input後value正・keyCode 229/key"Process"非依存・isComposing＋内部state併用・`suppressCommitUntilKeyup` 互換層）、変換中クリックの pendingNavigation（§11.6・Q-3破棄）、リモート更新時 MarkConflictOnly（§11.7）、Q-1 Backspace/Q-4 blur=commit を実装 → 47件 pass
- [x] `apps/playground/src/ime/resident-textarea.ts`（改修）: 最小版の暫定commit/cancelを廃し状態機械と本統合（DOMイベント→`EditorEvent`変換・`Effect`適用〔applyEffect/reconcile〕・activeCell所有権を machine へ一本化）
- [x] `apps/playground/src/main.ts`: activeCell/競合を`editor.getActiveCell()/getConflictCells()`から読む配線へ変更。pointerdown/dblclickを`editor.pointerdownCell/doubleClickCell`へ委譲（変換中判定・commit・pendingNavigationは状態機械が担う）
- [x] **Refactor** + 🔬 **機械検証**: `npm run test`（**102件 pass**・状態機械47件）／`typecheck`／`lint`／`build` → green
- [x] 😈 **DA批判レビュー**（§11.9 全7項目を確認＝下記記録 #8。文字キー後input生成なし／composition中の再マウント・value整形・サーバー値反映なし／確定Enter通常扱いなし／focus付け替えなし）

### Phase 4: リモート更新シミュレーター・スクロール追従
- [x] `apps/playground/src/sim/remote-update-simulator.ts`（新規）: 「編集中セルへ書込」「他セルへ書込」「インターバル連続書込（再描画誘発）」操作 → `editor.applyRemoteUpdate` 経由で cell-store 更新。§11.7 準拠（textarea不変・Canvas再描画・競合インジケーター表示）。セル選択は純粋関数 `pickDistinctCell` に分離しユニットテスト（`remote-update-simulator.test.ts`＝6件）
- [x] スクロール追従（§11.6・方式2）: `resident-textarea.ts` の `followScroll` を host の scroll に配線。位置のみ再配置（composition中も value/selection/DOM は不変・I-3）。3方式の比較メモを本DD検討内容へ追記済み
- [x] `apps/playground/index.html`／`main.ts`: シミュレーターUI（編集中セルへ書込／他セルへ書込／連続書込 開始・停止）を追加・配線
- [x] 📸 **エビデンス**: シミュレーターUI＋競合インジケーター表示のキャプチャ（`DD-002/phase3-4-statemachine-conflict-smoke.png`。主セッション Playwright で取得＝編集中セル "abc" に赤の競合枠・ドラフト保持）
- [x] 🔬 **機械検証（自動分）**: `test`（103件）／`typecheck`／`lint`／`build` → green。**主セッション dev目視スモーク実施**: クリック→入力→編集開始、Enter確定＋下移動、編集セルへリモート更新→ドラフト保持＋赤枠（§11.7）を確認（下記ログ）。2件の実行時バグを発見・修正（TDZ初期化・クリック時フォーカス喪失）
- [x] 😈 **DA批判レビュー**（下記記録 #9。シミュレーターは必ず `applyRemoteUpdate` 経由で§11.7契約を維持／`followScroll` はコンテンツ座標で座標ズレなし・位置のみ変更）

### Phase 5: 基本操作E2E・手動試験手順書・Codexレビュー
- [ ] Playwright 導入（ルート devDependencies に `@playwright/test`・`apps/playground/e2e/`＋設定。vitest 対象と分離。ランタイム依存は追加しない。webServer は明示ポート＋strictPort でポート競合を避ける）**※保留: 並行セッション（DD-003）のnpm install競合回避のため今夜は実装しない。主セッションが後で実施**
- [ ] `apps/playground/e2e/basic-operations.spec.ts`（新規）: クリック選択→矢印/Enter/Shift+Enter/Tab/Shift+Tab→直接入力で既存値置換→F2既存値編集→Escape取消→移動直後の再入力（受け入れ#3の自動分）**※E2E保留（上記）**
- [ ] `apps/playground/e2e/synthetic-composition.spec.ts`（新規）: synthetic composition 列の再生で状態遷移・確定Enter抑止をスモーク確認（実IMEの代替ではない旨をコメント明記）**※E2E保留（上記）**
- [x] `doc/DD/DD-002/manual-ime-test-guide.md`（新規）: 実機手動試験手順書 — 環境情報の記録欄（OS/ブラウザー/IME各バージョン）、受け入れ基準1〜5の手順A〜E（操作・確認項目・回数）、トレースJSONの保存方法（`traces/phase6-acceptance/`）、観察項目（Backspace開始挙動・Alt+Enter・変換中クリック・変換中スクロール・長文変換・文節移動・再変換）
- [x] 🔬 **機械検証（E2E以外）**: `npm run test`（102件）/ `typecheck` / `lint` / `build` → green。**※E2E全passは保留（Playwright未導入）**
- [x] 😈 **DA批判レビュー**（手順書だけで第三者が再現できるか＝手順A〜Eに操作/確認/回数/保存先を明記済み。E2Eが実IME差を担保しない前提の確認はE2E実装時＝主セッションへ委譲）
- [x] Codexレビュー自動実行（依頼書 `DD-002/codex-review-request.md`〔目的・スコープ・§11.2/11.5/11.9 の設計意図・制約・**対象はDD-002のapps/playground実装差分のみ**〕→ `bash scripts/codex-review.sh --uncommitted --effort high` → `DD-002/codex-review-result.md`）
- [x] Codexレビュー指摘への対応、または見送り理由をログに記録（下記ログ参照）

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
- DA #7（recorder取りこぼし最終目視）・#6（commitが観察を妨げないか）を本スモークで確認済み。

### 2026-07-11（合成リファレンス生成・トレース方針確定 / 主セッション）
- **実機IME採取の可否をユーザーに提示**: Claude/Playwrightはブラウザに`insertText`で直接挿入するためOSの実IME（MS IME/Google日本語入力）を通らず、本物のcomposition/isComposingを再現不可（§11.8/§20.5）。実機4環境の採取と6観点（順序A/B・Chrome/Edge差・最終input遅延・Google固有差）は実機でのみ判定可能と説明
- **ユーザー選択 = 「合成リファレンス生成＋Phase 3着手」**: 実機の実IME検証はPhase 6受入試験へ委譲し、Phase 3は合成リファレンス＋scenarios.mdを種に進める
- **合成リファレンス生成**: `DD-002/traces/synthetic-reference/` に3本＋README。orderA（確定Enterがcomposition中・isComposing:true）／orderB（compositionend後・isComposing:false＝最小版では下移動しうる＝抑止対象）／direct-input（確定の次Enterで下移動＝受け入れ#2）。全て `meta.ime: SYNTHETIC…` と明記し実機用`phase2-raw/`と分離。JSON整合を検証（7/7/9件）
- recorderのcomposition整形はユニット16件で検証済みのためツールは実機採取可能状態。実機採取（`phase2-raw/`）は任意・後日でも可（未採取でもPhase 6で実機確定）
- 次: Phase 3（編集状態機械 TDD）へ着手。順序A/B両方をコード化（DA #1）

### 2026-07-11（Phase 3-5実装セッション：状態機械TDD・シミュレーター・手順書・Codex）

> ユーザー就寝中・合意済みスコープ（Phase 3〜5、E2E除く）を自律実行。並行セッション（DD-003）と衝突回避のため編集は `apps/playground/**` と `doc/DD/DD-002/**` のみ、`npm install`・`git`・`packages/**`・`collaboration-server` に一切触れず。

- **Phase 3（編集状態機械 TDD ＋ 常駐textarea本統合）**:
  - `apps/playground/src/ime/editor-state-machine.ts`（新規・**DOM型非依存**）— §11.2 の5状態を実装。入力=`EditorEvent`、出力=`Effect`。§11.5 原則（input後value正・keyCode229/"Process"非依存・isComposing＋内部フラグ併用）。**確定Enter抑止は順序A（composing中Enter→SuppressKey）と順序B（compositionend時 `suppressCommitUntilKeyup`）の両方**（DA #1）。pendingNavigation（§11.6・Q-3破棄）、MarkConflictOnly（§11.7）、Q-1 Backspace＝空EditingReplace、Q-4 非composing blur＝commit。composition取消/確定の判別に `escapePressedDuringComposition` を導入（変換中Escape→compositionend{""}を取消扱いにして誤commit回避＝S-D10/11/E4）。
  - `apps/playground/src/ime/editor-state-machine.test.ts`（新規）— scenarios.md の44シナリオ（A〜H）をコード化＋合成リファレンス3本（orderA/orderB/direct-input）と同一イベント列をインライン再生。playground tsconfigは`types:[]`でnode型を含まないためファイル読込でなくインライン化（同一データ）。
  - `resident-textarea.ts` を状態機械と本統合（最小版の暫定commit/cancelを廃止）。DOMイベント→`EditorEvent`変換→`machine.dispatch`→`applyEffect`/`reconcile`。keydownは `effects.length>0` で preventDefault。activeCell所有権を machine へ一本化（DA #2）。
  - `main.ts` — activeCell/競合を `editor.getActiveCell()/getConflictCells()` から読む配線へ。pointerdown/dblclickを `editor.pointerdownCell/doubleClickCell` へ委譲。
- **Phase 4（リモート更新シミュレーター・スクロール追従）**:
  - `apps/playground/src/sim/remote-update-simulator.ts`（新規）＋テスト— 編集中/他セル/連続書込。書込は必ず `editor.applyRemoteUpdate` 経由で §11.7 契約（textarea/draft不変・編集中セルは競合マークのみ）を維持。選択ロジックは純粋関数 `pickDistinctCell` に分離しユニット検証。
  - スクロール追従（§11.6 **方式2**）— `followScroll` を host の scroll に配線。cellRect（スクロール非依存座標）で位置のみ再設定（I-3）。3方式比較メモを「検討内容」へ追記。
  - `index.html`／`main.ts` — シミュレーターUI（3ボタン＋状態表示）を追加・配線。
- **Phase 5（E2E以外）**:
  - `manual-ime-test-guide.md`（新規）— 実機手動試験手順書（4環境記録欄・受け入れ1〜5の手順A〜E・`traces/phase6-acceptance/` 保存・観察項目・確定Enter順序A/B比較表・合否まとめ）。
  - **E2E（basic-operations / synthetic-composition）は保留**＝並行セッション（DD-003）の `npm install`（hono/ws）と `@playwright/test` 導入が package-lock 競合を起こすため。該当タスク `[ ]` のまま「主セッションが後で実施」と注記。
- **機械検証**: `apps/playground` の `npm run test` **103件 pass**（状態機械52＝44シナリオ＋Codex回帰5＋再生3、simulator6、recorder16、grid29）／`typecheck`／`lint`（`any`/`as`/`!`/`console`不使用）／`build` すべて green。※`npm run test`（全体）は DD-003 の未完成 `packages/sheet-core/*.test.ts`（`./apply` 未作成）が2ファイル load 失敗するが**本DDの範囲外**（packages は DD-003 所有・不介入）。dev目視スモークとスクショ📸は主セッション（Playwright MCPなし）へ委譲＝Phase 4📸は `[ ]` のまま。
- **Codexレビュー（effort high・`--uncommitted`）**: 依頼書で対象を DD-002 の apps/playground 差分に限定（DD-003 は対象外と明記）。findings **5件**（P1×4・P2×1）を全て妥当と判断し**あなた（実装側）が修正**:
  1. **[P1] I-2 違反**（editor-state-machine.ts）: 変換中判定が内部フラグ/phaseのみで `event.isComposing` を見ていなかった。イベント順差で内部フラグ未設定でも `isComposing:true` の Enter が通常移動になりうる。→ 変換中ガードに `event.isComposing` を追加。回帰テスト追加。
  2. **[P1] 抑止窓が広すぎ**（同）: `suppressCommitUntilKeyup` が全 compositionend で無条件に立ち、マウス確定/フォーカス変更後の正規 Enter を飲む恐れ。→ 抑止した Enter で self-clear ＋ 任意 keyup / pointerdown / blur / focus / 非Enter keydown で解除し窓を最小化。回帰テスト追加。※完全なマウス確定直後Enterの識別は timing 依存で残余（Phase 6で実機調整）。
  3. **[P1] 最終input前blurの暫定commit**（同）: `compositionend→blur→input` の順で暫定値（base+data）を commit し、後続の確定 input が Navigation で宙に浮き I-1 違反。→ `EditingAwaitFinalInput` 中の blur は `blurPendingCommit` で保留し、最終 input の確定値で commit。回帰テスト（暫定と異なる最終値で検証）追加。
  4. **[P1] 競合中ダブルクリックで draft 破棄**（同）: 競合中に別セルをダブルクリックすると Commit を飛ばしたまま既存値編集へ遷移し、draft と競合フラグが黙って消える（S-F5 迂回）。→ 競合中のダブルクリックは無視（破棄しない）。回帰テスト追加。
  5. **[P2] シミュレーター操作前の blur**（main.ts）: ボタンの既定フォーカス移動で textarea が blur し、変換中リモート更新（§11.7・#4/#5）を検証できない。→ 各ボタンの `mousedown` を preventDefault してフォーカスを保持。
  - 見送り findings: なし（全件対応）。修正後 `test`（103件）/`typecheck`/`lint`/`build` 再 green。
- **DA（#8/#9）**: §11.9 全7項目クリア（#8）。シミュレーターの§11.7契約維持・followScroll座標ズレなし（#9）。
- **停止・要判断**: なし（合意済みスコープ内で完走。仕様・受け入れ基準・UXの変更は不要）。
- **コミット**: 本セッションでは行っていない（`git` 不実行。主セッションがスコープ指定でコミット）。

### 2026-07-11（Phase 3-4 dev目視スモーク・実行時バグ2件修正 / 主セッション）
- 主セッションで `npm run dev`（:5176）を開き Playwright MCP で目視スモーク。ユニットテスト（103件）は green だが**DOM配線順の実行時バグを2件発見・修正**（テストが検証しない領域＝dev目視の価値）:
  1. **[実行時バグ] TDZ 初期化エラー**（`resident-textarea.ts`）: `createResidentEditor` 構築中の初期 `focus()` が DOM focus リスナー→`applyEffects`→`onViewChange`→main の `render()` を同期発火させ、まだ代入前の `const editor` を参照して `ReferenceError: Cannot access 'editor' before initialization`＝**アプリがロード時に落ちる**。→ `initialized` フラグを追加し、構築完了までは `applyEffects` が `onViewChange` を呼ばないよう修正（初期描画は main が明示実行）。
  2. **[実行時バグ] クリック時フォーカス喪失**（`main.ts`）: canvas は非フォーカス要素のため、セルクリックの mousedown 既定動作でフォーカスが body へ移り、pointerdown の `focus()` が打ち消され**「クリック後に入力」（§11.4）ができない**（activeElement=BODY）。→ canvas の `mousedown` を preventDefault して textarea フォーカスを保持（Codex #5 と同型）。
- **修正後の目視確認（green）**: (a) ロード時エラー0。(b) セルクリック→直接入力 "abc" で編集開始（白背景・Editing）。(c) Enter で確定＋下移動（textarea 空・透明・top +28px・フォーカス維持）。(d) 編集中セルへリモート更新（sim-active）→**ドラフト "abc" 保持＋赤枠競合インジケーター**（§11.7 MarkConflictOnly・受け入れ#5の中核ロジック。※実IME composition ではなく ASCII での検証）。エビデンス `DD-002/phase3-4-statemachine-conflict-smoke.png`。
- 修正後 `apps/playground` スコープで `test` 103 pass／`typecheck`／`lint` 再 green。
- **回帰カバレッジのメモ**: 2件は DOM/ブラウザー統合バグでユニット（node）では検出困難。保留中の Phase 5 E2E（Playwright）に「ロード時エラー0」「クリック→入力」を回帰として必ず含める（E2E実装時のTODO・下記DA #10）。

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
| 8 | 3 | §11.9 禁止事項の混入（状態機械統合で最も起きやすい） | 高 | `resident-textarea.ts` の applyEffect/reconcile/followScroll を精査 | §11.9 全項目 | 全7項目クリアを確認: ①編集開始は `input`/`compositionstart` 起点で keydown文字推測なし ②composition中は place() が return し再マウント/位置変更なし ③UpdateDraft は DOM 無操作・reconcile は composing 中 value を触らない（value整形なし）④applyRemoteUpdate は store のみ・textarea へサーバー値を入れない ⑤確定Enterは composing/suppress で SuppressKey（通常Enter扱いなし）⑥textarea 1個を destroy まで保持・focus 付け替えなし ⑦React 不使用・値の正は textarea.value。テスト47件で遷移を固定 |
| 9 | 4 | シミュレーターが §11.7 契約を破る／スクロール追従で座標ズレ | 中 | simulator は store 直書きせず editor.applyRemoteUpdate 経由か・followScroll が composition を壊さないか | §11.7・I-3・回帰 | simulator は `RemoteUpdateSink.applyRemoteUpdate` のみを呼び、store反映+MarkConflictは editor/machine が一元処理（§11.7 の textarea不変・競合マークのみが保たれる）。`followScroll` は cellRect（スクロール非依存のコンテンツ座標）で left/top/width/height のみ再設定＝座標ズレなし・value/selection/DOM不変（I-3）。連続書込中も draft 不変は S-F4 テストで担保 |
| 10 | 3/4 | ユニット（node）が DOM 配線順・ブラウザー既定挙動を検証せず、実行時バグ（TDZ初期化・クリック時フォーカス喪失）が緑テストをすり抜けた | 高 | 主セッション dev目視で発見（本ログ参照）。①ロード時 `ReferenceError` ②クリック後 activeElement=BODY で入力不可 | テスト盲点・回帰 | 2件とも修正済み（initialized フラグ／canvas mousedown preventDefault）。**保留中の Phase 5 E2E に必須回帰を追加**: (a) ページロードでコンソールエラー0（未捕捉例外なし）(b) セルをクリック→printable入力で編集開始（activeElement=textarea・白背景）。E2E導入時のTODOとして固定 |
