# DD-012-2 Phase 3: CG-6 精密メモリ計測 手順（`performance.memory` 封鎖回避・人手必須）

> CG-6 = 「`performance.memory` 封鎖を回避した精密メモリ計測」。期限=Alpha exit 前・未解除は「データ上限明示 or Alpha 不可」。
> 実ブラウザー＋起動フラグが必要で自動化不可。計測スクリプト・判定器・手順は自動セッションで用意済み（本書）。

## 背景: なぜ `performance.memory` をそのまま使えないか

`performance.memory.usedJSHeapSize` は既定で **精度が封鎖**される（フィンガープリンティング対策）:
- 値が **約 5% 単位に量子化（バケット化）** され、更新レートも粗い。
- そのため 300MB 予算の可否や、リークの傾き（bytes/sec）を精密に取れない。

## 封鎖回避（第一候補・優先順）

### 方式A: `--enable-precise-memory-info` 起動フラグ（第一候補）

Chromium を `--enable-precise-memory-info` 付きで起動すると `performance.memory` が**バケット化なしの精密値**を返す。既存の `pocd-browser-bench`（`readMemory()` が `performance.memory` を読む）と `pocb` ハーネスのメモリサンプラーをそのまま流用できる（Q3=流用）。

- **Playwright MCP / Playwright 経由**: 起動オプションに `args: ['--enable-precise-memory-info']` を付与。
- **手動 Chrome**: `chrome.exe --enable-precise-memory-info --user-data-dir=<temp>` で起動して対象ページを開く。
- 確認: DevTools Console で `performance.memory.usedJSHeapSize` が 5% 刻みでない生値を返すか（フラグ無しは丸められる）。

### 方式B: `performance.measureUserAgentSpecificMemory()`（相互チェック・任意）

cross-origin isolation（COOP: `same-origin` ＋ COEP: `require-corp`）下で `await performance.measureUserAgentSpecificMemory()` が JS ヒープ＋DOM 等を含む**帰属付き精密値**を返す。方式A の usedJSHeapSize と桁が合うかの相互チェックに使う（ヘッダ設定が必要なので第一候補は方式A）。

### 方式C: CDP `--remote-debugging-port` + `Memory`/HeapProfiler（監査用・任意）

Chrome DevTools Protocol でヒープスナップショットを取り、方式A の傾向を裏取り（重いので単発監査用）。

## 合格ライン（`scripts/cg-perf/perf-budget.json`）

- 単発ピーク: usedJSHeapSize ピーク ≤ **300MB**（memoryPct マージン 0%＝DD-004 実測 ~29MB に対し約10倍ヘッドルーム）。
- リーク傾向（時系列・DD-004 手法踏襲）: slope < 64KB/s **AND** growthRatio < 1.25（Codex 硬化しきい値）。**slope・growthRatio は両方とも有限値が必須**（欠落は n/a）。
- リーク判定の**計測下限**: 標本数 ≥ 8 **かつ** 計測時間 ≥ 90 秒（`perf-budget.json.leakTrend`）。10 秒だけ平坦な標本での誤解除を防ぐ（DD-004 実測=約100秒・11標本に整合）。下限未満は leak=n/a＝CG-6 を pass にしない。
- 単発ピーク AND リーク傾向 の両方 pass で CG-6 メモリ pass。

## 計測条件

- 50,000 行 × 200 列・非空 500,000 セル（seed=20260712）＝ CG-6 の「5万行文書」。
- 単発値だけでなく**時系列（リーク傾向）**を採取。**推奨=数分〜10 分の往復スクロール**（DD-004 §AC4 手法。実測は約100秒・11標本で実施済＝最低ライン。長いほどリーク検出精度が上がる）。
- 起動フラグ・DPR・ブラウザーバージョンを `evidence.md` 環境表へ記録（フラグ無し計測は無効＝再取得）。

## 手順

1. **精密フラグ付き起動**: 上記方式A で Chrome/Chromium を起動（`--enable-precise-memory-info`）。`bash scripts/dev-start.sh` で playground を起動し、対象ページ（pocb ハーネス or `pocd-browser-bench`）を開く。
2. **フラグ有効の確認**: Console で `performance.memory.usedJSHeapSize` が非バケット値であることを確認し、値を `evidence.md` に控える。
3. **採取（5万行文書・時系列）**:
   - **judge 互換の時系列は pocb ハーネスで採取**: 自動スクロール（往復・推奨 数分〜10 分・最低 90 秒/8 標本）でメモリ時系列サンプリング → JSON エクスポート（`memory.samples` [{t,usedBytes}] ＋ `memory.trend`）。**この JSON をそのまま judge へ渡す**（判定器が要求する形式）。
   - `pocd-browser-bench` は **単発 `metrics.memory.usedJSHeapSize` のみ**で `memory.samples`/`memory.trend` を持たない（judge に直接渡すと leak=n/a）。したがって **judge の入力には使わず**、精密フラグ下の単発 usedJSHeapSize と `approxStoreMB` の桁確認（相互チェック）に限って併用する。時系列は必ず pocb ハーネス側で採る。
   - **GC タイミングの明示**: 計測直前に（可能なら `--js-flags=--expose-gc` ＋ `window.gc()`）で GC を強制し、GC 直後/操作直後の別を記録（数値を恣意的にしない＝DA 指摘）。
4. **格納**: エクスポート JSON を `doc/DD/DD-012-2/cg6-memory-realrun-<env>.json` として格納。
5. **機械判定**:
   ```bash
   node scripts/cg-perf/judge-perf-report.mjs doc/DD/DD-012-2/cg6-memory-realrun-<env>.json
   ```
   - judge の `memory.overall=pass`（ピーク ≤ 300MB AND リーク傾向内）を確認（AC4）。
   - 判定 JSON を `doc/DD/DD-012-2/cg6-judge-result.json` として保存し `evidence.md` へ引用。
6. **CG 台帳更新**: `doc/plan/cg-ledger.md` の CG-6 を「解除済」へ更新し、実機環境（OS/ブラウザー/フラグ/バージョン）を追記。
   - **未達の場合**: 300MB を超えるなら「データ上限明示 or Alpha 不可」の判断を**親 DD-012 経由でユーザーへ提示**（本 DD では確定しない）。
7. **DA 批判レビュー**: 計測タイミング（GC 直後/操作直後）で数値が恣意的になっていないか・フラグ無し計測が混入していないかを `evidence.md` へ記録。

## 自動セッションで用意済み（人手不要）

- 予算・リーク傾向しきい値: `scripts/cg-perf/perf-budget.json`（`budget.memoryPeakMB`・`leakTrend`）
- メモリ判定器: `scripts/cg-perf/perf-judge-core.mjs`（`judgeMemoryReport`）＋CLI
- メモリ計測ハーネス: `apps/playground/src/pocb/{harness,metrics}.ts`（`memorySamples`・`memoryTrend`）／`apps/pocd-browser-bench`（`performance.memory` 読取）

## 人手セッションに残るもの（自動化不可）

- `--enable-precise-memory-info` 付きブラウザー起動と精密値確認。
- 5万行文書の時系列メモリ採取（10 分往復・GC タイミング記録）。
- judge 実行 → CG 台帳 CG-6 解除 or「データ上限明示」提示（未達時は親 DD へ）。
