# DD-012-2 Phase 2: 5万行×200列 統合性能 headed 実測 手順（人手必須）

> Phase 2 の scroll/selection/再描画 実測は **実ブラウザー（Playwright MCP 駆動 Chrome or 実 Chrome）** が必要で自動化不可。
> 判定器・予算表・計測ハーネスは自動セッションで用意済み（本書）。人間が下記を実行すれば数値が出て判定が確定する。
> 参照: CG-1 実機ゲートの `scripts/cg1/` と同型（採取フロー＋機械判定を事前設置し、実機採取だけ人手に残す）。

## 合格ライン（予算表・ユーザー確定 2026-07-13）

正典 = `scripts/cg-perf/perf-budget.json`。DD-004『実機確認run』（2026-07-12・実Chrome）の実測を予算化。

| メトリクス | 回帰予算（合格ライン） | §18.2 機能上限（floor） | ノイズマージン |
|---|---|---|---|
| scroll frame p95 | ≤ 16.8ms | < 33ms | +20%（timing） |
| 選択応答 worst | ≤ 16.9ms | < 50ms | +20%（timing） |
| 停止中 full 再描画 mean | ≤ 0.33ms | ≤ 12ms | +20%（timing） |
| メモリ ピーク | ≤ 300MB | — | 0%（10倍ヘッドルーム） |
| メモリ リーク傾向 | slope < 64KB/s AND growthRatio < 1.25 | — | — |

- **判定 3 値**: `pass`（予算内）／`over-budget`（予算超だが機能上限内＝回帰の疑い＝再ゲート）／`fail`（機能上限超）。
- ★ノイズマージン 20% は DD-004 自身の run 間分散（0.33↔0.39ms ≈18%）吸収のための**暫定値**。headed ゲートでユーザー確定する（緩める＝spec 変更＝再ゲート）。

## 計測条件（DD-004 踏襲・`perf-budget.json.conditions`）

- 50,000 行 × 200 列・非空 500,000 セル（seed=20260712・uniform-sparse）・セル基準寸法 56×22px。
- 可視セル 2,000〜4,000 帯（overscan 込み。帯外は負荷条件未達＝合格根拠にしない＝判定 n/a）。
- **DPR・CPU/RAM/GPU・ブラウザーバージョンを `evidence.md` の環境表へ必ず記録**（判定の前提）。

## 計測ハーネスの流用判断（Q2/Q4・Phase 2 冒頭で確定）

- **流用（第一候補どおり採用）**: `apps/playground/src/pocb/{harness,metrics}.ts` ＋ `pocb/main.ts` の計測ドライバー（poc-b ページ）。
  - fps レコーダー（rAF 間隔 p95/worst・自動スクロール中に限定）・停止中 full 再描画・pointer→選択枠遅延・メモリサンプリング・結果 JSON エクスポート・`evaluateAcceptance` を既に備える（DD-004 で Codex 硬化済）。
  - pocb は `evaluateAcceptance` で §18.2 の緩い上限（33/12/50ms）判定だが、**本 DD の判定器（`scripts/cg-perf/perf-judge-core.mjs`）が同じエクスポート JSON を DD-004 実測予算（16.8/16.9/0.33ms）で再判定**する。ハーネスは作り直さない（Q2/Q4=流用）。
  - `apps/pocd-bench`（Node CLI）・`integration/initial-load-metrics.ts` は初期ロード計測用で scroll/selection の fps は測れないため、本 Phase では非採用（初期ロードは別途）。
- 位置づけ: 判定器・予算・fixtures は `scripts/cg-perf/`（package 外 harness＝境界対象外）。pocb ハーネスは apps/playground 内（現位置維持・render 抽出は DD-016 委譲・後述）。

## 手順

1. **起動**: `bash scripts/dev-start.sh`（playground :5885）。poc-b ページ（pocb 計測ハーネス）を対象ブラウザーで開く。
   - 統合ページ（integration）で計測したい場合は、pocb ハーネスの計測ドライバーを統合ページへ配線する必要がある（未配線＝dev tool として追加。製品には載せない）。**現状は poc-b ページで計測**（同一 render 資産・挙動保存のため描画特性は一致。差が疑われたら親 DD-012 へエスカレーション）。
2. **環境記入**: `evidence.md` の環境表に DPR・CPU/RAM/GPU・ブラウザーバージョンを記録。
3. **採取**:
   - 自動スクロールドライバーを開始（速度指定・往復）。fps は自動スクロール中のフレームのみ採取される（idle フレームで p95 を薄めない＝DD-004 Codex #1）。
   - 可視セル数が 2,000〜4,000 帯にあることを readout で確認（帯外なら列幅/行高/ズームで調整）。
   - 選択ドラッグを複数回実施（pointer→選択枠遅延を採取）。
   - 停止中 full 再描画を N 回強制（停止中再描画 mean を採取）。
   - メモリは時系列サンプリング（リーク傾向。Phase 3 の精密計測は `cg6-memory-procedure.md`）。
4. **エクスポート**: 「JSON エクスポート」ボタンで `pocb-measurement-<timestamp>.json` を保存し、`doc/DD/DD-012-2/` へ格納（例 `perf-realrun-<env>.json`）。
5. **機械判定**:
   ```bash
   node scripts/cg-perf/judge-perf-report.mjs doc/DD/DD-012-2/perf-realrun-<env>.json
   ```
   - **PASS 条件（AC2）**: perf.overall=`pass`（scroll p95・選択・再描画すべて予算内）かつ conditions.inBand=true。
   - `over-budget`＝回帰の疑い（原因分析・再ゲート）／`fail`＝機能上限超（対策必須）。
   - 判定 JSON を `doc/DD/DD-012-2/perf-judge-result.json` として保存し `evidence.md` へ引用。
6. **AC3 確認**: `npm run test:invariants` green（判定器＋予算ピンの常設テスト＝`perf-judge.test.ts`）。
7. **DA 批判レビュー**: warm cache だけで cold 経路を見ていないか・p95 標本数は十分か（DD-004 は 6,349 フレーム）・可視セル帯を満たしているか、を `evidence.md` へ記録。

## 自動セッションで用意済み（人手不要）

- 予算表（正典）: `scripts/cg-perf/perf-budget.json`
- 判定器（純関数＋CLI）: `scripts/cg-perf/perf-judge-core.mjs` / `judge-perf-report.mjs`
- 判定器の機械検証＋予算ピン: `tests/invariants/perf/perf-judge.test.ts`（`npm run test:invariants` に含む）
- fixtures（pass/over-budget/fail/condition-unmet）: `scripts/cg-perf/fixtures/`
- 計測ハーネス: `apps/playground/src/pocb/{harness,metrics,main}.ts`（DD-004 資産・流用）

## 人手セッションに残るもの（自動化不可）

- 実ブラウザーでの採取（自動スクロール・選択ドラッグ・停止中再描画・時系列メモリ）。
- 採取 JSON の格納 → judge 実行 → `evidence.md`・`perf-judge-result.json` への記入。
- ノイズマージン 20%（暫定）の最終確定。
