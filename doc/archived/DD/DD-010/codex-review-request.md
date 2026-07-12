# Codex レビュー依頼: DD-010 安定ID・CellStore移行（CG-2・Risk A）

## 目的・スコープ
CG-2（安定ID: index→RowId）の解除。ADR-0011 の chunked-rowslot 構造を **index キー → RowId キー（slot 間接方式）**
へ移行し、`packages/sheet-core` の文書表現 `SheetDocument.cells`（旧: 二段 `Map<RowId,Map<ColumnId,CellRecord>>`）を
新 CellStore（slot/colIndex キー・チャンク化並列配列）へ差し替えた。serialization（snapshot）・replay 整合・
documentHash 正準性を維持することが要件。

## 設計意図・確定事項（ユーザー合意済み）
- **A案（slot 間接）**: RowMeta.slot（安定整数・単調採番・tombstone でも保持・回収なし）をチャンクキーに使う。
  RowId→slot は rowMeta、ColumnId→colIndex は columnOrder で解決（document.ts の純ヘルパー `slotOf`/`columnIndexOf`/
  `getCell`/`setCell`/`deleteCell`/`deleteRowCells`/`forEachCellInRow` に集約）。各層はこのヘルパー経由でのみ cells を読み書きする。
- **互換不要・fail-fast**: SnapshotData を version 1→2 に更新。互換層・migration なし。version 不一致は throw。
  wire 形式（SerializedDocument）は不変（RowId/ColumnId で直列化）。
- **hash 正準性**: canonicalSerialize は rowId/columnId 文字列を出力し内部表現（slot/colIndex）に非依存＝hash 値不変。

## 重点的に見てほしい観点（findings 優先）
1. **仕様一致 / 安定 ID の正しさ**: InsertRows/DeleteRows/tombstone/削除済みアンカー挿入で、セルが RowId に
   追従し index ずれ・サイレント上書きが起きない設計になっているか。slot 採番（apply.nextSlot=max+1・回収なし）と
   CellStore のキー整合に穴はないか（歯抜け slot・rollback で deleteRow した slot の再利用可能性など）。
2. **round-trip / replay 整合**: serialize→deserialize、空文書からの全 replay で hash・構造（rowOrder/tombstone/
   slot/revision）・tombstone 行のセル保全が一致するか。deserialize の slot/colIndex 解決（rowMeta 先構築・
   columnOrder 引き当て）に取りこぼし経路はないか。
3. **バリデーション / 防御**: setCell が columnOrder 外の列・未知行で fail-fast する一方、getCell/deleteCell が
   lenient な非対称は妥当か（サイレント破損を招かないか）。負 colIndex・非整数 slot の扱い。
4. **回帰**: cloneDocument（`cells.clone()` の深い隔離）・applyInverseSeed（rollback で deleteRowCells を
   rowMeta.delete より前に呼ぶ順序）・document-view read-through（getCell 経由）に破壊がないか。
5. **テスト不足**: differential test（二段 Map リファレンス）の網羅性錯覚（両実装が同じバグを持つ可能性）。
   AC1〜5 のカバレッジ漏れ。境界（空文書・全 tombstone・重複 slot・大規模）。
6. **性能**: perf-report の再検討結論（DD-006 の文字列ストア基準に対する名目超過は CellRecord 値モデル由来で
   CG-2 由来でない／移行前の二段 Map 表現には非回帰）の妥当性。

## 対象差分（uncommitted）
- 新規: `packages/sheet-core/src/cell-store.ts`（CellStore 実装）・同 `cell-store.test.ts`・`cell-store-differential.test.ts`
- 変更: `packages/sheet-core/src/{document,apply,hash,index}.ts`・`packages/sheet-server-core/src/snapshot.ts`（+test）・
  `packages/sheet-collaboration/src/session.ts`・`apps/playground/src/integration/document-view.ts`・
  `apps/collaboration-server/test/{doc-compare,convergence}.ts`・`apps/collaboration-server/src/seed-dataset.test.ts`・
  `apps/pocd-bench/src/bench-replay.ts`・同 `stores/{index,chunked-rowslot-stable-store,map-record-store}.ts`
- 文書: `doc/DD/DD-010/*`・`doc/adr/0011-*`・`doc/plan/cg-ledger.md`

## 制約
- 現行パッケージ名 `packages/sheet-*` のまま（rename は DD-011）。ランタイム依存ゼロ・DOM/Node 非参照（sheet-core）。
- `npm run test`（557 green）・`npm run typecheck`・`npm run lint` 全 green を確認済み。
