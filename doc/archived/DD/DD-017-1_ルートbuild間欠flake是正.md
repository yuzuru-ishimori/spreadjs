# DD-017-1: ルートbuild間欠flake是正（Vite html-inline-proxy）

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-15 | 2026-07-15 | 完了 | 親=DD-017。真因=html-inline-proxy の cwd casing 不一致（決定的バグ）。vite.config.ts input を realpath 正準化で恒久是正・ルート build 8/8 green。コミット 8fe7148。知見は engineering-patterns #5 へ昇格 |

```text
Risk Class: C（tooling/build 設定のみ。製品コード=packages/* の挙動変更なし・公開面/protocol/IME/永続化に非接触）
Risk Triggers: なし（検証ゲートの信頼性に影響するが §2.1 の A/B トリガー非該当）
Human Spec Gate: required（原因未特定の間欠 flake ゆえ Phase 0 の原因分析・是正手段選択で合意ゲート。バグ修正フルパス）
Codex: Phase 1 = 推奨・high（全DDの検証ゲート=build 経路に触れる・原因が複雑）／Phase 0/2 = 不要。xhigh 非該当
Manual Gate: 不要（実機/headed 不要。エビデンスはコマンドログ）
External Review: 不要
Evidence Level: standard（再現ログ・切り分けマトリクス・Before/After build ログを doc/DD/DD-017-1/ へ）
昇格条件: 是正が vite メジャー更新・test/e2e 基盤への波及・playground の画面挙動変更を要すると判明したら停止して B へ再判定・ユーザー提示
```

> アプローチ: バグ修正・フルパス（原因未特定・間欠再現のため、再現確認と原因分析の合意ゲートを置く。画面影響なし）
> エビデンス: テスト出力（build コマンドの実行ログ。Before=fail ログ / After=連続 green ログ）
> 位置づけ: DD-017 実装中に発見された pre-existing tooling flake（DD-017 ログ 2026-07-14「要判断/残課題（build flake）」参照）。スコープは tooling 是正のみで、Alpha 必須ライン（DD-017→DD-018）とは独立。

## 目的

ルート集約の `npm run build`（apps/playground の Vite 本番ビルド）が `[vite:html-inline-proxy] Could not load ...inline-css` で間欠失敗する問題の再現条件を特定し、恒久是正（または合意の上での境界化）によって、各DDの検証ゲート「build green」がルートコマンドで安定して判定できる状態に戻す。

## 概要

| Bug# | 概要 | 重要度 |
|------|------|--------|
| 1 | ルート `npm run build`（npm workspaces 経由）が playground の Vite `vite:html-inline-proxy` の inline-css 仮想モジュール解決失敗で間欠 FAIL。直接 `cd apps/playground && npx vite build` は安定 green | MEDIUM（製品挙動への影響なし・検証ゲートの信頼性を汚染） |

**DD-017 セッションでの観測事実**（DD-017 本文ログ 2026-07-14）:

- tracked 変更を stash した clean tree でも、ルート `npm run build` は **4/4 FAIL**
- 直接 `cd apps/playground && npx vite build` は **4/4 green**
- DD-017 は `apps/playground` を一切変更していない（pre-existing）

**既知の構成差分（仮説の材料・Phase 0 で実測切り分け）**:

- ルート `build` script = `npm run build --workspace apps/playground`（npm が cwd を workspace へ切替えて実行）
- ルート package.json に `overrides: vite ^6.4.3`、playground devDeps は `vite: ^6.0.5`（実解決版の確認要）
- `apps/playground/vite.config.ts` の `rollupOptions.input` が相対パス `'poc-integration.html'`（html-proxy は絶対パス正規化に敏感。Windows のドライブレター大小文字 `c:`/`C:`・パス区切りの不一致で仮想モジュール lookup が外れる既知パターンあり）
- `poc-integration.html` に `<style>` ブロック（L7-56）= `vite:html-inline-proxy` の inline-css 対象
- `apps/playground/node_modules/.vite/` にキャッシュ残置

## 原因分析（確定）

**真因**: `vite:html-inline-proxy` が inline `<style>` を退避する仮想 CSS モジュールのキー
`entryId.replace(config.root, '')` が、**add 時（build html plugin・シェル cwd 由来の casing）と
load 時（rollup が正準化＝ドライブレター大文字・実ディスク casing）でエントリ id の casing が食い違う**ため
不一致になり `No matching HTML proxy module found` で build 失敗する。ルート `npm run build`（npm workspace 経由）は
git-bash 既定の小文字ドライブ `c:` が cwd に流れ込み FAIL、直接/明示 cd 起動は大文字 `C:` で green。実行時シェルの
cwd 表記に依存する**決定的な環境依存バグ**であり、真のランダム flake ではない（DD-017 の「間欠」観測はこれが正体）。

- 版差（overrides `^6.4.3` vs devDeps `^6.0.5`）・`.vite`/`dist` キャッシュ・並行プロセスはいずれも**無関係**（実測切り分け済み）。
- `config.root` だけを大文字化しても解消しない（add 側は cwd 由来 casing のまま）。**input のエントリ casing を rollup の正準化に一致させる**のが必須。

> 詳細: [cause-analysis.md](DD-017-1/cause-analysis.md) / [repro-log.md](DD-017-1/repro-log.md) / [env-diff.md](DD-017-1/env-diff.md) / [bug-report.md](DD-017-1/bug-report.md)

## 修正方針（確定＝案 a を精緻化）

**採用**: `apps/playground/vite.config.ts` の build input を、`realpathSync.native` でディスク上の正準 casing に揃えた
絶対パスへ固定（`resolve(realpathSync.native(dirname(fileURLToPath(import.meta.url))), 'poc-integration.html')`）。
add 時のエントリ id を rollup の load 正規化と一致させキー一致 → 解消。`config.root` casing 非依存・POSIX no-op。
Codex[P2] を受け、当初の「ドライブレターのみ大文字化」から realpath（全区間 casing＋シンボリックリンク正規化）へ強化。

**選択理由（代行判断・案e不採用）**:
- (a=採用) 最小変更（1ファイル・input 1行）で真因に直接対処。packages/*・画面・vite 版・HTML 非接触＝Risk Class C 維持。
- (b) `<style>` 外部化は dist 出力構造が変わり AC3「dist 実質同等」を脅かす・変更範囲広 → 却下。
- (c) 版差は実測で無関係 → 無効。
- (d) build script 変更は呼出し側シェル casing に依存し続け脆い → 非本質的。
- (e) 恒久是正が成立したため**不採用**（要確認1により案 e は選択しない方針。境界化は要ユーザー判断）。

## 対象ファイル（確定）

| ファイル | 変更内容 |
|---------|----------|
| `apps/playground/vite.config.ts` | build input を `realpathSync.native` 正準絶対パスへ固定（+ 経緯コメント）。他ファイルは変更なし |

## 受け入れ基準

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | 再現条件が特定され、ルート経由 FAIL・直接実行 green の差分要因が実測で説明されている（切り分けマトリクス付き） | Phase 0 🔬（再現ループ実行 → `DD-017-1/repro-log.md`＋`cause-analysis.md`） |
| 2 | 修正後、ルート `npm run build` が**連続 8 回すべて green**（間欠 flake の解消判定。既定 N=8＝要確認2） | Phase 2 🔬（`for i in 1..8; npm run build` → 8/8 exit 0・ログ保存） |
| 3 | 回帰なし: 直接 `npx vite build`（apps/playground）green・`npm run typecheck`/`lint`/`test` green・`dist/poc-integration.html` の実質内容（inline-css 反映）が修正前と同等 | Phase 1/2 🔬（各コマンド green＋dist 差分確認） |
| 4 | 恒久是正が不能/過大と判明した場合のみ: 境界化（既知制約の文書化＋検証ゲート手順変更）をユーザー合意の上で実施し、AC2 を代替基準へ差し替える | Phase 0 ゲート（停止してユーザー提示。勝手に境界化しない） |

## タスク一覧

### Phase 0: 調査・再現確認・原因分析（バグ修正フルパス）

**再現ハーネス:**
- [x] 再現ループの実行・記録: ルート `npm run build` を 8 回連続実行し fail 率・エラーメッセージ全文を採取 → `doc/DD/DD-017-1/repro-log.md`（📸 Before=8/8 FAIL・**コード修正前に取得済**）
- [x] 対照実行: `cd apps/playground && npx vite build` を同回数実行し green を確認（8/8 green・repro-log.md）

**切り分けマトリクス（各因子を1つずつ変えて実測）:**
- [x] npm workspace 経由 vs 直接実行の環境差採取: 実行時 cwd（大小文字含む厳密値）・vite 実体を両経路でダンプし diff → `DD-017-1/env-diff.md`（差分は cwd ドライブレター casing の一点）
- [x] vite 実解決版の確認: 両経路とも `vite/6.4.3`・同一実体 `node_modules/vite`（hoisted）→ 版差は無関係
- [x] パス正規化仮説の検証: input 相対→絶対＋ドライブレター casing を変えた場合の挙動を実測（input 大文字/正準化で green・真因確定）
- [x] キャッシュ/並行仮説の検証: `.vite`/`dist` 削除後も結果不変・並行プロセス無関係
- [x] vite 該当 issue 相当のコード機序を dist ソース（`vite:html-inline-proxy`）で直接確認 → 設定（input casing）で是正可能と判定

**原因分析・ゲート:**
- [x] 原因分析を `doc/DD/DD-017-1/cause-analysis.md` に記載（コードレベル機序・再現手順付き）し、本文「原因分析」「修正方針」「対象ファイル」を確定値へ更新
- [x] 📝 バグレポート作成（`doc/DD/DD-017-1/bug-report.md`）
- [x] 👀 **ユーザーレビュー** — 要確認1〜3 はオーケストレータがユーザー承認に基づき確定（2026-07-15・ゲート代行）。是正手段は代行判断で案 a（realpath 精緻化）を選択・案 e 不採用

### Phase 1: コード修正・回帰確認（合意した是正手段のみ実施）

- [x] 合意した是正の実装（`apps/playground/vite.config.ts` の input を realpath 正準絶対パス化。packages/* 非接触）
- [x] 🔬 **機械検証**: ルート `npm run build` green＋直接 `npx vite build` green＋`typecheck`/`lint`(+boundary)/`test`(730) green＋`dist/poc-integration.html` が修正前と**バイト同一**（inline-css 反映維持・AC3）
- [x] 😈 **DA批判レビュー**（下記記録。dev/E2E/consumer 経路への波及確認）
- [x] Codexレビュー自動実行（effort high・依頼書 → `codex-review.sh` → `doc/DD/DD-017-1/codex-review-result.md`。findings 2件）
- [x] Codexレビュー指摘への対応（[P2]反映=realpath 化 / [P3]反映=index 再生成）をログに記録

### Phase 2: 修正後エビデンス・記録整備

- [x] 📸 修正後エビデンス取得: ルート `npm run build` 連続 8 回 → **8/8 green** ログ `doc/DD/DD-017-1/build-after-8x.log`（AC2）
- [x] 📝 検証ドキュメント作成（`doc/DD/DD-017-1/verification.md`＝Before/After 比較＋修正内容解説）
- [x] 親 DD-017 のログ「残: build flake」へ解消を追記（残課題クローズ）
- [x] 🔬 **機械検証**: `bash scripts/doc-check.sh` green（文書整合）
- [x] 😈 **DA批判レビュー（8/8 green が偶然でないか＝再現条件を意図的に成立させ FAIL→green の因果確認）**（下記記録）

## ログ

### 2026-07-15
- DD作成（親=DD-017。DD-017 実装中に発見された pre-existing tooling flake の切り出し。子DD採番ポリシーに従い DD-017-1 固定）。Codex 利用可否チェック: **利用可**（codex-cli 0.144.0-alpha.4・`--check` exit 0）。
- Phase 0 判定: 詳細化トリガー=Phase 1 は原因確定後に1〜3ファイルの限定変更見込み＝詳細化不要（Phase 0 の原因分析自体が詳細化を兼ねる）。Codex 要否: Phase 1=推奨・high（検証ゲート=build 経路・原因複雑）／Phase 0/2=不要。xhigh 非該当。
- Playwright MCP: 画面実装 Phase なし（エビデンスはコマンドログ）＝確認不要。
- **要確認1: 是正手段の優先順位** — 原因未特定のため事前確定不可。Phase 0 の原因分析後に案a〜e から選択（Phase 0 ゲートでユーザー提示）。起票時点の心証は「(a) input 絶対パス化 or (b) inline `<style>` 外部化」が最小変更。
- **要確認2: 安定判定の基準** — 「連続 8 回 green」を既定案とした（発見元の観測が 4/4 FAIL→4/4 green だったため倍の 8 回）。回数の妥当性はユーザー判断で変更可。
- **要確認3: 境界化の許容** — 恒久是正が vite 本体の既知バグ等で不能/過大な場合、「playground 直接 build を検証ゲート標準にする」境界化（AC4）を許容するか。既定案は「まず恒久是正を試み、不能時のみ停止してユーザー提示」。

### 2026-07-15 要確認の確定（決定者=ユーザー承認によるゲート代行）
- **要確認1（是正手段）確定**: Phase 0 の原因分析結果に基づき、案a〜e のうち根本原因に合致する最小変更案をオーケストレータ承認済みの代行判断で選択してよい（選択理由を本文へ記録）。ただし **案e（境界化＝「playground 直接 build を検証ゲート標準にする」）だけは選択せず**、恒久是正が不能・過大と判明した時点で停止し「要判断」として呼び出し元へ戻す。
- **要確認2（安定判定基準）確定**: 既定案どおり「修正後ルート `npm run build` 連続 8 回 green」。
- **要確認3（境界化の許容）確定**: 境界化は必ずユーザー判断へ戻す（自動採用しない）。

### 2026-07-15 実装（Phase 0〜2 完了）
- **Phase 0（原因分析）**: 再現ループでルート `npm run build` = **8/8 FAIL**（相対 input・小文字 cwd 起動時）・対照の直接 `npx vite build` = **8/8 green** を採取（repro-log.md）。切り分けの結果、真因は「間欠 flake」ではなく **`vite:html-inline-proxy` の仮想 CSS モジュールキー `entryId.replace(config.root,'')` が add 時（シェル cwd 由来 casing・git-bash 既定 `c:` 小文字）と load 時（rollup 正準化・大文字 `C:`）でエントリ id casing が食い違い不一致になる決定的な環境依存バグ」と確定（cause-analysis.md）。版差・キャッシュ・並行プロセスはいずれも無関係。probe プラグインで `config.root`（小文字）とエラーパス（大文字）の食い違いを実測。
- **是正手段の選択（代行判断）**: 案 a（input 絶対パス化）を採用。案 b/c/d 却下・案 e 不採用（理由は本文「修正方針」）。恒久是正が成立したため停止不要。
- **Phase 1（実装・検証）**: `apps/playground/vite.config.ts` の build input を `realpathSync.native` で正準 casing の絶対パスに固定。ルート `npm run build` green・直接 build green・`typecheck`/`lint`(boundary new=0)/`test`(79 files・730 tests) green・`dist/poc-integration.html` は修正前と**バイト同一**（inline-css 反映維持・AC3）。
- **Codex レビュー（effort high・uncommitted）**: findings 2件。**[P2 反映]** withUpperDrive はドライブレターのみ正規化で中間セグメント casing 差に脆い → `realpathSync.native`（全区間 casing＋シンボリックリンク正規化）へ強化。**[P3 反映]** DD-INDEX ステータス不整合 → 本文ステータス確定後に `dd-index-gen.sh` で再生成。見送り findings なし。結果: `doc/DD/DD-017-1/codex-review-result.md`。
- **Phase 2（8/8 エビデンス）**: dist+`.vite` クリア後、ルート `npm run build` を小文字 cwd 条件で連続 8 回 → **8/8 green**（`build-after-8x.log`・AC2 達成）。verification.md 作成・親 DD-017 の残課題「build flake」をクローズ追記・`doc-check.sh` green。
- **スコープガード**: 変更は `apps/playground/vite.config.ts` の 1 ファイルのみ。packages/*・画面挙動・vite 版・HTML 非接触（Risk Class C 維持）。B 昇格条件（vite メジャー更新・test/e2e 基盤波及・画面変更）には非該当。
- **未コミット**（ユーザー確認後に主ループでコミット）。

### 2026-07-15 完了・アーカイブ

- コミット 8fe7148（11ファイル）。親 DD-017 の残課題クローズ追記済み。
- 知見昇格: 「Windows ドライブレター casing 差×vite html-inline-proxy＝実行経路依存の決定的 build 失敗（間欠 flake に見える）」を `doc/engineering-patterns.md` #5 へ昇格（言語/ツールチェーン仕様起因・再発確実・正しいやり方が非自明）。
- 仕様書同期: `doc/spec/` 不在＋tooling のみの変更のためスキップ。
- ステータス=完了 → アーカイブ（`doc/archived/DD/`）。

---

## DA批判レビュー記録

### Phase 1 DA批判レビュー

**DA観点:** この修正で何が壊れるか（dev/E2E/consumer 経路への波及）＋ 8/8 green が偶然でないか。

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | dev（`npm run dev`）への波及 | 低 | — | build 専用の `build.rollupOptions.input` のみ変更。dev は Vite が任意 .html を配信し input を参照しないため非影響 | 波及なし（設計上 build 限定） |
| 2 | E2E（playwright.config.ts）・consumer-app 経路への波及 | 低 | — | E2E は preview/build 済 dist を用いるが dist はバイト同一。consumer-harness は packages を対象で playground config 非依存 | 波及なし（dist 同等・test 730 green） |
| 3 | 8/8 green が偶然か（間欠 flake の見かけ） | 中 | 小文字 cwd（no-cd）でルート build | 修正前は同条件で 8/8 決定的 FAIL・修正後 8/8 green。真因は casing 不一致で確率要素なし。FAIL→green の因果を同一起動条件で確認済 | 因果確認済（verification.md）。偶然ではない |
| 4 | realpath が全区間 casing を正準化しきれない残穴 | 低 | 中間セグメント mis-cased cwd | Codex[P2] 指摘。`realpathSync.native` は実ディスク casing を返し中間セグメント＋シンボリックリンクも正規化するため withUpperDrive より堅牢 | realpath 採用で解消 |
