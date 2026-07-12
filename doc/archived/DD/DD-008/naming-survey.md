# DD-008 添付: 名称揺れ調査・採否表

> 調査日: 2026-07-12 / 対象: `doc/`・`README.md`（コード領域 `apps/*`・`packages/*` はスコープ外）
> 目的: 製品名・クラス名・npmスコープ・パッケージ名の表記揺れを洗い出し、文書内での採否を提示する。
> 正の基準: npmスコープ = `@nanairo-sheet/*`（decisions.md **D-003**）／製品仮称 = Nanairo Sheet／公開クラス仮称 = `NanairoSheet`。
> **リポジトリ名 `spreadjs`・正式製品名は本DDで決定・変更しない**（憲章 P-01/P-14 の未決事項として保持）。

## 1. 調査コマンドと網羅範囲

```bash
grep -rn "SpreadJS\|@spreadjs\|NanairoGrid\|NanairoSheet\|@nanairo-sheet\|spreadjs" doc/ README.md
```

本表は上記の全ヒットを分類し、`SpreadJS`／`@spreadjs`／`NanairoGrid` のような「現行の正と揺れる表記」を漏れなく採否付きで記載する（AC6・Phase 1 機械検証）。`@nanairo-sheet/*` の正しい用法（DD-003〜006・憲章）は正のため個別列挙せず、末尾でまとめて「修正不要」とする。

## 2. 実変更（本DDで修正する）

| # | 箇所 | 現状 | 変更後 | 理由 |
|---|------|------|--------|------|
| 1 | `doc/plan/nanairo_realtime_spreadsheet_development_plan_v1.md` L414 | `const grid = new SpreadJS(container, {` | `const sheet = new NanairoSheet(container, {`（直前に仮称注記） | 公開API例が商用製品「SpreadJS」（GrapeCity/MESCIUS）と衝突。憲章の公開クラス仮称 `NanairoSheet` に合わせる（戦略レビュー 矛盾表 #1 Critical）。正式名称は未確定のため「仮称」を注記 |

> 本DDの文書内 実変更は上記1箇所のみ（ユーザー確定 仕様6）。以下はすべて「修正しない」または「survey提示のみ」。

## 3. 修正しない（理由付き）

### 3.1 リポジトリ名・ディレクトリ表記

| # | 箇所 | 表記 | 判定 | 理由 |
|---|------|------|------|------|
| 2 | `README.md` L1 | `# spreadjs — …`（タイトル） | 修正しない | リポジトリ名／プロジェクト通称。D-003 で「据え置き（必要になれば別途判断）」。憲章 P-14 で `spreadjs` からの変更は Stage 1 Alpha 前に決定 |
| 3 | `doc/plan/…development_plan_v1.md` L1521 | `spreadjs/`（ディレクトリツリー表記） | 修正しない | 実リポジトリのルートディレクトリ名。リポジトリ名不変更のため一致させる |

### 3.2 商用製品「SpreadJS」への正当な言及（依存回避対象として）

| # | 箇所 | 表記 | 判定 | 理由 |
|---|------|------|------|------|
| 4 | `doc/plan/…concept_record_v1.md` L72 | 「SpreadJS、Handsontable、Univer、AG Grid等…への中核依存は避ける」 | 修正しない | 商用製品名としての正しい言及。自製品を指す表記ではない |
| 5 | `doc/decisions.md` L38 | 「商用スプレッドシート製品『SpreadJS』（GrapeCity/MESCIUS）と名称が衝突」 | 修正しない | D-003 決定の背景説明。商用製品名としての正しい言及 |

### 3.3 旧称の歴史的記録（注記済み・保持）

| # | 箇所 | 表記 | 判定 | 理由 |
|---|------|------|------|------|
| 6 | `doc/decisions.md` L38-40 | `@spreadjs/*`（旧スコープ） | 修正しない | D-003 の決定記録本体。旧スコープが覆された経緯を残す正典。既に「本決定が正」と明記済み |
| 7 | `doc/archived/DD/DD-001_開発基盤monorepo構築.md` L9,34,72,76,80,83,130 | `@spreadjs/*` | 修正しない | アーカイブ済みDD本体。冒頭 L9 に「後日 `@nanairo-sheet/*` へ改名（D-003）」の注記済み。歴史的記録として保持 |
| 7a | `doc/archived/DD/DD-001/codex-review-request.md` L64 | `@spreadjs/sheet-types` | 修正しない | 上記 DD-001 の添付レビュー依頼書。当時のレビュー依頼を再現する歴史的記録。**この添付単体には改名注記はない**が、親DD本体 L9 の改名注記でアーカイブ全体の旧称性は明示されている（アーカイブは注記付きの一体資料）。個別に注記追記はしない |
| 8 | `doc/DD/DD-002_*.md`（アーカイブ）L174 | `@spreadjs/*` → `@nanairo-sheet/*` | 修正しない | 改名経緯そのものの記録 |

### 3.4 公開クラス名の揺れ（`NanairoGrid`）— survey提示のみ

| # | 箇所 | 表記 | 判定 | 理由 |
|---|------|------|------|------|
| 9 | `doc/plan/…concept_record_v1.md` L121 | `const grid = new NanairoGrid(container, options)` | 今回は修正しない（提示のみ） | 構想記録は歴史的入力資料（Active Historical Record）。当時の仮称 `NanairoGrid` を残す。現行の公開クラス仮称は `NanairoSheet`（憲章 P-02）。Phase 1 最初の Facade DD で公開クラス名を確定する際にコード例を更新する。本DDでは concept_record 冒頭に「歴史的資料・現在の正は憲章」注記を追加することで誤読を防ぐ |

### 3.5 パッケージ名プレフィックスの揺れ（`sheet-*` vs 憲章の短縮名）— survey提示のみ

| # | 箇所 | 揺れ | 判定 | 理由 |
|---|------|------|------|------|
| 10 | 憲章 §10 vs 実リポジトリ | 憲章は `@nanairo-sheet/core`・`@nanairo-sheet/grid` 等（短縮名）。実リポジトリ・README・DD は `@nanairo-sheet/sheet-core`・`@nanairo-sheet/sheet-types` 等（`sheet-` プレフィックス付き） | 今回は修正しない（提示のみ） | 憲章はパッケージ「候補」名（Phase 1 で確定）。実装済みは `sheet-` プレフィックス付き。どちらを正とするかは憲章 P-04「利用者向けパッケージ構成」＝Phase 1 パッケージ設計DDの決定事項。本DD（文書同期・低リスク）のスコープ外。**要フォロー: Phase 1 で `@nanairo-sheet/{core|grid}` か `@nanairo-sheet/sheet-*` かを D-003 に次ぐ決定として確定する** |

### 3.6 移動する戦略レビュー資料内の旧称言及

| # | 箇所 | 表記 | 判定 | 理由 |
|---|------|------|------|------|
| 11 | `doc/reviews/nanairo_sheet_product_strategy_package_v1.md`（移動後）L1126,1290 等 | `new SpreadJS(...)`・「`new SpreadJS(...)` で既存商用製品と衝突」 | 修正しない | 憲章作成時の分析・レビュー資料（非正典・歴史的記録）。矛盾指摘そのものを記録する文書のため原文保持。冒頭注記＋自己記述（60/69行）への打ち消し注記で非正典性を明示（Phase 2） |

## 4. 修正不要（現行の正・正しい用法）

| 対象 | 表記 | 状態 |
|------|------|------|
| `doc/product/nanairo_sheet_product_charter_v1.md`（憲章） | `@nanairo-sheet/*`・`NanairoSheet`・製品仮称 Nanairo Sheet | 正典。正の定義元 |
| `doc/DD/DD-003〜006`（アクティブDD） | `@nanairo-sheet/sheet-core` 等 | D-003 準拠の正しい用法 |
| `doc/DD/DD-004` L49 | `@nanairo-sheet/sheet-types` | 正しい用法 |

## 5. まとめ

- **実変更は開発計画 L414 の1箇所のみ**（`new SpreadJS` → `new NanairoSheet`＋仮称注記）。AC6・Phase 3 機械検証（`new SpreadJS` が 0 件）で担保。
- リポジトリ名 `spreadjs`・正式製品名・公開クラス名・パッケージプレフィックスは**本DDで確定しない**（憲章 P-01/P-02/P-04/P-14 の未決事項）。
- 旧称 `@spreadjs/*` の残存はすべて「決定記録／アーカイブ／改名経緯」の歴史的記録であり保持する。改名注記は decisions.md D-003（正）と各アーカイブDD本体の冒頭注記に存在する（アーカイブ配下の添付ファイル単体には個別注記を付けない＝親DDと一体の歴史的資料として扱う）。
- **Phase 1 へのフォロー事項**: (a) 公開クラス名を `NanairoSheet` で確定し concept_record L121 のコード例を更新、(b) パッケージ名を `@nanairo-sheet/sheet-*` と `@nanairo-sheet/{core|grid}` のどちらに統一するか決定。
