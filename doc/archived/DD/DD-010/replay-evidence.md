# DD-010 CG-2 解除証拠（serialization round-trip・replay 整合・differential）

> Evidence Level: **full**（Risk A・§2.2 L5 A区分＝格納場所の集約であり seed・再現コマンド・整合ログを省略しない）。
> CG-2「安定ID（index→RowId）」の解除証拠。すべて自動試験で機械実証（画面なし・TDD）。

## 再現コマンド

```bash
# AC1（index ずれ 0・RowId 追従）＋ store 単体
npx vitest run packages/sheet-core/src/cell-store.test.ts
# AC2（差分試験・二段 Map リファレンスと完全一致・seed×6）
npx vitest run packages/sheet-core/src/cell-store-differential.test.ts
# AC3/AC4（round-trip・全 replay 整合・version fail-fast）
npx vitest run packages/sheet-server-core/src/snapshot.test.ts
# AC5/AC7（hash 正準性不変・全回帰 0）
npm run test && npm run typecheck && npm run lint
```

## AC1: 安定 ID（セル値が RowId に追従・index ずれ 0）

`packages/sheet-core/src/cell-store.test.ts` — 12 tests green。

- store 単体: set/get/delete/deleteRow/hasRow/forEachInRow・blank レコード保持・colIndex 二分探索の昇順維持・
  チャンク境界（slot 255/256/512）・clone の深い隔離・防御（負 colIndex=undefined/throw・非整数 slot=throw）。
- 文書レベル:
  - 「先頭への InsertRows を 10 回繰り返しても row-1 のセル値が不動」（index キーなら破綻するケース）。
  - 「DeleteRows（tombstone）後も当該行のセルが slot に保全・生存行のセルは無傷」。
  - 「削除済みアンカーへの InsertRows でも既存セルが RowId に追従」。

## AC2: 差分試験（新 CellStore ↔ 二段 Map リファレンス完全一致）

`packages/sheet-core/src/cell-store-differential.test.ts` — 6 tests green（seed×6・各 1,200 op）。

- リファレンスは本実装のセル表現に非依存な独立実装（二段 `Map<RowId,Map<ColumnId,CellRecord>>`＋独立 apply＋
  独立 canonical serialize。hash 素 fnv1a64 のみ共有）。
- setCells/insertRows/deleteRows 混在の seed 付きランダム Operation 列を同順適用し、**各 op 後**に
  documentHash・rowOrder・tombstone・slot・全 (rowId×columnId) セル値が完全一致することを検証（tombstone 行の
  セルも含む）。index ずれ・サイレント上書き 0 の機械実証。

**最終 documentHash（独立再現・`node --import tsx` 直実行）:**

| seed | ops | insert | set | delete | finalHash | rev |
|------|-----|--------|-----|--------|-----------|-----|
| 1 | 1200 | 406 | 583 | 211 | `692a1d59cc668c5f` | 1200 |
| 7 | 1200 | 441 | 575 | 184 | `178aee5b2d89abe8` | 1200 |
| 42 | 1200 | 458 | 533 | 209 | `dca8f14eb940f849` | 1200 |
| 1337 | 1200 | 446 | 549 | 205 | `c8a682530a20d10f` | 1200 |
| 20260713 | 1199 | 421 | 539 | 239 | `fd09caaae9f3f781` | 1199 |
| 8888888 | 1200 | 434 | 556 | 210 | `893d448ffa92924a` | 1200 |

（3 種の op がいずれも十分数生成される＝自明収束でないことをテスト内で assert 済み。）

## AC3: serialize→deserialize round-trip（CG-2 証拠①）

`packages/sheet-server-core/src/snapshot.test.ts` — `[AC3]` green。

- シナリオ `buildStableIdSequencer`: insert row-1/2/3 → setCells 各行 → **row-2 を tombstone（セル 'two' を保持）**
  → 削除済みアンカー row-2 直後へ row-new 挿入 → setCells row-new。
- serialize → `JSON.parse(JSON.stringify(...))` → deserialize round-trip で:
  - `documentHash` 一致
  - rowOrder（tombstone 含む全行）一致
  - rowMeta（slot / tombstone / lastChangedRevision）各行一致
  - 全 (rowId×columnId) セル一致（**tombstone 行 row-2 のセル 'two'（rev=5）が保全**）
  - `document.revision` 一致・`SnapshotData.version === 2`

## AC4: 空文書から operationLog 全 replay（CG-2 証拠②）

`packages/sheet-server-core/src/snapshot.test.ts` — `[AC4]` green。

- `verifySnapshotIntegrity(data).ok === true`・`documentHash === replayHash`。
- revision 連番（`log[i].revision === i+1`）・`currentRevision === ログ長`・`document.revision === currentRevision`。
- 既存の収束試験（`apps/collaboration-server/test/convergence.test.ts` 3〜10 クライアント×10,000 件・
  フォールト注入）が新表現で二重適用 0・全 committed 収束を維持（回帰 0）。

## 要確認2: version 不一致 fail-fast

`[要確認2]` test green — `version:1` の snapshot を `deserializeSnapshot` に渡すと throw（互換層・migration
なし。ADR-0015 方針）。`SNAPSHOT_VERSION = 2`（DD-010 で 1→2 更新・wire 形式 SerializedDocument は不変）。

## AC5: documentHash 正準性の不変

- 表現変更（二段 Map → slot キー CellStore）前後で hash 値は不変。正準形（canonicalSerialize）は rowId/columnId
  文字列を出力し内部表現（slot/colIndex）に非依存。
- `hash.test.ts`（fnv1a64 期待値・documentHash 決定論・Map 反復順非依存の各 assert）・`snapshot.test.ts` S-K2
  round-trip・cross-platform 一致（ws-convergence smoke）が**hash 期待値そのままで green**（構築構文のみ store 化）。

## 総括

CG-2 の解除証拠（AC1〜5）は全て自動試験で green。**セルデータは物理的に slot（安定整数）へ束ねられ、
InsertRows/DeleteRows で移動しない**ため index ずれ・サイレント上書きは構造的に発生しない。round-trip・全
replay・differential・hash 正準性のいずれも新表現で整合。DD-014（永続化）より前に完了。
