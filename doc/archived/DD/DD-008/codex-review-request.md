# Codex レビュー依頼: DD-008 製品憲章導入と文書体系同期

## 目的

`doc/product/` に配置された製品憲章（Nanairo Sheet 製品憲章・SDK戦略）を文書体系へ正式に組み込み、既存正典群（DOC-MAP・構想記録・開発計画・DDロードマップ・README）と相互参照・役割分担を同期する。あわせて製品名の表記揺れ（SpreadJS / NanairoSheet 等）を調査し、文書内の修正案を提示する。**本DDはドキュメントのみの変更**であり、コード（`apps/*`・`packages/*`）・`package.json`・lockファイルは一切変更していない。

## スコープ（このDDで実施したこと）

1. 製品憲章のステータスを Proposed → Accepted に更新（製品名・一般公開・商用化等の未決定事項は未決のまま保持）。
2. 戦略パッケージを `doc/product/` → `doc/reviews/`（新設・非正典領域）へ移動し、冒頭注記と、本文の「最上位正典とする候補」「最上位文書である」自己記述への打ち消し注記を挿入。
3. 5文書の同期: DOC-MAP（製品戦略＋レビュー資料の2セクション新設）、開発計画（位置付け段落追加・`new SpreadJS` → `new NanairoSheet` 仮称注記付き）、構想記録（歴史的資料である旨と憲章参照）、phase0-dd-roadmap（「最上位」を「DD作業管理上の最上位」に限定＋Phase 1以降のDD必須観点6項目追加）、README（憲章への1行参照）。
4. 名称揺れ調査表 `doc/DD/DD-008/naming-survey.md` を作成。

## 文書体系（3層・確定仕様）

- 製品戦略層 = 製品憲章（`doc/product/nanairo_sheet_product_charter_v1.md`・最上位正典）
- 技術層 = 開発計画（`doc/plan/nanairo_realtime_spreadsheet_development_plan_v1.md`・技術方式の正典）
- 作業管理層 = phase0-dd-roadmap（DD作業管理上の最上位）

矛盾解決原則は憲章 §1 のとおり（製品目的・利用者・提供形態・非目標は憲章、技術方式はADR・開発計画、進行状況はDD-INDEX・各DD、判断理由は構想記録）。

## 対象差分

`git diff`（uncommitted）の doc/・README.md の変更全体。特に:

- `doc/product/nanairo_sheet_product_charter_v1.md`（新規・ステータス更新）
- `doc/reviews/nanairo_sheet_product_strategy_package_v1.md`（移動＋注記）
- `doc/DOC-MAP.md`・`doc/plan/*.md`・`README.md`
- `doc/DD/DD-008/naming-survey.md`（新規）

## 制約・非スコープ

- 正式製品名・リポジトリ名（`spreadjs`）・公開クラス名・パッケージプレフィックスは本DDで決定・変更しない（憲章 P-01/P-02/P-04/P-14 の未決事項）。
- npmスコープの正は `@nanairo-sheet/*`（decisions.md D-003）。本DDで変更しない。
- コード・パッケージ・lock は変更しない。

## 重点的に確認してほしい点（findings 優先）

1. **仕様一致**: 3層文書体系の役割分担・相互参照が、憲章 §1 の矛盾解決原則と各文書の自己記述（正典・最上位表記）で矛盾していないか。「最上位」の多重定義が残っていないか。
2. **移動と注記の整合**: 戦略パッケージの非正典化（冒頭注記＋自己記述への打ち消し注記）が、憲章を正とする体系と齟齬なく機能しているか。DOC-MAP の非正典セクションと整合しているか。
3. **名称揺れの網羅性**: naming-survey.md が `doc/`・README.md の SpreadJS/@spreadjs/NanairoGrid 等の揺れを漏れなく採否付きで扱っているか。実変更（開発計画1箇所）の妥当性、および「修正しない」判断の理由が妥当か。
4. **回帰**: doc-check.sh の孤児・リンク切れが発生しないか（`doc/reviews/` 新設・`doc/product/` 掲載）。リンク・パス参照の切れがないか。
5. **抜け・不足**: 受け入れ基準（DD-008 §受け入れ基準 1〜7）に対して未達・見落としがないか。ドキュメント専用DDとして過不足ないか。
