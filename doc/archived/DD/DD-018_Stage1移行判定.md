# DD-018: Stage1移行判定

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-15 | 2026-07-15 | 完了 | **総合判定=Stage 1 移行 可（Alpha 宣言可・ユーザー承認済 2026-07-15）**。S1-1〜6 全合格・CG-1〜6 全終端・cg-ledger 全CG終端化・stage2-backlog.md 新設。K7 は子DD DD-018-1（非ブロッカー=ユーザー承認・着手は別途判断）。Codex 証拠監査 high 4件全反映 |

```text
Risk Class: A（roadmap §4 DD-018 行・マイルストーン判定）
Risk Triggers: 受け入れ基準・操作仕様の最終判定（Stage 1 移行＝Alpha 宣言の可否）。コード・公開API・永続化は変更しない（新規実装ゼロ）
Human Spec Gate: required（総合判定〔Alpha 宣言〕はユーザー承認ゲート必須。要確認A〜E あり）
Codex: 推奨・high（証拠監査＝DD-007 先例。実装差分ゼロのため差分レビューではなく「判定チェックリスト×証拠参照の突合監査」を依頼。xhigh 非該当）
Manual Gate: 原則不要（CG-1/CG-5/CG-6 の実機・障害注入証拠は解除済＝再取得しない。回帰スイート実行のみ当日実施）
External Review: 原則不要（Phase境界に該当するが、CG/S1 の証拠は各DDで Codex/実機済み。ユーザーが ChatGPT レビューを求める場合は既存ゲートで手動実施）
Evidence Level: standard（判定チェックリスト＋機械検証ログを doc/DD/DD-018/ へ。証拠本体は各アーカイブDDへの参照で足りる）
```

> アプローチ: 標準（合否判定・文書作業が中心。コード変更なし）
> 位置づけ: Alpha 必須ライン DD-017（完了）→ **DD-018（最終）**。roadmap §4 の Stage 1移行判定DD・Stage 1 区分=必須・§23 Phase境界・CG=**全CG**。
> **最重要原則（roadmap §5・ChatGPTレビュー §4.11）**: 本DDは**スコープ決定の場ではなく、事前に決めた条件を証拠で判定する場**。Alpha 必須範囲をここで初めて決めない。判定作業＝証拠の収集・照合・合否記録であり、**新規実装は原則ゼロ**。不合格項目が出た場合の是正は子DD `DD-018-1` へ切り出し、本DDは判定記録に徹する。

## 目的

Stage 1 移行条件 **S1-1〜S1-6**（roadmap §0）・**CG-1〜CG-6**（cg-ledger）・**既知制約**（roadmap §8＋各DD既知制約）を既存証拠で合否判定し、**Stage 1 社内SDK Alpha への移行可否を記録**する。あわせて cg-ledger の CG-4 行（実測記入済・最終合否=本DD）をクローズし、**Stage 2 バックログ**（DD-019〜022＋各DDの Stage 2 送り項目）を確定する。

## 背景・課題

- DD-009〜DD-017 は**すべて完了・アーカイブ済み**（DD-017=S1-6 充足・2026-07-15 完了）。Alpha 必須ラインの残りは本DDのみ。
- CG 現況（cg-ledger）: CG-1/CG-2/CG-3/CG-5=**解除済**・CG-6=**解除＋redraw 境界化**（DD-016-2）・**CG-4=実測記入済（DD-017）で最終合否判定が本DDの責務**。cg-ledger は「DD-018 が全CG行の最終合否を判定する」と明記している。
- S1-1 は「DD-018 で『Adopt/Harden 対象が `apps/playground` 等に残っていないこと』を機械確認」と roadmap §0 が本DDに機械確認を割り当てている。
- roadmap §8 は「放置期限を過ぎた既知制約は Stage 1移行判定DD で **解消済/延期/製品境界化** を判定」と定める。
- S1-6 は DD-017 決定事項A・ADR-0015 で「private registry」→「**再現可能な private 配布経路**」（pack tarball closure 正式化）と再解釈済み。**合否は registry 有無でなく実質（再現 build・チャネル明示・成果物のみ統合）で評価**する（ADR-0015 明記）。この再解釈はゲート代行決定のため、判定時にユーザー追認を得る（要確認B）。

## スコープ

- **対象**: ①判定チェックリスト（項目×証拠の所在×合否欄）の作成と全行記入（S1-1〜6・CG-1〜6・既知制約） ②S1-1 の機械確認＋回帰スイート実行（CG-4「exit で実証」の当日証拠） ③cg-ledger CG-4 行の最終合否記入・クローズ ④既知制約の棚卸し（解消済/延期/製品境界化 の三値判定・§6 製品境界との整合確認） ⑤Stage 2 バックログ確定文書 ⑥総合判定（Stage 1 移行 可/否）の記録とユーザー承認。
- **対象外**: **新規実装・コード変更・仕様変更すべて**（不合格項目の是正は子DD `DD-018-1` へ切り出す）／解除済CG（CG-1/2/3/5/6）の証拠**再取得**（既存アーカイブ参照で足りる。証拠が欠けている場合のみ「不合格 or 証拠再取得」を判断し、再取得が必要なら子DDへ）／Alpha 必須範囲の再定義（roadmap §5 で確定済み）／Stage 2 DD（DD-019〜022）の起票・設計（バックログ確定のみ）。

## 検討内容（要確認A〜E）

- **要確認A: 総合判定の承認方式** — 既定案: 本DDは判定材料（チェックリスト全行）と判定案を提示し、**Stage 1 移行宣言（Alpha 宣言）の最終承認はユーザーが行う**（確認待ちゲート）。夜間ゲート代行の対象外とする想定でよいか。
- **要確認B: S1-6 再解釈の追認** — 「private registry」→「再現可能な private 配布経路」（ADR-0015・DD-017 決定事項A=ゲート代行決定）を S1-6 **合格判定の基準として追認**してよいか。否なら S1-6 は不合格＝registry 昇格子DD（DD-018-1）が必要。
- **要確認C: 境界化合格の追認** — CG-4「対象外環境（macOS/Firefox/モバイル）の明示＝境界化で可」・CG-6「redraw は上限 12ms 明示の境界化」（DD-016-2 確定）を**合格扱い**としてよいか（いずれも roadmap §0 が境界化を許容する定義）。
- **要確認D: Stage 2 バックログの置き場所** — 既定案: `doc/plan/stage2-backlog.md` を新設（DOC-MAP 更新）。DD-007→`phase1-dd-roadmap.md` の先例に倣い、Stage 2 開始時のロードマップ化はその時点の判断とする。代替案: `doc/DD/DD-018/stage2-backlog.md`（添付止まり・昇格は後日）。
- **要確認E: 不合格時の運用** — 不合格項目が出た場合、子DD `DD-018-1` の**起票まで**は本DD内で自動実施してよいか（着手はユーザー判断）。それとも不合格判明時点で都度停止か。

## 決定事項

> 決定者=ユーザー承認（2026-07-15）。A〜E を以下で確定。

- **A. 総合判定の承認方式** — **ユーザーがオーケストレータ（Claude）へ委任**（ユーザー明示指示・2026-07-15）。証拠に基づき総合判定（Alpha 宣言可否）まで本フローで確定してよい。ただし判定根拠（各項目の合否＋証拠参照）を完全に記録し、ユーザーへ事後報告する。判定が「不合格あり=Alpha 宣言不可」となる場合も同様に確定・報告する（隠さない）。※起票時の既定案（ユーザー最終承認）から更新。
- **B. S1-6 再解釈の追認** — **追認**。「private registry」→「再現可能な private 配布経路」（ADR-0015・DD-017 決定事項A）を S1-6 合格基準とする。合否は registry 有無でなく実質（再現 build・チャネル明示・成果物のみ統合）で評価する。
- **C. 境界化合格の追認** — **追認**。CG-4（macOS/Firefox/モバイル 対象外明示＝境界化）・CG-6（redraw 上限 12ms 明示＝境界化）は合格扱い（roadmap §0 が境界化を許容）。
- **D. Stage 2 バックログの置き場所** — **`doc/plan/stage2-backlog.md` を新設**（DOC-MAP 更新）。
- **E. 不合格時の運用** — **子DD `DD-018-1` の起票まで本DD内で自動実施**（/dd 新規作成フロー準拠）。着手はユーザー判断へ残す。

### 総合判定（2026-07-15・要確認A によりオーケストレータ確定・ユーザー事後報告）

> 判定根拠の全量は `doc/DD/DD-018/stage1-gate-checklist.md`（S1-1〜6・CG-1〜6・既知制約 K1〜K9 の条件原文×証拠×合否）。

> Codex 証拠監査（high・2026-07-15・findings 4件）反映後の最終版。監査結果=`doc/DD/DD-018/codex-review-result.md`。

- **S1-1〜S1-6**: **全合格**（S1-1 機械確認=boundary `baselined=10 new=0`・`apps/playground` 採用資産0／S1-6=要確認B 追認基準＋**本DDで再現build 再取得**〔Codex P1#1 対応・`release-manifest-reproduced-20260715.json`・verify gate green〕）
- **CG-1〜CG-6**: **全終端**（CG-1/2/3/5=解除済・CG-4/CG-6=境界化〔要確認C 追認で合格扱い〕）。未解除の必須CG=0
- **既知制約 K1〜K9**: 解消済3（K1/K2/K5）・延期5（K3/K4/K6/K8=Stage 2／**K7=子DD DD-018-1**）・製品境界化1（K9）。**実装を要する項目=K7 の1件のみ**（Codex P1#2 追認）
- **回帰スイート（CG-4「exit で実証」・当日）**: `doc/DD/DD-018/regression-run-20260715.txt` — boundary/typecheck/lint/build/test **全 EXIT=0**（79 files・730 tests passed・2026-07-15）
- **子DD `DD-018-1`（documentId×persistenceDir fail-fast・K7）を起票**（要確認E: 起票のみ・着手はユーザー判断。AC8 の切り出し参照＝`doc/DD/DD-018-1_documentId-persistenceDir-failfast.md`）

**総合判定: Stage 1 社内SDK Alpha 移行 = 可（Alpha 宣言可）**

条件（Alpha の明示境界）:
1. 対応環境は Tier 1（Windows Chrome/Edge）限定。macOS/Firefox/モバイルは対象外（CG-4 境界化・roadmap §6・ADR-0015）
2. redraw は ≤12ms を上限として明示（CG-6 境界化・roadmap §18.2 機能上限内）
3. 信頼境界=trusted internal 限定・本番認証認可/HA/バックアップ/24時間接続は Stage 1 対象外（roadmap §6）
4. 行操作・数式・Clipboard・Presence は Alpha 必須範囲外（Stage 2/Alpha後拡張・stage2-backlog.md）
5. API は Experimental `0.x`（長期後方互換非保証・version 検出）
6. **DD-018-1（K7 fail-fast）を追跡**。**要ユーザー判断**: Codex は K7 を「不合格＝fail-fast 必須」と主張。本判定は §6（documentId は security 境界でない・tenant isolation 非保証）＋§5（P2-3 はユーザー既決で Alpha 対象外＝判定DDでスコープ再決定しない）を根拠に**非ブロッカー**とし Alpha 可としたが、DD-018-1 を Alpha ブロッカーへ格上げするか否かはユーザーが最終判断する（透明化のため本判定に明記・隠さない=要確認A）

## 受け入れ基準

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | 判定チェックリスト `doc/DD/DD-018/stage1-gate-checklist.md` が存在し、S1-1〜6・CG-1〜6・既知制約の**全行**に「証拠の所在（ファイルパス）＋合否＋判定根拠1行」が記入されている | Phase 2/3 🔬（空欄行 0 を目視＋grep 確認） |
| 2 | S1-1 機械確認: boundary lint 逸脱 new=0 ＋ DD-009 資産台帳（`poc-asset-ledger.md`）の Adopt/Harden 資産の抽出先が `packages/*` であることの照合記録がある | Phase 2 🔬（`npm run lint` green＋台帳照合表） |
| 3 | 回帰スイート green（`npm run typecheck` / `lint` / `build` / `test`）＝CG-4「exit で実証」の当日証拠 | Phase 2 🔬（一括実行 green・ログを DD-018/ へ） |
| 4 | cg-ledger の CG-4 行が最終合否（解除済 or 境界化）へ更新され、全CG行が終端状態（解除済/境界化）である | Phase 4 🔬（`doc/plan/cg-ledger.md` diff＋`bash scripts/doc-check.sh` green） |
| 5 | 既知制約（roadmap §8 の5件＋DD-014 P2-1/P2-3/P2-4＋DD-012-1 順序A不発知見）の各行に 解消済/延期/製品境界化 が判定され、延期・境界化項目は roadmap §6 製品境界 or Stage 2 バックログと突合済み | Phase 3 🔬（チェックリスト該当節の全行判定＋§6 との整合を1行ずつ記録） |
| 6 | Stage 2 バックログ文書が存在し、DD-019〜022＋各DDの Stage 2 送り項目（dist ビルド切替・registry 昇格・PostgreSQL 本採用・React Facade 等）を網羅、各項目に出典DDが付いている | Phase 4 🔬（文書存在＋`bash scripts/doc-check.sh` green） |
| 7 | 総合判定（Stage 1 移行 可/否＋条件）が本DDに記録され、ユーザー承認を得ている | Phase 5 👀（確認待ちゲート＝要確認A） |
| 8 | 不合格項目が 0、または各不合格項目が子DD `DD-018-1` へ切り出され本DDから参照されている | Phase 5 🔬（チェックリスト不合格行 ⇔ 子DD参照の対応 100%） |

## タスク一覧

### Phase 0: 事前精査
- [x] 📋 **各Phaseのタスク精査・詳細化**（AC↔検証対応・対象ファイルパス・🔬タスクの有無。要確認A〜E の確定値を決定事項へ反映）→ 確定値を決定事項へ反映済（A=Claude委任・B〜E 追認）
- [x] 📐 **実装前詳細化トリガー判定** → 確定: **全Phase 詳細化不要**（コード変更ゼロ・文書と機械検証のみ。規模/複雑度シグナル非該当）
- [x] 🧑‍⚖️ **Codexレビュー要否判定** → 確定: **Phase 5 で 推奨・effort high（証拠監査）**。Codex 利用可（`--check` 実施）
- [x] 😈 **Devil's Advocate調査**（①「証拠がある」≠「条件を満たす」＝チェックリスト各行に条件原文を転記して突合 ②解除済CG過信＝cg-ledger の各行完了ログで挙動変更DDを確認〔CG-1 は DD-016-2 統合後スモークで再PASS・CG-3 は DD-014-1 で bootstrap 化後も green・CG-6 は render 無変更を確認〕 ③バックログ漏れ＝roadmap §4 DD-019〜022＋各DD「Stage 2/対象外」記述を grep 列挙→stage2-backlog.md へ集約）

### Phase 1: 判定チェックリスト整備（証拠の所在の列挙まで・合否は記入しない）
- [x] `doc/DD/DD-018/stage1-gate-checklist.md` を新設: 3節構成（A: S1-1〜S1-6／B: CG-1〜CG-6／C: 既知制約）
- [x] A節の証拠所在を記入（S1-1〜6・各証拠パス実在確認済）
- [x] B節の証拠所在を記入: cg-ledger 各行の証拠パス（`doc/archived/DD/` 配下）を転記・**証拠ファイル実在確認済**（欠落0）
- [x] C節の対象を確定列挙: roadmap §8 の5件＋DD-014 P2-1/P2-3/P2-4＋DD-012-1 順序A不発＋grep 棚卸し（K1〜K9）
- [x] 🔬 **機械検証**: チェックリスト全行に「条件原文＋証拠の所在」記入・参照パス実在（リンク切れ0）→ `bash scripts/doc-check.sh` green
- [x] 😈 **DA批判レビュー**（条件原文の転記漏れ・証拠パス誤参照。下記記録）

### Phase 2: S1-1〜S1-6・CG-1〜6 の合否判定（機械確認含む）
- [x] S1-1 機械確認: `node scripts/boundary/check.mjs`（`baselined=10 new=0 stale=0`・残10件は全て PoC-D throwaway・`apps/playground` 由来0）＋DD-009 Adopt/Harden 行×抽出先 package 照合表をチェックリストへ記録
- [x] 🔬 **機械検証**: `boundary/typecheck/lint/build/test` → 全 green（当日ログ `doc/DD/DD-018/regression-run-20260715.txt`・全 EXIT=0・79 files/730 tests passed。CG-4「exit で実証」・AC3）
- [x] A節・B節の合否と判定根拠を全行記入（S1-6=要確認B 追認基準・CG-4/CG-6=要確認C 追認で境界化合格。条件原文×証拠を1行ずつ突合）→ 不合格行0
- [x] 🔬 **機械検証**: チェックリスト A/B 節の合否欄・判定根拠欄に空欄 0
- [x] 😈 **DA批判レビュー**（判定の甘さ＝「証拠がある」≠「条件を満たす」の突合漏れ。下記記録）

### Phase 3: 既知制約の棚卸し・製品境界整合
- [x] C節の全行（K1〜K9）に 解消済/延期/製品境界化 を判定記入。延期（K3/K4/K6/K7/K8）は回収先DD＋Stage 2 バックログ掲載を確認、製品境界化（K9）・CG-4/CG-6 は roadmap §6 Alpha 製品境界に対応記述ありを確認
- [x] §6 製品境界の突合: 延期は §6「行操作は範囲外」or 信頼境界内・境界化は §6 記載済。**当初 Phase 3 では実装要制約0 と判定したが、Phase 5 Codex 監査 P1#2 で K7（documentId 誤公開）を「延期→子DD DD-018-1 切り出し」へ格上げ**（roadmap §6 追記は不要・fail-fast は子DDで対応）
- [x] 🔬 **機械検証**: C節 空欄 0＋延期項目 ⇔ Stage 2 バックログ項目の対応 100%＋`bash scripts/doc-check.sh` green
- [x] 😈 **DA批判レビュー**（棚卸し漏れ＝grep 結果と C節の差分。下記記録）

### Phase 4: Stage 2 バックログ確定・cg-ledger クローズ
- [x] Stage 2 バックログ文書 `doc/plan/stage2-backlog.md` 新設（要確認D）: DD-019〜022＋Stage 2 送り項目（dist 切替〔DD-017 B〕・registry 昇格〔DD-017 A〕・PostgreSQL 本採用〔ADR-0023〕・React Facade〔roadmap §7〕・P2-1/3/4・複数チャネル/汎用診断〔S1-6 注記〕）を出典DD付きで確定
- [x] `doc/plan/cg-ledger.md`: CG-4 行を最終合否=境界化（合格扱い）へ更新・ヘッダへ「全CG終端・判定=DD-018」追記
- [x] `doc/DOC-MAP.md` 更新（stage2-backlog.md 追加）
- [x] 🔬 **機械検証**: `bash scripts/doc-check.sh` green（AC4/AC6）
- [x] 😈 **DA批判レビュー**（バックログ粒度＝出典・理由・依存が各項目に付与。下記記録）

### Phase 5: 総合判定・Codex 証拠監査・ユーザー承認
- [x] 本DD「決定事項」へ総合判定を記録: Stage 1 移行 **可**＋条件（境界化2項目・既知制約の明示・DD-018-1 追跡）＋K7 を子DD `DD-018-1` へ切り出し・参照（要確認E）
- [x] Codexレビュー自動実行（推奨・effort high・証拠監査）→ `doc/DD/DD-018/{codex-review-request.md,codex-review-result.md}`（findings 4件: P1×2・P2×2）
- [x] Codexレビュー指摘への対応をログに記録（下記 Codex findings 節: 4件全反映）
- [x] 👀 **ユーザー承認ゲート**（要確認A=ユーザーは総合判定を Claude へ委任済み。本DDで確定・事後報告 → **ユーザー承認 2026-07-15: 総合判定「可」＋DD-018-1 非ブロッカーを追認・「完了→アーカイブ→コミット」指示**）
- [x] 🔬 **機械検証**: 不合格行（K7）⇔ 子DD DD-018-1 参照 100%（AC8）。`dd-health` は下記ログで確認

## ログ

### 2026-07-15
- DD作成（dd-drafter。roadmap §4 DD-018 行・§5「事前条件の合否判定のみ」原則・cg-ledger「DD-018 が全CG行の最終合否を判定」に基づく。番号は roadmap §0 で DD-018 固定）。Codex 利用可否チェック: **利用可**（codex-cli 0.144.0-alpha.4・exit 0）。
- 要確認A〜E を起票（総合判定の承認方式／S1-6 再解釈追認／境界化合格の追認／バックログ置き場所／不合格時運用）。回答が出るまで Phase 2 以降の合否記入・cg-ledger クローズには着手しない（Phase 1 の証拠所在列挙は先行着手可）。
- Playwright MCP: 本DDに画面実装 Phase なし（実機再取得もしない）＝確認不要。
- **要確認A〜E 確定**（ユーザー承認 2026-07-15。A=Claude へ委任〔ユーザー明示指示〕・B〜E 追認/確定）。決定事項へ記録。
- **Phase 0**: 詳細化トリガー=全Phase 不要（コード変更ゼロ）で確定。Codex 要否=Phase 5 推奨・high で確定。DA調査 3観点を実施（下記 DA 記録）。
- **Phase 1**: `stage1-gate-checklist.md` 新設（A: S1-1〜6／B: CG-1〜6／C: 既知制約 K1〜K9）。各行に条件原文×証拠所在を記入・証拠パス実在確認（欠落0）。S1-1 用に DD-009 Adopt/Harden×抽出先 package 照合表を作成。
- **Phase 2**: S1-1 機械確認=`node scripts/boundary/check.mjs`（`baselined=10 new=0 stale=0`・残10件は全て `apps/pocd-bench`/`apps/pocd-browser-bench`=PoC-D throwaway・`apps/playground` 由来0）。当日回帰スイート `doc/DD/DD-018/regression-run-20260715.txt`: boundary/typecheck/lint/build/test **全 EXIT=0**（79 files・730 tests passed）。A/B 節合否記入=不合格0（S1-6 は要確認B 追認基準・CG-4/CG-6 は要確認C 追認で境界化合格）。
- **Phase 3**: 既知制約 K1〜K9 を三値判定（解消済3/延期5/製品境界化1）・roadmap §6 突合。当初は実装要0 と判定（後段 Phase 5 Codex P1#2 で K7 を子DD DD-018-1 へ格上げ）。
- **Phase 4**: `doc/plan/stage2-backlog.md` 新設（DD-019〜022＋dist切替/registry昇格/PostgreSQL本採用/React Facade/P2-1/3/4/複数チャネル/汎用診断を出典DD付き）。`cg-ledger.md` CG-4 行を最終合否=境界化（合格扱い）へ更新・ヘッダに全CG終端注記。`DOC-MAP.md` 更新。`bash scripts/doc-check.sh` green。
- **Phase 5**: Codex 証拠監査（effort high・`--check` 利用可）を実施 → findings 4件（P1×2・P2×2）を全反映（下記 Codex findings 節）。**総合判定: Stage 1 移行 = 可（Alpha 宣言可）**（決定事項へ記録）。K7 のみ子DD DD-018-1 へ切り出し（起票済・着手ユーザー判断）。

### 2026-07-15 Codex 証拠監査 findings 対応（effort high・4件）

依頼書=`doc/DD/DD-018/codex-review-request.md`／結果=`doc/DD/DD-018/codex-review-result.md`。

| # | findings | 対応 |
|---|----------|------|
| P1-1 | S1-6 の再現build証拠（DD-017 manifest）が dirty tree（commit 5eb89b6・当時版0.0.0・script不在）由来で再現不能 | ✅反映: 現 committed 版 `0.1.0-alpha.0` から `build-release.sh`（typecheck/lint/test 前置ゲート green・EXIT=0）を再実行し 9 tarball closure を再生成＝`release-manifest-reproduced-20260715.json`・`release-reproduce-20260715.txt`。gitDirty は DD-018 doc のみ由来（packages/scripts 無変更を git status で確認）。S1-6 合格維持（再現性を実証） |
| P1-2 | K7（documentId×persistenceDir 誤公開）は通常の内部設定ミスで到達＝trusted境界で防げず、単なる延期でなく不合格＝DD-018-1 で fail-fast 対応必要 | ✅反映: K7 を「延期→子DD DD-018-1（fail-fast guard）切り出し」へ格上げ・起票（`DD-018-1_documentId-persistenceDir-failfast.md`）。**Alpha ブロッカー扱いの是非はユーザー判断へ残す**（本判定は §6/§5 根拠で非ブロッカーとするが Codex の不合格主張を透明化） |
| P2-3 | S1-3 の「monorepo外」根拠が不正確（consumer-app は repo直下・dev ツールはルート node_modules） | ✅反映: S1-3 判定根拠を実態化（repo 直下だが npm workspaces 非登録の独立プロジェクト・SDK は tarball closure のみ・§7 不合格条件に非該当。dev ツール分離は §7 要求外・より厳密な外部実証は Stage 2 留意） |
| P2-4 | 証拠パス不備（`doc/adr/0015-...md` 省略形・CG-2 が active `doc/DD/DD-010/` 参照） | ✅反映: ADR 完全ファイル名へ・CG-2 を `doc/archived/DD/DD-010/` へ修正（機械追跡可能に） |

- 反映後 `bash scripts/doc-check.sh` green を再確認予定（下記）。総合判定は findings 反映後も **Alpha 可**（P1-2 の残判断のみユーザーへ）。

### 2026-07-15 ユーザー承認・完了・アーカイブ

- **ユーザー承認**: 総合判定「Stage 1 移行 可（Alpha 宣言可）」＋DD-018-1 の非ブロッカー扱いを追認。「完了→アーカイブ→コミット」指示。
- **子DD採番の是正**: 起票時のファイル名 `DD-018-M`（リテラル M）は子DD採番ポリシー（M は連番プレースホルダ・letter枝番禁止＝スクリプト安全）違反のため **`DD-018-1`** へリネームし、本DD・checklist・Codex 依頼/結果内の参照を一括是正。
- 知見の昇格判定: 該当なし（判定DDの運用パターン〔証拠監査方式 Codex・スコープ再決定しない原則〕は DD-007 先例と roadmap §5 が既に正本。engineering-patterns への新規昇格なし）。
- 仕様書同期: `doc/spec/` 不在＋コード変更ゼロのためスキップ（判定結果は cg-ledger・stage2-backlog.md・DOC-MAP へ反映済み）。
- ステータス=完了 → アーカイブ（`doc/archived/DD/`）。**Stage 1 社内SDK Alpha 宣言＝2026-07-15**。DD-018-1 は起票のみ・active に残置（着手はユーザー判断）。

---

## DA批判レビュー記録

### Phase 1〜4 DA批判レビュー（判定DD特有リスク）

**DA観点:** ①「証拠がある」と「条件を満たす」の混同 ②解除済CGへの過信（解除後に挙動を変えたDD） ③バックログ漏れ ④判定の甘さ（境界化を安易に合格扱い）

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | 「証拠がある」≠「条件を満たす」の突合漏れ | 高 | 各行に roadmap §0/cg-ledger の条件原文を転記し証拠と1行ずつ突合していないと、証拠ファイルの存在だけで合格にしてしまう | ① | ✅修正済（checklist 各行に条件原文列を設け突合。S1-3 は §7 不合格条件〔workspace link/source path/Internal 直接import〕に非該当を明記） |
| 2 | 解除済CGが後続DDの挙動変更で回帰していないか | 中 | CG-1/CG-3/CG-6 は DD-016 統合・DD-014-1 bootstrap 化・Facade 配線で挙動が変わりうる | ② | ✅確認済（CG-1=DD-016-2 統合後スモークで再PASS・CG-3=DD-014-1 bootstrap 後も E2E green・CG-6=render 無変更を cg-ledger で確認。当日回帰スイート 730 tests green で再固定） |
| 3 | バックログ漏れ（Stage 2 送り項目の取りこぼし） | 中 | roadmap §4 と各DD「Stage 2/対象外」記述を機械列挙せず主観で拾うと漏れる | ③ | ✅修正済（roadmap §4 DD-019〜022＋DD-017 決定事項A/B＋DD-014 P2-1/3/4＋ADR-0023＋roadmap §7 React＋S1-6 注記を stage2-backlog.md へ集約） |
| 4 | 境界化（CG-4/CG-6）を安易に合格扱いにする甘さ | 高 | roadmap §0 が境界化を許容する条件（CG-4「対象外環境を明示」・CG-6「上限明示 or 不可」）を満たさずに合格にすると Alpha 品質が崩れる | ④ | ✅確認済（CG-4=macOS/Firefox/モバイルを roadmap §6・ADR-0015 で明示・Tier1 は実証／CG-6=redraw≤12ms を §18.2 機能上限内で上限明示・精密メモリ本体は PASS。要確認C でユーザー追認） |
| 5 | S1-6 再解釈（registry→再現可能な配布経路）が条件緩和になっていないか | 高 | 「private registry」を外形的に満たさないのを実質評価にすり替えると条件を甘くする恐れ | ①④ | ✅確認済（要確認B でユーザー追認・ADR-0015 に再解釈明記。実質3要件〔再現build・チャネル明示・成果物のみ統合〕を証拠で確認＝外形の registry 有無より厳密な実質評価） |

> Phase 5 の Codex 証拠監査（effort high）で上記突合の妥当性・判定の甘さ・証拠欠落を外部監査する。
