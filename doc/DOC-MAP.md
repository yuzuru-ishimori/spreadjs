# DOC-MAP: ドキュメントインデックス

> doc/ フォルダ内の全ドキュメントの場所と目的。
> **ドキュメントの追加・移動時はここも更新すること。**

## プロジェクト概要

| ファイル | 説明 |
|---------|------|
| `doc/project-overview.md` | プロジェクトスコープ・環境・方針（未作成。最初に書くことを推奨） |
| `README.md`（ルート） | 製品概要・アーキテクチャ・ロードマップ（開発者向けの入口） |

## 製品戦略（最上位正典）

| ファイル | 説明 |
|---------|------|
| `doc/product/nanairo_sheet_product_charter_v1.md` | 製品憲章・SDK戦略（**製品戦略層の最上位正典**。製品の目的・利用者・提供形態・非目標・成熟段階の正。技術方式は開発計画、DD作業管理はロードマップが担当） |

## 計画・構想

| ファイル | 説明 |
|---------|------|
| `doc/plan/nanairo_realtime_spreadsheet_development_plan_v1.md` | 開発計画・基本設計（技術方式の正典。アーキテクチャ・ADR・プロトコル・IME・数式・性能・リスク。上位は製品憲章） |
| `doc/plan/nanairo_realtime_spreadsheet_concept_record_v1.md` | 構想記録（計画書の入力資料＝歴史的記録。製品戦略の現在の正は製品憲章） |
| `doc/plan/phase0-dd-roadmap.md` | Phase 0のDDロードマップ（DD作業管理上の最上位。計画書§18/§26→DDの写像。dd-auto実行順と進捗対応表） |
| `doc/plan/phase1-dd-roadmap.md` | Stage 1 SDK Alpha DDロードマップ（**正式版**。Stage 1社内SDK Alphaまでの縦切りDD計画 DD-009〜022。密度レジーム・境界整合・SDK Alpha完了条件・CG-1〜6 ハードゲート） |
| `doc/plan/cg-ledger.md` | CG解除台帳（条件付きGo 解除ゲート CG-1〜6 の横断追跡。DD-018 移行判定まで複数DDが参照する常設台帳。起票: DD-009。定義本体は phase1-dd-roadmap.md §0） |

## レビュー・分析資料（非正典）

| ファイル | 説明 |
|---------|------|
| `doc/reviews/nanairo_sheet_product_strategy_package_v1.md` | 製品戦略・文書整合レビュー（製品憲章作成時の分析・レビュー資料。**非正典**・歴史的記録。製品戦略の正は製品憲章） |

## アーキテクチャ決定記録（ADR）

| ファイル | 説明 |
|---------|------|
| `doc/adr/0005-server-ordered-operation-log.md` | サーバー主導型全順序Operationログ（PoC-C/DD-003で検証・Status: Proposed） |
| `doc/adr/0015-stage1-api-maturity-and-tier1-support.md` | Stage 1 Alpha の公開API成熟度方針（Internal→Experimental・0.x・CHANGELOG・fail-fast）とTier 1対応環境（Win Chrome/Edge・CG-4）（DD-009で起票・Status: Draft・Accepted化はDD-016） |
| `doc/adr/0008-optimistic-apply-rollback-replay.md` | 楽観適用＋rollback/replay（PoC-C/DD-003で検証・Status: Proposed） |
| `doc/adr/0011-row-slot-chunked-cell-store.md` | 行スロット＋チャンク化セルストア（PoC-B/DD-004で起票・Status: Draft・DD-006で拡充） |
| `doc/adr/0022-zero-runtime-dependency-core.md` | コアはゼロランタイム依存を原則（DD-005/006で実証・Status: Draft・Accepted化はDD-007） |

## プロセス・開発規約

| ファイル | 説明 |
|---------|------|
| `doc/da-method.md` | DD + Devil's Advocate 開発方法論（品質フィルター・再チェック条件） |
| `doc/spec-sync-check.md` | DDアーカイブ時の仕様書同期チェック手順 |
| `doc/engineering-patterns.md` | エンジニアリングパターン集（gotcha・定石。DAの同根パターンの昇格先） |
| `doc/decisions.md` | 意思決定記録（長寿命のアーキテクチャ決定。「なぜこうなってる？」の逆引き） |
| `doc/templates/coding-standards.md` | コーディング基準書（P規約・採点基準・Lint対応表） |

## 仕様書（現在形の正典）

> DD = 変更の記録（フロー）、spec = 現在の姿（ストック）。
> DDアーカイブ時に同期チェックを行う（手順: spec-sync-check.md、Level 2 で doc/ 直下に配置）。

| パス | 説明 |
|------|------|
| `doc/spec/` | 画面・機能仕様書（テンプレート: `doc/templates/screen-spec-template.md`） |

## DD 設計文書

| パス | 説明 |
|------|------|
| `doc/DD/` | アクティブな設計文書 |
| `doc/DD/DD-INDEX.md` | DD一覧インデックス（`scripts/dd-index-gen.sh` で自動生成） |
| `doc/archived/DD/` | 完了済みDD（アーカイブ） |

## テンプレート

| ファイル | 説明 |
|---------|------|
| `doc/templates/dd_template.md` | DD標準テンプレート（DA批判レビュー組み込み済み） |
| `doc/templates/dd_template_bugfix.md` | バグ修正DD用 差分テンプレート |
| `doc/templates/dd_template_mock.md` | モック先行DD用 差分テンプレート |
| `doc/templates/dd_template_e2e.md` | E2E駆動DD用 差分テンプレート |
| `doc/templates/dd_template_tdd.md` | TDD駆動DD用 差分テンプレート |
| `doc/templates/guides.md` | DD作成ガイド（アプローチ選択・命名・サイズ管理・エビデンス） |
| `doc/templates/screen-spec-template.md` | 画面仕様書テンプレート（フロントマター status_check 付き） |

<!--
プロジェクトの成長に合わせてセクションを追加していく（参考: 成熟プロジェクトの構成例）:
- ## アプリケーション理解 (guide/)    — 全体ガイド・画面カタログ・用語集
- ## システム設計・仕様 (spec/)        — 機能仕様・状態遷移・権限モデル
- ## デプロイ (deploy/)               — デプロイ手順・ロールバック
- ## 運用 (operation/)                — サーバー構成・cron・監視
- ## セキュリティ (security/)          — 監査レポート・インシデント対応
-->
