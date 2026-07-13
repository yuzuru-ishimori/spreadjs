# Codex レビュー依頼: DD-011 基盤実装（package skeleton・boundary lint・不変条件スイート・consumer harness）

## 目的（このDDが何を達成するか）

Stage 1 SDK Alpha の縦切りDD群（DD-012〜018）が乗る**共通基盤を機械的に設置**する。Risk Class B（承認済みバックログ範囲・機械的整備）。
設計判断は先行DD（DD-009 package-boundary.md §4 が boundary lint の正本／DD-010 で安定ID解除済み）で確定済みで、本DDは**実装のみ**。
前提の子DD DD-011-1（package rename）は完了済で、最終名 `@nanairo-sheet/{types,core,collab,server,formula}` の上に構築している。

## スコープ（この差分に含むもの）

1. **codec 移設**: `packages/collab/src/message-codec.ts` → `packages/core/src/message-codec.ts`（挙動保存）。
   理由: `server-hono`（サーバー）と `collab`（クライアント）双方が decode を使うため core 所有にしないと R3 逆流（server→collab）になる（DD-009 Codex P1 反映）。
   consumer（server.ts・ws-transport.ts・browser-transport.ts）の import を `@nanairo-sheet/collab` → `@nanairo-sheet/core` へ追随。
2. **Facade skeleton（stub）**: `packages/grid`（`@nanairo-sheet/grid`・mount/destroy stub）・`packages/server-hono`（`@nanairo-sheet/server-hono`・serve/stop stub）を新設。
   **実 API は確定しない**（実装は DD-016）。内部パッケージへ依存ゼロ・内部型を公開シグネチャへ出さない。
3. **package boundary lint**（DD-009 §4 の R1〜R7 を実装。規約の新規発明はしない）:
   - `eslint.config.js`: R2（Facade間）・R3（依存逆流）・R5（apps間 by-name）を `no-restricted-imports` で full-error。DAG 定義は `scripts/boundary/policy.mjs` に単一化。
   - `scripts/boundary/check.mjs`（`npm run lint:boundary`）: R1（consumer→内部・既存 apps は baseline）・R4（package 境界越え相対 import）・R7（Facade 再エクスポート／内部型漏洩）を TypeScript AST で検査。
   - `scripts/boundary/baseline.json`: 既存違反（R1×38・R4×3）を既知例外として固定化。新規違反のみ ERROR。縮退は DD-012〜016・ゼロ確認は DD-018。
4. **常設不変条件スイート runner**: `tests/invariants/{ime,collab,api,perf}` ＋ `npm run test:invariants`。各カテゴリ最小ケース1本以上（実充足は各縦切りDD）。
5. **contract test 骨格**: `tests/contract/facade-surface.test.ts`（Facade の公開 value surface を snapshot 契約化）。
6. **independent consumer harness（雛形）**: `consumer-harness/`（workspaces 対象外）＋ `scripts/consumer-harness.sh`（pack→install→tsc --noEmit。S1-3 不合格条件＝内部直接 import・source path 参照・workspace link を機械検査）。
7. **DD差分テンプレ**: `doc/plan/dd-risk-class-header.md` 新設（Risk Class ヘッダ＋製品化6観点）＋DOC-MAP 追記。

## 設計意図・制約（レビュー時に前提としてほしい）

- **B→A 昇格の境界**: Facade は **stub に留め、実 API を確定させない**（Internal 予定 API を consumer へ確定露出したら A 昇格）。stub が実 API を固定していないか観点で見てほしい。
- **boundary lint の段階導入**（DD-009 §4.3）: R3/R4/R5 は最初から full-error・R1 は既存 apps を baseline・R7 は AST。テスト専用ハーネス（`*.test.ts`・`test-support.ts`・`inprocess-transport.ts`）は境界検査の対象外（§4.3 test 例外）。
- **確定事項（2026-07-13 ユーザー）**: ①テンプレは templates を改修せず別ファイル新設 ②機械修正で済む既存違反は是正・大きい構造変更は baseline 化 ③harness は雛形（実証は DD-016）④rename は DD-011-1 で完了。
- pocd-bench/pocd-browser-bench は PoC-D throwaway（製品憲章 §25 対象外）。R4 違反は baseline（owner なし）。

## 重点的に見てほしい観点（findings 優先で）

1. **仕様一致**: boundary lint の許可/禁止方向が DD-009 §4.1 の DAG と一致しているか。policy.mjs の ALLOWED_DEPS に誤り/漏れはないか。
2. **バリデーション/回帰**: codec 移設で decode の挙動・import 差し替えに取りこぼしがないか（旧 `@nanairo-sheet/collab` からの decode import が残っていないか）。
3. **境界検査の穴**: R1/R4/R7 の検査が回避可能な抜け道はないか（例: 動的 import・`export type` 再エクスポート・subpath import・baseline のなりすまし）。
4. **stub の早すぎるAPI固定**: grid/server-hono の公開面が DD-016 の設計余地を奪っていないか。
5. **consumer harness の実効性**: S1-3 不合格条件（workspace link・source path・内部 import）の検査が本当に機能するか（symlink 判定・grep の取りこぼし）。
6. **テスト不足**: 不変条件の最小ケースが「動くだけの形骸」になっていないか。contract snapshot が破壊的変更を実際に捕捉するか。

## 検証状況（実装側で確認済み）

- `npm run typecheck`・`npm run lint`（eslint＋boundary）・`npm run build` green。
- `npm run test:invariants`（8）・contract（2）green。`bash scripts/consumer-harness.sh` green（pack→install→tsc）。
- boundary 否定テスト（R1/R4/R5/R7 フィクスチャ）で ERROR 検出を確認済み。contract 否定テスト（export 追加で fail→snapshot 更新で復旧）確認済み。
- `npm run test` は 570/571 green。1 failure は `ws-convergence.smoke`（実WS×3クライアント×1000op・`waitFor` 20s ハード上限）で、**マシン高負荷（並行 node 20+）による timeout の環境要因**（baseline から flaky・codec は byte 同一で decode 単体テスト green）。
