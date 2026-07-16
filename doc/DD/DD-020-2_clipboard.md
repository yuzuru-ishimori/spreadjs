# DD-020-2: clipboard copy/cut/paste

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-16 | 2026-07-16 | 検討中 | 親=DD-020（3分割の第2子）。前提=DD-020-1 完了（選択レンジ・range-ops・上限語彙） |

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
- [ ] 📋 **各Phaseのタスク精査・詳細化**（AC⇔検証対応・対象パス・変更内容の具体性・🔬の有無）
- [ ] 🧪 **テスト設計（Red）**: TSV 方言受理表・型変換境界値・OCC 競合マトリクス（自分/他者×範囲内/外×先行/後続）・敷き詰め/はみ出し/上限ケースを `doc/DD/DD-020-2/scenarios.md` へ自然言語で作成。fixture 一覧を含める。👀 シナリオ確認（フル委譲モード=オーケストレータ確認・結果をログへ記録）
- [ ] 📐 **実装前詳細化トリガー判定**（判定結果: Phase 1 → 要〔新規モジュール〕／Phase 2 → 要〔並行処理=OCC・公開語彙=外部I/F〕／Phase 3 → 要〔3ファイル超〕）
- [ ] 🧑‍⚖️ **Codexレビュー要否判定**（判定結果: 必須・effort: high。最終Phaseで本子DD全差分に対し1回。理由=Risk Class ヘッダ）
- [ ] 😈 **Devil's Advocate調査**（TSV 方言の取りこぼし＝データ化け／beforeRevision を「実行時点」で取る妥当性（編集開始凍結との差）／巨大 paste の UI ブロック／クリップボード内改行セルと行区切りの混同）

### Phase 1: TSV parser／serializer（TDD・core）
- [ ] **Red**: 合意済み scenarios から `packages/core/src/clipboard-text.test.ts` 作成 → 全件失敗確認
- [ ] **Green**: `packages/core/src/clipboard-text.ts` 新設（`parseClipboardText`／`serializeMatrix`・純関数・依存ゼロ）
- [ ] **Refactor＋fuzz**: 引用・改行・巨大文字列の fuzz（計画書 §20.2）・serialize→parse property test
- [ ] 🔬 **機械検証**: `npm run test -w @nanairo-sheet/core`（該当パッケージ）→ green／`npm run typecheck && npm run lint` → green
- [ ] 😈 **DA批判レビュー（基準: da-method.md §3.4）**

### Phase 2: paste/cut Command・原子 SetCells＋OCC（TDD・grid）
- [ ] **Red**: paste-command unit（敷き詰め・はみ出し全体拒否・上限・型変換・beforeRevision・非 Navigation 位相で発火しない）→ 失敗確認
- [ ] **Green**: `packages/grid/src/clipboard-controller.ts` 新設（ClipboardEvent 配線・位相裁定・paste フロー・copy/cut）。DD-020-1 の `selection-controller`（範囲取得）・`range-ops`（SetCells 生成・上限検査）を再利用。`packages/grid/src/error-codes.ts` へ paste 拒否語彙追加
- [ ] **確定単位 chokepoint の整備（→DD-020-3 引き継ぎ）**: 単一セル commit（既存 `ime-editing-session`）・paste・cut/範囲クリアが**共通の submit 記録点**を通る構造にする（DD-020-3 が逆値捕捉 hook を挿せる形）
- [ ] 2クライアント競合テスト: 既存 collab/server-hono ハーネスで「paste 範囲内セルの先行変更 → 全体 reject・収束」を検証
- [ ] 🔬 **機械検証**: `npm run test` → 全 green
- [ ] 😈 **DA批判レビュー（基準: da-method.md §3.4）**

### Phase 3: E2E 統合＋Codex
- [ ] `apps/playground/e2e/clipboard.spec.ts` 新設: 実 Ctrl+C/V round-trip（`grantPermissions(['clipboard-read','clipboard-write'])`）・Excel 方言 fixture 注入・敷き詰め・拒否通知・cut・standalone cell-commit・IME 干渉（composition 中 paste）
- [ ] `tests/invariants` へ「composition 中 clipboard 非干渉」ケース追加
- [ ] 🔬 **機械検証**: `npx playwright test`（apps/playground）＋`npm run test:invariants` → 全 green
- [ ] 😈 **DA批判レビュー（基準: da-method.md §3.4）**
- [ ] Codexレビュー自動実行（本子DD全差分・effort high。依頼書 `doc/DD/DD-020-2/codex-review-request.md`〔シナリオ網羅性・境界値・仕様一致・回帰リスクの観点を明記〕→ `bash scripts/codex-review.sh` → `doc/DD/DD-020-2/codex-review-result.md`）
- [ ] Codexレビュー指摘への対応、または見送り理由をログに記録

## 引き継ぎ物（→ DD-020-3／親 Phase 4）

- **確定単位 chokepoint**: 単一 commit・paste・cut/範囲クリアが共通の submit 記録点を通る構造（DD-020-3 の Undo スタックが逆値捕捉 hook を挿す）
- rejected 通知・公開語彙の確立（DD-020-3 の undo-blocked 通知の前例）
- 親 Phase 4 へ: 10,000 セル paste 計測対象の実装・Excel fixture（M1/M2 実機確認の比較対象）

## ログ

### 2026-07-16
- DD作成（親 DD-020 の Phase 2 を自己完結の子DDとして切り出し。親 要確認①〜⑥はオーケストレータ確定済み=フル委譲モード）。
- 経路設計: ClipboardEvent（clipboardData）主経路を採用（権限プロンプト不要・同期。navigator.clipboard 不使用）。E2E は実キー入力＋grantPermissions で実 clipboard を検証。
- 本子DD追加の既定案: 不整合列数 TSV の欠けセル=変更対象に含めない（skip・親へ報告済み・オーケストレータ確定対象）。

---

## DA批判レビュー記録

### Phase N DA批判レビュー

**DA観点:** （このPhaseで最も壊れやすいポイントは何か？）

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | (具体的に記述) | 高/中/低 | (高/中: 操作→結果) | (どのDA観点で発見したか) | ✅修正済/⏭️別DD/❌不要 |
