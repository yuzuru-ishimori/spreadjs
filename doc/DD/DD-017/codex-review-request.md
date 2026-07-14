# Codex レビュー依頼 — DD-017 Alpha配布・診断（Phase 1 release automation・Phase 2 診断面）

## DD の目的・スコープ

DD-017 は Stage 1 移行条件 S1-6（配布・運用成果物）を充足する。**Phase 1=配布正式化・release automation**（pack tarball
closure 方式の正式化・版採番・再現 build スクリプト）と **Phase 2=診断面**（grid Facade の安定 error code 語彙・debug logging
hook）が本レビュー対象。IME・protocol・永続化・OCC のコアには触れない（Experimental 0.x 公開面の拡張のみ）。

要確認は全て既定案で確定済み（ゲート代行・2026-07-14）: A=pack tarball closure 正式化（registry 立てない）／B=TS ソース
配布継続／C=`0.1.0-alpha.0`＋channel `alpha`／D=DD-016-2 実機証跡転記＋配布物機械スモーク1回。

## 確認してほしい観点（findings 優先・到達性×実害で）

1. **仕様一致**: error code 語彙が「内部 protocol コードを素通ししない（R7）」を満たすか。公開面（`grid` value export＝
   `mount`/`GRID_API_VERSION`/`GRID_ERROR_CODES`/`GRID_CONFLICT_CODES`）に内部型漏洩がないか。
2. **後方互換/破壊的変更**: `GridEvent` error への `code` 必須追加・`GridConflict.code` の `string→GridConflictCode`＋必須化が
   CHANGELOG に正しく記録されているか。consumer が壊れる導線はないか（既定案では consumer-app は無変更で green）。
3. **error code 写像の健全性**: `toGridConflictCode` の写像表（`packages/grid/src/error-codes.ts`）に取りこぼし・誤写像が
   ないか。未知コードの `unknown` フォールバックが前方互換として機能するか（内部 RejectCode 追加で consumer が壊れないか）。
4. **debug hook の安全性**: `createDiagnosticSink`（`packages/grid/src/diagnostics.ts`）・server-hono `onDiagnostic` が
   opt-in・既定無出力・hook 例外の非波及・hot path 性能非影響を満たすか。診断で機微情報を過剰に出していないか。
5. **release automation の再現性**（`scripts/release/build-release.sh`）: 再現 build ゲート（typecheck/lint/test 前置）・
   版一貫性検査・manifest（版数/sha256/生成コミット/dirty フラグ）が「配布成果物と source の乖離」を検出できるか。
   pack closure（9 tarball）の宣言漏れ再発（`check-closure.mjs` 通過）を隠さないか。dry-run と実配布の差はないか。
6. **回帰・テスト不足**: error-codes/diagnostics の単体テスト（`packages/grid/src/{error-codes,diagnostics}.test.ts`）に
   抜けはないか。mount-controller での写像・診断配線に未テストの分岐がないか。

## 対象差分（uncommitted）

- `packages/grid/src/error-codes.ts`（新）・`diagnostics.ts`（新）・同 `*.test.ts`（新）
- `packages/grid/src/index.ts`（公開型追加）・`mount-controller.ts`（写像・診断配線）
- `packages/server-hono/src/index.ts`（ServeOptions.onDiagnostic）
- `packages/{9 package}/package.json`（`0.1.0-alpha.0` 採番）
- `scripts/release/build-release.sh`（新）・`scripts/consumer-app.sh`（RELEASE_VENDOR_DIR 対応）
- `tests/invariants/api/api.invariant.test.ts`・`tests/contract/facade-surface.test.ts`（allowlist/snapshot/timeout）
- 文書: `CHANGELOG.md`・`doc/quick-start.md`・`doc/DD/DD-017/error-codes.md`・`doc/adr/0015-*.md`・`doc/plan/cg-ledger.md`

## 制約・設計意図

- 配布は registry 非経由の pack closure（9 tarball 同時 install が前提。1 つ欠けると module 解決不能）。TS ソース配布継続。
- error code 語彙は「最小 taxonomy＋`unknown` 前方互換」で早すぎる固定を避ける設計。
- ADR-0023 ガード: PostgreSQL 運用は Alpha 配布へ波及させない（本 DD で DB 運用は触れない）。
