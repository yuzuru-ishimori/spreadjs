主要な安定ID経路は実装されていますが、未知列で共有 validator/apply 契約が破れ、snapshot 不整合がデータ欠落やslot衝突として受理されます。また、描画性能の回帰と性能比較ベンチの非等価性があります。

Full review comments:

- [P1] columnOrder 外の変更を検証段階で reject する — C:\repo\spreadjs\packages\sheet-core\src\document.ts:111-115
  `SetCells` が既存行と未知の `columnId` を指定した場合、`validateOperation` は違反なしを返す一方、適用時にここで通常の `Error` が送出されます。これにより Sequencer の「検証成功なら apply は throw しない」という契約が破れ、WebSocket 経由では操作拒否ではなく接続切断、ローカル操作では pending 追加後の例外になります。列の存在を validator でも検査して構造化 reject にしてください。

- [P2] 不整合な snapshot キーを CellStore 構築前に拒否する — C:\repo\spreadjs\packages\sheet-server-core\src\snapshot.ts:208-215
  version 2 snapshot に重複した `rowMeta.slot` があると複数 RowId が同じ物理行を共有してセルを上書きし、rowMeta にない行や columnOrder 外の列は `continue` で黙って破棄されます。`deserializeSnapshot` は復元前に整合検証を呼ばないため、破損・手動生成された snapshot からサーバーがデータ欠落または RowId エイリアスを持つ状態で起動できます。slot の非負整数性・一意性と全セル参照の解決可能性を検証して fail-fast してください。

- [P2] 空行を列走査する前に除外する — C:\repo\spreadjs\apps\playground\src\integration\document-view.ts:231-234
  セルがない行を含む可視範囲では、旧実装が行 Map の有無を一度確認してスキップしていたのに対し、このループは全列について `getCell` を呼びます。疎な業務表では再描画コストが `O(行数 + 非空行の列数)` から `O(行数×列数)` へ回帰するため、slot 解決後の `cells.hasRow` などで空行を先に除外する必要があります。

- [P2] 移行前ベンチを実際の CellRecord 形状に合わせる — C:\repo\spreadjs\apps\pocd-bench\src\stores\map-record-store.ts:9-13
  AC6 で移行前の `Map<RowId, Map<ColumnId, CellRecord>>` と比較する場合、この `Rec` は実際の二重オブジェクト `{ value: { kind, value }, lastChangedRevision }` ではなく単一の平坦オブジェクトです。オブジェクト数と値アクセス経路が異なるため、heap・走査結果を移行前製品表現との比較として扱えず、性能超過を CellRecord 値モデル由来とするレポートの数値根拠が不正確になります。
---

## 対応記録（dd-implementer / 2026-07-13）

全 4 findings に対応（見送りなし）。詳細は DD 本文ログ参照。

- [P1] unknown-column を validate/apply/RejectCode に追加（`protocol.ts`/`validate.ts`/`apply.ts`/`sequencer.ts`＋テスト）。
  「validateOperation===[] ⇒ applyOperation は throw しない」契約を維持し、WS 切断ではなく構造化 reject にした。
- [P2] deserializeSnapshot: slot 非負一意・セル参照解決可能性を検証し破損 snapshot を fail-fast（`snapshot.ts`＋テスト2件）。
- [P2] document-view.queryRange: slot/hasRow で空行を列走査前にスキップ（O(行×列) 回帰を回避）。
- [P2] map-record-store の Rec を CellRecord 入れ子形状へ修正し 500k 再計測（`perf-report.md` 更新・結論は強化）。

再検証: `npm run test` 561 green・`npm run typecheck` green・`npm run lint` green。
