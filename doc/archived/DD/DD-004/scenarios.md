# DD-004 テストシナリオ（Red 設計・自然言語）

> Phase 0「テスト設計（Red）」成果物。DOM 非依存の座標・データロジックを vitest で先に赤くしてから実装する。
> 対象: `apps/playground/src/pocb/{axis,viewport,dpi,prng,data-gen,chunk-store,scroll-anchor,render-scheduler,presence-sim,metrics}.test.ts`。
> Canvas 実描画（base-layer/overlay-layer）と実ブラウザー fps/メモリは vitest 対象外（主セッションが headed 実測）。

## 1. Axis（`axis.ts`）— index↔pixel offset・ID↔index・構造変更

境界シナリオ:

- **標準サイズのみ**: count=5, defaultSize=20 → `offsetOf(0)=0`・`offsetOf(3)=60`・`offsetOf(5)=totalSize=100`。`indexAt(0)=0`・`indexAt(59)=2`・`indexAt(60)=3`（境界は次セルの内側）・`indexAt(1e9)=count-1`（末尾クランプ）・`indexAt(-5)=0`（先頭クランプ）。
- **override 混在**: index2 のサイズを 50 に変更 → `offsetOf(2)=40`・`offsetOf(3)=90`・`totalSize=130`。`indexAt(45)=2`・`indexAt(90)=3`。サイズ変更は override（Id キー）で保持し default は不変。
- **ID↔index**: `getIndex(getId(3))===3`・`getId(getIndex(id))===id`・存在しない ID は `getIndex` が -1・`hasId` が false。
- **挿入後の offset**: index1 に 2 件挿入（size=20）→ count+2・挿入位置以降の Id は index が +2 されても `getIndex` で正しく引ける・`offsetOf` が挿入分ずれる・挿入前に設定した override（Id キー）が正しい index に追従する。
- **削除後の offset**: index2 を 2 件削除 → count-2・削除された Id は `getIndex=-1`／`hasId=false`・後続の offset が詰まる。
- **再構築時間計測フック**: サイズ変更・挿入・削除のあとに prefix sum が再構築され、`rebuildStats()` の `rebuildCount` が増え `lastRebuildMs>=0` を記録する（Fenwick 切替判断の材料）。
- **大規模健全性**: count=50,000・defaultSize=22 で `offsetOf(50000)=1,100,000`・`indexAt(550000)=25000`。二分探索が線形走査でないこと（大 count でも実行が速い＝時間アサートではなく結果の正しさで担保）。

## 2. ViewportTransform（`viewport.ts`）— 4象限可視範囲・セル矩形・ヒットテスト

前提: headerWidth=44・headerHeight=24・rowAxis(50000, 22)・colAxis(200, 56)。

- **スクロール0・固定なし**: body pane の可視行範囲が [0, おおよそ viewportHeight/22]・列範囲が [0, viewportWidth/56] 付近（overscan 込みでそれ以上）。`visibleCellCount()>0`。
- **セル矩形（スクロール反映）**: scrollTop=220（=10行分）で row10 の `cellRect` の y が bodyOrigin 付近（`headerHeight + offsetOf(10) - scrollTop`）。scrollLeft でも同様。
- **固定行列4象限**: frozenRowCount=1・frozenColCount=1・scrollTop=1000・scrollLeft=1000 →
  - corner pane = rows[0,1)×cols[0,1)（スクロールしても固定・矩形は header 直後で不変）
  - top pane = rows[0,1)×可視スクロール列（固定行はスクロールしても y 不変、x はスクロール）
  - left pane = 可視スクロール行×cols[0,1)（固定列は x 不変、y はスクロール）
  - body pane = 可視スクロール行×可視スクロール列。4 pane の行列範囲が重複しない。
- **固定セルの矩形はスクロール非依存**: frozen セル (0,0) の `cellRect` は scrollTop/Left を変えても不変。
- **ヒットテスト（§12.6・DOM非探索）**:
  - header 領域: `hitTest(10, 10)`→corner・`hitTest(100, 10)`→column-header（colIndex 妥当）・`hitTest(10, 100)`→row-header（rowIndex 妥当）。
  - body セル: スクロール後の可視セル中央をヒットすると、そのセルの rowIndex/colIndex と rowId/columnId を返し、`localX/localY` がセル内相対座標になる。
  - 固定列バンド内のヒットは固定列 index（<frozenColCount）を返し、スクロール量に依存しない。
- **overscan**: overscanY を増やすと可視行範囲が前後に広がる（描画セル数が増える）。範囲は [0, count-1] にクランプされ負や超過にならない。

## 3. 高DPI snap（`dpi.ts`）

- `backingSize({width:100,height:50}, 2)` → `{width:200,height:100}`（DPR 2 のバッキングストア）。非整数 DPR=1.25 → `round` で整数化。
- `snapToDevice(css, dpr)`: `snapToDevice(10, 2)` が device 上で X.5（`*dpr` して `round+0.5`）になる CSS 座標を返す。`deviceLineWidth(dpr)=1/dpr`（scale(dpr) 済みコンテキストで device 1px の罫線）。
- DPR=1 では `snapToDevice(10,1)=10.5`（DD-002 と同じ 0.5 オフセット）。

## 4. 決定論データ生成（`prng.ts`・`data-gen.ts`）

- `createPrng(seed)` は同一 seed で同一列を返す（`next()` 列が再現）。異なる seed で（ほぼ確実に）異なる。
- `generateCells({rows:100, cols:20, nonEmpty:200, seed})`:
  - 非空セル数がちょうど 200（重複なし・全て範囲内 0≤row<100, 0≤col<20）。
  - 同一 seed → 完全に同一の (row,col,value) 列（再現性）。
  - 出力は (row, col) 昇順（チャンクストア一括ロード用）。
  - value に数値・短文・日本語・長文が混在する（種別が 2 種類以上出現）。

## 5. チャンク化 CellStore（`chunk-store.ts`）

- 生成済み 200 セルを投入 → `nonEmptyCount()===200`・`get(row,col)` が投入値、未設定セルは空文字。
- **可視範囲クエリ O(可視セル数)**: `queryRange(rowStart,rowEnd,colStart,colEnd, visit)` が範囲内の非空セルだけを visit する。範囲外セルを 1 件も visit しない（visit 回数＝範囲内非空セル数）。
- 範囲外（全セル空の窓）は visit 0 回。
- `set` で値を更新・空文字で削除（`nonEmptyCount` が増減）。
- `approxMemoryBytes()>0`（メモリ概算フック・レポート素材）。

## 6. RenderScheduler（`render-scheduler.ts`）— dirty flags・描画振り分け

注入した `scheduleFrame`（同期実行モック）と `drawBase`/`drawOverlay` モックで検証:

- `invalidate('selection')` → フレーム実行で overlay のみ描画（`baseDrawCount` 不変・`overlayDrawCount` +1）。**選択変更で base を再描画しない**（§12.1）。
- `invalidate('presence')` → 同上（overlay のみ）。**Presence 更新で全セル再描画しない**。
- `invalidate('cells')`／`'geometry'`／`'full'` → base+overlay 両方描画。
- 1 フレーム内に複数 `invalidate` を集約（rAF 集約）: 同一フレームで selection と cells を出すと base 1・overlay 1（重複描画しない）。

## 7. ScrollAnchor（`scroll-anchor.ts`・§13.4）

- **anchor 捕捉**: scrollTop=1000 で可視先頭付近の行を anchor（rowId＋offsetWithinRow）に採る。
- **行高変更後の補正**: anchor 行より上の行高を増やす → 補正後 scrollTop が増え、anchor 行の画面内 y が変わらない（跳ばない）。
- **行挿入後の補正**: anchor 行より上に 1,000 行挿入 → 補正後 scrollTop が挿入総高分増え、anchor 行の画面内 y が不変。
- **anchor 行が削除された場合**: anchor 行自体が消えたら、直近の生存行へフォールバック（例外にせず妥当な scrollTop を返す）。

## 8. Presence 模擬（`presence-sim.ts`）

- `createPresenceSim({count:20, seed, rows, cols})` の 1 step で全 20 人の activeCell が ±1 セル範囲で random walk・範囲内クランプ（0≤row<rows, 0≤col<cols を割らない）。
- 同一 seed で step 列が決定論的（再現）。各人に安定した colorKey・displayName。

## 9. 計測合否判定（`metrics.ts` の純粋部）

- `percentile([...], 95)` が正しい分位値を返す（既知配列で検証）。
- `evaluateAcceptance(metrics)` が §18.2 の5基準を判定:
  - frameP95 < 33ms → AC1 pass、≥33 → fail
  - stoppedRedrawMs（平均）8〜12ms 目標: ≤12 を pass、超過を warn/fail
  - selectionLatencyMs < 50 → AC3
  - memory 単調増加でない（傾き閾値以下）→ AC4
  - anchorMaintained（真偽）→ AC5
- しきい値・入力（サンプル配列）から判定が再現でき、JSON へシリアライズできる。
