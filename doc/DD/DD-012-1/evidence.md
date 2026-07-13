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
| 1 | 日本語連続入力・順序A/B・先頭欠落0・既存E2E回帰 | ✅（順序B=実機／順序A=自動） | 順序B は実機20セッションで実証（AC8）・順序A は invariant 4/6＋E2E〔synthetic〕で担保（実機 Chromium 150 で不発）。先頭欠落0=実機 judge PASS。E2E 11本 build green・再構成は DD-016 |
| 2 | selection/navigation・composition中 grid 不動 | ✅ | invariant 6「composition 中は矢印/Tab で grid 不動」・navigation.test 既存 green |
| 3 | 型変換（標準セット）・受理書式表・canonical分離 | ✅ | `cell-input.test.ts`（40ケース・全角/桁区切り/西暦/全角スラッシュ/否定ケース）・`commit-bridge.test.ts` 標準セット委譲 |
| 4 | CellScalar date 拡張後 codec/hash/apply/validate green・往復一致 | ✅ | `packages/core` 全 green（hash/apply/cell-store/document）・`local-operation.test.ts` JSON往復一致・`snapshot.test.ts` date round-trip |
| 5 | ローカル Operation・documentHash 決定的 | ✅ | `local-operation.test.ts`（同一入力列→同一hash・date≠string・サーバー接続なし） |
| 6 | IME 不変条件 6 項目 実カバー・green | ✅ | `tests/invariants/ime/ime.invariant.test.ts`（13 tests・6項目＋実セッション+fake port の DOM 実駆動） |
| 7 | ADR-012 ドラフト→Codex 承認で Accepted | ✅ | `doc/adr/0012-local-date-cell-value.md`（**Accepted**・Codex 中核異議なし・findings 5件全対応） |
| 8 | CG-1 解除証拠（実機 trace・先頭欠落0＋順序B×Chrome/Edge 機械判定） | ✅ PASS | 実機20セッション（Chrome/Edge）→ `judge-ime-trace.mjs` verdict **PASS**（`cg1-judge-result.json`）。順序A は Chromium 150 で構造的に不発→自動テスト担保。実機セクション（下記） |
| 9 | 新規違反0・test/typecheck/lint/build green | ✅（縮退は DD-016） | 新規違反0・lint green（baseline=41 不変）。**ime/grid/integration 由来 R1 の縮退は DD-016(grid Facade)/DD-012-2(render) 依存**（ユーザー決定 2026-07-13） |

## テスト結果（最終一括）

- `npm run test`: **627 passed / 1 failed**（Codex 対応の追加テスト＝全角スラッシュ・snapshot date round-trip・IME DOM 実駆動×2 を含む）。失敗は `ws-convergence.smoke`
  （実 WS 実測・`waitFor timeout`＝環境依存の既知flaky。hash 内容不一致ではない。同じ documentHash を大量に検証する
  `convergence.test.ts`〔in-process 10,000 op〕と `cell-store-differential`〔1,200 op×6 seed〕は green＝hash ロジックは正しい）。
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

## Phase 4: CG-1 実機ゲート（2026-07-13・PASS・人手実施）

### 実機環境

| 項目 | 内容 |
|------|------|
| OS | Windows |
| ブラウザー | Chrome 150（Chromium）／Edge 150（Chromium）＝Tier-1 |
| 実 IME | **Microsoft IME**（Windows 標準）。※trace-panel の手入力欄 `ime:"Google"` は**ラベル誤記**（採取者のスクショで実 IME=Microsoft IME を確認）。raw JSON は改変せず本欄で訂正する |
| trace | `cg1-chrome-msime.json`（6セッション）・`cg1-edge-msime-1.json`（5）・`cg1-edge-msime-2.json`（9）＝計 **20 セッション** |

### 判定コマンドと結果

```bash
node scripts/cg1/judge-ime-trace.mjs \
  doc/DD/DD-012-1/cg1-chrome-msime.json \
  doc/DD/DD-012-1/cg1-edge-msime-1.json \
  doc/DD/DD-012-1/cg1-edge-msime-2.json
# → verdict: PASS（保存: doc/DD/DD-012-1/cg1-judge-result.json）
```

- **verdict = PASS**: `headDropSessions=0`（**先頭欠落0**）・`orderBPresent=true`（順序B確定）・`tier1Browsers.bothCovered=true`（Chrome/Edge 両方）・`sessionTotal=20`。
- `orderAPresent_informational=false`（**順序A=0**）。

### 知見: Chromium 150 で確定Enter順序Aが構造的に発生しない

- 実機20セッションで**順序A（`keydown Enter` かつ `isComposing:true`）は 1 件も観測されず**。現行 Tier-1（Windows Chromium 150・Chrome/Edge）では、確定 Enter は **`key=Process`(keyCode 229)＋`compositionend` 先行**（＝順序B）に統一されている。
- したがって CG-1 実機ゲートは「**先頭欠落0＋順序B確定を Chrome/Edge 両実機で実証**」と再定義（ユーザー承認 2026-07-13）。**順序Aのハンドリングは自動不変条件（`invariant/ime 4`・`6`）＋E2E〔synthetic〕で担保**（実機では出ないため自動テストが唯一の防御線）。
- 将来 Tier-1 に順序A発生ブラウザが加わった場合は CG-1 を再ゲートする（roadmap §0 注記の条件付き）。

### AC8/AC1 の充足

- **AC8: 充足（PASS）**。実機 trace 3本＋`cg1-judge-result.json` を `doc/DD/DD-012-1/` へ格納。CG台帳 CG-1「解除済」。
- **AC1: 充足**。順序B＝実機実証・先頭欠落0＝実機 judge PASS・順序A＝自動テスト担保。
