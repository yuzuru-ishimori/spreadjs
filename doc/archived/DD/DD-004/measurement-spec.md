# DD-004 計測仕様（データ生成・手順・条件）

> 本体から分離（guides.md §6）。PoC-B の計測条件・データ生成仕様・計測ハーネスの操作手順を定める。
> 正典: 計画書 §18.2（合格条件）・§21（性能目標）・§12/§13（描画・仮想スクロール）。

## 1. 計測条件（要確認1〜3 で確定）

| 項目 | 値 | 根拠 |
|------|----|------|
| 参照端末 | 本機（Windows 11 ＋ Chrome/Edge） | 要確認1（後日、業務標準端末が決まれば再計測） |
| ウィンドウ | headed 実ウィンドウ・フルスクリーン相当（最小化・ヘッドレス不可） | §18.2「headed の実ブラウザーウィンドウ」・GPU 合成経路 |
| 論理表 | 50,000 行 × 200 列 | §21 アドレス可能行数/列数 |
| 非空セル | 500,000（決定論生成・seed=20260712） | §21 非空セル基準 |
| 可視セル | 2,000〜4,000（overscan 込み。セル寸法 56×22px を基準に UI で調整） | §18.2 可視セル数 |
| Presence | 20 人固定（有効） | 要確認2 |
| Axis 実装 | 順序配列＋ID→index Map＋標準サイズ＋疎 override＋prefix sum キャッシュ | 要確認3（Fenwick は計測でボトルネック時のみ） |
| メモリ計測 | `performance.memory.usedJSHeapSize`（Chromium 限定）＋ DevTools ヒープ補助 | §18.2 |

> ⚠️ 参照端末の機種・CPU/RAM/GPU・DPR は計測時に `measurement-report.md` の環境表へ必ず記録する（判定の前提）。

## 2. データ生成仕様（`src/pocb/data-gen.ts`）

- **決定論**: seed 付き mulberry32 PRNG（`src/pocb/prng.ts`）。同一 seed から常に同一の (row, col, value) 集合。
- **配置**: 位置は重複なし（Set で dedup）、出力は (row, col) 昇順（チャンクストア一括ロードの append 高速化）。
- **内容混在**（measureText キャッシュと clip に実運用相当の負荷を与える）:
  - 数値 40%（整数／小数）
  - 短英数 25%（3〜6 文字）
  - 日本語短文 25%（氏名・部署・状態語など）
  - 日本語長文 10%（clip とはみ出し防止の検証用）
- **格納**: 行スロット＋チャンク化ストア（`src/pocb/chunk-store.ts`、CHUNK_ROWS=256）。可視範囲クエリは
  重なるチャンクの範囲内行スロットのみ走査し、行内は列の二分探索で colStart 以降だけを見る＝O(可視セル数)。

## 3. 計測ハーネス（`src/pocb/metrics.ts`＝純粋コア／`src/pocb/harness.ts`＝ドライバー）

純粋コア（`metrics.ts`・vitest 検証済み）:

- `frameStats(intervalsMs)`: p50/p95/worst/mean/33ms 超え比率（nearest-rank 分位）。
- `memoryTrend(samples)` / `isMemoryStable`: 線形回帰の傾き（bytes/sec）で単調増加を判定。
- `createAutoScrollPlan({maxScrollTop,maxScrollLeft,speedPxPerSec})`: 三角波往復のスクロール位置計画。
- `evaluateAcceptance(input)`: §18.2 の 5 基準を pass/fail/n/a で自動判定。しきい値は `ACCEPTANCE_THRESHOLDS`。

ドライバー（`harness.ts`・DOM/perf 依存）:

- `onFrame(now)`: フレーム間隔記録・10 秒ごとのメモリサンプリング・自動スクロール位置算出。
- `startAutoScroll/stopAutoScroll` / `recordStoppedRedraw` / `recordSelectionLatency` / `reset`。
- `toReportJson(anchorMaintained, visibleCellCount)`: 環境＋サマリ＋合否判定を JSON 文字列で返す。

## 4. 計測手順（主セッションが headed 実ウィンドウで実施）

1. `npm run dev` で Vite を起動し、**実ブラウザー（Chrome/Edge）で `/poc-b.html` を開く**（ヘッドレス不可）。
   ウィンドウを最大化し、可視セル数が読み出し（readout）で 2,000〜4,000 になるようセル寸法を調整（「セル寸法」→適用）。
2. **AC1（スクロール fps）**: 「自動スクロール開始」→ 30〜60 秒往復させる → readout の `p95` を確認（<33ms で pass）。
3. **AC2（停止中再描画）**: スクロールを止め「停止中再描画×20」→ readout の `停止中再描画 平均`（目標 8〜12ms・上限 12ms）。
4. **AC3（選択遅延）**: 任意のセルを pointerdown → readout の `選択遅延worst`（<50ms で pass）。数回試す。
5. **AC4（10 分メモリ）**: 「リセット」後「自動スクロール開始」→ **10 分連続** → readout の `memory 傾き`（KB/s。
   傾き 64KB/s 未満 かつ 末尾/先頭の増加率 1.25 未満で「単調増加でない」＝pass。Codex 指摘で 512KB/s から厳格化）。
   DevTools の Memory で usedJSHeapSize の推移も補助確認。可視セル数が 2,000〜4,000 帯を外れると overall は n/a（負荷条件未達）。
6. **AC5（scroll anchor）**: 末尾付近まで自動/手動スクロール → 「可視上方の行高+80」「可視上方へ1000行挿入」を実行 →
   画面が跳ばない（anchor 維持）ことを目視＋readout の `anchor維持(直近): true` で確認。
7. 「JSONエクスポート」で結果 JSON を保存し、`measurement-report.md` の各表へ実測値を転記。合否は JSON の
   `acceptance.overall` と各 `verdict` を根拠にする。

## 5. スクリーンショット（📸・エビデンス）

`DD-004/` に配置（guides.md §9）。少なくとも次を撮る:

- 固定行列 4 象限が効いた状態（固定行1・固定列1）でのスクロール中の全景。
- 選択ドラッグ枠＋Presence 20 人（activeCell 枠・名前タグ・selection ハイライト）。
- 高DPI 罫線（拡大表示で 1px 罫線がにじまないこと）。

Playwright MCP 利用可なら赤枠ハイライトして撮る。不可なら手動キャプチャし DD ログに「手動キャプチャ」と明記。
