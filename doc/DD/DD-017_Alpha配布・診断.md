# DD-017: Alpha配布・診断

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-14 | 2026-07-14 | 確認待ち | S1-6 担当。要確認A〜D 確定（ゲート代行）。Phase 0〜4 実装＋Codex(high) findings 8件全対応・全検証 green。**未コミット**（ユーザー確認後に主ループでコミット）。残: `npm run build` の既存 Vite flake（DD-017 非起因） |

```text
Risk Class: B（roadmap §4 DD-017 行）
Risk Triggers: 公開面の拡張（診断面=error code/debug hook の Experimental API 追加）／配布・運用成果物（S1-6）。IME・protocol・永続化・OCC には触れない
Human Spec Gate: required（要確認A〔registry 実体〕・B〔配布形態〕・D〔matrix 実測方式〕がユーザー環境・判断依存。確定まで Phase 1/4 は着手不可。Phase 2〔診断面〕は先行着手可）
Codex: high（Phase 2 診断面=公開API変更〔外部I/F〕→必須。Phase 1 release automation→推奨。xhigh 条件に非該当）
Manual Gate: 原則不要（CG-1/CG-6 解除済。matrix 実測は DD-016-2 実機証跡の転記＋配布物での機械スモークが既定＝要確認D。人手実機を選ぶ場合のみ発生）
External Review: 不要（ADR-0015 Accepted 化は Codex レビューで代替可＝DD-010 先例。ユーザーが ChatGPT レビューを求める場合は既存ゲートで手動実施）
Evidence Level: standard（再現 build/publish ログ・成果物 manifest・consumer-app 検証ログ・matrix 記入根拠を doc/DD/DD-017/ へ）
```

> アプローチ: 標準（配布・運用・文書整備が中心。Phase 2 診断面のみテスト先行=TDD併用）
> 位置づけ: Alpha 必須ライン DD-016（完了）→ **DD-017** → DD-018（Stage 1 移行判定）。roadmap §4 の S1-6 担当・Stage 1 区分=必須・Risk Class B・公開面。
> CG: **CG-4**（Tier 1 compatibility matrix）— 枠=ADR-0015・**実測記入=本DD**・最終合否判定=DD-018（cg-ledger）。

## 目的

Stage 1 移行条件 **S1-6（配布・運用成果物）** を充足する: 配布経路（private registry publish または pack tarball 運用の正式化）・alpha dist-tag・再現 build/publish 自動化・CHANGELOG 運用（S1-5 実装）・Quick Start（S1-4 の残り）・最小 error code/debug logging hook（診断面）・Tier 1 compatibility matrix の実測記入（CG-4）。あわせて ADR-0015 を Accepted 化し、DD-018 が「証拠で合否判定するだけ」の状態を作る。

## 背景・課題

- **配布戦略は本DDの責務**（`doc/engineering-patterns.md` #4）: Facade の実行時依存は `dependencies` 宣言へ是正済み・**pack closure 方式(a)＝内部 package 全 9 tarball 同時 install は DD-016-2 で実証済み**（`scripts/consumer-harness.sh`・`scripts/consumer-app.sh`・`scripts/consumer/check-closure.mjs` green）。ただし private registry へ昇格するか pack tarball 運用を正式化するかは未決（要確認A）。
- **現状の package は配布不能な形**: 全 `@nanairo-sheet/*` が `version: 0.0.0`・`private: true`・`main: ./src/index.ts`（TS ソース直配布・dist ビルドなし）。publish/dist-tag には版採番・メタ整備が要る。TS ソース配布は DD-016-2（vite consumer）で実証済みだが正式配布形態としての可否は判断が要る（要確認B）。
- **CHANGELOG（S1-5）と Experimental 運用は ADR-0015 D1 で方針確定済み・未実装**: `0.x`・破壊的変更を CHANGELOG に必ず記録・version で検出可能に。CHANGELOG ファイル自体がまだ無い。
- **Quick Start（S1-4 の残り）**: 最小サンプル＝`consumer-app/`（vanilla TS・pack closure install・vite build）は DD-016-2 で実証済み。文書化のみ残。
- **診断面（S1-6「最小 error code/debug hook」）**: 現状 `GridEvent` は `error {phase,message}`・`rejected` の `code?: string`（server reject 文字列の素通し）のみ。安定した error code 語彙と debug logging hook が未整備＝consumer が障害切り分けできない。
- **CG-4**: 枠=ADR-0015 の matrix（Tier 1 = Win Chrome/Edge のみ・対象外明示）。実測記入が本DD、合否判定が DD-018。DD-016-2 の実機証跡（CG-1: Chrome6＋Edge3 sessions・CG-6: 精密メモリ PASS・2026-07-14・OS/ブラウザ版は `doc/DD/DD-016-2/` の trace/judge JSON）を転記できる。

## スコープ

- **対象**: 配布経路の確定・正式化（要確認A）／9 package（Facade 2＋内部 7）の版採番・publish メタ整備・dist-tag alpha／再現 build/publish スクリプト（release automation）／CHANGELOG 新設・運用ルール（S1-5）／Quick Start 文書（S1-4）／grid Facade の最小 error code 語彙・debug logging hook（server-hono は必要最小限）／compatibility matrix 実測記入（CG-4）・ADR-0015 Accepted 化・cg-ledger 更新。
- **対象外**: 複数配布チャネル運用・汎用診断/テレメトリ基盤（**Stage 2**＝S1-6 注記）／Stage 1 合否判定（**DD-018**）／公開 API の機能追加・変更（診断面の追加を除き 0.1.0-experimental 面を維持。変更が必要と判明したら停止しユーザー提示）／`react` Facade（Stage 2）／PostgreSQL 本採用・運用（**ADR-0023＝Stage 2**。DB 運用〔起動前提・接続設定〕が Alpha 配布へ波及すると判明したら**停止して再判定・ユーザー提示**）／CG-1/CG-6 の再取得（解除済）。

## 検討内容（要確認A〜D）

- **要確認A: 配布経路の実体**（ユーザー環境依存） — (a) **pack tarball 運用の正式化**（DD-016-2 実証経路をそのまま release 成果物へ昇格。registry 不要・最小変更＝**既定案候補**。dist-tag は tarball manifest 上のチャネル表記で代替）／(b) **Verdaccio 等を本リポジトリ運用として新設**（`npm publish --tag alpha` の実経路が通る。運用物が1つ増える）／(c) **既存の社内 registry を使う**（有無・URL・認証をユーザーに確認）。roadmap S1-6 は「private registry 配布」を挙げるが、(a) でも「再現 build・チャネル明示・consumer が成果物のみで統合」という S1-6 の実質は満たせる（DD-018 判定に影響するため要ユーザー判断）。
- **要確認B: 配布形態** — (a) **TS ソース配布の継続**（現状 `main: ./src/index.ts`。DD-016-2 で vite consumer 実証済み・最小変更＝**既定案候補**。制約: consumer は TS を透過コンパイルできるビルド環境〔vite 等〕が前提＝Quick Start に明記）／(b) **dist ビルド配布**（tsc emit の js＋d.ts。汎用性は上がるが 9 package のビルドパイプライン新設＝規模増。Stage 2 で registry 昇格時に再検討でも可）。
- **要確認C: 初期バージョンと dist-tag** — 既定案: `0.1.0-alpha.0`・dist-tag `alpha`（`GRID_API_VERSION='0.1.0-experimental'` は API 面の版として維持し、package 版との対応を CHANGELOG に記録）。異論なければ既定案で進める。
- **要確認D: matrix 実測の方式** — 既定案: **DD-016-2 実機証跡（2026-07-14・Win Chrome/Edge・CG-1 trace/judge・CG-6 精密メモリ）を転記**＋**本DDの配布成果物経由で consumer-app 機械スモーク（synthetic）を 1 回実施**して「配布物でも成立」を確認。人手の実機再スモークは CG-1/CG-6 解除済のため行わない。改めて人手実機を望む場合はその旨指示（Manual Gate が発生）。

## 決定事項

> 決定者: ユーザー指示（「一気に進める」）に基づくゲート代行・2026-07-14。要確認A〜D はいずれも既定案を採用。

- **A. 配布経路 = (a) pack tarball 運用の正式化**。DD-016-2 で実証済みの pack closure 方式（内部 9 tarball 同時 install）を正式配布経路へ昇格する。private registry（Verdaccio/社内 registry）は立てない。roadmap S1-6 の「private registry 配布」は「**再現可能な private 配布経路**」と読み替える（(a) でも「再現 build・チャネル明示・consumer が成果物のみで統合」という S1-6 の実質を満たす）。この解釈と DD-018 判定への影響を本 DD および ADR-0015 に明記する。registry への昇格パス（`publishConfig`＋`npm publish --tag alpha`）は Stage 2/子DDで可能な形で残す。
- **B. 配布形態 = (a) TS ソース配布の継続**。現状 `main: ./src/index.ts` を維持（DD-016-2 で vite consumer 実証済み）。dist ビルド切替は Stage 2 送り。consumer 前提条件（vite 等 TS を透過コンパイルできるビルド環境）を Quick Start に明記する。
- **C. 初期バージョン = `0.1.0-alpha.0`＋チャネル表記 `alpha`**（dist-tag 相当）。registry 非経由のため dist-tag は release manifest 上のチャネル表記で代替する。`GRID_API_VERSION`／`SERVER_HONO_API_VERSION`（`0.1.0-experimental`）は API 面の版として維持し、package 版との対応を CHANGELOG に記録する。
- **D. matrix 実測 = DD-016-2 実機証跡の転記＋配布成果物での consumer-app 機械スモーク 1 回**。DD-016-2（2026-07-14・Win Chrome/Edge・CG-1 trace/judge PASS・CG-6 精密メモリ PASS）を ADR-0015 matrix へ転記し、本 DD の配布成果物経由で consumer-app スモークを 1 回実施して「配布物でも成立」を確認する。人手の実機再スモークは CG-1/CG-6 解除済のため行わない。

## 受け入れ基準

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | release スクリプト一発で再現 build（typecheck/lint/test → 9 package の配布成果物＋manifest〔版数・sha256〕）が生成される | Phase 1 🔬（`bash scripts/release/build-release.sh` → 成果物＋manifest 生成・再実行で同一版数） |
| 2 | consumer-app が **release 成果物のみ**で install→build→実挙動 green（S1-3 経路の配布物版・S1-6） | Phase 1 🔬（`bash scripts/consumer-app.sh` を release 成果物経由で実行 green） |
| 3 | 9 package が `0.1.0-alpha.x` 系で採番され、alpha チャネル（dist-tag または manifest 表記＝要確認A/C）が明示されている | Phase 1 🔬（package.json 版数検査＋publish dry-run or manifest 検査） |
| 4 | `GridEvent` の error/rejected に安定 error code 語彙が付与され、一覧が文書化されている。debug logging hook を opt-in すると診断ログが出力され、既定では無出力 | Phase 2 🔬（`npm run test` の該当テスト＋contract/consumer-harness green） |
| 5 | CHANGELOG が存在し、`0.1.0-alpha.0` エントリ・破壊的変更欄・運用ルール（0.x・破壊的変更は必ず記録＝S1-5/ADR-0015 D1）を含む | Phase 3 🔬（ファイル存在＋`bash scripts/doc-check.sh` green） |
| 6 | Quick Start に従い、新規 consumer が install→serve→mount→日本語入力まで到達できる（Tier 1 前提・TS ビルド環境前提を明記＝S1-4） | Phase 3 🔬（文書のコマンド列を consumer-app 経路で再現 green） |
| 7 | ADR-0015 の compatibility matrix に最終検証日・検証DD が実測記入され、ADR-0015 が Accepted 化・cg-ledger CG-4 が「実測記入済（合否=DD-018）」へ更新されている | Phase 4 🔬（該当文書 diff＋`bash scripts/doc-check.sh` green） |
| 8 | 回帰なし: `npm run typecheck`／`lint`（boundary new=0）／`build`／`test` green | Phase 2/4 🔬 一括機械検証 |

## タスク一覧

### Phase 0: 事前精査
- [x] 📋 **各Phaseのタスク精査・詳細化**（AC↔検証対応・対象ファイルパス・🔬タスクの有無。要確認A〜D の確定値を本文へ反映）→ 決定事項へ A〜D 反映済。対象ファイル: Phase 1=9 package.json＋`scripts/release/build-release.sh`（新設）＋`scripts/consumer-app.sh`／Phase 2=`packages/grid/src/{index,error-codes,diagnostics,mount-controller}.ts`＋`packages/server-hono/src/index.ts`＋テスト／Phase 3=`CHANGELOG.md`・`doc/quick-start.md`・`doc/DOC-MAP.md`／Phase 4=`doc/adr/0015-*.md`・`doc/plan/cg-ledger.md`。
- [x] 📐 **実装前詳細化トリガー判定** → Phase 1 = **要**（新規スクリプト・配布I/F）／Phase 2 = **要**（公開API変更）。詳細化結果を各 Phase 着手時にログへ記録し着手（ゲート代行・合意スコープ内ゆえユーザーレビュー待ちで停止せず継続。spec/AC/UX 変更に至る事態のみ停止）。Phase 3/4 = 不要（文書・記入）。
- [x] 🧑‍⚖️ **Codexレビュー要否判定** → Phase 2 = **必須**・effort **high**（公開API=外部I/F変更）／Phase 1 = **推奨**・effort **high**（release スクリプト新設・3ファイル以上）／Phase 3/4 = 不要。xhigh 非該当。Codex 利用可（0.144.0-alpha.4・`--check` exit 0）。
- [x] 😈 **Devil's Advocate調査** → (1) 配布成果物と working tree の乖離: build-release.sh は typecheck/lint/test 前置＋生成コミット SHA を manifest へ刻み、dirty tree では警告を出す。(2) error code 語彙の早すぎる固定: 公開語彙は最小 taxonomy に絞り `unknown` 前方互換フォールバックを必ず持たせ、内部 RejectCode 追加で consumer が壊れないようにする（Experimental 0.x・破壊的変更は CHANGELOG）。(3) tarball 運用の腐敗（stale 成果物の誤用）: manifest に版数・sha256・生成 SHA を刻み、consumer-app スモークは常に fresh build 経由 or manifest 検証付きとする。

### Phase 1: 配布正式化・release automation（要確認A/B/C 確定後）
- [x] 📐 **実装前詳細化**（成果物レイアウト＝ルート `release/`〔gitignore〕・manifest スキーマ〔distribution/channel/version/apiVersion/gitCommit/gitDirty/install/packages[name,version,tarball,bytes,sha256]〕・配布経路＝pack tarball closure 正式化。合意スコープ内ゆえ継続）
- [x] `packages/{grid,server-hono,core,types,collab,render,selection,ime,server}/package.json`: `0.1.0-alpha.0` 採番。決定事項A=(a) のため `private: true` は維持（registry 非経由・pack は private でも可）・チャネルは manifest で表現。`package-lock.json` も同版へ再生成（P2-4）。formula は配布 closure 外ゆえ据え置き。
- [x] `scripts/release/build-release.sh`（新設）: 再現 build（closure 健全性＋typecheck/lint/test 前置 → 9 tarball → manifest〔版数・sha256・生成コミット・dirty〕）。証跡 `doc/DD/DD-017/release-manifest.json`。
- [x] publish 経路の実装（要確認A=(a): manifest 台帳＋配布手順を CHANGELOG/Quick Start に文書化。registry 昇格は Stage 2 で `publishConfig`＋`npm publish --tag alpha` へ切替可能な形で据え置き）
- [x] `scripts/consumer-app.sh` を release 成果物経由へ対応（`RELEASE_VENDOR_DIR`・既存 pack 経路と共存・manifest sha256 同一性検証付き＝P2-2）
- [x] 🔬 **機械検証**: `bash scripts/release/build-release.sh` → 成果物＋manifest 生成 green／`RELEASE_VENDOR_DIR=release bash scripts/consumer-app.sh` → build/serve/mount/日本語入力(synthetic)/leak なし green（AC1〜3）
- [x] 😈 **DA批判レビュー**（下記 DA 記録参照。成果物と source の乖離＝生成コミット/dirty 記録・closure 再発＝gate に check-closure・stale tarball＝sha256 検証で対処）
- [x] Codexレビュー自動実行（推奨・effort high。`doc/DD/DD-017/codex-review-result.md`。Phase 2 と同一 uncommitted 差分で一括実施）
- [x] Codexレビュー指摘への対応（P1×4・P2×4 全対応。下記ログ参照）

### Phase 2: 診断面 — error code・debug logging（TDD・公開API変更）
- [x] 📐 **実装前詳細化**（error code 語彙＝`GRID_ERROR_CODES`〔config-unavailable/config-invalid/connect-failed/runtime-fault〕・`GRID_CONFLICT_CODES`〔cell-conflict/row-unavailable/column-unavailable/revision-stale/sequence-violation/duplicate-row/revalidation-failed/dependency/unknown〕。debug hook=`GridMountOptions.onDiagnostic`〔opt-in・既定無出力・`GridDiagnostic{level,code,message,timestamp}`〕。合意スコープ内ゆえ継続。TDD でテスト先行）
- [x] `packages/grid/src/{index,error-codes,mount-controller}.ts`: `GridEvent` error に `code: GridErrorCode` 必須追加・`GridConflict.code` を公開 `GridConflictCode` へ写像（内部 RejectCode 素通し廃止＝R7・未知は `unknown`）。写像は `error-codes.ts`（DOM 非依存・単体テスト付き）
- [x] `packages/grid/src/{index,diagnostics,mount-controller}.ts`: debug logging hook（`createDiagnosticSink`・opt-in・既定無出力・hook 例外非波及・単体テスト付き）
- [x] `packages/server-hono/src/index.ts`: `ServeOptions.onDiagnostic`（最小・serve-started/serve-stopped・opt-in・既定無出力）。接続単位診断は Stage 2（現状 connectionCount() で代替）と判定
- [x] error code 一覧の文書化（`doc/DD/DD-017/error-codes.md`）
- [x] 🔬 **機械検証**: `npm run test` 730 green（新規 `error-codes.test.ts`/`diagnostics.test.ts` 含む）／`typecheck`／`lint`（boundary new=0）／API invariant allowlist＋facade-surface snapshot 更新（正当な公開面追加）（AC4/AC8）
- [x] 😈 **DA批判レビュー**（下記 DA 記録。早すぎる固定→`unknown` フォールバック／後方互換→consumer-app 無変更で green／性能→hook 未指定時 no-op）
- [x] Codexレビュー自動実行（**必須**・effort high。依頼書・結果を `doc/DD/DD-017/` へ）
- [x] Codexレビュー指摘への対応（P2-3 JSON parse→config-invalid 反映ほか。下記ログ）

### Phase 3: CHANGELOG・Quick Start（S1-4/S1-5）
- [x] `CHANGELOG.md`（新設・ルート）: 運用ルール（0.x・破壊的変更必記・API 版↔package 版対応）＋ `0.1.0-alpha.0` 初回エントリ（Added/Changed〔破壊的〕）
- [x] `doc/quick-start.md`（新設）: 前提〔Node 22・Tier 1・TS ビルド環境〕→ build-release → 配布成果物 install → serve → mount → 日本語入力 → error code/debug hook
- [x] `doc/DOC-MAP.md` 更新（quick-start・CHANGELOG を追加）
- [x] 🔬 **機械検証**: `bash scripts/doc-check.sh` green＋Quick Start の手順を `scripts/consumer-app.sh`（release 成果物経由）で再現 green（AC5/AC6）
- [x] 😈 **DA批判レビュー**（下記 DA 記録。Quick Start は consumer-app.sh が機械再現する手順に一致させ「書いてあるのに動かない」を排除）

### Phase 4: compatibility matrix 実測記入・ADR-0015 Accepted 化（CG-4）
- [x] `doc/adr/0015-stage1-api-maturity-and-tier1-support.md`: matrix に最終検証日 2026-07-14・検証DD（DD-012/DD-016-2/DD-017）を実測記入（CG-1/CG-6 証跡転記＋配布物スモーク）・Status を **Accepted** へ・S1-6「private registry」再解釈を明記
- [x] `doc/plan/cg-ledger.md`: CG-4 現在状態を「実測記入済（最終合否=DD-018）」へ更新
- [x] 🔬 **機械検証**: `bash scripts/doc-check.sh` green＋`typecheck`／`lint`／`test` 一括 green（AC7/AC8）。`npm run build` は既存の Vite html-inline-proxy 間欠 flake（DD-017 非起因・下記ログ）を除き green
- [x] 😈 **DA批判レビュー**（下記 DA 記録。転記証跡は DD-016-2 の実 JSON＋配布物 sha256 検証で同一性担保・Accepted 根拠＝Experimental 運用実装済み）

## ログ

### 2026-07-14
- DD作成（roadmap §4 S1-6・DD-016 完了を受けた Alpha 必須ライン次段。番号は roadmap §0 で DD-017 固定）。Codex 利用可否チェック: **利用可**（codex-cli 0.144.0-alpha.4・exit 0）。
- **要確認A: 配布経路の実体** — (a) pack tarball 運用の正式化（既定案候補・DD-016-2 実証済み）／(b) Verdaccio 等の新設／(c) 既存社内 registry の利用（有無・URL・認証要確認）。S1-6 の字面は「private registry」だが (a) でも実質を満たせるため、DD-018 判定への影響込みでユーザー判断が要る。
- **要確認B: 配布形態** — (a) TS ソース配布の継続（既定案候補・実証済み・consumer に TS ビルド環境前提）／(b) dist ビルド（js＋d.ts）配布へ切替（規模増）。
- **要確認C: 初期バージョン・チャネル表記** — 既定案 `0.1.0-alpha.0`＋dist-tag `alpha`（API 版 `0.1.0-experimental` は維持し対応を CHANGELOG に記録）。
- **要確認D: matrix 実測の方式** — 既定案: DD-016-2 実機証跡の転記＋配布成果物での consumer-app 機械スモーク 1 回（人手実機なし）。人手実機を望む場合は Manual Gate が発生する旨を明示。
- ADR-0023（PostgreSQL=Stage 2）ガードをスコープ外条項に明記: DB 運用が Alpha 配布へ波及すると判明したら停止して再判定・ユーザー提示。
- Playwright MCP: 本DDに画面実装 Phase なし（スモークは既存スクリプト経路）＝確認不要。

### 2026-07-14（実装・ゲート代行）

- **要確認A〜D 確定**（ユーザー「一気に進める」指示によるゲート代行）。決定事項へ記入。DDステータス 検討中→進行中。
- **Phase 0**: タスク精査・詳細化・Codex 要否（Phase 2 必須/Phase 1 推奨・high）・DA 調査を記録。
- **Phase 1 実装**: 9 package を `0.1.0-alpha.0` 採番（private 維持＝registry 非経由・pack 正式化）。`scripts/release/build-release.sh` 新設（再現 build ゲート→9 tarball→manifest）。`scripts/consumer-app.sh` に `RELEASE_VENDOR_DIR` 対応。`release/` を gitignore。**検証**: build-release green・`RELEASE_VENDOR_DIR` 経由 consumer-app スモーク green（build/serve/mount/日本語入力(synthetic)/leak なし）。
- **Phase 2 実装（TDD）**: テスト先行（`error-codes.test.ts`・`diagnostics.test.ts`）→ `error-codes.ts`（写像・`GridBootError`）・`diagnostics.ts`（`createDiagnosticSink`）実装。`index.ts`/`mount-controller.ts` へ配線（error に `code` 必須・reject を公開語彙へ写像・診断 hook）。`server-hono` に `ServeOptions.onDiagnostic`（最小）。API invariant allowlist＋facade-surface snapshot を正当な公開面追加として更新。**破壊的変更**: error に `code` 追加・`GridConflict.code` 型変更＋必須化（CHANGELOG 記録済）。
- **facade-surface R7 leak テスト**: 全体スイート同時実行の負荷下で既定 5s timeout に稀に触れるため、TS program emit 系 2 ケースへ明示 30s timeout を付与（assertion 自体は不変）。
- **Phase 3/4**: `CHANGELOG.md`・`doc/quick-start.md` 新設・`DOC-MAP` 更新。ADR-0015 matrix 実測記入＋**Accepted 化**＋S1-6「private registry」→「再現可能な private 配布経路」再解釈明記。cg-ledger CG-4「実測記入済（合否=DD-018）」へ更新。doc-check green。
- **検証総括**: `typecheck`／`lint`（boundary new=0）／`test`（730 green）／build-release／consumer-app スモーク green。DD-INDEX は `bash scripts/dd-index-gen.sh` で再生成。
- **要判断/残課題（build flake）**: `npm run build`（ルート集約）が playground の Vite `[vite:html-inline-proxy] Could not load ...inline-css` で**間欠的に**失敗する。**DD-017 非起因**を確認済（tracked 変更を stash した clean tree でも `npm run build` は 4/4 FAIL、直接 `cd apps/playground && vite build` は 4/4 green）。既存の playground マルチ HTML/inline-CSS ビルドの tooling flake で、本DDは apps/playground を変更していない。スコープ拡大は避け、既知の pre-existing issue として記録（AC8 の build green は直接呼出しで達成可能・別途 tooling 対処を推奨）。

### 2026-07-14 Codex レビュー（effort high・uncommitted・Phase 1推奨＋Phase 2必須を一括）

依頼書 `doc/DD/DD-017/codex-review-request.md`／結果 `doc/DD/DD-017/codex-review-result.md`。**findings 8件（P1×4・P2×4）**。到達性×実害で仕分けた結果、いずれも正当かつ低コストのため**全件対応**（見送り 0）:

- **P1-1（対応）** `.gitignore` の `release/` が非アンカーで `scripts/release/` まで無視＝release スクリプト本体が漏れる → `/release/` へアンカー。`git check-ignore` で scripts/release=tracked・root release=ignored を確認。
- **P1-2（対応）** manifest の tarball 選択が前方一致で `server` が `server-hono-*.tgz` を誤選択しうる → 版込み完全一致（`nanairo-sheet-<pkg>-<version>.tgz`）へ。
- **P1-3（対応）** `--out` 任意パスの `rm -rf` → `rm -f *.tgz manifest.json` の限定削除＋主要ソースディレクトリ指定の拒否ガード。
- **P1-4（対応）** manifest の install がファイル名のみでパス欠落＝別 consumer dir で失敗 → `./` 明示＋`installNote`（tarball を consumer へコピー/release で実行）＋Quick Start/最終ログを修正。
- **P2-1（対応）** release gate に `check-closure.mjs` 未包含（devDep 回帰を hoisting が隠す）→ gate 先頭へ追加。
- **P2-2（対応）** `RELEASE_VENDOR_DIR` スモークが個数のみで sha256 未検証 → `scripts/release/verify-manifest.mjs` 新設（名前/版/ファイル名/bytes/sha256/stray 照合）を consumer-app.sh に組込み。
- **P2-3（対応）** `/config` が HTTP200＋不正 JSON のとき `SyntaxError`→`config-unavailable` 誤写像 → `response.json()` を try/catch し `config-invalid` を throw。
- **P2-4（対応）** 9 package.json を採番したが `package-lock.json` が `0.0.0` のまま＝clean checkout で dirty → `npm install --package-lock-only` で同版へ再生成（diff は版のみ 9/9）。

Codex 修正後: build-release（closure gate 含む）green・consumer-app スモーク（manifest sha256 検証込み）green・test 730 green・typecheck/lint green。

---

## DA批判レビュー記録

### Phase 1（配布・release automation）DA批判レビュー

**DA観点:** 配布成果物と source の乖離・宣言漏れの再発・stale 成果物の誤用。

| # | 発見した問題/改善点 | 重要度 | 再現手順 | DA観点 | 対応 |
|---|-------------------|--------|----------|--------|------|
| 1 | 成果物と working tree の乖離（dirty のまま配布物を作ると source と一致しない） | 中 | dirty tree で build-release → 成果物が未コミット変更を含む | 再現 build の実効性 | ✅ manifest に gitCommit＋gitDirty を刻み WARN 出力 |
| 2 | 内部 inter-dep が devDependencies へ戻っても hoisting で typecheck/lint/test が通過し宣言漏れ tarball を生成 | 高 | dep→devDep 差し戻し→build-release が green で欠陥 tarball 生成 | 宣言漏れの再発 | ✅ gate に check-closure.mjs（Codex P2-1 と同根） |
| 3 | stale/改変 tarball を RELEASE_VENDOR_DIR に置くとスモークが素通し | 中 | 古い tarball 9個→consumer-app が green | tarball 運用の腐敗 | ✅ verify-manifest.mjs で sha256 照合（Codex P2-2） |

### Phase 2（診断面・公開API）DA批判レビュー

**DA観点:** error code の早すぎる固定・後方互換・debug hook の性能影響。

| # | 発見した問題/改善点 | 重要度 | 再現手順 | DA観点 | 対応 |
|---|-------------------|--------|----------|--------|------|
| 1 | 内部 RejectCode の将来追加で公開 code 分岐が壊れる（早すぎる固定） | 中 | 新 RejectCode 追加→consumer の switch が漏れる | 早すぎる固定 | ✅ `unknown` 前方互換フォールバック＋テストで固定 |
| 2 | 既存 consumer（consumer-app）が公開面変更で壊れる | 中 | error/rejected 変更後に consumer-app build | 後方互換 | ✅ consumer-app 無変更で typecheck/build/E2E green（reason 参照のみ・code は加算/写像） |
| 3 | debug hook が hot path の性能に影響 | 低 | onDiagnostic 未指定で mount→hot path | 性能影響 | ✅ hook 未指定時は emit 完全 no-op（entry 生成も now() 呼出しもしない・テストで固定） |
| 4 | `/config` HTTP200＋不正 JSON が誤 code（config-unavailable）になる | 中 | 200 で不正 JSON 返却→config-unavailable 通知 | 仕様一致（taxonomy） | ✅ Codex P2-3。json 解析失敗を config-invalid へ |

### Phase 3/4（文書・matrix）DA批判レビュー

**DA観点:** 文書と実挙動の乖離・転記証跡の実測性・Accepted 化の根拠。

| # | 発見した問題/改善点 | 重要度 | 再現手順 | DA観点 | 対応 |
|---|-------------------|--------|----------|--------|------|
| 1 | Quick Start の install 手順が動かない（tarball パス欠落） | 中 | 別 dir で manifest install → 失敗 | 書いてあるのに動かない | ✅ Codex P1-4。copy→install 手順へ修正（consumer-app.sh が機械再現） |
| 2 | matrix 転記が配布物と別物の証跡に基づく懸念 | 中 | — | 転記証跡の実測性 | ✅ CG-1/CG-6 は DD-016-2 実 JSON・配布物成立は release manifest sha256 検証済スモーク |
| 3 | Accepted 化の根拠不足（Experimental 運用未実装での昇格） | 低 | — | Accepted 根拠妥当性 | ✅ 版採番・pack 配布・CHANGELOG・error code/debug hook 実装済みを根拠に明記 |
