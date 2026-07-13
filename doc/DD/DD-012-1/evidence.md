# DD-012-1 証跡（Evidence full・自動実装部）

> Evidence Level: full（A 区分）。実機部（Phase 4・CG-1）は実機セッション後に追記する。
> 本書は自動実装可能な Phase 1〜3（IME 不変条件・型変換・ローカル Operation・hash 決定性・ADR-012・Codex）の証跡。

## 再現コマンド

```bash
# 型変換（受理書式表・偽陽性防止）
npx vitest run packages/core/src/cell-input.test.ts
# ローカル Operation + documentHash 決定性（サーバー接続なし）
npx vitest run packages/core/src/local-operation.test.ts
# IME 不変条件 6 項目
npm run test:invariants        # tests/invariants（ime 含む）
npx vitest run tests/invariants/ime
# CellScalar date 波及（既存 hash/apply/cell-store/document 回帰）
npx vitest run packages/core
# commit 経路（標準セット委譲）
npx vitest run apps/playground/src/integration/commit-bridge.test.ts
# 全体
npm run test && npm run typecheck && npm run lint && npm run build
# CG-1 機械判定（Phase 4 prep・synthetic フィクスチャで検証）
node scripts/cg1/judge-ime-trace.mjs scripts/cg1/fixtures/synthetic-orderA.json scripts/cg1/fixtures/synthetic-orderB.json  # PASS
node scripts/cg1/judge-ime-trace.mjs scripts/cg1/fixtures/synthetic-headdrop.json                                          # FAIL(先頭欠落検出)
```

## AC 対応表（自動実装部）

| # | 基準 | 状態 | 証跡 |
|---|------|------|------|
| 1 | 日本語連続入力・順序A/B・先頭欠落0・既存E2E回帰 | 部分（不変条件で充足／E2E実機は Phase 4） | invariant 4（順序A/B・先頭欠落0）・invariant 3（instance不変）。E2E 11本は build green・実機採取は Phase 4 |
| 2 | selection/navigation・composition中 grid 不動 | ✅ | invariant 6「composition 中は矢印/Tab で grid 不動」・navigation.test 既存 green |
| 3 | 型変換（標準セット）・受理書式表・canonical分離 | ✅ | `cell-input.test.ts`（39ケース・全角/桁区切り/西暦/否定ケース）・`commit-bridge.test.ts` 標準セット委譲 |
| 4 | CellScalar date 拡張後 codec/hash/apply/validate green・往復一致 | ✅ | `packages/core` 全 green（hash/apply/cell-store/document）・`local-operation.test.ts` JSON往復一致 |
| 5 | ローカル Operation・documentHash 決定的 | ✅ | `local-operation.test.ts`（同一入力列→同一hash・date≠string・サーバー接続なし） |
| 6 | IME 不変条件 6 項目 実カバー・green | ✅ | `tests/invariants/ime/ime.invariant.test.ts`（11 tests・6 describe） |
| 7 | ADR-012 ドラフト→Codex 承認で Accepted | ⏳ | `doc/adr/0012-local-date-cell-value.md`（Draft）。Codex 結果で Accepted 化 |
| 8 | CG-1 解除証拠（実機 trace・順序A/B・先頭欠落0 機械判定） | ⏳ Phase 4 | 判定スクリプト `scripts/cg1/judge-ime-trace.mjs`＋手順 `cg1-realmachine-procedure.md` を用意済み。実機採取は人手 |
| 9 | baseline 縮退・新規違反0・test/typecheck/lint/build green | 部分 | 新規違反0・lint green（baseline=41 不変）。**縮退は DD-016(grid Facade)/DD-012-2(render) 依存**（下記） |

## テスト結果（最終一括）

- `npm run test`: **623 passed / 1 failed**。失敗は `ws-convergence.smoke`（実 WS 実測・`waitFor timeout`＝環境依存の既知flaky。
  hash 内容不一致ではない。同じ documentHash を大量に検証する `convergence.test.ts`〔in-process 10,000 op〕と
  `cell-store-differential`〔1,200 op×6 seed〕は green＝hash ロジックは正しい）。
- `npm run typecheck`: 全 workspace green。
- `npm run lint`（eslint + boundary）: green。boundary `baselined=41 new=0 stale-baseline=0`（新規違反0・回帰なし）。
- `npm run build`: green（editor-state-machine/viewport/integration チャンク生成）。
- `npm run test:invariants`: ime 6 項目含め green。

## CellScalar `date` 波及と hash 決定性の維持

- 追加: `{ kind:'date'; value:'YYYY-MM-DD' }`（`packages/core/src/operations.ts`）。
- clone 網羅: `document.ts cloneCellScalar`・`cell-store.ts cloneScalar` に date 分岐（switch 網羅・`as` 不使用）。
- hash: `hash.ts` は `field(kind)`（'date'≠'string'）＋`value.value` の長さ前置連結。logic 変更なし（コメントのみ）。
  → date と string は同一 `YYYY-MM-DD` 文字列でも hash が分岐（`local-operation.test.ts` で確認）。cross-platform 決定性維持。
- apply/validate/message-codec: CellScalar を不透明に扱う（clone 経由）ため構造変更不要で date が流れる。

## 型変換 受理書式一覧（実装・固定済み）と否定ケース

`packages/core/src/cell-input.ts`（正本）。commit 経路 `commit-bridge.draftToScalar` が委譲。

- number: `123` `0` `-5` `007` / 全角 `１２３` `－５` / 桁区切り `1,234` `1,234,567` `-1,234` / 小数 `1.5` `-0.5` `1,234.5`
- date→`YYYY-MM-DD`: `2026-07-13` / `2026/07/13` / `2026-7-3`（0埋め）/ 閏年 `2024-02-29` `2000-02-29`
- string（偽陽性防止）: `090-1234-5678`（電話）`123-4567`（郵便）`ABC-123`（型番）`型番123`（日本語混在）/
  非実在日 `2026-13-01` `2026-02-30` `2023-02-29` / 不正桁区切り `1,23` `12,34` `1,2345` / 前後空白 ` 123 ` / `1e5` `+5`

## baseline 縮退が本DDで完了しない理由（要判断・DD-016/DD-012-2 依存）

- 抽出（`@nanairo-sheet/{ime,selection}` への物理 move）は本DDで**見送り**。理由:
  - apps/playground が新内部 package を直接 import すると **R1（consumer→internal）違反が増える**（grid Facade 未配線）。
    その縮退は **DD-016（grid Facade 統合）** の責務。抽出だけ先行すると baseline が縮退でなく増加する。
  - `ime-editing-session` の抽出は `CellRect`（render＝`pocb/viewport`・**DD-012-2** 未抽出）と grid Facade の R7
    （公開シグネチャへの内部型漏洩）に阻まれる。DD-012-1 の順序（DD-012-2 より先行）では成立しない。
- よって本DDは baseline を**増やさない**選択（現位置の状態機械を不変条件で検証）を採り、`new=0`（lint green）を維持。
  IME 不変条件テストの import 先差し替え（`@nanairo-sheet/ime`）は抽出完了時（DD-016）に行う。
