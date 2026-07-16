# DD-020-2: clipboard copy/cut/paste

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-16 | 2026-07-17 | 完了 | AC1〜10 充足・Codex high 2件（P2 反映/P1 既存境界）。chokepoint=`submitSetCells`。実機統合は親 Phase 4（アーカイブは親完了時） |

```text
Risk Class: A
Risk Triggers: 貼り付けの原子性・OCC（並行処理＝競合時の全体 reject でサイレント上書き防止が本丸）／外部入力の解析（TSV parser=入力検証・fuzz 対象）／利用者データ喪失の可能性（ペースト内容・既存セル値）／公開エラー/競合語彙の追加（外部I/F）／常駐 textarea の ClipboardEvent 配線（IME 周辺・I-3 維持）
Human Spec Gate: 解決済（親 DD-020 要確認①②④⑤確定=2026-07-16 フル委譲モード。テストシナリオ合意はオーケストレータ確認で代替）
Codex: high（必須・TDD 対象ゆえ原則必須。SetCells 既存型のまま・OCC は既存 validator 利用・永続化/状態機械の実質変更なし=xhigh 非該当。protocol 変更が生じたら停止して xhigh へ昇格=親ヘッダ条項）
Manual Gate: なし（本子DDは synthetic E2E まで。実 Excel ⇄ グリッド round-trip=親 Phase 4 M1/M2・実 IME=M3）
External Review: なし
Evidence Level: full（A区分=L5。OCC 競合マトリクス・TSV fixture 一覧・再現コマンド・既知の未保証境界を省略しない）
```

> アプローチ: TDD（parser・型変換・原子性・OCC=正解が明確）＋E2E（clipboard round-trip・standalone 契約）
> 親=**DD-020**。依存: **DD-020-1 完了**（選択レンジ読み取り・`range-ops`・上限語彙を利用）。後続: **DD-020-3**（本子DDが確定単位 chokepoint を引き渡す）。

## 目的

外部アプリ（Excel 等）⇄ グリッド間・グリッド内の copy/cut/paste を提供する。TSV parser・型変換（`parseCellInput` 委譲）・**原子的 SetCells**（全成功/全失敗）＋OCC（beforeRevision 照合）・上限・敷き詰め・公開エラー語彙まで一貫して実装する。

## 背景・課題（親 DD-020 §背景の該当分）

- clipboard parser・copy/paste イベント処理は未実装（`packages/ime/src/editor-state-machine.ts` の EditorEvent に paste/copy 種別なし）。計画書 §11.5 は copy/cut/paste を常駐 textarea の監視対象、§11.2 は「Navigation の paste → Command execution」と定義。
- `SetCellsOperation`（原子・I-5・beforeRevision セル単位）・`validateSetCells`（stale-cell-revision 全件列挙）・`parseCellInput`（型変換正本）・rejected 通知経路（ClientSession Conflict Queue → GridEvent `rejected`）は既存資産。
- cell-commit 通知（DD-024・standalone）は SetCells batch 単位（`GridCellCommitChange[]`）で複数セル対応済み＝paste は既存契約のまま通知できる。
- 性能: 10,000 セル paste ローカル適用 250〜500ms（計画書 §21）。計測は親 Phase 4。

## 検討内容

- **parser 配置**: `packages/core/src/clipboard-text.ts` 新設（純関数・依存ゼロ・fuzz 可能。計画書 §20.1「clipboard TSV parser」）。
- **TSV 読み取り受理仕様**: タブ区切り・行区切り CRLF/LF 両対応・末尾改行1個は行にしない・`"` 引用セル（引用内の改行/タブ/`""` エスケープを保持）・非引用セルは素通し。**不整合列数**（手書きテキスト等）: 行ごとの列数のまま受け、貼り付けは最大列数×行数の矩形のうち**欠けセルは変更対象に含めない**（skip・空文字で上書きしない）＝既定案 (d)。
- **fixture**: Excel 系が書く text/plain の実ペイロード（数値/日付/セル内改行/空セル/末尾タブ/巨大文字列）を `doc/DD/DD-020-2/fixtures/` へ書き起こし、unit＋fuzz（引用・改行・巨大文字列=計画書 §20.2）で検証。
- **書き出し（serializer）**: 改行/タブ/`"` を含むセルのみ `"` 引用。値は**表示文字列**（cell-commit の value と同じ round-trip 規約）。serialize→parse round-trip を property test で担保。
- **イベント経路**: **ClipboardEvent（copy/cut/paste の clipboardData）を主経路**とする＝`setData`/`getData` は同期・権限プロンプト不要（常駐 textarea にフォーカスがあるため Ctrl+C/V/X はそこで発火する）。`navigator.clipboard` API は使わない（権限 UX・非同期の複雑さ回避）。E2E は Playwright の実キー入力（Ctrl+C/V）＋`grantPermissions(['clipboard-read','clipboard-write'])` での実 clipboard 検証と、fixture 注入（合成 ClipboardEvent）の2系統。
- **位相裁定（親 D5）**: **Navigation 位相のみ** Command 化。Editing/Composing 位相の copy/cut/paste はブラウザ既定動作（textarea 内テキスト編集）へ任せ、composition 中の value/selection に介入しない（I-3）。editor-state-machine へは `getPhase()` 問い合わせのみ・遷移追加なし。
- **paste フロー**: paste イベント → `text/plain` 取得 → parse → 敷き詰め判定（**matrix 1×1 かつ複数セル選択 → 選択範囲全体へ敷き詰め**／それ以外 → 選択左上アンカーから matrix サイズ）→ 範囲検査（行/列端はみ出し=**全体拒否**・**上限 100,000 セル超=実行前拒否**）→ 各セル `parseCellInput` で型変換 → SetCells 生成（beforeRevision=**paste 実行時点の committed lastChangedRevision**・未書込=0）→ `submitLocalOperation`。競合 reject は既存 rejected 経路（ペースト内容は clipboard に残存するため退避 UI は作らない=親 D2/D4）。
- **copy**: 選択範囲（未選択時は activeCell 単一）の表示文字列を TSV 化して `clipboardData.setData('text/plain', …)`。
- **cut**: copy＋**即時範囲クリア**（DD-020-1 `range-ops` 再利用・1 SetCells 原子）。Excel の「移動」セマンティクス（貼り付け時に元を消す）にはしない（親④）。
- **公開語彙**: `packages/grid/src/error-codes.ts` へ paste 拒否系（上限超過・はみ出し・clipboard 読み取り不能）を追加（内部型は露出しない=R7。命名は Phase 0 📐 で確定し `doc/DD/DD-017/error-codes.md` へ登録）。

## 決定事項（親 要確認①〜⑥の確定〔2026-07-16〕の継承＋本子DD分）

- **親①**: 上限 **100,000 セル**・超過は実行前拒否＋通知（`packages/core/src/protocol-limits.ts` の定数=DD-020-1 設置を共有）。性能保証は 10,000 セルで親 Phase 4 実測。
- **親②**: 行/列端はみ出し=**全体拒否＋通知**（切り捨て・部分適用をしない）。
- **親④**: cut=**提供する**（copy＋即時範囲クリア・移動セマンティクスなし）。
- **親⑤**: 書き出しは **text/plain（TSV）のみ**。値のみ扱う（書式 copy/paste は DD-027-3）。text/html 解析・書き出しは対象外。
- 本子DD: ClipboardEvent 主経路（権限プロンプト回避・同期）・parser は core 純関数・Navigation 位相のみ Command 化・不整合列数の欠けセルは skip（既定案 (d)・オーケストレータ確定対象）。

## 受け入れ基準

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | TSV 方言 fixture（引用・セル内改行・CRLF・空セル・末尾タブ・巨大文字列・不整合列数）→ parser が正しい matrix を返す | Phase 1 unit＋fuzz |
| 2 | serialize→parse round-trip で値が保存される | Phase 1 property test |
| 3 | グリッド内 copy→paste（実 Ctrl+C/V・実 clipboard）→ 値と型（number/date/string）が保持される | Phase 3 E2E（grantPermissions） |
| 4 | '123'→number・'2026-07-16'→date・その他→string（parseCellInput 準拠・偽陽性なし） | Phase 2 unit |
| 5 | 他クライアントが貼り付け範囲内セルを先行変更 → 全体 reject・文書無変更・rejected 通知（サイレント上書きなし・部分適用なし） | Phase 2 unit＋2クライアント収束テスト |
| 6 | 上限超過・はみ出し → 実行前拒否・公開コードで通知（SetCells を送らない） | Phase 2 unit＋E2E |
| 7 | 1×1 copy → 複数セル選択 paste → 選択範囲全体へ敷き詰め | Phase 2 unit＋Phase 3 E2E |
| 8 | cut → クリップボードへ TSV・元範囲は原子クリア・貼り付け先で値再現 | Phase 3 E2E |
| 9 | standalone モードで paste/cut → cell-commit（SetCells batch 単位）が発火し利用側保存契約（DD-024）が成立 | Phase 3 standalone E2E |
| 10 | Editing/Composing 位相の paste はセル編集テキストとして入る（グリッド Command 化しない）・composition 非破壊 | Phase 3 synthetic＋不変条件 |

## タスク一覧

### Phase 0: 事前精査
- [x] 📋 **各Phaseのタスク精査・詳細化**（AC⇔検証対応・対象パス・変更内容の具体性・🔬の有無）
- [x] 🧪 **テスト設計（Red）**: TSV 方言受理表・型変換境界値・OCC 競合マトリクス（自分/他者×範囲内/外×先行/後続）・敷き詰め/はみ出し/上限ケースを `doc/DD/DD-020-2/scenarios.md` へ自然言語で作成。fixture 一覧を含める。👀 シナリオ確認（フル委譲モード=オーケストレータ確認・結果をログへ記録）
- [x] 📐 **実装前詳細化トリガー判定**（判定結果: Phase 1 → 要〔新規モジュール〕／Phase 2 → 要〔並行処理=OCC・公開語彙=外部I/F〕／Phase 3 → 要〔3ファイル超〕）
- [x] 🧑‍⚖️ **Codexレビュー要否判定**（判定結果: 必須・effort: high。最終Phaseで本子DD全差分に対し1回。理由=Risk Class ヘッダ）
- [x] 😈 **Devil's Advocate調査**（TSV 方言の取りこぼし＝データ化け／beforeRevision を「実行時点」で取る妥当性（編集開始凍結との差）／巨大 paste の UI ブロック／クリップボード内改行セルと行区切りの混同）

### Phase 1: TSV parser／serializer（TDD・core）
- [x] **Red**: 合意済み scenarios から `packages/core/src/clipboard-text.test.ts` 作成 → 全件失敗確認（module 不在で 0 件・その後 P-10 失敗→修正で Green＝テストが実挙動を検証している実証）
- [x] **Green**: `packages/core/src/clipboard-text.ts` 新設（`parseClipboardText`／`serializeMatrix`・純関数・依存ゼロ・core index から re-export）
- [x] **Refactor＋fuzz**: 引用・改行・巨大文字列（100k）の fuzz（計画書 §20.2）・serialize→parse property test（seed 掃引 6 種・末尾列非空で degenerate 回避）・fixture 経由 parse 2 件
- [x] 🔬 **機械検証**: `npx vitest run packages/core/src/clipboard-text.test.ts`（24 件 green）／`npm run typecheck`・`npm run lint`（boundary new=0）→ green
- [x] 😈 **DA批判レビュー（基準: da-method.md §3.4）**（記録は下記 DA 表 Phase 1）

### Phase 2: paste/cut Command・原子 SetCells＋OCC（TDD・grid）
- [x] **Red**: paste-command unit（敷き詰め・はみ出し全体拒否・上限・型変換・beforeRevision・jagged skip・位相裁定）→ module 不在で失敗確認
- [x] **Green**: `packages/grid/src/clipboard-controller.ts` 新設（純ロジック=`shouldInterceptClipboard`／`serializeSelectionToTsv`／`buildPaste`）。ClipboardEvent 配線は `integration-editor.ts`（copy/cut/paste listener）＋`mount-controller.ts`（callback・位相裁定・chokepoint）。DD-020-1 の `selection-controller`（`selectedRange`）・`range-ops`（`buildRangeClear`＝cut のクリア）を再利用。`error-codes.ts` へ `paste-too-large`／`paste-out-of-bounds` 追加
- [x] **確定単位 chokepoint の整備（→DD-020-3 引き継ぎ）**: `mount-controller.ts` の `submitSetCells` を単一記録点化（①IME 単一 commit ②範囲クリア ③paste ④cut のクリア が全て通過。DD-020-3 は submit 直前で committed から逆値捕捉 hook を挿せる）。doc コメントで明示
- [x] 2クライアント競合テスト: operation レベル OCC を clipboard-controller.test.ts で固定（先行変更→stale-cell-revision で全体 reject・範囲外は非競合）。transport レベルの 2 クライアント収束は Phase 3 E2E（offline paste→reconnect 全体 reject）で検証（DD-020-1 と同分担）
- [x] 🔬 **機械検証**: `npm run test`（92 files/921 tests・+45）／`npm run typecheck`／`npm run lint`（boundary new=0）／`npm run build` → 全 green。公開 .d.ts snapshot 更新（`vitest run tests/contract -u`＝新語彙 2 件の追加のみ）
- [x] 😈 **DA批判レビュー（基準: da-method.md §3.4）**（記録は下記 DA 表 Phase 2）

### Phase 3: E2E 統合＋Codex
- [x] `apps/playground/e2e/clipboard.spec.ts` 新設（CL-1〜CL-7）: 実 Ctrl+C/V round-trip（`grantPermissions`）・敷き詰め・cut・下端はみ出し拒否通知・Excel 方言 fixture 注入（合成 ClipboardEvent＋DataTransfer）・2 クライアント OCC・composition 中 paste 非干渉。standalone は `clipboard-standalone.spec.ts`（paste/cut→cell-commit・AC9）
- [x] `tests/invariants/ime/clipboard.invariant.test.ts` へ「composition 中 clipboard 非干渉」ケース追加（全位相×composing 掃引＋実セッション state）
- [x] 🔬 **機械検証**: `npx playwright test`（playground **42 件**＝clipboard 7＋standalone 2 追加・IME/range-selection 回帰ゼロ／showcase 3）＋`npm run test:invariants`（46・+3）→ 全 green
- [x] 😈 **DA批判レビュー（基準: da-method.md §3.4）**（記録は下記 DA 表 Phase 3）
- [x] Codexレビュー自動実行（本子DD全差分 `59ce9bc..HEAD`・effort high。依頼書 `doc/DD/DD-020-2/codex-review-request.md` → `doc/DD/DD-020-2/codex-review-result.md`。findings 2件=P1/P2）
- [x] Codexレビュー指摘への対応、または見送り理由をログに記録（P2=反映／P1=既存境界として記録＝ログ 2026-07-17 参照）

## 引き継ぎ物（→ DD-020-3／親 Phase 4）

- **確定単位 chokepoint**: `mount-controller.ts` の **`submitSetCells`**（単一 commit・paste・cut/範囲クリアが全通過する単一 submit 記録点）。DD-020-3 の Undo スタックはここで submit 直前に committed から逆値捕捉 hook を挿す。API 名=`submitSetCells(op: SetCellsOperation)`・ファイル=`packages/grid/src/mount-controller.ts`。
- rejected 通知・公開語彙の確立（`paste-too-large`/`paste-out-of-bounds`/`range-too-large`＝実行前拒否は operationId 空文字・standalone は診断のみ＝`notifyPreExecutionReject`）。DD-020-3 の undo-blocked 通知の前例。
- 親 Phase 4 へ: 10,000 セル paste 計測対象の実装・Excel fixture（`doc/DD/DD-020-2/fixtures/`＝M1/M2 実機確認の比較対象）。

## 既知の未保証境界（L5・本子DD時点）

- **active cell が画面外にスクロールした状態では clipboard（copy/cut/paste）が発火しない**（Codex P1）: 常駐 textarea を active cell に配置し画面外で隠す仮想スクロール設計（DD-005 §11.3）由来で、**Delete・通常入力を含む全キーボード入力に共通**の既存性質（clipboard の回帰ではない・実測 DIAG で確認）。固定コーナー等の常時可視セルでは発生しない。実害は inert（データ喪失なし）。正しい解消は「keyboard focus 時の active cell scroll-into-view / off-screen でも textarea をフォーカス可能に保つ」＝CG-1 常駐 textarea 資産の変更で、**後続 DD（全キーボード入力の off-screen 対応）を推奨**。
- **cut/paste の Undo なし**（DD-020-3 で解消・親 Phase 4 で確認）。
- **paste 後に選択範囲を貼り付け矩形へ拡張しない**（Excel は拡張する。最小実装＝選択/active 不変。将来拡張）。
- own pending を含む範囲の cut/paste は pending 先行確定で全体 reject されうる（committed 由来 beforeRevision＝単一セル Delete/範囲クリアと同一 OCC 規約・安全側＝サイレント上書きなし）。
- 一般タイル展開（2×2→4×4 の整数倍繰り返し）は対象外（1×1×複数選択の敷き詰めのみ・親 D2）。copy は上限なし（read-only）＝巨大選択 copy の性能は §21 対象外。

## ログ

### 2026-07-16
- DD作成（親 DD-020 の Phase 2 を自己完結の子DDとして切り出し。親 要確認①〜⑥はオーケストレータ確定済み=フル委譲モード）。
- 経路設計: ClipboardEvent（clipboardData）主経路を採用（権限プロンプト不要・同期。navigator.clipboard 不使用）。E2E は実キー入力＋grantPermissions で実 clipboard を検証。
- 本子DD追加の既定案: 不整合列数 TSV の欠けセル=変更対象に含めない（skip・親へ報告済み・オーケストレータ確定対象）。

### 2026-07-17
- **Phase 0 完了**（実装セッション開始）: ステータス→進行中。🧪 テスト設計を `doc/DD/DD-020-2/scenarios.md` へ作成（TSV 方言受理表 P-1〜P-15・型変換境界値・paste フロー C-1〜C-10・copy/cut・位相裁定・OCC 競合マトリクス O-1〜O-3・IME 非干渉・standalone・fixture 一覧）。フル委譲モード=オーケストレータ確認で合意扱い。
- 📐 実装前詳細化（設計自己完結記録）:
  - **parser 配置**: `packages/core/src/clipboard-text.ts`（純関数・依存ゼロ）。`parseClipboardText(text): string[][]`（状態機械: 引用/タブ/CRLF・LF・末尾改行1個 trim・jagged 保持・空文字列→`[]`）＋`serializeMatrix(matrix): string`（CRLF 区切り・タブ/改行/`"` 含みのみ引用・`""` エスケープ）。
  - **paste/cut/copy 純ロジック**: `packages/grid/src/clipboard-controller.ts`。`shouldInterceptClipboard(phase, sessionComposing)`（Navigation かつ非 composing のみ true）／`serializeSelectionToTsv(port, range)`（copy）／`buildPaste(port, matrix, range)`（敷き詰め判定・はみ出し全体拒否・上限・parseCellInput・beforeRevision＝実行時点 committed・SetCells 生成）。`PasteOutcome`=submit/too-large/out-of-bounds/noop。DD-020-1 の `range-ops.buildRangeClear`（cut のクリア）を再利用。
  - **DOM 配線**: `integration-editor.ts` に copy/cut/paste の ClipboardEvent listener を追加（`onClipboardCopy/Cut`=TSV を返せば `clipboardData.setData`＋preventDefault／`onClipboardPaste(text)`=消費すれば preventDefault）。`mount-controller.ts` が callback を提供し、位相裁定・buildPaste・submitSetCells（**確定単位 chokepoint**）を配線。
  - **確定単位 chokepoint（→DD-020-3）**: 単一 commit（ime-editing-session `submit`）・range clear・paste・cut が全て mount-controller の `submitSetCells` を通る構造にする（DD-020-3 が submit 前 committed 読み取りで逆値捕捉 hook を挿せる単一記録点）。
  - **公開語彙**: `error-codes.ts` の `GRID_CONFLICT_CODES` へ `paste-too-large`（上限超過）・`paste-out-of-bounds`（行/列端はみ出し）を追加（R7 写像維持・operationId 空文字＝未 submit 規約は `range-too-large` 前例に倣う）。
- 😈 DA調査（主論点と対処方針）: ①TSV 方言取りこぼし=parser を状態機械で厳密実装＋fixture＋fuzz＋property round-trip で固定 ②beforeRevision「実行時点」の妥当性=単一セル Delete/範囲クリアと同一規約（committed 由来・OCC が安全側に倒す）＝サイレント上書きなし ③巨大 paste UI ブロック=上限 100,000 で実行前拒否（親①）＋走査前に面積判定 ④引用内改行と行区切りの混同=引用状態を parser が追跡（引用内 CR/LF はリテラル）。
- **Phase 1 完了**（TSV parser/serializer・core）:
  - `packages/core/src/clipboard-text.ts` 新設（`parseClipboardText` 状態機械＝引用/タブ/CRLF・LF・lone CR・末尾改行 1 個 trim・jagged 保持・引用空セル `""` の実在化・空文字列→`[]`／`serializeMatrix`＝CRLF・タブ/改行/`"` 含みのみ引用・`""` エスケープ）。core index から re-export。
  - Red の実際: module 不在で collect 0 → 実装後に **P-10（引用空セル `""`→`[['']]`）が fail**（`cellStarted` フラグ未導入で末尾空セルと末尾改行を区別できず）→ 修正で Green。テストが実挙動を検証していることをこの fail で実証。
  - fixture: `doc/DD/DD-020-2/fixtures/*.tsv` を `printf` で byte 精密生成（`.gitattributes -text` で EOL 無変換保護）。厳密検証は test 内の明示エスケープ定数で決定化、fixture はファイル経由 parse の実証＋人間可読証跡（jagged・quotes を test が読む）。
  - 🔬 `npx vitest run packages/core/src/clipboard-text.test.ts` 24 件 green／typecheck・lint（boundary new=0）green。
  - コミット: `4303cf1`（Phase 1）。
- **Phase 2 完了**（paste/cut Command・原子 SetCells＋OCC・grid）:
  - `packages/grid/src/clipboard-controller.ts` 新設（純ロジック）: `shouldInterceptClipboard(phase, composing)`（Navigation かつ非 composing のみ true）／`serializeSelectionToTsv(port, range)`（copy）／`buildPaste(port, matrix, range)`（敷き詰め判定・上限→はみ出しの順で実行前拒否・parseCellInput 委譲・beforeRevision＝実行時点 committed・jagged 欠けは skip・present 空は blank 上書き）。`PasteOutcome`=submit/too-large/out-of-bounds/noop。
  - DOM 配線: `integration-editor.ts` に copy/cut/paste の ClipboardEvent listener＋callback（`onClipboardCopy/Cut`=TSV 返却で `clipboardData.setData`＋preventDefault／`onClipboardPaste(text)`=消費で preventDefault）。`mount-controller.ts` が `clipPort`（ClipboardDocumentPort）・`performCopy/Cut/Paste`・`clipboardActive`（位相裁定）を配線。**Navigation の paste は必ず消費**（未消費だと browser 既定が textarea へ流し込み Navigation input が編集を開始してしまうため）。
  - cut は copy＋範囲クリア（`buildRangeClear` 再利用・1 原子 SetCells・親④）。クリアが上限超過なら cut 全体を拒否（copy もしない＝クリップボード不変・`range-too-large` 通知）。
  - 確定単位 chokepoint: `submitSetCells` を単一記録点として doc 明示（→DD-020-3 が逆値捕捉 hook を挿す）。
  - 公開語彙: `paste-too-large`／`paste-out-of-bounds` を `GRID_CONFLICT_CODES` へ追加（operationId 空文字＝未 submit・R7 維持）。error-codes.md・CHANGELOG Unreleased・contract snapshot 更新（DD-028 手順 1〜3）。
  - copy は上限を設けない（read-only・SetCells を作らない＝親①の対象外。巨大選択 copy の性能は selectedRange サイズ律速で親 Phase 4 §21 範囲外＝既知境界）。cut/paste は 100,000 上限。
  - 🔬 `npm run test` 92 files/921 tests（+45=clipboard-text 24＋clipboard-controller 21）／typecheck／lint（boundary new=0）／build → 全 green。
  - コミット: `a1ea8e0`（Phase 2）。
- **Phase 3 完了**（E2E 統合＋Codex）:
  - `apps/playground/e2e/clipboard.spec.ts`（CL-1〜7・実 Ctrl+C/V/X＋grantPermissions で round-trip／型 kind 保持／敷き詰め／cut／下端はみ出し拒否／Excel 方言 fixture=合成 ClipboardEvent＋DataTransfer／2 クライアント OCC／composition 非干渉）・`clipboard-standalone.spec.ts`（#1 paste・#2 cut→cell-commit・#3 はみ出し rejected 非発火）・`tests/invariants/ime/clipboard.invariant.test.ts`（全位相×composing 掃引＋実セッション）。test-support に `committedCellKind` 追加。
  - 🔬 playground E2E **42 件**（clipboard 7＋standalone-clip 3 含む・IME/range-selection 回帰ゼロ）／showcase 3／invariants 46 全 green。
  - **Codexレビュー（effort high・`59ce9bc..HEAD`）: findings 2件 → P2 反映・P1 見送り**（詳細は §Codexレビュー記録）:
    - **P2（standalone rejected 契約違反）反映**: `notifyPreExecutionReject` を新設し実行前 `rejected` を共同編集モードのみに限定（standalone は診断のみ）。paste/cut/範囲クリアの 3 経路を統一（DD-020-1 の range-too-large も同違反だったため一緒に是正）。回帰テスト（standalone #3・collab CL-3）を追加。
    - **P1（active cell 画面外で clipboard 不達）見送り**: 実測で Delete/通常入力も同様に不発＝常駐 textarea 仮想スクロール設計（DD-005 §11.3）の全キーボード入力共通の既存性質。clipboard の回帰ではなく、修正は CG-1 資産変更＝本子DD scope 外。既知境界に記録し後続 DD を推奨。
    - 修正後の再検証: grid unit 34／clipboard E2E 10（collab 7＋standalone 3）／invariants 46／`npm test` 93 files/924／lint（boundary new=0）→ 全 green。
- **全AC充足を確認しステータス「完了」へ**（AC1=clipboard-text P-1〜15＋CL-5・AC2=round-trip property・AC3=CL-1・AC4=C-10＋CL-1 kind・AC5=OCC unit＋CL-6 2 クライアント・AC6=C-4/5/6＋CL-3・AC7=C-2＋CL-2・AC8=CL-4・AC9=standalone #1/#2・AC10=CL-7＋invariant）。実機統合（実 Excel round-trip・実 IME）は親 DD-020 Phase 4 M1〜M3 に集約（本子DDは synthetic まで＝ヘッダどおり）。アーカイブは親完了時にオーケストレータ実施のため保留。
- 🔬 最終検証: `doc-check` green・`dd-index-gen` 再生成・`dd-health --dd DD-020-2` ⚠️0・`npm run build` green。コミット: Phase 3=`31158b5`／Codex P2 反映＋完了=（本コミット）。

---

## DA批判レビュー記録

### Phase 1 DA批判レビュー（TSV parser/serializer）

**DA観点:** 外部入力（クリップボード TSV）の解析でデータが化ける／失われる経路は無いか。引用状態と区切りの取り違えは無いか。

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | 引用空セル `""` が末尾改行の空行と区別されず消える（present な空セルの喪失） | 中 | `parseClipboardText('""')` → `[]`（`[['']]` 期待） | 暗黙の前提（空 vs 未開始） | ✅修正済（`cellStarted` フラグで引用開始/文字追加を追跡し末尾確定に反映。P-10 で固定） |
| 2 | 末尾行の末尾空セル/空行が round-trip で復元されない（TSV 末尾 trim 曖昧性） | 低 | `serializeMatrix([['a'],['']])`→`'a\r\n'`→parse→`[['a']]` | 矛盾・不整合 | ❌不要（TSV 本質の degenerate。property 生成器で末尾列を非空化し前提を明示・§2 注記に記録。paste の実害は末尾空セルを書かないだけ＝skip と同旨） |
| 3 | 未終端引用でクリップボード末尾が失われる | 中 | `parseClipboardText('"open')` | エッジケース | ✅対応済（寛容に残りをリテラル確定＝データを失わない。P-15 で固定） |
| 4 | 巨大文字列（100k）で O(n^2) 化・スタック超過 | 低 | 100k 単一セル paste | 将来の脆弱性 | ❌不要（線形走査・文字列連結のみ・再帰なし。P-14 で 100k を実測 green。UI ブロックは paste 側の上限で別途防御） |

### Phase 2 DA批判レビュー（paste/cut Command・grid）

**DA観点:** Navigation の paste が textarea へ流し込まれて意図しない編集を起こさないか。cut がデータを失わないか。はみ出し/上限で部分適用（サイレント欠落）が起きないか。

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | Navigation の paste を preventDefault しないと browser 既定が textarea へペーストテキストを流し込み、Navigation input が編集を開始（グリッド paste 意図と乖離・生テキストで 1 セル編集開始） | 高 | Navigation で Ctrl+V → textarea.value にペースト→input→EditingReplace | 依存関係（IME 資産と共有 textarea） | ✅修正済（clipboardActive なら buildPaste の全 outcome で return true＝必ず preventDefault。noop/拒否でも消費） |
| 2 | cut の範囲が上限超過だと、copy だけ成立してクリアが reject＝「cut したのに元が残る」不整合＋クリップボードに巨大 TSV | 中 | 100,001 セル選択で Ctrl+X | 矛盾・不整合 | ✅修正済（cut は buildRangeClear を先に評価し too-large なら copy もせず全体拒否＝クリップボード不変・通知） |
| 3 | はみ出し/上限 paste で一部だけ適用されサイレント欠落 | 高 | 右端で 1×2 paste / 100,001 セル paste | 暗黙の前提（部分適用の排除） | ✅対応済（buildPaste は矩形全体で out-of-bounds/too-large を返し submit しない＝原子・切り捨てなし。C-4/5/6 で固定） |
| 4 | jagged TSV の欠けセルを空文字で上書きすると意図せぬクリア（データ喪失） | 中 | `a\tb\nc` を 2×2 相当へ paste | データ整合性 | ✅対応済（欠けセル=skip・present 空セル=blank 上書きを区別。C-7/C-8 で固定・決定(d)） |
| 5 | copy に上限が無く巨大選択でUIブロック | 低 | 全選択相当を Ctrl+C | 将来の脆弱性 | ❌不要（read-only・SetCells 非生成＝親①対象外。selectedRange サイズ律速＝親 Phase 4 §21 範囲外の既知境界。cut/paste は 100,000 上限で防御） |
| 6 | own pending を含む範囲の cut/paste が pending 先行確定で全体 reject | 低 | offline で入力→同範囲 cut | エッジケース | ❌不要（committed 由来 beforeRevision＝単一セル Delete/範囲クリアと同一 OCC 規約・安全側。DD-020-1 既知境界と同旨） |

### Phase 3 DA批判レビュー（E2E 統合）

**DA観点:** 実 clipboard 経路と合成注入で挙動が乖離しないか。IME E2E に回帰が出ないか。型保持を E2E が実証しているか。

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | 実クリップボードの EOL 正規化（\r\n↔\n）で round-trip アサートが不安定になりうる | 中 | Ctrl+C→readClipboard で \r\n が \n に化ける環境差 | 暗黙の前提 | ✅対応済（round-trip は EOL 正規化して比較。byte 精密が要る Excel 方言は合成 ClipboardEvent＋DataTransfer で注入＝EOL 無変換） |
| 2 | 型（number/date/string）が E2E で未検証だと「値は合うが型が崩れる」を見逃す | 中 | paste 後の kind 未確認 | テスト網羅性 | ✅対応済（test-support に committedCellKind 追加・CL-1 で number/date/string を kind まで検証） |
| 3 | clipboard 配線で既存 IME/range-selection E2E に回帰 | 高 | 全 E2E 実行 | 回帰 | ✅確認済（playground 42・showcase 3・invariants 46 全 green＝IME/範囲選択 回帰ゼロ） |
| 4 | composition 中 paste の非干渉が実ブラウザーで崩れる | 高 | 変換中に paste イベント | 依存関係（CG-1） | ✅確認済（CL-7 で committedRevision 不変・draft 'にほん' 維持・確定後 commit 成立。invariant で全位相掃引） |

## Codexレビュー記録（effort high・本子DD全差分 `59ce9bc..HEAD`）

findings 2件。到達性×実害で仕分け（依頼書/結果=`doc/DD/DD-020-2/codex-review-request.md`・`codex-review-result.md`）。

| # | 指摘 | 判定 | 対応 |
|---|------|------|------|
| P1 | active cell が画面外へスクロールすると常駐 textarea がフォーカスを失い、そこにのみ登録した clipboard listener に copy/cut/paste が届かず大きな範囲で機能しない | **既存境界（clipboard 固有でない）＝見送り** | 実測（DIAG）: 非固定 active cell が画面外だと **Delete も通常入力も不発**（`deleteWorked:false`・`typeWorked:false`）＝常駐 textarea の仮想スクロール設計（DD-005 §11.3・全キーボード入力共通）由来で clipboard の回帰ではない。固定コーナー(0,0)等は常時可視で不発生。実害=inert（データ喪失なし）。正しい修正は「keyboard focus 時の active cell scroll-into-view / off-screen でも textarea をフォーカス可能に保つ」＝**CG-1 常駐 textarea 資産の変更**で本子DD scope 外（ヘッダ「IME 資産変更は停止」条項）。**既知境界に記録＋後続 DD 推奨**（§既知の未保証境界） |
| P2 | standalone で上限/はみ出し paste・cut・範囲クリアが `rejected` を発火し、DD-024 契約「standalone は connection/pending/rejected/divergence 非発火」に違反（consumer が collab 競合と誤認しうる） | **妥当＝反映** | `mount-controller.ts` に `notifyPreExecutionReject` を新設し、実行前拒否の公開 `rejected` を**共同編集モードのみ**に限定（standalone は診断 `onDiagnostic` のみ）。paste(too-large/out-of-bounds)・cut(too-large)・**範囲クリア(too-large＝DD-020-1 の同一違反)** の 3 経路を統一。E2E `clipboard-standalone.spec.ts #3`（standalone はみ出し paste で rejected 0 件・無変更）と CL-3（collab は paste-out-of-bounds 発火維持）で両モードを固定 |
