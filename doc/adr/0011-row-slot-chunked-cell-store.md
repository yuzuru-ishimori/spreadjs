# ADR-0011: 行スロット＋チャンク化セルストア

- **Status**: Draft（PoC-B/DD-004 で起票。**DD-006/PoC-D で4分布×4実装の本格比較を実測・反映済み**＝下記「DD-006 拡充」。Accepted 化は DD-007〔要確認4〕）
- **関連**: 計画書 §18.2（PoC-B）・§18.4（PoC-D）・§12（Canvas 描画）・§13（仮想スクロール）・§21（性能目標）／
  リスク R-03（データ密度でメモリ超過）／DD-004（PoC-B）／DD-006（PoC-D・本 ADR を拡充予定）

## 背景・課題

50,000 行 × 200 列（＝1,000 万論理セル）・非空 500,000 セル（§21 基準）の表を Canvas で実用速度に描くには、
**毎フレーム非空セルを全走査してはいけない**（DD-002 の `cell-store.entries()` は O(非空セル数)＝500,000 で破綻）。
仮想スクロール（§13.1）の可視範囲描画には「可視行×可視列の非空セルだけ」を O(可視セル数) で取り出すストアが要る。
同時にメモリ（§21 目標 300MB 未満）を R-03 の範囲に収める必要がある。

## 選択肢

| 選択肢 | 概要 | 長所 | 短所 |
|--------|------|------|------|
| **(A) 行スロット＋チャンク化（本 PoC 実装）** | 行を CHUNK_ROWS 単位のチャンクへ束ね、各行スロットに非空セルを列 index 昇順の並列配列で保持。可視範囲クエリは重なるチャンクの範囲内行のみ走査し、行内は列を二分探索 | 可視範囲クエリが O(可視セル数＋log)／疎データでメモリ節約／一括ロードが append で O(n)／実装が素直 | 密なブロックでは行内配列が長くなる／セル単位ランダム書込は splice コスト |
| (B) 単一 Map<cellKey,val>（DD-002 方式） | 非空セルを 1 つの Map に平坦保持 | 実装最小・get/set O(1) | 可視範囲クエリが全走査 O(非空セル数)＝仮想スクロールに不適 |
| (C) 密な列指向（TypedArray/列ブロック） | 列ごとに連続配列 | 密データで最速・省メモリ | 疎データでメモリ無駄／文字列セルに不向き |
| (D) チャンク×密ブロック（tile） | 矩形タイル単位に密配列 | 局所性が高い | 疎/密混在の切替が複雑・PoC 過剰 |

## 決定（Draft）

**(A) 行スロット＋チャンク化**を PoC-B の計測用ストアとして採用する（`apps/playground/src/pocb/chunk-store.ts`）。

- チャンク = CHUNK_ROWS（=256）行。チャンクは行スロットの疎配列、行スロットは `cols:number[]（昇順）` と
  `values:string[]` の並列配列。
- 可視範囲クエリ `queryRange(rowStart,rowEnd,colStart,colEnd,visit)` は「重なるチャンク → 範囲内行スロット →
  列は `colStart` の lower bound から `colEnd` まで」だけを走査＝**O(可視セル数)**（範囲外を 1 件も visit しない）。
- 一括ロード `bulkLoad` は (row,col) 昇順入力を末尾 append する高速経路（データ生成が昇順出力）。
- メモリ概算フック `approxMemoryBytes()`（非空件数×概算＋文字数×2＋チャンク配列）をレポート素材に持つ。

**本 ADR は Draft。** 疎/密 CellStore の本格比較（500,000 非空の生成/読取時間・メモリ実測）は DD-006（PoC-D）が担い、
その結果で「Phase 1 の CellStore を (A) 単独／(A)+(C) ハイブリッドのどちらにするか」を確定して本 ADR を Accepted 化する。

## 結果（本 PoC の計測・観察）

- **可視範囲クエリの O(可視セル数)**: chunk-store の unit test で「visit 件数＝範囲内非空セル数」「範囲外は 0 visit」
  「空窓は 0 visit」を機械実証（`chunk-store.test.ts`）。base-layer は各 pane でこの queryRange を使い非空セルのみ描画。
- **決定論データ**: 500,000 非空セルを seed 付き PRNG で重複なし・昇順生成（`data-gen.test.ts` で件数・再現性・昇順・
  内容混在を実証）。生成時間・実メモリ（usedJSHeapSize）の実測値は `DD-004/measurement-report.md`（主セッションが headed で記入）。
- **既知の簡略化**: 本ストアは **index キー**。行挿入/削除は Axis（RowId）側のみ再採番し、セルデータは index 位置に留まる。
  RowId 追従の CellStore は Phase 1（DD-006 の方式比較を受けて）で実装する。

## DD-006（PoC-D）拡充: 4分布×4実装の実測と用途別選択

500,000非空・4分布（uniform-sparse/dense-block/top-left-cluster/column-typed）×4実装をNode計測（生JSON `doc/archived/DD/DD-006/measurements/cellstore-node-500k.json`・詳細 `doc/archived/DD/DD-006/measurement-report.md` §AC1）。要点:

- **(A) 行スロット＋チャンク（chunked-rowslot）が総合最良**: 範囲走査8ms（map の 128〜175ms に対し圧倒）・疎メモリ最小（16.7MB）・全分布で安定。
- **(C) 列指向（columnar）**: read 最速だが**密割当でメモリ高（88MB）**・列型変換で write 遅（192ms）。
- **列チャンク（chunked-column）は密ブロックで最小メモリ（12.5MB）・load最速（42ms）** ＝高密度数値領域に有利。
- **(B) 単一Map は範囲走査 O(非空)** で仮想スクロール不適（基準線）。
- メモリは全方式で §21 目標300MB未満（heap 最大約138MB）＝R-03/§18.6「メモリ上限超過」は Node 実測で非該当（ブラウザ確認は DD-006 AC9）。

### 決定案（用途別選択・単一の勝者を強制しない）

| 用途・条件 | 推奨方式 |
|------------|----------|
| 疎な業務表・初期MVP既定 | **(A) chunked-rowslot** |
| 高密度数値領域 | **(C′) chunked-column** |
| read 特化（参考） | columnar |
| 再検討条件 | 非空率・列型の均一度・範囲走査頻度・密ブロック比率 |

**Phase 1 方針**: (A) を既定とし、**index キー→RowId キー**へ移行（DD-004 の簡略化解消・共同編集の InsertRows/DeleteRows と整合）。密領域は用途別に (C′) を選べる拡張点を残す。Accepted 化は DD-007 の Go 判定で行う（要確認4）。

## 再検討条件

- DD-006（PoC-D）の疎/密比較で、密ブロック（(C)/(D)）が 500,000〜2,000,000 非空セルでメモリ・読取ともに優位と出る
  → ハイブリッド（疎行スロット＋密タイル）へ再設計。
- 行内配列の splice コストが高頻度ランダム書込で問題化 → 行スロットを列 index キーの Map や B-tree へ。
- index キー起因の挿入/削除ずれが Phase 1 の共同編集（RowId 基準の InsertRows/DeleteRows）と衝突
  → RowId キー CellStore へ移行（Phase 1 で必須）。
