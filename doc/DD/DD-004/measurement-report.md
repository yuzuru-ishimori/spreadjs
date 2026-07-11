# DD-004 計測レポート（PoC-B Canvas 仮想スクロール）

> 計画書 §18.2 合格条件の実測記録。**headed 実ウィンドウでの fps/メモリ実測値と 📸 は主セッションが
> Playwright MCP で採取して記入する**（本実装セッションに MCP 無し＝DD-002 と同運用）。本実装セッションは
> 計測ハーネス・自動判定ロジック・レポート雛形までを用意した。実測手順は `measurement-spec.md` を参照。
>
> 判定の根拠は「JSONエクスポート」の内容（`acceptance.overall` と各 `verdict`）とする。

## 0. 環境（要確認1: 参照端末＝本機）— 主セッション記入待ち

| 項目 | 値 |
|------|----|
| 機種 | _記入待ち_ |
| CPU（コア数） | _記入待ち（`navigator.hardwareConcurrency` は JSON の env に自動記録）_ |
| RAM | _記入待ち（`navigator.deviceMemory` は JSON に自動記録・GB 概算）_ |
| GPU | _記入待ち（DevTools > chrome://gpu 等）_ |
| OS / ブラウザー | Windows 11 / _Chrome or Edge のバージョン記入待ち_ |
| devicePixelRatio | _記入待ち（JSON の env.devicePixelRatio に自動記録）_ |
| ウィンドウ内寸 | _記入待ち（JSON の env に自動記録）_ |
| 可視セル数（計測時） | _記入待ち（readout・JSON の visibleCellCount。目標 2,000〜4,000）_ |

## 1. 合格条件の判定（§18.2）— 実測値は主セッション記入待ち

| # | 基準 | しきい値 | 実測値 | 判定 |
|---|------|---------|--------|------|
| 1 | 通常速度スクロールの 95% フレームが 33ms 未満 | frame p95 < 33ms | _記入待ち_ | _pass/fail_ |
| 2 | 停止中の全可視セル base 再描画 | 平均 ≤ 12ms（目標 8〜12） | _記入待ち_ | _pass/fail_ |
| 3 | pointer→選択枠表示 | < 50ms | _記入待ち_ | _pass/fail_ |
| 4 | 10 分連続スクロールでメモリ単調増加しない | 傾き < 64KB/s かつ 増加率 < 1.25 | _記入待ち_ | _pass/fail_ |
| 5 | 末尾付近で上方の行高変更・行挿入 → 画面が跳ばない | anchor 維持 | _記入待ち（readout: anchor維持）_ | _pass/fail_ |

> 上記しきい値は `metrics.ts` の `ACCEPTANCE_THRESHOLDS`（vitest で判定ロジックを検証済み）。

## 2. データ・メモリ（500,000 非空セル）— 一部は本セッションで確認済み

| 項目 | 値 | 出所 |
|------|----|------|
| 論理表 | 50,000 行 × 200 列 | 実装定数（main.ts） |
| 非空セル数 | 500,000（決定論・seed=20260712） | data-gen（unit test で件数・再現性・昇順を検証） |
| 生成時間 | _記入待ち（readout: データ生成 Nms）_ | 実行時計測（`GenerateResult.elapsedMs`） |
| ストア概算メモリ | _記入待ち（readout: 概算メモリ MB）_ | `chunk-store.approxMemoryBytes()`（傾向把握用フック） |
| JS ヒープ（usedJSHeapSize） | _記入待ち（JSON の memory.samples）_ | performance.memory（§21 メモリ目標 300MB 未満の参考） |
| 可視範囲クエリ計算量 | O(可視セル数)（範囲外を 1 件も走査しない） | chunk-store unit test で visit 件数＝範囲内非空セル数を実証 |

## 3. Axis 再構築計測（Fenwick 切替判断・要確認3）— 主セッション記入待ち

| 操作 | prefix sum 再構築時間 | 備考 |
|------|----------------------|------|
| 行高変更（30 行） | _記入待ち（readout: Axis再構築 最新 Nms）_ | 50,000 要素の prefix 再構築 |
| 1,000 行挿入 | _記入待ち_ | 構造変更＋prefix 再構築 |
| 1,000 行削除 | _記入待ち_ | 同上 |

> 判断基準: 上記再構築がスクロール/操作の体感を損なう（フレーム落ち）なら Fenwick Tree へ切替（§13.2）。
> 本 PoC の初期実装は「順序配列＋prefix sum キャッシュ＋二分探索」（要確認3 確定）。

## 4. ボトルネック分析・未達時の対策（実測後に記入）

- _記入待ち_: 未達基準があれば、§12.3 dirty rectangle／tile cache、§13.3 高速スクロール中の文字簡略化（適応モード）、
  §13.2 Fenwick Tree、overscan チューニングのいずれを適用したか、再計測結果とともに記録する。
- 本実装で用意済みの対策余地: RenderScheduler は dirty flag 単位描画（選択/Presence は overlay のみ）を既に構造化。
  可視範囲全描画→dirty rect は「実測で必要なら」導入（§12.3）。

## 5. Phase 1 へ引き継ぐ設計注意事項（`packages/sheet-renderer-canvas` 化の分割線）

1. **座標コアは DOM 非依存で切り出し済み**: `axis.ts`／`viewport.ts`／`scroll-anchor.ts`／`selection.ts`／`dpi.ts`／
   `text-cache.ts`／`metrics.ts` は Canvas も window も参照しない純粋モジュール。そのまま
   `packages/sheet-renderer-canvas`（または `sheet-core` の geometry）へ移設できる。Canvas 依存は
   `base-layer.ts`／`overlay-layer.ts`／`main.ts`／`harness.ts` に隔離した（描画アダプタ境界）。
2. **PoC で簡略化した点（Phase 1 で解消が必要）**:
   - **chunk-store は index キー**（RowId キーではない）。行挿入/削除は Axis（RowId）側のみ再採番し、
     セルデータは index 位置に留まる＝挿入で既存データが RowId 追従しない。anchor 補正は RowId 基準で正しく動くが、
     データ再マッピングは Phase 1 の RowId キー CellStore（DD-006 の疎/密比較）で解消する。
   - **Axis の override は Id キーで保持**（挿入/削除の再採番に自然追従）だが、prefix sum は毎回全再構築。
     大量構造変更が高頻度なら Fenwick へ（§13.2・上記 §3 の計測で判断）。
   - **セル結合・アクセシビリティ・IME textarea 追従は未実装**（描画構造のみ考慮。IME は DD-005 統合で ViewportTransform に載せる）。
   - **overscan は縦 0.6×画面高・横 3 列固定**。適応モード（高速スクロール中の文字簡略化）は基準未達時のみ導入。
3. **base/overlay の座標一致**: 両レイヤーは同一 `ViewportTransform`（同一 `cellRect`）を使うため、選択枠・Presence が
   セル位置とずれない。DPR 変更・resize では両 Canvas を再確保し `textCache.clear()` する（§12.4/§12.5）。
4. **計測の再現性**: データ生成・Presence・自動スクロールはすべて seed 付き決定論。合否は JSON に全サンプルと
   `evaluateAcceptance` 結果を含めるため、レポートの数値は JSON から追跡できる。

## 6. スクリーンショット（📸）— 主セッション取得待ち

| 説明 | 画像 |
|------|------|
| 固定行列4象限＋スクロール全景 | _`DD-004/pocb-after-frozen-quadrants.png` 取得待ち_ |
| 選択ドラッグ＋Presence 20人 | _`DD-004/pocb-after-selection-presence.png` 取得待ち_ |
| 高DPI 罫線（拡大） | _`DD-004/pocb-after-hidpi-gridlines.png` 取得待ち_ |
