# DD-010 設計確定・テストシナリオ（Phase 0/1）

> Human Spec Gate 素材。呼び出し元（オーケストレータ）経由でユーザーが確定した 4 点（下記「確定事項」）の
> 範囲内で設計を詳細化した。新たな設計論点は生じていない（＝停止不要）。

## 確定事項（ユーザー合意・仕様確認ゲート）

1. **CellStore 内部方式 = A案（slot 間接）**。RowMeta.slot をチャンクキーにし、ADR-0011 の chunked-rowslot
   構造（チャンク×行スロット×列昇順並列配列＋二分探索）を流用。RowId→slot は rowMeta で解決。
   A/B/C の比較記録は残すが結論は A案。
2. **既存 SnapshotData version 1 との互換 = 互換不要・fail-fast**。PoC 形式で永続データが実在しないため
   互換層・migration は作らない。version 不一致は検出して fail-fast（ADR-0015 準拠）。
3. **ADR-0011 を本DDで Accepted 化**（実装完了後の手動 ChatGPT 外部レビューを前提に本文へ追記）。
4. **性能非回帰の合格ライン = 範囲走査 +30% 以内・メモリ +20% 以内**（DD-006 実測: 範囲走査 8ms・疎
   16.7MB@500k が基準）。超過時は方式を再検討し結果を DD へ記録。

## A/B/C 比較の結論（要確認1・比較記録）

| 案 | 挿入/削除でのセル移動 | チャンク局所性（範囲走査・省メモリ） | 実装コスト | 判定 |
|---|---|---|---|---|
| **A: slot 間接** | ゼロ（slot 不変・tombstone でも保持） | 維持（ADR-0011 実測優位） | slot 採番規約は既存 apply を踏襲＝新規実装ほぼゼロ | **採用** |
| B: RowId 直接 Map | ゼロ | 放棄（二段 Map と同型＝範囲走査 O(非空)） | 最小 | 却下（DD-006 で範囲走査劣位が実測済み） |
| C: 二段 Map 正本維持 | ゼロ | 描画派生のみ・正本は非チャンク | 変更最小 | 却下（台帳/ロードマップ「index→RowId 移行」と不整合・500k 文書表現性能が予算未担保のまま DD-014 へ） |

**A案が「安定 ID」と「ADR-0011 実測優位」を両立する唯一案**。slot はもともと安定整数（§6.3）で、
apply が単調採番していた（がキーには未使用）。A案はその slot を CellStore のチャンクキーに用いるだけで、
データ構造・採番規約とも既存資産の流用で済む（新規リスク最小）。

## slot 採番・回収規約（新規論点の確定）

- **採番**: `apply.nextSlot(doc) = max(既存 slot) + 1`（空文書は 0）。**既存の apply 実装をそのまま踏襲**
  （本DDで採番ロジックは変更しない）。単調・重複なし・決定論。InsertRows で新行に付与。
- **回収**: しない。DeleteRows は tombstone のみで rowOrder/rowMeta/slot を保持する（セルデータも slot に残る）。
  ゆえに歯抜け slot は「rollback で挿入行を除去した」場合のみ生じ、通常運用では密に詰まる。
- **compaction**: PoC では不要（歯抜けは稀・チャンク走査は疎配列で O(可視)）。将来の永続化（DD-014）で
  再評価する拡張点として残す。**hash・serialization は slot を出力しない**ため compaction は正準形へ非影響。
- **slot は hash に含めない**（従来どおり）。serialization には rowMeta の一部として含める（構造復元用）。

## serialization 変更点（`packages/sheet-server-core/src/snapshot.ts`）

- **wire 形式（SerializedDocument）は不変**: `rowMeta[]`＋`cells: Array<{rowId, columns[]}>`。RowId/ColumnId で
  直列化するため、内部表現（slot/colIndex）に非依存。round-trip の JSON バイト互換は保つ。
- **version を 1 → 2 に更新**（`SNAPSHOT_VERSION=2`）。永続データ非実在ゆえ互換層なし。`deserializeSnapshot` は
  version 不一致で **fail-fast**（throw）。
- `serializeDocument`: `doc.cells`（旧二段 Map）反復 → **rowMeta を走査し `forEachCellInRow`（slot→colIndex 昇順）**
  で非空行のみ直列化（tombstone 行のセルも保全）。
- `deserializeDocument`: rowMeta 先構築 → RowId→slot・ColumnId→colIndex を解決して `createCellStore` へ復元。
- `verifySnapshotIntegrity` / `structuralMatch` は rowOrder・rowMeta（tombstone/revision）比較で不変（cells 表現に非依存）。

## SheetDocument 統合方式（波及一覧）

`SheetDocument.cells: Map<RowId, Map<ColumnId, CellRecord>>` → `CellStore`（slot/colIndex キー）。
RowId/ColumnId 解決は document.ts の純ヘルパーへ集約（`slotOf` / `columnIndexOf` / `getCell` / `setCell` /
`deleteCell` / `deleteRowCells` / `forEachCellInRow`）。各層はこのヘルパー経由でのみ cells を読み書きする。

| 層/ファイル | 変更 |
|---|---|
| `packages/sheet-core/src/cell-store.ts`（新規） | CellStore 実装（chunked-rowslot・slot キー・CellRecord 格納・二分探索・clone） |
| `document.ts` | cells 型変更・createDocument/cloneDocument（`cells.clone()`）・getCell/setCell 等ヘルパー |
| `apply.ts` | applySetCells / readCellValueOrBlank を setCell / getCell へ（nextSlot・InsertRows/DeleteRows は不変） |
| `hash.ts` | canonicalSerialize を slot/colIndex 走査へ（出力は rowId/columnId ＝正準形不変） |
| `snapshot.ts` | 上記 serialization 変更点 |
| `session.ts` | applyInverseSeed の cells 操作を deleteRowCells/deleteCell/setCell へ |
| `document-view.ts`（playground） | queryRange/nonEmptyCount を getCell/store へ（read-through 不変・第二 CellStore 化しない） |
| `doc-compare.ts`・`bench-replay.ts`・convergence/seed テスト | getCell/forEachCellInRow/nonEmptyCount へ追従 |

## テストシナリオ（Red→Green）

### AC1（index ずれ 0・RowId 追従）— `cell-store.test.ts`
1. store 単体: set/get/delete/deleteRow/hasRow/forEachInRow の基本・blank レコードも保持（二段 Map と等価）・
   colIndex 二分探索の昇順維持・clone の深い隔離・nonEmptyCount 一致・負 colIndex は get=undefined/set=throw・非整数 slot は throw。
2. 文書レベル: InsertRows で既存行のセルが不動（挿入は他行のセル値に影響しない）・DeleteRows（tombstone）後も
   当該行のセルが slot に保全され、un-tombstone 相当（rollback）で復活・削除済みアンカーへの InsertRows で
   既存セルが RowId に追従・「先頭挿入を大量に繰り返しても各 RowId のセルが元値を保つ」（index 方式なら壊れるケース）。

### AC2（differential・二段 Map リファレンス完全一致）— `cell-store-differential.test.ts`
- 独立実装の二段 Map リファレンス（`Map<RowId, Map<ColumnId, CellRecord>>`＋参照 apply＋参照 canonical）を用意。
- seed 付き PRNG で setCells/insertRows/deleteRows 混在の Operation 列（1,000 件以上×複数 seed）を生成し、
  本実装 `applyOperation` とリファレンス apply へ同順適用。**各 op 後**に全 (rowId×columnId) セル値・rowOrder・
  tombstone・documentHash がリファレンスと完全一致することを検証（index ずれ・サイレント上書き 0 の機械実証）。

### AC3/AC4（round-trip・replay 整合＝CG-2 証拠）— `snapshot.test.ts` 追加
- InsertRows/DeleteRows/tombstone/削除済みアンカー挿入を含むログで serialize→JSON→deserialize round-trip →
  documentHash・rowOrder・rowMeta（slot/tombstone/revision）一致。
- 空文書から operationLog 全 replay → 復元文書と hash・構造一致・revision 連番・二重適用なし（`verifySnapshotIntegrity`）。
- version 不一致（version:1 の壊れ snapshot）は `deserializeSnapshot` が throw（fail-fast）。

### AC5（hash 正準性不変）
- 既存 `hash.test.ts`（fnv1a64 期待値・documentHash 決定論・Map 反復順非依存）・`snapshot.test.ts` S-K2 round-trip・
  収束試験が**表現変更後も無修正の hash 期待値で green**（構築構文のみ store 化・hash 値は不変）。

### AC6（性能非回帰）— `apps/pocd-bench`
- 新 CellStore を bench 候補に追加し 500k×4分布を DD-006 と同 seed で再計測。合格ライン: 範囲走査 +30%・メモリ +20% 以内。
