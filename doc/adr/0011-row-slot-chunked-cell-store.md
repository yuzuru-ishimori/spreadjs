# ADR-0011: 行スロット＋チャンク化セルストア

- **Status**: **Accepted**（2026-07-13）。DD-010 で RowId キー（slot 間接）へ移行し製品 CellStore として `packages/sheet-core` へ統合・CG-2 を解除し、実装・自動試験・性能再計測を反映済み。**ADR 転換＝External Review 対象だが、本件は Codex レビュー（xhigh・1回・findings 4件全対応）をもって承認とする**（ユーザー判断 2026-07-13＝ChatGPT ではなく Codex レビューで十分・DD-010 ログ参照）。AC6 の性能 baseline 解釈（真の従来製品表現＝二段 Map+CellRecord 比では改善）も本承認に含む。
  - 履歴: Draft（PoC-B/DD-004 起票）→ DD-006/PoC-D で4分布×4実装の本格比較を実測・反映（下記「DD-006 拡充」）→ DD-010 で RowId キー移行を実装・**Codex レビュー承認で Accepted 確定**（2026-07-13）。
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

## DD-010 移行: index キー → RowId キー（slot 間接）＝製品 CellStore へ（CG-2 解除）

**決定**: (A) 行スロット＋チャンク構造を **RowId キー（slot 間接方式）** へ移行し、`packages/sheet-core` の
文書表現（`SheetDocument.cells`）の正本 CellStore として統合する（`packages/sheet-core/src/cell-store.ts`）。

- **slot 間接（A案）**: RowMeta.slot（§6.3・安定整数・単調採番・tombstone でも保持・回収なし）を**チャンクキー**に
  使う。RowId→slot は rowMeta、ColumnId→colIndex は columnOrder で解決（document.ts の純ヘルパーへ集約）。
  チャンク×行スロット×列昇順並列配列＋二分探索は DD-004/DD-006 の構造をそのまま流用する。
- **効果**: InsertRows/DeleteRows でセルデータが物理移動しない（slot 不変）＝**index ずれ・サイレント上書きが
  構造的に発生しない**（DD-004 の既知簡略化「index キー」を解消）。ADR-0011 の実測優位（O(可視) 走査・省メモリ・
  昇順 append ロード）は維持。
- **値モデル**: 製品は生文字列でなく CellRecord（`{value: CellScalar, lastChangedRevision}`）を格納する（§6.4 収束判定）。
- **serialization**: `SnapshotData` を version 1→2 に更新（wire 形式 SerializedDocument は不変・RowId 直列化）。
  互換層・migration は作らず version 不一致は fail-fast（PoC・永続データ非実在・ADR-0015 方針）。
- **A/B/C 比較の結論**: A案採用（B=RowId 直接 Map は範囲走査 O(非空) で DD-006 劣位・C=二段 Map 正本維持は
  500k 文書表現性能が予算未担保のまま DD-014 へ）。記録は `doc/DD/DD-010/scenarios.md`。

**検証（自動試験・green）**: index ずれ 0（AC1）／二段 Map リファレンス差分試験 seed×6・1,200 op 完全一致（AC2）／
serialize→deserialize round-trip・全 replay 整合（AC3/AC4・CG-2 証拠）／documentHash 正準性不変（AC5）。
証拠所在: `doc/DD/DD-010/replay-evidence.md`。

**性能（AC6・`doc/DD/DD-010/perf-report.md`）**: 移行前の製品表現（二段 Map×CellRecord）に対しメモリ heap -22〜31%・
範囲走査 -33〜49%（**非回帰・改善**）。DD-006 の生文字列 PoC ストア基準（16.7MB/8ms）に対する名目超過（メモリ約2倍・
走査約2倍）は **CellRecord 値モデル由来（既存の内在コスト）** であり slot キー化（CG-2）由来ではない。slot キー化の
構造コストは ≒0（chunked-rowslot と同一構造）。heap 最大 135MB＝§21 目標 300MB 未満（R-03 非該当）。

**用途別選択（DD-006 決定案）は維持**: 疎な業務表の既定＝(A) chunked-rowslot（slot 間接）。高密度数値領域は
(C′) chunked-column を選べる拡張点を残す（本DDでは (A) のみ製品統合）。

## 再検討条件

- DD-006（PoC-D）の疎/密比較で、密ブロック（(C)/(D)）が 500,000〜2,000,000 非空セルでメモリ・読取ともに優位と出る
  → ハイブリッド（疎行スロット＋密タイル）へ再設計。
- 行内配列の splice コストが高頻度ランダム書込で問題化 → 行スロットを列 index キーの Map や B-tree へ。
- index キー起因の挿入/削除ずれが Phase 1 の共同編集（RowId 基準の InsertRows/DeleteRows）と衝突
  → RowId キー CellStore へ移行（Phase 1 で必須）。
