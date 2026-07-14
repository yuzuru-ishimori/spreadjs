# DD-016-2: 独立consumer実証・統合後実機スモーク

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-14 | 2026-07-14 | 検討中 | 親=DD-016（案Y 2分割）。前提=DD-016-1 完了。独立consumer実証(S1-3)・CG-1統合後スモーク・CG-6精密確定・DD-012クローズ連絡。Manual Gate |

```text
Risk Class: A
Risk Triggers: 公開API消費（外部I/F の実利用＝S1-3）／lifecycle 資源管理（再mount/画面遷移で resource leak）／未解除・残CGの変更トリガー例外（CG-1 統合後スモーク・CG-6 精密確定＝コード変更の有無に関わらず必須）
Human Spec Gate: 解決済（親DD-016 要確認②〔独立consumer・vanilla TS・pack 経由〕③〔CG-1 各ブラウザ3セッション以上・judge 再判定〕④〔CG-6 flag 付き実 Chrome clean run〕を確定）
Codex: 差分の性質が変わった場合のみ2回目を判定（§2.2 L3）。既定は不要（実証・計測が主でコード変更は最小）
Manual Gate: 要（CG-1 統合後 Tier 1 実機スモーク〔Win Chrome/Edge・Microsoft IME・人手〕＋CG-6 精密メモリ〔`--enable-precise-memory-info` 付き実 Chrome・clean run〕。残CGの例外につき必須＝cg-ledger 重要注記）
External Review: 不要（Codex xhigh 代替は DD-016-1 で実施済）
Evidence Level: full（consumer 実証ログ〔pack 経路・S1-3 不合格条件検査〕・再mount leak 検証・CG-1 実機 trace/judge 結果・CG-6 計測 raw・実施環境〔OS/ブラウザ版〕を doc/DD/DD-016-2/ へ格納）
```

> アプローチ: E2E 駆動（独立 consumer の serve→mount→日本語入力→共同編集→destroy/再mount を実挙動で実証）＋Manual Gate（実機IME・実機精密メモリ）
> 親=**DD-016**（アンブレラ）。前提=**DD-016-1 完了**（Facade 実 API・抽出・baseline 縮退が済んでいること）。本子DDは**実証重心**（pack 統合・S1-3・CG Manual Gate・DD-012 クローズ連絡）。
> CG: **CG-1**（解除済=DD-012-1）の「Facade 配線後の統合後 Tier 1 実機スモーク」残の担当・期限=Facade 公開前。**CG-6**（指標 pass=DD-012-2）の精密確定の担当・期限=Alpha exit 前。**CG-4 は本DDのゲートに含めない**（実機スモークの環境情報〔OS/ブラウザ版〕は証跡へ記録し DD-017 が転記できるようにする）。

## 目的

DD-016-1 で確定した公開 Facade を**独立 consumer から pack 済み成果物経由で統合**して **S1-3 を実証**し、**consumer lifecycle 契約の実挙動**（serve→mount→日本語入力→共同編集反映→connection state/error notification 受信→destroy→再mount で leak なし）を確認する。あわせて **CG-1 統合後 Tier 1 実機スモーク**と **CG-6 精密メモリの定義的確定**を行い、cg-ledger を更新して **DD-012 アンブレラ（AC2/AC4）のクローズを親DDへ連絡**する。

## 背景・課題（親DD-016 §背景の該当分）

- **consumer-harness は雛形どまり**: DD-011 の `scripts/consumer-harness.sh` は pack 経由の型疎通＋S1-3 不合格条件の機械検査（内部 import／source path／workspace link／tarball 実体）まで。**実挙動（mount→編集→共同編集→destroy/再mount の leak なし）の実証は本子DD**（harness README 明記）。
- **残CG**: CG-1 は DD-012-1 で実機解除済だが「Facade 配線後の最終確認スモーク」が残（cg-ledger）。CG-6 は指標 pass のみで `--enable-precise-memory-info`＋clean redraw の定義的確定が残。いずれも変更トリガー例外＝本子DDで必須発火。
- **CG-6 redraw**: DD-012-2 で redraw over-budget は「render 無変更ゆえ回帰不能の計測環境アーティファクト」と判定済み。本子DDの clean run で予算内なら解除、依然 over なら**上限明示（境界化）**を判定（親 要確認④）。

## スコープ

- **対象**: 独立 consumer プロジェクト新設（vanilla TS・`grid` 直接・pack 済み tarball 経由）／S1-3 不合格条件の機械検査（workspace link／source path 直参照／`@nanairo-sheet/*` 内部 package 直import／unpublished 依存＝0）／実挙動シナリオ（serve→mount→日本語入力〔synthetic〕→2クライアント共同編集反映→connection state/error notification 受信→destroy→再mount で resource leak なし）／CG-1 統合後 Tier 1 実機スモーク／CG-6 精密メモリ確定／cg-ledger 更新／DD-012 クローズ連絡。
- **対象外**: Facade 実 API・抽出・baseline 縮退（**DD-016-1**）／配布〔private registry・dist-tag〕・CHANGELOG・Quick Start・Tier 1 matrix 実測（**DD-017**）／Stage 1 移行判定・baseline 空の最終確認（**DD-018**）／`react` Facade（Stage 2）／20セッション級の CG-1 再取得（解除済ゆえ最終確認スモークのみ）。

## 決定事項（親 要確認確定を継承）

- **最初の consumer**: 実アプリ未定のため**独立 consumer プロジェクト新設**（vanilla TS・`grid` 直接＝最小経路）。取り込みは **pack 済み tarball**（private registry は DD-017）。実アプリ確定時は差し替え/追加。
- **CG-1 スモーク**: Win Chrome/Edge 実機（Microsoft IME・人手）で Facade 配線後の統合経路に対し**各ブラウザ最低3セッション**・`scripts/cg1/judge-ime-trace.mjs` 再判定 PASS（順序B＋先頭欠落0）。20セッション級は再取得しない。
- **CG-6 経路**: `--enable-precise-memory-info` 付きで実 Chrome をスクリプト起動し、Facade 配線後の統合経路で **clean run**（並行負荷なし）→ `scripts/cg-perf/` 判定器で精密メモリ＋redraw 予算を再判定。予算内なら解除、redraw が依然 over なら上限明示（境界化）。

## 受け入れ基準

| # | 基準（操作 → 期待結果) | 検証方法 |
|---|------------------------|---------|
| 1 | 独立 consumer が **pack 済み成果物のみ**で統合され、S1-3 不合格条件（workspace link／source path 直参照／`@nanairo-sheet/*` 内部 package 直import／unpublished assets・開発サーバー暗黙設定依存）が機械検査で0。実挙動（serve→mount→日本語入力→共同編集反映→destroy）を確認 | Phase 3 🔬 機械検査＋実挙動シナリオ |
| 2 | lifecycle 実挙動: mount→destroy→再mount を繰り返しても listener/RAF/WS/canvas/textarea が解放され resource leak しない。connection state・error notification（SessionEvent 4種の公開整形）を Facade 経由で購読/解除できる | Phase 3 再mount leak 検証 |
| 3 | **CG-1 統合後スモーク**: Facade 配線後の統合経路で Win Chrome/Edge 実機・順序B＋先頭欠落0・judge 再判定 PASS → cg-ledger の CG-1 残注記を消し込み | Phase 4 Manual Gate＋証跡 |
| 4 | **CG-6 精密確定**: `--enable-precise-memory-info` 付き実 Chrome の clean run で精密メモリ＋redraw 予算を再判定し、解除（または上限明示の境界化）を cg-ledger へ記録 | Phase 4 Manual Gate＋cg-ledger 更新 |
| 5 | 回帰なし: `npm run test`／`typecheck`／`lint`／`build`／`test:invariants`・E2E green＋`bash scripts/doc-check.sh` green。DD-012 アンブレラ残 AC（抽出・縮退・統合後スモーク）の充足を親DD-012 へ連絡しクローズ可能にする | Phase 4 🔬 一括機械検証 |

## タスク一覧

### Phase 0: 事前精査
- [ ] 📋 各Phaseのタスク精査・詳細化（AC↔検証対応・対象ファイルパス・🔬タスクの有無）
- [ ] 📐 **実装前詳細化トリガー判定**: Phase 3 → 詳細化要（新規プロジェクト・外部I/F消費）／Phase 4 → 不要
- [ ] 🧑‍⚖️ **Codexレビュー要否判定**: 既定=不要（実証・計測が主）。差分の性質が変わったら2回目を判定
- [ ] 😈 **Devil's Advocate調査**（独立 consumer が「fixture の言い換え」に堕ちないか〔§7 不合格条件〕／destroy 漏れ検出の実効性〔leak をテストでどう観測するか〕／CG-1 実機で順序A不発の前提が Facade 配線後も成り立つか）

### Phase 3: 独立 consumer 実証（S1-3・E2E駆動）
- [ ] 独立 consumer プロジェクト整備（vanilla TS・`consumer-harness/` とは別の実アプリ相当プロジェクト）: pack 済み tarball install・S1-3 不合格条件の機械検査（`scripts/consumer-harness.sh` の拡張 or consumer 側検査スクリプト）・最小サンプルとして整備（S1-4 の一部。Quick Start 文書は DD-017）
- [ ] 実挙動シナリオ: `server-hono` serve 起動→`grid` mount→日本語入力（synthetic）→2クライアント共同編集反映→connection state/error notification 受信→destroy→**再mount で leak なし**（AC1/AC2）
- [ ] 🔬 **機械検証**: consumer 検査スクリプト green（不合格条件0）＋leak 検証テスト green（シナリオ・ログを `doc/DD/DD-016-2/` へ）
- [ ] 😈 **DA批判レビュー**（consumer が開発サーバーの暗黙設定・未公開アセットに依存していないか＝§7 不合格条件の再監査）

### Phase 4: CG-1/CG-6 統合後実機スモーク・クローズ（Manual Gate）
- [ ] **CG-1 統合後スモーク**: 実機（Win Chrome/Edge・Microsoft IME・人手）で Facade 配線後の統合経路に日本語連続入力→ `scripts/cg1/judge-ime-trace.mjs` 再判定 PASS → trace/judge 結果を `doc/DD/DD-016-2/` へ・cg-ledger CG-1 行の「DD-016 統合後スモーク残」を消し込み（Playwright MCP は synthetic 補助・実IMEは人手必須＝DD-012-1 先例）
- [ ] **CG-6 精密確定**: `--enable-precise-memory-info` 付き実 Chrome の clean run（`scripts/cg-perf/` 判定器）→ 精密メモリ＋redraw 予算の再判定 → cg-ledger CG-6 を解除 or 上限明示（境界化）へ更新
- [ ] DD-012 アンブレラ残 AC（AC2/AC4）の充足を親DD-012 ログへ連絡（クローズは親DD-012 側）・密度計測を記録（人間確認時間・Codex effort/回数・ゲート待ち・findings 数・manual gate 実施内容 → ログへ。roadmap §2.4）
- [ ] 🔬 **機械検証**: `npm run test`・`typecheck`・`lint`・`build`・`test:invariants` 一括 green＋`bash scripts/doc-check.sh` green（AC5）
- [ ] 😈 **DA批判レビュー**（Evidence full 監査: consumer 実証ログ・CG-1 trace/実施環境・CG-6 raw・既知の未保証境界が証跡に欠けていないか）

## ログ

### 2026-07-14
- DD作成（親=DD-016 の案Y 2分割。親 §要確認②〜④ のユーザー確定を継承。前提=DD-016-1 完了）。番号は子DD `DD-016-2`（トップ連番 DD-017/018 は不変）。**実装は DD-016-1 完了後に着手**。

---

## DA批判レビュー記録

### Phase N DA批判レビュー

**DA観点:** （このPhaseで最も壊れやすいポイントは何か？）

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | (具体的に記述) | 高/中/低 | (高/中: 操作→結果) | (どのDA観点で発見したか) | ✅修正済/⏭️別DD/❌不要 |
