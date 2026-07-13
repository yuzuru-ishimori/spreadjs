# DD-012: 単一利用者IME縦切り

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-13 | 2026-07-13 | 進行中 | 仕様確認ゲート4点確定（2026-07-13）。案Y 2分割を採択し親アンブレラ化。実作業は DD-012-1（入力縦切り・CG-1）→ DD-012-2（性能縦切り・CG-6）で実施 |

```text
Risk Class: A（管理アンブレラ。実作業・レビュー・ゲートはすべて子DDで実施し、本DDは縦切りマイルストーンの完了判定のみ）
Risk Triggers: 子DDに委譲＝IME状態機械/textarea/focus/selection 変更（DD-012-1）／CellScalar データ形式変更（DD-012-1）／自動試験で判定不能な受け入れ条件＝実機IME・headed実測（DD-012-1/-2）
Human Spec Gate: required → 充足済（2026-07-13 ユーザー確定: ①分割=案Y ③性能ライン=DD-004実測予算化 ④型変換=標準セット ⑤ADR-012=Codex代替。spec/AC変更が生じたら再ゲート）
Codex: none（親では実施しない。子: DD-012-1=xhigh／DD-012-2=high）
Manual Gate: 子DDで実施（DD-012-1=CG-1 実機IME〔Win Chrome/Edge 両実機〕／DD-012-2=5万行 headed 実測＋CG-6 精密メモリ計測）
External Review: 不要（ADR-012 Accept は Codex レビューで代替＝ユーザー確定 2026-07-13・DD-010/ADR-0011 先例）
Evidence Level: full（証跡は各子DDの `doc/DD/DD-012-1/`・`doc/DD/DD-012-2/` に格納。親は集約確認のみ）
```

> アプローチ: 標準（親=管理アンブレラ。実装アプローチは子DD側で定義: DD-012-1=E2E駆動・DD-012-2=実測駆動）

## 目的

Stage 1 最初の縦切りマイルストーン（roadmap §4 DD-012・§19 Phase 1）。単一利用者が日本語IMEでセルへ**文字列/数値/日付を連続入力**し、**selection/navigation** で移動し、確定が**ローカルOperation**（SetCells）として文書へ適用される経路を、PoC資産の実抽出（`@nanairo-sheet/{ime,selection,render}`）の上で製品品質にする。§23 Phase 1完了条件「**5万行の基本 scroll/selection**」を統合性能回帰ゲートとして必須化し、**CG-1（実機IME）・CG-6（精密メモリ）を解除**する。

## スコープ

- **対象**: IME連続入力（DD-002/005 資産の実抽出）／型変換〔文字列/数値/日付・標準セット〕／selection/navigation／ローカルOperation／render 抽出／5万行×200列 scroll/selection 統合性能回帰ゲート／CG-1・CG-6 解除。
- **対象外**: 共同編集同期・OCC（**DD-013**）／永続化・snapshot（DD-014）／reconnect（DD-015）／Facade公開API確定・実consumer統合（DD-016）／Clipboard・Presence・行操作・数式・Undo。

## 決定事項（仕様確認ゲート確定・2026-07-13 ユーザー）

| # | 論点 | 確定内容 |
|---|---|---|
| ① | 2分割の要否・境界 | **案Y 採用**: DD-012-1「入力縦切り」＝IME＋型変換＋selection/navigation＋ローカルOp（**CG-1**・Codex xhigh）／DD-012-2「性能縦切り」＝render抽出＋5万行統合性能ゲート（**CG-6**・Codex high）。順序 **DD-012-1 → DD-012-2** |
| ③ | 5万行性能の合格ライン | **DD-004 実測を予算化**（scroll p95 16.8ms・選択 16.9ms・再描画 0.33ms・メモリ 300MB内 を回帰予算の基準に）→ DD-012-2 |
| ④ | 型変換の入力判定規則 | **標準セット**（数値=半角/全角数字・桁区切り・負数・小数を受理／日付=西暦 `YYYY-MM-DD` 等一般書式。内部表現は計画書確定済=IEEE754／LocalDate。受理書式の具体一覧は DD-012-1 実装Phaseで具体化し Codex 検証）→ DD-012-1 |
| ⑤ | ADR-012（LocalDate）Accept | **Codex レビューで代替**（ChatGPT 外部レビュー不要。DD-010/ADR-0011 先例）→ DD-012-1 |

残る要確認（DD-012-1 側で管理）: **②CG-1 実機環境の段取り**（Win Chrome/Edge 両実機・実施時期・実施者=人手必須）／**⑥順序A/B の実機記録方法**（既定=DD-002 実機手順踏襲・event-recorder＋trace-panel）。

## 子DD一覧（案Y・確定）

| 子DD | 縦切り（利用者成果） | 支配的リスク | CG | Codex | Manual Gate | 順序 |
|---|---|---|---|---|---|---|
| **DD-012-1 入力縦切り** | 日本語で文字列/数値/日付を連続入力し、移動・確定できる | IME状態機械・focus/selection＋CellScalar 値モデル | **CG-1** | xhigh | 実機IME（Win Chrome/Edge・人手） | 先行 |
| **DD-012-2 性能縦切り** | 5万行×200列で scroll/selection が快適（予算内） | 性能回帰・メモリ | **CG-6** | high | headed 実測＋精密メモリ計測 | DD-012-1 完了後 |

baseline 縮退の分担: `apps/playground/src/{ime,grid,integration}` 由来の R1 entries → DD-012-1／`pocb` 由来 → DD-012-2（DD-016 共同 owner 分は DD-016 に残す）。

**抽出（S1-1）の順序決定（ユーザー 2026-07-13・DD-012-1 要判断1 回答）**: 縦切りを **①入力ロジック（DD-012-1）** と **②物理抽出・baseline 縮退（DD-016）** に分離する。
DD-012-1 は入力ロジック（型変換 標準セット・CellScalar date・ローカルOp・hash 決定性）・IME 不変条件 6 項目・ADR-012 Accepted・Phase 4 実機ゲートを担い、
`@nanairo-sheet/{ime,selection}` の**物理抽出と baseline 縮退は DD-016（Facade 配線時）へ委譲**する（apps→internal の R1 肥大回避・`ime-editing-session` は render〔DD-012-2〕と grid R7 に依存・ロードマップ §4.3 と整合）。
状態機械は現位置で不変条件検証し、DD-016 で抽出時に `tests/invariants/ime` の import 先を差し替える。**本 milestone の完了は DD-016 の抽出完了に依存する**（下記 AC4）。

## 受け入れ基準（milestone級＝本縦切りの完了条件）

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | DD-012-1 が完了（AC全合格・Codex xhigh 対応済・**CG-1 解除証拠**格納） | DD-012-1 ヘッダ=完了＋`doc/DD/DD-012-1/` 証跡 |
| 2 | DD-012-2 が完了（AC全合格・Codex high 対応済・**CG-6 解除証拠**格納・perf 予算常設化） | DD-012-2 ヘッダ=完了＋`doc/DD/DD-012-2/` 証跡 |
| 3 | CG台帳の CG-1・CG-6 が解除済に更新されている | Phase 3 🔬（台帳の該当行を確認） |
| 4 | 新規違反0・`npm run test`/`typecheck`/`lint`/`build`/`test:invariants` green。**boundary baseline の ime/grid/integration 由来 R1 entries の縮退は DD-016（Facade 配線）に依存**（DD-012-1 は入力ロジックのみで抽出せず＝new=0/baseline 不変を維持。縮退完了確認は DD-016／最終 baseline 空は DD-018 S1-1） | Phase 3 🔬＋DD-016 |

## タスク一覧

### Phase 0: 事前精査（済）
- [x] 📋 各Phaseのタスク精査・分割判断の整理（起票時に実施・検討内容の比較表→ユーザー確定①）
- [x] 🧑‍⚖️ Codexレビュー要否判定: `親 → 不要（管理のみ・実装差分なし）／子 → DD-012-1=必須・xhigh／DD-012-2=必須・high`。Codex 利用可確認済（2026-07-13 `--check` exit 0）
- [x] 😈 Devil's Advocate調査（分割で実機証拠が無効化されないか → -2 は挙動保存抽出のため -1 の CG-1 証拠を維持。描画抽出で挙動差が出た場合は -2 で実機スモーク再判定をログへ）

### Phase 1: DD-012-1 入力縦切り（子DD）
- [ ] `doc/DD/DD-012-1_入力縦切り.md` の全Phase完了（CG-1 解除まで）
- [ ] 🔬 **機械検証**: DD-012-1 の最終一括 green（子DD側で実行）＋ヘッダ=完了を確認

### Phase 2: DD-012-2 性能縦切り（子DD・DD-012-1 完了後）
- [ ] `doc/DD/DD-012-2_性能縦切り.md` の全Phase完了（CG-6 解除まで）
- [ ] 🔬 **機械検証**: DD-012-2 の最終一括 green（子DD側で実行）＋ヘッダ=完了を確認

### Phase 3: milestone 完了確認
- [ ] CG台帳（CG-1・CG-6）の解除記録を確認・証跡パスを本DDログへ集約
- [ ] 🔬 **機械検証**: `npm run test`・`typecheck`・`lint`（boundary: DD-012 担当 baseline 縮退済・new=0）・`build`・`test:invariants` green＋`bash scripts/doc-check.sh` green（AC3・AC4）
- [ ] 😈 DA批判レビュー（両子DDの証跡で「実機環境・seed・再現コマンド」が欠けていないか＝Evidence full の監査）

## ログ

### 2026-07-13
- DD作成（roadmap §4 DD-012 定義・§5 Alpha必須ライン・DD-009 資産台帳・DD-011 基盤を前提に起票。dd-drafter）
- Codex 利用可否: **利用可**（`bash scripts/codex-review.sh --check` exit 0・codex-cli 0.144.0-alpha.4）
- 要確認①〜⑥を提示（分割・実機環境・性能ライン・型変換・ADR-012・順序A/B記録）

### 2026-07-13（仕様確認ゲート確定・親アンブレラ化）
- ユーザー確定4点を反映: **①案Y 2分割採用**／③性能ライン=DD-004実測予算化／④型変換=標準セット／⑤ADR-012=Codex代替。
- 本DDを親アンブレラへ改稿し、実作業Phaseを子DDへ移管: **DD-012-1_入力縦切り**（旧Phase 1・2・5相当＋Codex xhigh・CG-1）／**DD-012-2_性能縦切り**（旧Phase 3・4相当＋Codex high・CG-6）。
- 残る要確認（DD-012-1 で管理）: ②実機環境の段取り／⑥順序A/B記録方法（既定=DD-002手順踏襲）。

### 2026-07-13（抽出順序の決定・DD-012-1 要判断1 回答）
- **決定（ユーザー）**: 抽出（S1-1）を「入力ロジック=DD-012-1／`@nanairo-sheet/{ime,selection}` 物理抽出・baseline 縮退=DD-016」に分離。DD-012-1 は抽出せず new=0/baseline 41 不変を維持（apps→internal R1 肥大回避・render〔DD-012-2〕/Facade〔DD-016〕依存）。
- 反映: 子DD一覧の抽出順序決定・milestone AC4（縮退は DD-016 依存）へ明記。DD-012-1 のAC1/2/9 は入力ロジック＋不変条件で充足し、抽出部を DD-016 委譲。
- **DD-012-1 進捗**: Phase 1〜3 完了（型変換 標準セット・CellScalar date・ローカルOp・hash 決定性・IME 不変条件 6 項目・ADR-012 Accepted・Codex xhigh findings 5件全対応）。**Phase 4=CG-1 実機ゲート待ち**（人手）。証跡=`doc/DD/DD-012-1/`。

---

## DA批判レビュー記録

### Phase N DA批判レビュー

**DA観点:** （このPhaseで最も壊れやすいポイントは何か？）

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | (具体的に記述) | 高/中/低 | (高/中: 操作→結果) | (どのDA観点で発見したか) | ✅修正済/⏭️別DD/❌不要 |
