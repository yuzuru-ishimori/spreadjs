# DD-028: 継続回帰CI・API差分監視

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-16 | 2026-07-16 | 進行中 | 要確認①〜⑥ユーザー確定（既定案・フル委譲）。Phase 1 から実装中 |

```text
Risk Class: B（roadmap §1 指定。支配的リスク=回帰検出の継続性）
Risk Triggers: 公開API契約の検証機構（型スナップショット）新設／開発全体の回帰防御線（CI）新設。コア実装・IME状態機械・protocol・永続化は無変更
Human Spec Gate: skipped（承認済みバックログ=roadmap §1 DD-028 行の範囲内。要確認①〜⑥は既定案付きで確認ゲートへ）
Codex: high（必須=外部I/F〔公開API契約の検証機構〕＋3ファイル以上。状態機械・protocol・永続化の実質変更なし＝xhigh 非該当〔§2.2 L3〕。全Phase 差分まとめて1回）
Manual Gate: あり・正味約5分×1回（初回 push 後に GitHub Actions 初回 run green を Web UI で確認。gh CLI 未導入のため。**実機 IME 実行は本DDの AC にしない**＝運用規定の常設まで〔manual-gate-scope-calibration〕）
External Review: なし（ChatGPT は手動運用方針＝呼び出し元判断）
Evidence Level: standard
```

> アプローチ: 標準（CI 設定・契約テスト拡張・運用文書が中心。画面なし・ビジネスロジック中心でもないため差分テンプレ非該当）

## 目的

SDK 機能DD群（DD-020/021/027）を連打する前に回帰防御を常設する。4本柱: ① CI 常設（test・invariants・E2E の継続実行=S2-4）、② API 型スナップショット差分検出の常設（S2-3）、③ migration guide 運用の確立と dry-run 検証（S2-3）、④ deprecation policy 決定（P-10・期限=Stage 2 前）。あわせて S2-4 後半「Tier 1 実機 IME 実行記録」の運用規定を常設する。

## 背景・課題

- SDK 機能先行フェーズ（2026-07-16 ユーザー決定・roadmap §2 順序入替=コミット 818bcca）: DD-028 → DD-020 → DD-021 → DD-027 の順。機能DD群の前に回帰防御を敷くのが本DDを先頭に置いた理由。
- 現状の検証は **DD単位の手動実行のみ**（`npm test` 814件・`test:invariants` 4カテゴリ・E2E 18+3本・boundary lint R1〜R7）。継続実行の仕組みがなく、S2-4 判定証拠「CI 常設の成功履歴」が積み上がらない。
- 既存 contract test（`tests/contract/facade-surface.test.ts`）は **export 名のスナップショット＋R7 型漏洩のみ**。export 名が同じままの型シグネチャ変更（破壊的変更の主形態）を検出できない。また react Facade（DD-025 で公開済み）が contract 未収載。
- KPI-7（重大回帰のリリース前検出・`kpi-ledger.md` §1）の検出機構実体が本DD（台帳は記録契約のみ・DD-029-1 で確認済み）。CI 稼働開始で「CI 常設稼働前は既存DD単位ゲートで記録」の空白期間が終わる。
- 憲章 §18.3「公開型スナップショット・API example test・protocol contract test を CI に含める」「具体的な非推奨期間は Stage 2 までに決定する」（P-10）。

## 検討内容

### 1. CI 基盤の実体調査と選定（要確認①②③）

調査結果（2026-07-16）: origin=`https://github.com/ishimori/spreadjs.git`（`ls-remote` 到達可・main push 済み・ローカル ahead 3）／`.github/` 未作成／`package-lock.json` あり（`npm ci` 可）／Node 22（engines）／gh CLI 未導入。
- **案A（既定）: GitHub Actions**。リモートが GitHub で到達可・private 無料枠 2,000分/月で十分（1 run 目安 10〜15分×月数十 push）・実行履歴がそのまま S2-4 判定証拠になる・追加インフラゼロ。
- 案B: ローカル常設スクリプト＋実行台帳。Actions が組織ポリシー等で使えない場合のフォールバック。履歴の改ざん耐性・自動性で劣るため既定にしない。
- 制約: workflow は **push しないと稼働しない**（AGENTS.md=push はユーザー承認事項→要確認③）。初回 run の green 確認は gh CLI 未導入のため Web UI（Manual Gate・正味5分）。
- E2E の CI 適性は確認済み: playground/showcase 両 playwright.config.ts が `process.env.CI` 対応済み（forbidOnly・retries 1・webServer 自動起動・strictPort）。ブラウザーは Tier 1 方針と CI コストから chromium のみ（実機 Edge/実IME は台帳運用=柱④で別建て。synthetic と実IME を混同しない）。

### 2. API 型スナップショット差分検出（S2-3）

- **案A（既定）: 既存 contract test の拡張**。`facade-surface.test.ts` の `publicDeclaration()`（in-memory .d.ts emit）が既にあり、その出力を `toMatchSnapshot()` で固定するだけで**公開型シグネチャ全文の差分検出**になる。ツール追加ゼロ・TS 版は lockfile 固定でノイズなし・emit コスト約30s×3 Facade は許容。
- 案B: api-extractor 導入。多機能だが依存追加＋monorepo セットアップコストが重く、Experimental 0.x 段階では過剰。Stage 4（外部公開）で再評価。
- gap 回収: react を value surface・R7・.d.ts snapshot の3検査へ追加（現在 grid/server-hono のみ。element は package 未存在のため対象外）。
- 運用: 意図的変更は `npx vitest run tests/contract -u` → CHANGELOG 記録 → migration guide 要否判定 → deprecation policy 適用判定、の順（テストヘッダの手順コメントを4本柱運用へ更新）。

### 3. migration guide 運用と dry-run 検証（S2-3）

- S2-3 は「存在と dry-run 検証」を要求（破壊的変更の**発生実績は要求しない**）。ただし CHANGELOG に実績あり（`GridConflict.code` 型変更・任意→必須）＝架空でなく**実績変更を題材に初版ガイドを書き、dry-run できる**。
- dry-run の定義: ガイドの before コードが現行 API で型 error になり、after コードが compile/実行 green になることを consumer 視点コードで実走検証（手順が実際に通る証拠）。
- 置き場: `doc/migration/`（README=運用規定＋ガイド実体。DOC-MAP 登録）。

### 4. deprecation policy（P-10・要確認④）

憲章 §18.3 の枠内で成熟度3層の既定案（社内 consumer 2件という実態に合わせ「全統合 consumer の移行確認」を軸にする）:
- **Experimental 0.x（現行）**: 破壊的変更可。ただし CHANGELOG 必記＋型スナップショット更新同伴＋migration guide 要否判定。非推奨を経る場合は `@deprecated` JSDoc＋代替手段明示＋最低1 minor 共存。
- **Beta（Stage 2 宣言後）**: 公開 Facade API の削除・非互換変更は「非推奨マーク→**最低1 minor リリース かつ 30日 かつ 統合済み全 consumer の移行確認**」の全充足後。緊急（データ整合・安全性）は即時変更可・CHANGELOG＋consumer 直接通知必須。
- **Stable 1.0 以降（予告）**: 削除は major のみ・非推奨期間 最低90日。正式確定は Stage 4 前（憲章 §15 Stage 4 条件と整合）。
- 決定の同期先は P-01 の先例形式: `doc/product/deprecation-policy.md` 新設＋憲章 §27 P-10 行を決定済みへ＋roadmap §5 P-10 行＋`doc/decisions.md` 次番追記。

### 5. 実機 IME 実行記録の運用規定（S2-4 後半・要確認⑤）

- スコープは**運用規定の常設まで**（実機実行は将来DDの Manual Gate で発生。本DDの AC にしない）。
- `doc/plan/ime-manual-gate-ledger.md` 新設（cg-ledger/kpi-ledger の先例に倣う常設台帳）: 変更トリガー定義（T1=IME 状態機械/textarea/focus/selection/composition/commit-bridge 経路を変更した DD の完了前・T2=Beta リリースゲート〔DD-031 前・DD-032 判定前に各1回〕・T3=Tier 1 ブラウザーメジャー更新時〔任意〕）／Tier 1 最小シナリオ5点（変換確定・無変換確定・F2 再編集キャレット・確定直後連続入力=先頭欠落0・Esc 取消。Win Chrome/Edge×日本語IME・順序A/B 観測記録）／記録様式（日付・トリガー・DD・環境・**synthetic/実IME 区別列必須**・結果・証跡リンク）。
- 遡及初期行: Stage 1〜現在の実機実績（DD-012-1 CG-1 実機 PASS・DD-012-3・DD-024・DD-025）を初期行として記録し、S2-4 判定時に履歴が最初から存在する状態にする。

### 6. 性能予算・flaky の CI 上の扱い（要確認⑥）

- roadmap §3「性能予算を CI へ載せて継続実行化」の充足範囲: CI が継続実行するのは **node perf smoke＋perf-judge 機械検証＋予算ピン**（すべて `npm test` 内・既設。smoke は「CI の CPU 競合でも落ちない 3000ms」設計済み）。**headed フル再計測（`scripts/cg-perf/`）は CI 化しない**＝共有ランナーの計時ノイズが false red を量産し予算の信頼を毀損するため、Stage 1 §2.3 の変更トリガー方式（人手 headed 実測＋判定器）を維持する。
- 既知 flaky: `packages/server-hono/src/ws-convergence.smoke.test.ts`（DD-011 で環境依存 flaky 据え置き）が `npm test` に含まれる。既定=まず CI で観察（Linux ランナーでは再現しない可能性）し、flake したら quarantine（CI では exclude＋`continue-on-error` の別ステップで**実行は継続**=履歴保持）、恒久是正は発火条件付き子DD（DD-017-1 の先例）。

## 決定事項

**要確認①〜⑥は全て既定案でユーザー確定（2026-07-16・確認ゲート・フル委譲モード）**:

- **① CI プラットフォーム = GitHub Actions 確定**（検討1の調査根拠。不可時のみ案B〔ローカルスクリプト＋実行台帳〕へ切替）。
- **② CI トリガー・構成 = 既定案どおり確定**: `push`(main)＋`pull_request`＋`schedule`(週1・月曜 09:00 JST)＋`workflow_dispatch`。2 job 並列（checks=lint/typecheck/test、e2e=playground＋showcase・chromium のみ）・Node 22・`npm ci`・concurrency（ref 単位 cancel-in-progress）・timeout 明示。
- **③ push = ユーザー明示許可済み（「push OK・以降も自動で可」2026-07-16）**。ローカル ahead コミット（DD-029-1×2・roadmap 記録）も一緒に push されることを含めて承認済み。CI 検証に必要なタイミングで origin/main へ push 可（force push 禁止）。
- **④ deprecation policy = 検討4の3層案で確定**（0.x=CHANGELOG 必記＋型 snapshot 同伴＋非推奨時は最低1 minor 共存／Beta 後=最低1 minor かつ 30日 かつ統合済み全 consumer の移行確認／Stable 後=major のみ・90日予告）。
- **⑤ IME 台帳の遡及初期行 = 採用**: Stage 1〜現在の実機実績（DD-012-1/012-3/024/025）を初期行として遡及記録。
- **⑥ E2E = blocking・flake は quarantine 運用**確定（exclude＋continue-on-error で実行継続=履歴保持・恒久是正は発火条件付き子DD。既知候補 ws-convergence.smoke）。
- 性能予算の CI 充足範囲は検討6のとおり（headed フル再計測は変更トリガー方式を維持）。
- KPI-7 との関係: 本DDは検出機構のみ。`kpi-ledger.md` への記録は回帰イベント発生時のみ（本DDでは台帳へ書かない）。

## 受け入れ基準

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | main へ push すると Actions が lint(+boundary)・typecheck・test（invariants/contract 込み）・E2E×2 を自動実行し、連続 3 run green（S2-4 成功履歴の開始） | Phase 1 🔬（push 後）・run URL を DD ログへ記録 |
| 2 | Facade（grid/server-hono/react）の公開型シグネチャを変えると contract test が fail（export 名不変の型変更も検出） | Phase 2 🔬デモ検証（一時変更→red→revert→green） |
| 3 | react Facade が value surface・R7・.d.ts snapshot の3検査に収載 | Phase 2 🔬 `npx vitest run tests/contract` green |
| 4 | migration guide 運用規定＋実績1本が存在し、dry-run（before=型 error／after=green）が通る（S2-3） | Phase 3 🔬 dry-run 実走 |
| 5 | deprecation policy が文書化され、憲章 §27 P-10・roadmap §5・decisions.md が決定済みへ同期（P-10 終端） | Phase 3 🔬 doc-check＋grep |
| 6 | 実機 IME 実行記録台帳が常設（トリガー定義・Tier 1 シナリオ・synthetic/実IME 区別・遡及初期行あり） | Phase 4 🔬 grep で必須節確認 |
| 7 | 既存スイートに回帰なし・文書整合 green | Phase 4 🔬 `npm test`／`typecheck`／`lint`／`doc-check.sh` |

## タスク一覧

### Phase 0: 事前精査
- [x] 📋 **各Phaseのタスク精査・詳細化**（AC1〜7 全てに検証タスク対応あり・対象パス明記済み。精査での追加: Phase 2 の .d.ts snapshot は**エントリ単独では不足**＝`GridConflictCode` 等の再エクスポート型の変更を検出できないため、**相対 re-export を辿った公開宣言 closure** を snapshot 対象にする〔AC2「export 名不変の型変更も検出」の実充足。詳細はログ 2026-07-16〕）
- [x] 📐 **実装前詳細化トリガー判定（再判定）**: 起票時見立てを維持=全Phase 詳細化不要（Phase 1 新規1ファイル／Phase 2 既存テスト1ファイル拡張〔closure 化は同ファイル内のヘルパー拡張で収まる〕／Phase 3・4 doc 新設中心・規定内容は検討4・5で確定済み）
- [x] 🧑‍⚖️ **Codexレビュー要否判定**: 全Phase → 必須・effort: high・全差分まとめて1回（理由: 外部I/F=公開API契約の検証機構＋3ファイル以上。xhigh 非該当=状態機械・protocol・永続化の実質変更なし）。実施は Phase 4 末尾。`codex-review.sh --check` で利用可を確認済み
- [x] 😈 **Devil's Advocate調査**: ①workflow YAML は push まで検証不能（actionlint 未導入）→ローカルで CI と同一コマンド列を先に全実行し主因を排除＋実 run で確認 ②lockfile の Linux バイナリ有無（npm ci 失敗リスク）→ `@esbuild/linux-x64`・`@rollup/rollup-linux-x64-gnu` が lockfile に存在することを確認済み ③.d.ts snapshot の改行コード（Windows CRLF vs Linux LF で false diff）→ emit を `NewLineKind.LineFeed` に固定＋受信側 `\r\n`→`\n` 正規化 ④cancel-in-progress が「連続 3 run green」を潰すリスク（run 進行中の push で cancelled 化）→ 各 run の完了を確認してから次 Phase を push する運用 ⑤closure snapshot の over-capture（再エクスポート元モジュールの非公開シンボル〔`GridBootError`/`toGridConflictCode` 等〕も snapshot に入る）→ 安全側の誤検出のみ・手順コメントに明記して許容

### Phase 1: CI 常設（.github/workflows/ci.yml）
- [x] `.github/workflows/ci.yml` 新設: トリガー=決定事項②／job① checks: `npm ci`→`npm run lint`→`npm run typecheck`→`npm test`（timeout 20分）／job② e2e: `npm ci`→`npx playwright install --with-deps chromium`→`npm run test:e2e`→`npm run test:e2e:showcase`（timeout 30分）／Node 22（setup-node・cache: npm）／concurrency=ref 単位 cancel-in-progress／permissions: contents read
- [x] 🔬 **機械検証（push 前）**: ローカルで CI と同一コマンド列を順に実行 → 全 green（lint〔boundary new=0〕・typecheck・test 828/828〔24.6s・ws-convergence.smoke 含む〕・test:e2e 22/22〔29.3s〕・test:e2e:showcase 3/3〔13.5s〕）
- [x] 要確認③の承認に基づき DD-028 コミットとあわせて push（ahead 3 込み・958a1f5）→ 初回 run 起動
- [x] 🔬 **機械検証（push 後・AC1）**: Phase 1/2/3 コミットの push で**連続 3 run → 3/3 success**（run URL はログ 2026-07-16 参照）。flake 発生なし（ws-convergence.smoke 含め全 green）＝quarantine 発動不要
- [x] 😈 **DA批判レビュー**（記録表 #3: cancel-in-progress と連続 green の相互作用）

### Phase 2: API 型スナップショット差分検出
- [x] `tests/contract/facade-surface.test.ts`: 公開 .d.ts 全文スナップショット3件追加（grid/server-hono/react。Phase 0 精査どおり**公開宣言 closure**〔エントリ＋相対 re-export の再帰〕を snapshot。3 エントリを 1 program に束ねて emit を1回に共有〔6.8s〕・LF 正規化で CI=Linux と決定性一致・timeout 60s）
- [x] 同ファイル: react を value surface snapshot・R7 型漏洩0検査へ追加（`import * as react from '@nanairo-sheet/react'`。R7 は closure 全体へ強化＝再エクスポート元モジュールも検査。react→grid 参照は正当に通ることを確認）
- [x] 同ファイルヘッダの【意図的な surface 変更の手順】を更新: `-u` → CHANGELOG 記録 → migration guide 要否判定（`doc/migration/README.md`）→ deprecation policy 適用判定（4本柱運用）
- [x] 🔬 **機械検証（AC2/AC3）**: `npx vitest run tests/contract` 9/9 green ＋ デモ検証=`GridConflictCode` union へ一時値追加（**エントリ .d.ts 不変の再エクスポート型変更**）→ grid closure snapshot が red・value surface は green のまま（=旧方式では検出不能だった証拠）→ revert → 9/9 green
- [x] 😈 **DA批判レビュー**: ①snapshot -u の乱用（fail を機械的に更新して破壊的変更が素通り）→ ヘッダ手順に CHANGELOG/migration/deprecation 判定を明記し Codex レビュー対象に含めた ②closure の相対 specifier 解決が `.js` 拡張子付き import に未対応→ 本 repo は拡張子なし import 統一（現状 0 件）のため許容・新規 Facade 追加時は snapshot 空になり entry 欠落 throw で検出 ③1 program 束ね emit で per-package tsconfig 差（grid types:[] 等)を反映しない→ 既存 R7 検査（DD-016 以降）と同一の共有 options を踏襲・公開宣言テキストの差分検出には影響なし

### Phase 3: migration guide 運用＋deprecation policy（P-10）
- [x] `doc/migration/README.md` 新設: 書く条件（CHANGELOG 破壊的変更節=必須）・書式（対象版・影響 API・`ts before`/`ts after` fenced block・機械的手順）・dry-run 検証義務（**常設 contract test 化**）・CHANGELOG／型スナップショット／deprecation policy との対応関係表・ガイド一覧
- [x] `doc/migration/0001-grid-conflict-code.md` 新設: 実績破壊的変更（`GridConflict.code` 型変更・任意→必須。CHANGELOG「Changed」節）の移行ガイド初版（before/after コード＋写像表参照の機械的手順付き）
- [x] 🔬 **機械検証（dry-run・AC4）**: `tests/contract/migration-dryrun.test.ts` 新設=全ガイドの before/after を抽出し in-memory 型検査（1 program 束ね・consumer 視点の仮想ファイル）。before=**TS2367**（生内部コード `'stale-cell-revision'` と公開語彙の重なりなし）＋**TS2741**（`code` 必須化）で型 error・after=0 diagnostics → **2/2 green**（一時ファイルでなく常設 test にしたため CI で dry-run が継続検証される）
- [x] `doc/product/deprecation-policy.md` 新設（決定④の3層＋運用フック表＋成熟度現在地）＋憲章 §27 P-10 行を決定済みへ（P-01 先例形式・最小差分）＋roadmap §5 P-10 行へ決定記録＋`doc/decisions.md` D-006 追記
- [x] 🔬 **機械検証（AC5）**: `bash scripts/doc-check.sh` green（DOC-MAP へ migration 2件＋deprecation-policy を登録済み）＋grep で憲章 P-10 行「決定済（2026-07-16）: 成熟度3層」=1 hit
- [x] 😈 **DA批判レビュー**: ①dry-run が「実行 green」でなく型検査 green（AC4 の括弧定義=before=型 error／after=green は充足。挙動変更の移行は型 dry-run 対象外マーカー＋手動手順で README §3 が規定）②ガイドの before が将来 API 変化で型 error でなくなると test が fail する=**意図した設計**（ガイド陳腐化の検出器。README §3 に更新義務を明記）③deprecation policy の「30日」実測は Beta 後にしか発生しない→ 規定のみ先行は S2-3/P-10 の要求どおり（発生時の運用記録は当該DDへ）

### Phase 4: 実機 IME 記録規定・文書同期・総合検証
- [x] `doc/plan/ime-manual-gate-ledger.md` 新設: トリガー T1/T2/T3・Tier 1 最小シナリオ5点（S1 変換確定/S2 無変換確定/S3 F2 再編集/S4 確定直後連続入力=先頭欠落0/S5 Esc 取消・順序A/B 観測列）・記録様式〔synthetic/実IME 区別列必須〕・遡及初期行4件（DD-012-1 CG-1 PASS/DD-012-3/DD-024/DD-025）・運用ルール（T1 起票者のタスク組み込み義務=kpi-ledger §2 と同型）
- [x] `doc/DOC-MAP.md` へ新規4文書（`doc/migration/` 2件・`deprecation-policy.md`・`ime-manual-gate-ledger.md`）＋`.github/workflows/ci.yml` を記載
- [x] `apps/showcase/src/features.json` 更新要否の判断: 起票時見立て「対象外」を実物確認で**覆し更新**（`quality`「品質保証の仕組み」エントリは Stage 1 の「自動テスト 738件」記述のままで、CI 常設・API 差分監視・dry-run 検証は同エントリの実質スコープ拡張=AGENTS.md の更新義務対象と判断）→ summary を「835件＋E2E 25本を CI で継続実行＋API 差分監視＋dry-run 検証」へ・source へ DD-028 追記
- [x] 🔬 **機械検証（AC6/AC7）**: `npm test` 835/835・`npm run typecheck`・`npm run lint`（boundary new=0）・`npm run build`・`bash scripts/doc-check.sh` 全 green＋grep で ime-manual-gate-ledger.md の必須節 4 hit・遡及DD 8 hit 確認
- [x] 😈 **DA批判レビュー**（記録表 #6/#7: T1 トリガーの空振り防御・遡及行の粒度誠実性）
- [ ] Codexレビュー自動実行（全Phase差分まとめて1回・high。依頼書生成→`bash scripts/codex-review.sh --request doc/DD/DD-028/codex-review-request.md --out doc/DD/DD-028/codex-review-result.md`）
- [ ] Codexレビュー指摘への対応、または見送り理由をログに記録

## ログ

### 2026-07-16
- DD作成（dd-auto・フル委譲モード。roadmap §1 確定番号=DD-028・採番不要を DD-INDEX／アーカイブで確認済み）
- CI 基盤調査: origin=GitHub 到達可（main push 済・ローカル ahead 3）・`.github/` 未作成・lockfile あり・gh CLI 未導入 → 既定=GitHub Actions（検討1）
- 要確認①〜⑥は既定案付き（決定事項参照）。フル委譲モードのため確認ゲート通過をもって確定の扱い
- Playwright MCP: 画面を伴う実装Phaseなし（CI/契約テスト/文書）のため確認不要

### 2026-07-16（実装開始・Phase 0〜1）
- **確認ゲート通過（ユーザー確定）**: 要確認①〜⑥すべて既定案で確定。push は「push OK・以降も自動で可」の明示許可（ahead 3 の同時 push 込み）
- **Phase 0 精査での設計精密化（AC/スコープ変更なし）**: Phase 2 の .d.ts snapshot は起票時の「エントリ .d.ts のみ」だと `error-codes.ts`/`diagnostics.ts` など**再エクスポート元モジュール内の型変更（例: `GridConflictCode` union の増減）を検出できない**ことを確認（エントリ .d.ts には `export type { … } from './error-codes'` しか現れない）。AC2「export 名不変の型変更も検出」を実充足するため、エントリから**相対 specifier（`from './x'`・`import("./x")`）を再帰的に辿った公開宣言 closure** を snapshot する方式へ精密化。副作用=再エクスポート元モジュールの非公開シンボルも snapshot に入る over-capture（安全側・手順コメントへ明記）
- DA調査5点（Phase 0 タスク欄）: YAML 検証不能→ローカル同一列先行実行／lockfile Linux バイナリ確認済み／.d.ts 改行 CRLF/LF 正規化／cancel-in-progress と連続 green の両立=run 完了待ち運用／closure over-capture 許容
- **Phase 1**: `.github/workflows/ci.yml` 新設（2 job 並列・トリガー4種・concurrency・timeout・permissions 最小）。push 前機械検証=CI と同一コマンド列を全実行 → **全 green**（lint boundary new=0・typecheck・test 828/828・E2E 22/22・showcase 3/3）

### 2026-07-16（Phase 2〜4・AC1 達成）
- **AC1 達成（連続 3 run green・S2-4 成功履歴の開始）**: 全 run が checks/e2e 両 job success・flake 0（quarantine 発動不要）
  - run#1（Phase 1 push・958a1f5）: https://github.com/ishimori/spreadjs/actions/runs/29495442883 → **success**（workflow YAML は初回 run で妥当性確認=actionlint 未導入の代替）
  - run#2（Phase 2 push・18eb0ee）: https://github.com/ishimori/spreadjs/actions/runs/29495974654 → **success**
  - run#3（Phase 3 push・d6abc4f）: https://github.com/ishimori/spreadjs/actions/runs/29496589622 → **success**
  - run 状態の自動確認: gh CLI 未導入のため GitHub API（`git credential fill` のトークンを直接 curl へパイプ・トークン非表示）で取得＝Manual Gate（Web UI 確認・正味5分）は**自動確認で代替済み**
- **Phase 2 デモ検証（AC2 実働証拠）**: `GridConflictCode` union へ一時値 `'dd028-demo-only'` 追加 → grid 公開宣言 closure snapshot **red**（value surface は green のまま=旧方式の盲点の実証）→ revert → 9/9 green
- **Phase 3 dry-run 証跡（AC4）**: before=**TS2367**（`'stale-cell-revision'` と `GridConflictCode` に重なりなし）＋**TS2741**（`code` 必須）で型 error・after=0 diagnostics。恒久化のため一時ファイルでなく `tests/contract/migration-dryrun.test.ts`（全ガイド走査・1 program 束ね型検査）として常設
- **Phase 4**: ime-manual-gate-ledger.md 新設（遡及初期行4件）・DOC-MAP 5 記載・features.json quality エントリ更新（起票時見立てを実物確認で覆した経緯はタスク欄）・総合検証 835/835 全 green・dd-health ⚠️0（DA表を統合記録で充足）

---

## DA批判レビュー記録

### Phase 1〜4 DA批判レビュー（統合記録・詳細は各Phaseタスク欄）

**DA観点:** 回帰防御線そのものが壊れる/形骸化するポイントはどこか？

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | エントリ .d.ts 単独の snapshot では**再エクスポート元モジュールの型変更を検出できない**（AC2 の主目的が空振り） | 高 | `GridConflictCode` union へ値を追加→エントリ .d.ts は不変（`export type { … } from './error-codes'` のまま）→ 旧方式では green のまま | 検証の妥当性（Phase 0/2） | ✅修正済（公開宣言 closure 方式へ。実デモで red を確認） |
| 2 | .d.ts snapshot が改行コードで false diff（Windows ローカル CRLF vs CI Linux LF） | 中 | Windows で snapshot 生成→ Linux CI で emit（os 既定改行）→ mismatch | 環境差（Phase 0） | ✅修正済（emit `NewLineKind.LineFeed` 固定＋受信側 `\r\n`→`\n` 正規化） |
| 3 | concurrency cancel-in-progress が「連続 3 run green」を潰す（run 進行中の push で前 run が cancelled 化） | 中 | run 進行中に次コミットを push → 前 run が cancelled（green にならない） | 運用と機構の相互作用（Phase 1） | ✅修正済（run 完了確認後に次 Phase を push する運用・workflow コメントに明記。実績: run1〜3 全て完走） |
| 4 | snapshot `-u` の機械的乱用で破壊的変更が素通り（fail→無思考更新） | 中 | 公開型を変更→ `-u` 実行→ CHANGELOG/migration 未記録のまま commit | プロセス形骸化（Phase 2） | ✅修正済（ヘッダ手順を4本柱化＝CHANGELOG→migration 要否→deprecation 適用判定。deprecation-policy §1 が型 snapshot 同伴を義務化） |
| 5 | migration guide が API 進化で陳腐化しても誰も気付かない | 中 | 将来の API 変更で before が型 error でなくなる／after が error になる → ガイドが嘘になる | 文書の腐敗（Phase 3） | ✅修正済（dry-run を常設 contract test 化＝陳腐化した時点で CI が fail。README §3 に更新義務を明記） |
| 6 | IME 台帳の T1 トリガーが起票者の記憶頼みで空振りする | 中 | T1 該当 DD が台帳を知らずに完了 → S2-4 判定時に履歴欠落 | 運用防御（Phase 4） | ✅修正済（台帳 §4-1 で起票者へタスク文面組み込みを義務化＝kpi-ledger §2 と同型。Risk Triggers 語彙と対応付け） |
| 7 | 遡及初期行が当時の記録粒度を超えて「5点シナリオ実施済み」に見える捏造リスク | 低 | — | 記録の誠実性（Phase 4） | ✅修正済（遡及行は「相当」表記＋注記で粒度差を明示） |
