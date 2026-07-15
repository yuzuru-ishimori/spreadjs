# Codex レビュー依頼書 — DD-017-2: SDK紹介サイト・機能カタログ（showcase）

## 背景・目的

SDK は完成度が外部から見えないため、全機能を「提供中／開発予定／対象外」の3区分で紹介する**紹介サイト（機能カタログ）**と、Facade 経由の**動作デモ**を常設する（DD-017-2。親=DD-017 Alpha配布・診断）。ユーザーは HTML モックを承認済み（2026-07-15）。本レビューは Phase 2（apps/showcase 実装）＋Phase 3（デモ配線・運用固定）の実装差分を束ねて1回で行う。

## スコープ（対象差分 = uncommitted 全量）

- `apps/showcase/` 新設（Vite workspace アプリ・ポート 5886）
  - `index.html`＋`src/catalog/main.ts` — 機能カタログ。`src/features.json`（単一データ源）から3区分カードを描画
  - `demo.html`＋`src/demo/main.ts`＋`src/demo/scenarios.ts` — 動作デモ5シナリオ。**`@nanairo-sheet/grid` Facade のみ import**（R1）
  - `src/features.test.ts` — カタログ整合性 smoke（vitest・DD-009〜022 網羅・デモリンク⇔シナリオ対応）
  - `playwright.config.ts`＋`e2e/showcase.spec.ts` — 実ブラウザー smoke（起動・カタログ描画・デモ接続）
  - `README.md` — 起動手順＋5分デモ台本＋features.json 更新義務
- `scripts/dev-start.sh` / `dev-kill.sh` — `--showcase`（5886＋server 9499・50k行シード＋`PERSISTENCE_DIR=.dev-persistence/showcase`）・`--server-only`・`--server` 追加
- ルート `package.json` — `test:e2e:showcase` 追加・`build` を `--workspaces --if-present` へ変更
- `AGENTS.md`（コマンド表・ドキュメント更新義務に features.json）・`doc/DOC-MAP.md`・`.gitignore`（`.dev-persistence/`）
- `doc/DD/DD-017-2*` — DD本体・添付（レビュー対象外の記録類）

## 設計意図・制約

- **showcase は consumer**: SDK 内部パッケージを import しない（boundary lint R1 が機械検査。baseline 追加 0 を確認済み）
- **features.json 一元化**: 機能×ステータスは features.json のみで管理し HTML に手書きしない（腐った紹介サイト防止）。正本は roadmap §4・stage2-backlog・§6 境界で、features.test.ts が突き合わせる
- **コア無改変**: packages/* への変更なし。公開 API・protocol・永続化に触れない（Risk Class B）
- **永続化デモ**: `--showcase` は PERSISTENCE_DIR を設定。シードは fresh 時のみ（DD-014/DD-018-1 実装済み挙動）なので再起動で復旧する、が前提
- 検証済み: typecheck / eslint / lint:boundary（new=0）/ build（playground＋showcase）/ vitest 744 全 green / Playwright smoke 3 本 green / `--showcase` 起動 HTTP 200

## 重点確認観点（findings 優先で）

1. **仕様一致**: features.json の3区分・概要・出典が DD-017-2 の受け入れ基準（AC1〜7）と整合するか。カタログ描画ロジック（catalog/main.ts）にデータ欠落・区分誤りの経路がないか
2. **デモシナリオの正しさ**: scenarios.ts の手順（特に persist / reconnect の `dev-kill.sh --server`→`dev-start.sh --showcase --server-only`）が実装済みサーバー挙動（seed は fresh 時のみ・durable 復旧・自動再送）と食い違わないか
3. **シェルスクリプト回帰**: dev-start.sh / dev-kill.sh の変更が既定動作（playground・`--integration`）を壊していないか。env 配列・ポート・strictPort の扱い
4. **ルート build 変更の影響**: `build --workspaces --if-present` への変更による回帰（DD-017-1 の realpath 正準化は showcase vite.config にも踏襲済み）
5. **テストの実効性**: features.test.ts / showcase.spec.ts が「腐った紹介サイト・壊れたデモ」を実際に検出できるか（すり抜け経路）
6. **XSS・安全性**: catalog/main.ts・demo/main.ts は textContent／自前 `<code>` パースのみで innerHTML 不使用の維持
