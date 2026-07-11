# DD-003 Phase 1 詳細設計: `@nanairo-sheet/sheet-core` 最小

> Phase 1（sheet-core 最小）の 📐 実装前詳細化。モジュール境界・公開シグネチャ・`ApplyResult`/`ChangeSet` の形を確定する。
> `scenarios.md`（A/B/C/D/E カテゴリ）・`protocol-subset.md`（§4 Operation境界・§5 処理順）と型・用語・境界仕様を一致させる。
> **コード化はユーザーレビュー・合意後**（本 Phase 0 では作らない）。ランタイム依存ゼロ（ADR-022・§3.6）・DOM 非参照（§17.2）・`@nanairo-sheet/sheet-types` のブランド型を使用。

## 1. モジュール境界（依存 DAG・循環なし）

```
@nanairo-sheet/sheet-types  （既存: RowId/ColumnId/OperationId 等ブランド型）
        ↑
  document.ts ← operations.ts ← apply.ts
        ↑                          ↑
      hash.ts ────────────────────┘   （apply/hash とも document を参照）
        ↑
     index.ts（公開エントリ: 型と関数を re-export）
```

- `document.ts`: 文書モデルと純粋な読み取り/複製ユーティリティ（状態は持たず、関数が新状態を返す or バッファ操作）。
- `operations.ts`: Operation 型・Envelope 型・`CellScalar` 型（データのみ・ロジックなし）。
- `apply.ts`: 決定論的適用関数（§7.6）。`document` と `operations` に依存。
- `hash.ts`: 正準直列化＋FNV-1a 64bit。`document` に依存。
- すべて DOM/Canvas/React/Hono を import しない（§5.2）。サーバーとクライアントが**同じ apply を共有**（§5.3）。

## 2. `document.ts` — 最小文書モデル

```ts
interface RowMeta {
  id: RowId
  slot: number                 // 安定整数スロット（§6.3）
  tombstone: boolean           // DeleteRows で true。rowOrder からは消さない
  lastChangedRevision: number
}
interface CellRecord {
  value: CellScalar
  lastChangedRevision: number  // 正準ハッシュに含める（§B）
}
interface SheetDocument {
  revision: number
  rowOrder: RowId[]            // tombstone 含む全行の順序（アンカー解決の基準）
  rowMeta: Map<RowId, RowMeta>
  columnOrder: ColumnId[]      // 固定 ColumnId 列（PoC は固定・変更しない）
  cells: Map<RowId, Map<ColumnId, CellRecord>>  // 二段 Map（§6.4 最小形）
}
```

公開関数（純粋）:

- `createDocument(columns: ColumnId[]): SheetDocument`
- `cloneDocument(doc): SheetDocument` — 二相適用のバッファ用（深いコピー。apply の validate→commit で使用）
- `getCell(doc, rowId, columnId): CellRecord | undefined`
- `displayRowOrder(doc): RowId[]` — `rowOrder` から tombstone を除いた**表示順**（hash/描画用）
- `resolveAnchorIndex(doc, afterRowId: RowId | null): number` — `afterRowId` の `rowOrder` 上インデックス（`null`=先頭=-1）。未知IDは `undefined`（→ apply が `unknown-anchor`）。**tombstone 行も参照点として有効**（`protocol-subset.md` §4-2）
- `isTombstoned(doc, rowId): boolean`

> 設計判断: `rowOrder` は tombstone を保持し、表示は `displayRowOrder` で除外する。これにより「削除済みアンカーへの InsertRows（S-D2）」と「hash から tombstone 除外（S-B3）」を両立し、全クライアントで**アンカー解決が同一位置**になる（DA D2）。

## 3. `operations.ts` — Operation / Envelope 型

```ts
type CellScalar =            // §6.4 サブセット（PoC）
  | { kind: 'blank' }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }

interface SetCellsOperation {
  type: 'setCells'
  changes: Array<{ rowId: RowId; columnId: ColumnId; beforeRevision?: number; value: CellScalar }>
  conflictPolicy: 'reject-overlap'   // PoC 固定
}
interface InsertRowsOperation {
  type: 'insertRows'
  afterRowId: RowId | null           // null = 先頭。新 RowId は rows に同梱（採番は apply の外）
  rows: Array<{ rowId: RowId; height?: number }>
}
interface DeleteRowsOperation {
  type: 'deleteRows'
  rowIds: RowId[]
}
type DocumentOperation = SetCellsOperation | InsertRowsOperation | DeleteRowsOperation
```

- Client/Server Envelope 型は `protocol-subset.md` §2 と同一（`sheet-core` に型定義、server-core/client が import）。
- **ID 採番はここに含めない**（§7.6）。新 RowId・operationId・transactionId はクライアント Command 側の `crypto.randomUUID()`（テストは注入シード ID＝DA D4）。

## 4. `apply.ts` — 決定論的適用関数（§7.6）

```ts
interface ChangeSet {
  cells: Array<{ rowId: RowId; columnId: ColumnId; before: CellScalar | undefined; after: CellScalar | undefined }>
  rowsInserted: RowId[]
  rowsDeleted: RowId[]        // 実際に tombstone 化した分のみ（再Delete no-op は含めない）
}
interface InverseSeed {       // rollback 用の逆操作生成データ（§7.6/7.7）
  cells: Array<{ rowId: RowId; columnId: ColumnId; value: CellScalar | undefined }>  // 変更前値
  insertedRowIds: RowId[]     // 逆操作で削除すべき行
  deletedRows: Array<{ rowId: RowId; index: number; meta: RowMeta }>  // 逆操作で復元する行
}
interface ApplyResult {
  document: SheetDocument     // 適用後の新文書（入力は不変）
  changeSet: ChangeSet
  inverseSeed: InverseSeed
  dirtyRegions: RowId[]       // 再描画対象（PoC は行集合で十分）
  formulaInvalidations: never[]  // PoC はスコープ外（常に []）
}

class ApplyError extends Error {
  code: 'unknown-row' | 'target-row-deleted' | 'unknown-anchor'
  offending: unknown         // 違反 change/row の一覧（reject details の元）
}

function applyOperation(
  doc: SheetDocument,
  op: DocumentOperation,
  ctx: { revision: number }  // 付与 revision は呼び出し側（サーバー sequencer / クライアント楽観層）が渡す
): ApplyResult
```

**決定論の担保（§7.6・DA）**:

- **時刻・乱数・DOM・ネットワークを参照しない**。`lastChangedRevision` に刻む値は `ctx.revision`（呼び出し側が渡す。サーバー付与 revision＝committed、楽観適用＝暫定。暫定値は最終 hash に混ざらない＝pending は必ず rollback される・I-4）。
- **二相適用（SetCells 原子性・DA D5）**: `changes` を**全件検証**（行存在・tombstone・`beforeRevision` 照合）→ 全件 OK のときだけ `cloneDocument` 上で確定し新文書を返す。1件でも NG なら `ApplyError` を投げ、**元文書は不変**（部分ミューテーション無し・S-C5）。
- **InsertRows**: `resolveAnchorIndex` で位置決定（tombstone アンカー可・S-D2、未知 `unknown-anchor`・S-D3）。`rows` を該当位置へ挿入、`rowMeta` に `tombstone:false`・`slot` 採番。
- **DeleteRows**: 生存 ID を tombstone 化、tombstone 済み ID は**冪等 no-op**（`rowsDeleted` に含めない・S-E2）。全件 no-op でも**成功**（changeSet 空・S-E3）。呼び出し側は空 changeSet を見て revision 非消費を判断できる（`protocol-subset.md` §4-3・Q-1）。
- 入力 `doc` を破壊しない（純粋。新 `document` を返す）。

## 5. `hash.ts` — 正準直列化＋FNV-1a 64bit

```ts
function canonicalSerialize(doc: SheetDocument): string
function fnv1a64(input: string): string   // 16桁 hex。BigInt で 64bit を厳密計算（Node/ブラウザ共通・crypto 非依存）
function documentHash(doc: SheetDocument): string  // = fnv1a64(canonicalSerialize(doc))
```

**正準化ルール（DA D1・S-B1〜B4）**:

- 行は `displayRowOrder(doc)`（表示順・**tombstone 除外**）で列挙。
- 各行内は `columnOrder` 配列順で列挙（**Map 反復順に依存しない**）。
- 非空セル（`kind !== 'blank'`）のみ `rowId, columnId, kind, value, lastChangedRevision` を区切り文字付きで連結。
- **`localeCompare` や `Array.sort` の既定比較を使わない**（環境依存整列を排除）。順序は常に `rowOrder`/`columnOrder` 配列由来。
- `revision` 自体はハッシュに含めない（収束判定は文書内容＋各セル `lastChangedRevision` で行う。revision 番号のズレは catch-up で解消するため内容 hash とは分離）。

> 収束の主張は**committed 状態・静止点**でのみ行う（I-4・S-H5）。楽観適用ビュー（pending 反映後）の hash は比較対象にしない。

## 6. 相互整合チェック（scenarios / protocol-subset との対応）

| 本設計の要素 | scenarios | protocol-subset |
|-------------|-----------|-----------------|
| 二相適用・SetCells 原子性 | S-C1〜C5 | §4-1・§5-4 |
| tombstone アンカー / rowOrder 保持 | S-D2, S-B3 | §4-2 |
| DeleteRows 冪等・空 changeSet 成功 | S-E2/E3 | §4-3・Q-1 |
| `ctx.revision` 注入（時刻/乱数非参照） | S-A1〜A3, I-1 | §5（付与 revision） |
| 正準化が Map 反復順/localeCompare 非依存 | S-B1/B4 | — |
| committed 静止点でのみ hash 一致 | S-H5, I-4 | — |
| ApplyError code ↔ reject code | S-A6〜A8 | §3 reject コード |

## 7. Phase 2 以降への引き継ぎ（境界メモ）

- `apply` はサーバー（`sequencer.ts`）とクライアント（`session.ts`）で共有する（§5.3）。付与 revision の出所だけが違う。
- `InverseSeed` はクライアント rollback（§7.7 手順1）で逆操作を生成するのに使う。Phase 3 で `session.ts` が消費する。
- `cloneDocument` の深いコピーコストは PoC 規模（数千行）では許容。ボトルネック化したら構造共有へ（§6.3 の注記どおり Phase 0 は配列＋Map で実測）。
