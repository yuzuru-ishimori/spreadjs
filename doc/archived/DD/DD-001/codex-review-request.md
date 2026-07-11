# Codexレビュー依頼: DD-001 開発基盤monorepo構築

別モデル（Codex）視点で、下記の実装差分を **findings 優先**でレビューしてください。
特に「仕様一致・回帰・テスト不足・不変条件の破れ」を重視し、重要度（高/中/低）付きで指摘してください。
指摘の修正は実装側（Claude）が行うため、**リポジトリは変更しないでください**（read-only）。

## DDの目的

npm workspaces による monorepo 骨格（`packages/` と `apps/`）と、`npm run dev|test|typecheck|lint`
が動く最小の開発基盤を構築する。以降の PoC-A〜D はすべてこの基盤の上に載る。
正典: `doc/plan/nanairo_realtime_spreadsheet_development_plan_v1.md`（§6.1 識別子・§17 リポジトリ構成）。

## スコープ（作ったもの / 作らないもの）

- 作った: ルート `package.json`（workspaces / engines / scripts）、`.gitignore`、`tsconfig.base.json`、
  `packages/sheet-types`（ブランド型 + ファクトリ + テスト）、`apps/playground`（空Canvas土台 + Vite）、
  `eslint.config.js`（flat / typescript-eslint recommended）、`vitest.config.ts`、
  ドキュメント更新（AGENTS.md コマンド表・README ステータス・decisions.md D-001/D-002）。
- 作らない: 製品ロジック（グリッド描画・IME・サーバー）、CI、`sheet-core` 等の他パッケージ、
  package boundary lint（PoC-C 以降で導入）。

## 設計意図・確定事項（ユーザー合意済み）

- パッケージマネージャは **npm workspaces**（pnpm 等は入れない）。Node.js は **22 基準**（`engines.node: ">=22"`）。
- `packages/*` は**ランタイム依存ゼロ**（計画書 §3.6・ADR-022）。dev 依存はルートに集約する。
- **`sheet-types` は DOM lib なしでコンパイルできること**（計画書 §17.2「coreにDOM型を持ち込まない」）。
  そのため `tsconfig.base.json` には `lib` を置かず、`sheet-types` は `lib: ["ES2022"]`、
  `playground` だけ `lib: ["ES2022","DOM","DOM.Iterable"]` を足す。
- ブランド型（§6.1）は `string & { __brand }`。ファクトリは既存文字列をブランドへ持ち上げるだけ
  （ID採番ロジックは後続DD）。ブランド構築に `as` を用いるのは TypeScript の nominal typing の
  慣用手段であり、外部データの危険なダウンキャストではない（この点の是非も見てほしい）。
- `sheet-types/package.json` の `exports`/`types` は `./src/index.ts`（ソース直参照）。playground は
  Vite/tsc(bundler resolution) でソースを直接消費する（ビルド成果物を介さない）。
- 依存の重複と esbuild の dev-only 脆弱性回避のため、root に `overrides: { "vite": "^6.4.3" }` を置き、
  vite を単一の 6.4.3 に統一した（vitest も同じ vite を使う）。

## レビュー対象差分

未コミット変更すべて（`git status` / `git diff HEAD` / untracked）。
実装の中心は次のファイル:
`package.json`, `tsconfig.base.json`, `eslint.config.js`, `vitest.config.ts`,
`packages/sheet-types/{package.json,tsconfig.json,src/ids.ts,src/index.ts,src/ids.test.ts}`,
`apps/playground/{package.json,tsconfig.json,index.html,src/main.ts}`,
`AGENTS.md`, `README.md`, `doc/decisions.md`。
（`package-lock.json` は生成物、`node_modules/` は gitignore 対象なので無視してよい。）

## 受け入れ基準（この差分で満たすべきこと）

1. `npm install` → exit 0、`npm run dev` → playground（Vite）が起動し空Canvasを表示。
2. `npm run test` → sheet-types のユニットテストが pass。
3. `npm run typecheck` → エラー0（sheet-types は DOM lib なしで型検査が通る）。
4. `npm run lint` → エラー0。
5. `packages/sheet-types/package.json` に `dependencies` が無い（ランタイム依存ゼロ）。
6. AGENTS.md「コマンド」表が実コマンドに更新され、`bash scripts/doc-check.sh` → エラー0。
7. `doc/decisions.md` に A-01/A-02/D-01 の確定（D-001）と monorepo 方針（D-002）が記録されている。

（当方の実測ではローカルで 1〜7 の機械検証はすべて green。#1 の「ブラウザーで空Canvas目視」だけは
未確認＝手動キャプチャ待ち。）

## 特に確認してほしい観点

- **不変条件**: `sheet-types` に将来ランタイム依存や DOM 型が混入しにくい設計になっているか。
  `tsconfig.base.json` に `lib` を置かない方針は妥当か（各 workspace の lib 追加漏れリスクは？）。
- **設定の正しさ**: workspace 参照（`@spreadjs/sheet-types: "*"`）、`exports` の `.ts` 直参照、
  `moduleResolution: "bundler"`、`verbatimModuleSyntax`/`isolatedModules` の組み合わせに落とし穴はないか。
- **テスト**: ブランド型の「区別」を型注釈で示しているが、`vitest run`（esbuild）は型検査しないため
  実質 typecheck 側で担保している。この担保が十分か、より良い最小テストがあるか。
- **スクリプト配線**: `typecheck`/`test`/`lint`/`dev` のルート集約と workspace 委譲が正しいか。
  Windows（cmd 経由の npm scripts）で壊れる書き方をしていないか。
- **コーディング規約**（`doc/templates/coding-standards.md`）: P01(any)/P19(型迂回)/P20(スタブ)/P21(デバッグ出力)
  等の違反がないか。ブランド型ファクトリの `as` の扱いを含め判定してほしい。
- **回帰/整合**: ドキュメント更新（AGENTS.md/README/decisions.md）が実装と食い違っていないか。
