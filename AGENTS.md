# AGENTS.md

> 全エージェント共通の正本（Codex は直接、Claude Code は CLAUDE.md の `@AGENTS.md` インポート経由で読む）

## プロジェクト概要

{プロジェクトの説明を1〜2行で。詳細は doc/ に置き、ここには書かない}

- **技術スタック**: {FE} / {BE} / {DB} / {インフラ}
- **ドキュメント一覧**: `doc/DOC-MAP.md`（全ドキュメントの場所と目的。迷ったらまずここ）

## コマンド

| コマンド | 用途 |
|---------|------|
| {`npm run dev`} | 開発サーバー起動 |
| {`npm run build`} | ビルド + 型チェック |
| {`npm run lint`} | Lint（修正ヒント: `tools/lint-fix-hints.json`） |
| {`npm test`} | テスト実行 |
| `bash scripts/doc-check.sh` | ドキュメント整合性チェック（DOC-MAP孤児・リンク切れ） |
| {`npm run precheck`} | DD完了前の集約チェック（lint + テスト + doc-check） |

## DD設定

- **DDフォルダ**: `doc/DD/` / **アーカイブ**: `doc/archived/DD/` / **テンプレート**: `doc/templates/dd_template.md`
- **パス設定**: ルート直下の `.dd-config`（スクリプト・フックはここを読む。上の実パスと常に一致させる）
- **ステータス**: 固定6種（検討中/進行中/確認待ち/保留/見送り/完了）+ 補足列。語彙ルール: `doc/templates/guides.md` §3
- **スキル**: `/dd new|list|log|archive|search|rebuild-index|health`（Claude Code: `.claude/skills/` / Codex: `.agents/skills/` — 同一内容のミラー）
- **開発フロー**: DD作成 → 仕様確認 → 実装 → 検証 → 完了（いきなりコードを書かない）
- **DA メソッド**: `doc/da-method.md` / **コミット**: `DD-{番号}: 概要` 形式

## コーディング規約

- 基準書: `doc/templates/coding-standards.md`（コードレビューはこの基準で評価する）
- フロントエンド実装時は Modern Web Guidance で最新Webプラットフォーム知識を取得:
  `npx modern-web-guidance@latest search "<課題>"` → `retrieve <ガイドID>`

## ドキュメント更新義務

- `doc/` にドキュメントを追加・移動したら `doc/DOC-MAP.md` も更新する
- 画面・API・DBを変更したら、対応する仕様書も同じ変更で更新する

## エージェント別の注意

- 編集ガード等の hooks は Claude Code 固有。Codex 等ではガードが効かないがルールは同じ: DD-INDEX.md は直接編集せず `bash scripts/dd-index-gen.sh` で再生成する
