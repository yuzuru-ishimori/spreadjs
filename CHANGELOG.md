# CHANGELOG — @nanairo-sheet Alpha

`@nanairo-sheet/*`（Facade `grid` / `server-hono` と内部 package）の変更履歴。

## 運用ルール（S1-5・ADR-0015 D1）

- **成熟度**: Stage 1 は **Experimental `0.x`**。Facade（`grid` / `server-hono`）だけが consumer 公開面。長期後方互換は**非保証**。
- **破壊的変更**: `0.x` では破壊的変更を許すが、**必ず本 CHANGELOG に記録**する（サイレント破壊の禁止）。「破壊的変更」節に列挙する。
- **バージョン検出**: package 版（`0.1.0-alpha.0`）と API 版（`GRID_API_VERSION` / `SERVER_HONO_API_VERSION` = `0.1.0-experimental`）の
  両方で検出可能にする。**API 版は公開シグネチャの契約版**、**package 版は配布物の版**で、対応を本 CHANGELOG に記録する。
- **配布**: pack tarball closure 方式（決定事項A・ADR-0015）。`scripts/release/build-release.sh` が 9 tarball＋manifest（版数・sha256・
  生成コミット・channel）を生成する。channel は `alpha`（registry 非経由のため dist-tag 相当を manifest 表記で代替）。

| package 版 | channel | API 版（grid / server-hono） | 備考 |
|---|---|---|---|
| `0.1.0-alpha.0` | `alpha` | `0.1.0-experimental` | 初回 Alpha 配布（DD-017） |

## [Unreleased]

### Added

- **grid 列幅・行高リサイズ（Experimental・DD-012-4）**: 列ヘッダー右端／行ヘッダー下端の境界ドラッグで列幅・行高を変更できる
  （±4px の掴み代・`col-resize`/`row-resize` カーソル・最小 列20px/行16px・最大 2000px でクランプ）。設定は **view-local**
  （他ユーザーへ即時同期しない）。
  - `GridMountOptions.columnWidths?: Readonly<Record<string, number>>`（ColumnId 文字列→px・初期 override）を追加。
  - `GridMountOptions.rowHeights?: Readonly<Record<string, number>>`（RowId 文字列→px・初期 override）を追加。
  - `GridEvent` に `{ type: 'layout'; columnWidths: Record<string, number>; rowHeights: Record<string, number> }` を追加。
    境界ドラッグ確定時（pointerup）に発火し、**既定値と異なる列/行だけ**（override のみ）を含む。利用側はこれを保存し、次回 mount の
    `columnWidths`/`rowHeights` へ渡すと F5 リロードで復元できる（保存先を共有にすれば他ユーザーへも反映）。
  - IME 不変（I-3）維持: リサイズの pointer 操作は編集状態機械へ流さず、変換中でも textarea の value/selection/DOM 親に触れない。

## [0.1.0-alpha.0] — 2026-07-14（DD-017）

初回の Alpha 配布版。配布 closure = `@nanairo-sheet/{grid,server-hono,core,types,collab,render,selection,ime,server}`（9 package）。
`formula` は Alpha 配布 closure 外（現行 Facade の実行時依存でないため未配布・版据え置き）。

### Added

- **配布**: pack tarball closure 方式の正式化（決定事項A）。`scripts/release/build-release.sh`（再現 build ゲート＝typecheck/lint/test →
  9 tarball → manifest〔版数・sha256・生成コミット・channel=alpha〕）。`scripts/consumer-app.sh` は `RELEASE_VENDOR_DIR` で配布成果物経由の
  スモークに対応。
- **版採番**: 配布 closure 9 package を `0.1.0-alpha.0` へ採番（従来 `0.0.0`）。
- **診断（grid）**: `GridEvent` の `error` / `rejected` に**安定した公開エラーコード**を付与（`GRID_ERROR_CODES` / `GRID_CONFLICT_CODES`）。
  内部 `RejectCode` を素通しせず公開語彙へ写像（R7）。未知コードは `unknown` フォールバック。一覧は `doc/DD/DD-017/error-codes.md`。
- **診断（grid）**: `GridMountOptions.onDiagnostic`（debug logging hook・opt-in・既定無出力）を追加。`GridDiagnostic` / `GridDiagnosticLevel` /
  `GridDiagnosticHook` を公開。
- **診断（server-hono）**: `ServeOptions.onDiagnostic`（opt-in・既定無出力・`serve-started`/`serve-stopped`）を追加。`ServeDiagnostic` /
  `ServeDiagnosticLevel` / `ServeDiagnosticHook` を公開。
- **文書**: `doc/quick-start.md`（consumer 向け Quick Start）・`CHANGELOG.md`（本ファイル）を新設。

### Changed（破壊的変更・Experimental 0.x）

- **grid `GridEvent` error**: `code: GridErrorCode` を**必須追加**（`config-unavailable` / `config-invalid` / `connect-failed` / `runtime-fault`）。
  既存の `phase` / `message` は不変。error を読むだけの consumer は影響なし（フィールド追加）。
- **grid `GridConflict.code`**: 型を `string`（内部 `RejectCode` 素通し）から公開語彙 `GridConflictCode` へ変更し、**任意（`code?`）から必須（`code`）へ**。
  値は写像後の安定コード（例 `stale-cell-revision` → `cell-conflict`）。生の内部コードに依存していた consumer は写像表（`error-codes.md`）で追随する。

### Notes

- **Tier 1 対応環境**: Windows Chrome / Edge のみ（ADR-0015 D2・CG-4）。他 OS / ブラウザは対象外（明示・非検証）。
- **配布形態**: TS ソース配布を継続（`main: ./src/index.ts`）。consumer は TS を透過コンパイルできるビルド環境（vite 等）が前提。dist ビルド配布は Stage 2。
- **registry 昇格**: private registry publish は Stage 2/子DD（package.json に `publishConfig` を足し `npm publish --tag alpha` へ切替可能な形で据え置き）。
