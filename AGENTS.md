# AGENTS.md

> 全エージェント共通の正本（Codex は直接、Claude Code は CLAUDE.md の `@AGENTS.md` インポート経由で読む）

## プロジェクト概要

spreadjs — 業務Webアプリへ組み込む TypeScript製リアルタイム共同編集スプレッドシート型入力基盤。日本語IME・数万行Canvas描画・サーバー主導の共同編集を優先する。詳細は `doc/plan/`。

- **ステータス**: Phase 0 着手判断段階（実装未着手。現状は計画・設計ドキュメントのみ）
- **技術スタック**: React（業務UI外周） / TypeScript製グリッドコア（Canvas 2D・依存ゼロ） / Hono + `@hono/node-server` + `ws`（API・WebSocket） / PostgreSQL
- **正典**: `doc/plan/nanairo_realtime_spreadsheet_development_plan_v1.md`（アーキテクチャ・ADR・プロトコル・IME・数式・性能・リスク）
- **ドキュメント一覧**: `doc/DOC-MAP.md`（全ドキュメントの場所と目的。迷ったらまずここ）
- **概要**: `README.md`

## コマンド

> ビルド／テスト系（`npm run dev|build|lint|test|precheck`）は monorepo 未構築のため**未整備**。Phase 0 で `packages/` を作成する際に定義する（想定構成は `README.md` / 計画書 §5・§17 を参照）。現状で使えるのはドキュメント系スクリプトのみ。

| コマンド | 用途 |
|---------|------|
| `bash scripts/doc-check.sh` | ドキュメント整合性チェック（DOC-MAP孤児・リンク切れ） |
| `bash scripts/dd-index-gen.sh` | DD-INDEX.md 再生成（直接編集しない） |

## DD設定

- **DDフォルダ**: `doc/DD/` / **アーカイブ**: `doc/archived/DD/` / **テンプレート**: `doc/templates/dd_template.md`
- **パス設定**: ルート直下の `.dd-config`（スクリプト・フックはここを読む。上の実パスと常に一致させる）
- **ステータス**: 固定6種（検討中/進行中/確認待ち/保留/見送り/完了）+ 補足列。語彙ルール: `doc/templates/guides.md` §3
- **スキル**: `/dd new|list|log|archive|search|rebuild-index|health`（Claude Code: `.claude/skills/` / Codex: `.agents/skills/` — 同一内容のミラー）
- **自動フロー**: `/dd-auto <機能>` = 起票(Fable)→〔仕様確認〕→実装(Opus)→Codexレビューを自動振り分け（`.claude/agents/dd-drafter`・`dd-implementer` を使用。Claude Code 専用）
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
