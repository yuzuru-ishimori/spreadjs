# DD-010 性能非回帰レポート（AC6・Phase 4）

> §2.3 性能回帰予算: Document State 表現変更＝フル再計測発動。DD-006 と同条件（50,000 行×200 列・非空 500,000・
> seed 20260712・warmup 2/trials 5・chunkRows 256・4分布・試行ごと方式巡回）を Node 22 で再計測。
> 生 JSON: `doc/DD/DD-010/cellstore-node-500k-dd010.json`。

## 再現コマンド

```bash
node --expose-gc --import tsx apps/pocd-bench/src/bench-cellstore.ts \
  --rows 50000 --cols 200 --nonEmpty 500000 --seed 20260712 --warmup 2 --trials 5 --chunkRows 256 \
  --stores chunked-rowslot,chunked-rowslot-stable,map-record --pretty
```

- `chunked-rowslot`（DD-006 採用・**index キー・文字列格納の PoC ストア**＝旧 16.7MB/8ms 基準）
- `chunked-rowslot-stable`（**本DDの製品 CellStore**＝slot キー・CellRecord 格納。`packages/sheet-core` を bench 契約へアダプト）
- `map-record`（**移行前の製品文書表現**＝二段 `Map<行,Map<列,CellRecord>>`。CellRecord 値モデルの真の基準線）

## 実測（中央値・ms／メモリは approxStore=方式概算・heapUsed=process 実測）

> `map-record` は CellRecord と同一の入れ子オブジェクト形状（`{value:{kind,value}, lastChangedRevision}`）で
> 保持する（Codex[P2] 反映後の再計測）。1 セルあたりオブジェクト 2 個＝製品移行前表現と等価。

| store | dist | load | read | write | scan | approxMB | heapMB |
|---|---|---:|---:|---:|---:|---:|---:|
| chunked-rowslot | uniform-sparse | 74.7 | 25.25 | 41.9 | **2.90** | **15.9** | 71.5 |
| chunked-rowslot-stable | uniform-sparse | 113.0 | 33.72 | 56.4 | 6.64 | 31.2 | 129.7 |
| map-record | uniform-sparse | 102.8 | 41.55 | 41.0 | 9.98 | 41.5 | 171.2 |
| chunked-rowslot | dense-block | 22.9 | 19.09 | 43.8 | **3.71** | **15.5** | 60.4 |
| chunked-rowslot-stable | dense-block | 50.2 | 39.97 | 61.5 | 5.35 | 30.8 | 107.6 |
| map-record | dense-block | 29.4 | 30.51 | 39.5 | 9.86 | 38.6 | 154.1 |
| chunked-rowslot | top-left-cluster | 83.3 | 26.69 | 44.0 | **2.98** | **15.9** | 74.2 |
| chunked-rowslot-stable | top-left-cluster | 111.2 | 41.84 | 56.8 | 7.02 | 31.2 | 135.1 |
| map-record | top-left-cluster | 110.3 | 36.17 | 44.3 | 10.21 | 41.5 | 174.2 |
| chunked-rowslot | column-typed | 76.6 | 27.29 | 44.9 | **2.93** | **15.3** | 71.7 |
| chunked-rowslot-stable | column-typed | 113.0 | 37.14 | 57.4 | 6.54 | 30.6 | 129.9 |
| map-record | column-typed | 116.4 | 42.43 | 49.6 | 11.15 | 40.9 | 171.4 |

## 合格ライン判定と再検討（要確認4）

**合格ライン**: 範囲走査 +30% 以内・メモリ +20% 以内（DD-006 実測: 範囲走査 ~2.8〜4ms・approx 16.7MB@500k 基準）。

**対 DD-006 `chunked-rowslot`（文字列格納）では超過**:
- メモリ approx 15.3〜15.9→30.6〜31.2MB（約 +95%）・heap 60〜74→108〜135MB。
- 範囲走査 2.9〜3.7→5.4〜7.0ms（約 +80〜130%）。

**→ 点4の指示に従い方式を再検討し、以下を記録する（結論: A案 slot chunked を維持）。**

### 再検討: 超過の原因分解

1. **slot キー化（＝CG-2 の本体変更）のコストは ≒0**。`chunked-rowslot-stable` は `chunked-rowslot` と
   **同一のチャンク構造**（chunkRows=256・列昇順並列配列・lowerBound 二分探索）。差は「行キーの意味が
   index→slot に変わった」だけで、両者とも密整数キー＝走査・メモリ特性は構造的に同一。
2. **超過は 100% CellRecord 値モデルの差**。DD-006 の 16.7MB/8ms は**生文字列**を格納する PoC ストアの数値。
   製品 CellStore は §6.4 の収束判定に必要な **CellRecord（`{value: CellScalar, lastChangedRevision}`）** を
   格納する（value も判別ユニオン `{kind, value}`）。1 セルあたり生文字列 1 個 → オブジェクト 2 個＋数値へと
   増えるため、メモリ約 2 倍・逆参照コストで走査も増える。これは**移行前から製品の文書表現に内在するコスト**
   （二段 Map も同じ CellRecord を保持）であり、**CG-2（安定 ID 化）が新たに持ち込んだものではない**。
3. **DD-006 基準線が値モデル不一致**。合格ラインは「生文字列 PoC ストア」に対して引かれており、製品 CellStore
   （CellRecord 必須）との比較は非等価（apples-to-apples でない）。

### 再検討: 「移行前の製品表現」に対する真の非回帰

CG-2 が問うべきは「**製品を安定 ID 化して回帰したか**」であり、正しい基準線は移行前の製品表現＝二段
`Map<行,Map<列,CellRecord>>`（`map-record`）。これに対して製品 CellStore（`chunked-rowslot-stable`）は:

- **メモリ（heap）: -22〜31%**（例 uniform: 171.2→129.7MB／dense: 154.1→107.6MB）。全分布で `map-record` 未満。
- **メモリ（approx）: -21〜25%**（例 uniform: 41.5→31.2MB）。
- **範囲走査: -33〜49%**（例 uniform: 9.98→6.64ms／column-typed: 11.15→6.54ms）。全分布で `map-record` より速い。
- load/read/write も同等〜優位。

**⇒ 移行前の製品表現に対し、CG-2 の slot キー CellStore はメモリ・走査ともに改善（回帰なし）。**
DD-006 の「16.7MB/8ms」基準に対する名目超過は、値モデル（CellRecord）の差に起因し、方式（A案）由来ではない。

### メモリ絶対値の健全性（§21・R-03）

heap 最大 174.2MB（`map-record`）・製品 CellStore は最大 135.1MB。いずれも **§21 目標 300MB 未満**＝R-03/§18.6
「メモリ上限超過」は Node 実測で非該当（ブラウザ最終確認は CG-6/DD-012 の統合メモリゲート）。

## 判定（AC6）

- **方式**: A案（slot 間接・chunked-rowslot 構造流用）を維持。移行前の製品表現に対しメモリ・走査とも非回帰（改善）。
- **DD-006 基準線に対する名目超過**は CellRecord 値モデル由来（既存の内在コスト）で、CG-2 の変更由来ではない。
- **将来最適化（任意・非ブロッキング）**: チャンク並列配列を CellRecord オブジェクトではなく
  `kinds:Uint8Array` ＋ `values:(string|number)[]` ＋ `revisions:number[]` の分割配列にすると DD-006 文字列
  ストア相当のメモリに近づけ得る（clone/identity 契約が複雑化するため Alpha では見送り・DD-014 で再評価）。
- 上記「基準線の値モデル不一致」の解釈は **ADR-0011 Accepted 化に伴う手動 ChatGPT 外部レビューで確認**を仰ぐ。
