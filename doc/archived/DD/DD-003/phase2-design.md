# DD-003 Phase 2 詳細設計: `@nanairo-sheet/sheet-server-core` 最小 ＋ sheet-core 共有追加

> Phase 2（sheet-server-core 最小＋共有バリデーター/プロトコル型）の 📐 実装前詳細化。
> Sequencer/Room/Presence/Snapshot の責務分割・メッセージ in/out インターフェース・公開シグネチャを確定する。
> `scenarios.md`（C/D/E/F/G/I/K/L）・`protocol-subset.md`（§1〜§7・**§5 の処理順は厳守**）・`phase1-design.md` と
> 型・用語・境界仕様を一致させる。ランタイム依存ゼロ・Node/Date/Math.random 非参照（クロック・ID は注入）。
> 主セッションレビュー指示 1〜6（DDログ 2026-07-11 Phase 2）を反映する。

## 0. パッケージ構成と依存 DAG（循環なし）

```
@nanairo-sheet/sheet-types  （ブランド型）
        ↑
@nanairo-sheet/sheet-core   （document / operations / apply / hash ＋【本Phase追加】validate / protocol）
        ↑
@nanairo-sheet/sheet-server-core  （sequencer / room / presence / snapshot）
```

- server-core は sheet-core を `devDependencies:"*"` 参照（型のみ import は実行時消去。apply/validate は実行時に呼ぶ）。
  Phase 1 sheet-core と同一方式。ランタイム依存ゼロ・`types:[]`・`lib:["ES2022"]`。
- **クライアント（Phase 3）は sheet-core の protocol.ts / validate.ts を import するが server-core には依存しない**
  （指示 2）。ゆえにメッセージ型・共有バリデーターは sheet-core 側に置く。

## 1. 【sheet-core 追加】`validate.ts` — 共有バリデーター（指示 1）

サーバー（sequencer の reject 判定）とクライアント（Phase 3 pending 再検証）が**同じ関数**で判定し、
判定乖離を構造的に防ぐ（§5.3 適用関数共有の精神）。`applyOperation` 本体は変更しない。

```ts
export type OperationViolation =
  | { code: 'unknown-row'; rowId: RowId }
  | { code: 'target-row-deleted'; rowId: RowId }
  | { code: 'unknown-anchor'; afterRowId: RowId }
  | { code: 'duplicate-row'; rowId: RowId }                       // 既存行 or op 内重複（指示 3・DA D11 境界）
  | { code: 'stale-cell-revision'; rowId: RowId; columnId: ColumnId; currentValue: CellScalar | undefined; currentRevision: number };

export function validateOperation(doc: SheetDocument, op: DocumentOperation): OperationViolation[];
```

- **SetCells**: 各 change を順に検査し、違反 1 件を収集（1 change は高々 1 違反）:
  行未知→`unknown-row` / tombstone→`target-row-deleted` /
  `beforeRevision` 定義済みかつ現在セル revision と不一致→`stale-cell-revision`（`currentValue`・`currentRevision` 同梱）。
  - 現在セル revision = `getCell(doc,r,c)?.lastChangedRevision ?? 0`（未書込セルは 0 とみなす）。
  - `beforeRevision === undefined` は stale 検査スキップ（optimistic concurrency を要求しない書込）。
- **InsertRows**: `resolveAnchorIndex` が `undefined`→`unknown-anchor`。
  `rows[].rowId` が既存（`rowMeta` に存在）または op 内で重複→`duplicate-row`（指示 3・S-D6）。
- **DeleteRows**: 違反なし（再 Delete は冪等・S-E2/E3）→ 常に `[]`。
- **契約**: `validateOperation(doc,op) === []` ⇒ `applyOperation(doc,op,ctx)` は throw しない
  （validate の違反集合は apply の構造 3 種を包含。duplicate-row は apply が防御しない D11 を Room 境界で塞ぐ）。
- **決定性**: 違反は change/row の配列順で並ぶ（Map 反復に依存しない）。時刻・乱数非参照。

## 2. 【sheet-core 追加】`protocol.ts` — メッセージ型（指示 2・型のみ）

protocol-subset §1/§3/§6 を型で確定（ランタイムコードなし）。server-core と Phase 3 クライアントが import。
Envelope 型は既存 operations.ts に定義済み（Phase 1）→ protocol.ts が type import して message でラップ。

```ts
export type RejectCode =
  | 'stale-cell-revision' | 'target-row-deleted' | 'unknown-anchor' | 'unknown-row'
  | 'invalid-base-revision' | 'client-sequence-violation' | 'duplicate-row';   // duplicate-row 新設（指示 3）

export interface CellAddressById { rowId: RowId; columnId: ColumnId }
export interface SelectionById { startRowId: RowId; startColumnId: ColumnId; endRowId: RowId; endColumnId: ColumnId }
export interface PresencePayload { userId; displayName; activeCell?; selectionRanges: SelectionById[]; editingCell? }
export interface UserPresence extends PresencePayload { connectionId: string; colorKey: string; sequence: number }

export interface RejectDetails {           // code ごとに使うフィールドが異なる最小構造（any 不使用）
  violations?: OperationViolation[];        // 検証 reject（全違反を列挙＝SetCells 原子性・§3）
  currentRevision?: number;                 // invalid-base-revision
  expectedSequence?: number;                // client-sequence-violation
  receivedSequence?: number;                // client-sequence-violation
}

// Client → Server（§1）
export type ClientMessage = JoinMessage | SubmitOperationMessage | PresenceClientMessage | HeartbeatMessage | RequestCatchupMessage;
// Server → Client（§1）
export type ServerMessage = WelcomeMessage | OperationsMessage | OperationAckMessage | OperationRejectedMessage
  | PresenceSnapshotMessage | PresenceDeltaMessage | PresenceRemovedMessage | HeartbeatAckMessage;
```

- `JoinMessage` フィールドは §1 に厳密一致（`protocolVersion, documentId, lastAppliedRevision, clientId`。**userId/displayName は持たない**）。
- `presence` メッセージが `userId`/`displayName`＋3 種フィールドを運ぶ（`PresencePayload`）。`colorKey`/`connectionId` はサーバー付与。
- **配置判断**: Envelope は operations.ts（Phase 1）に既存のため二重定義しない。protocol.ts は message union のみ追加。

## 3. `sequencer.ts` — 全順序シーケンサー（protocol-subset §5 厳守）

**状態**（クラスで保持。純粋性制約は apply 側の話）: `document`・`operationLog: ServerOperationEnvelope[]`・
`currentRevision`・`ackCache: Map<OperationId, number>`（operationId→ACK revision）・
`clientSequenceTable: Map<string, number>`（clientId→最終処理 clientSequence）。注入 `clock`。

```ts
export type SequencerOutcome =
  | { status: 'accepted'; ack: OperationAckMessage; envelope: ServerOperationEnvelope }  // ← broadcast 対象
  | { status: 'noop';     ack: OperationAckMessage }                                     // revision 非消費・非配信
  | { status: 'duplicate';ack: OperationAckMessage }                                     // 冪等再返却・非配信
  | { status: 'rejected'; rejection: OperationRejectedMessage };

class Sequencer {
  constructor(state: SequencerState, clock: Clock);
  get currentRevision(): number;
  get document(): SheetDocument;                       // 参照返し（呼び出し側は変更しない）
  submit(env: ClientOperationEnvelope): SequencerOutcome;
  operationsSince(afterRevision: number): ServerOperationEnvelope[];  // revision > afterRevision（off-by-one 明示）
  exportState(): SequencerState;                        // snapshot 用の深いコピー
}
```

**submit 処理順（§5 厳守。順序が正しさを決める＝DA D3）**:

1. **operationId 冪等**: `ackCache` にあれば `duplicate`（キャッシュ revision を再返却）。以降のチェックをしない（S-F2）。
   → clientSequence 検査より**先**（重複再送は seq が前回同値になり、順序を誤ると F2 が壊れる＝§5 注記）。
2. **clientSequence 検査**（clientId 単位・`expected=(last??0)+1`）: 不一致（欠番/戻り）は
   `client-sequence-violation`（advance しない・S-F3）。cA/cB は別列（S-F4/F5）。
3. **seq スロット消費**: ここを通ったら `clientSequenceTable[clientId]=seq` を**必ず**前進（以降の reject でも前進。
   well-behaved クライアントの次 op が `seq+1` で受理されるため。reject 済み op は Conflict Queue 行き＝再送しない）。
4. **baseRevision 検査**: `baseRevision > currentRevision`→`invalid-base-revision`（S-F6）。
5. **検証**: `validateOperation(document, op)`。非空なら primary code（unknown-row>unknown-anchor>duplicate-row
   >target-row-deleted>stale の固定優先）で reject・`details.violations` に**全違反**（SetCells 原子性・§3・G1/G4）。
6. **適用**: `applyOperation(document, op, {revision: currentRevision+1})`。
   - **空 changeSet（Q-1 no-op＝全件 tombstone 済み DeleteRows 等）**: revision 非消費・ログ非追記・配信なし。
     `ack.revision = currentRevision`（処理時点）を返し、**ackCache 登録・clientSequence 前進**（S-E3・指示 4）。
   - **非空**: `currentRevision+=1`・`document=result.document`・ServerOperationEnvelope をログ追記・
     ackCache 登録・`accepted`（envelope を broadcast 対象で返す）。
7. `acceptedAt = new Date(clock.now()).toISOString()`（注入クロック＝決定的。hash には含めない）。

- **ackCache は accepted と noop の両方**を登録（no-op ACK はログから再構築できない＝snapshot 明示 export の根拠・指示 5）。
- reject は二重適用を起こさないためキャッシュしない（reject 済み op の再送＝クライアント責務で Conflict Queue・Phase 3 境界）。
- ログ revision は**連続**（no-op/reject は消費しない）→ `log[i].revision === i+1`。`operationsSince(N)=log.filter(revision>N)`。

## 4. `room.ts` — 権威 Room（トランスポート非依存・メッセージ in/out）

**状態**: `sequencer: Sequencer`・`presence: PresenceRegistry`・`connections: Map<connectionId,{clientId}>`・
注入 `clock`・`idGenerator`（connectionId 払い出し・既定は決定的連番）。

```ts
export type OutboundTarget =
  | { kind: 'connection'; connectionId: string }        // 直接宛先
  | { kind: 'others'; exceptConnectionId: string }      // 送信元以外へ配信
  | { kind: 'all' };                                     // 全接続（送信元含む＝operations エコー）
export interface Outbound { target: OutboundTarget; message: ServerMessage }

class Room {
  constructor(sequencer: Sequencer, deps: { clock: Clock; idGenerator?: IdGenerator; ttlMillis?: number });
  handleJoin(join: JoinMessage): { connectionId: string; outbound: Outbound[] };  // connectionId 払い出し
  handleMessage(connectionId: string, message: ClientMessageExceptJoin): Outbound[];
  handleDisconnect(connectionId: string): Outbound[];   // 正常 close → presenceRemoved 即時
  sweep(): Outbound[];                                   // TTL 失効 → presenceRemoved（注入クロック・明示発火）
  activeConnectionIds(): readonly string[];              // 'all'/'others' 展開用（transport が fan-out）
  exportState(): SequencerState;                         // = sequencer.exportState()（snapshot 用）
}
```

- **handleJoin**: `connectionId=idGenerator.next()`・`connections.set`・`presence.register(connectionId)`（colorKey 予約・
  lastSeen=now）。outbound = `welcome{sessionId=connectionId,currentRevision}` ＋（`operationsSince(lastAppliedRevision)` が
  非空なら）`operations` ＋ `presenceSnapshot{users: presence.snapshot()}`（いずれも送信元へ）。
  - **設計判断**: join は §1 どおり userId/displayName を持たない。ゆえに join 時は **presenceDelta を配信しない**
    （共有すべき user データが無い）。colorKey だけ予約し、**最初の presence メッセージ**で UserPresence を確定→他へ
    presenceDelta（S-L1 の「join で colorKey 割当・presenceSnapshot 送付」は満たし、delta は presence 到着時）。
- **handleMessage**:
  - `submitOperation`→`sequencer.submit(envelope)`。`accepted`→ `[{connection(sender):ack},{all:operations{from=rev,to=rev,[envelope]}}]`
    （ACK と operations の順不同を許容・S-H4）。`noop`/`duplicate`→ `[{connection(sender):ack}]`。`rejected`→ `[{connection(sender):reject}]`。
  - `presence`→ `presence.update`。新しければ `[{others(exc sender):presenceDelta{presence}}]`、古ければ `[]`（S-L3）。
  - `heartbeat`→ `presence.touch`・`[{connection(sender):heartbeatAck{serverTime:now}}]`（TTL 更新・S-L4）。
  - `requestCatchup{afterRevision:N}`→ `[{connection(sender):operations{from=N+1,to=currentRevision, operationsSince(N)}}]`
    （**off-by-one: N 自身は再送しない**・S-I5。空でも range を返して確定応答）。
- **handleDisconnect**: `connections.delete`・`presence.remove`（即時）→ presence を持っていたら
  `[{others(exc conn):presenceRemoved{sessionId:conn}}]`（S-L6）。
- **sweep**: `presence.sweep()` の各失効接続を `connections.delete`、presence を持っていた分だけ
  `presenceRemoved`（S-L5）。

## 5. `presence.ts` — connection 単位レジストリ（注入クロック・決定的 colorKey）

```ts
class PresenceRegistry {
  constructor(deps: { clock: Clock; ttlMillis: number });
  register(connectionId: string): string;                 // colorKey 割当（未使用最小 index=`color-${i}`）・lastSeen=now
  touch(connectionId: string): void;                      // heartbeat/活動 → lastSeen=now
  update(connectionId: string, sequence: number, payload: PresencePayload): UserPresence | undefined; // 単調 seq・古いは undefined
  remove(connectionId: string): boolean;                  // hadPresence を返す・colorKey 解放
  sweep(): Array<{ connectionId: string; hadPresence: boolean }>;  // (now-lastSeen) > ttl を失効・colorKey 解放
  snapshot(): UserPresence[];                             // presence 確定済みのみ
  get(connectionId): UserPresence | undefined; has(connectionId): boolean;
}
```

- **colorKey**: 未使用の最小非負 index → `color-${index}`（決定的・同色回避）。remove/sweep で解放し再利用（指示 6）。
- **sequence 単調**: `保持 presence があり sequence <= 保持.sequence` は破棄（lastSeen だけ更新＝proof of life・S-L3）。
- **TTL**: `(clock.now() - lastSeen) > ttlMillis` を失効。**明示 sweep()** で発火（実時間待ちに依存しない・DA D6）。
- 未 register の connectionId への update は `undefined`（join 前提）。payload の cell/selection は防御コピー。

## 6. `snapshot.ts` — JSON エクスポート/インポート＋整合検証（指示 5）

エクスポート内容は **`{document(正準構造), operationLog, currentRevision, ackCache, clientSequenceTable}` を全部**含める
（no-op の ACK はログから再構築できないため ackCache 明示 export が必須。DA D17）。Presence は非永続ゆえ含めない。

```ts
export interface SnapshotData {          // JSON セーフ（Map→配列・二段 cells→配列）
  version: 1;
  document: SerializedDocument;
  operationLog: ServerOperationEnvelope[];
  currentRevision: number;
  ackCache: Array<{ operationId: string; revision: number }>;
  clientSequenceTable: Array<{ clientId: string; lastSequence: number }>;
}
export function serializeSnapshot(state: SequencerState): SnapshotData;
export function deserializeSnapshot(data: SnapshotData): SequencerState;   // Sequencer 復元入力（S-K2）
export function verifySnapshotIntegrity(data: SnapshotData):               // S-K1/K2・DA D7「ログ再構築」比較の基盤
  { ok: boolean; documentHash: string; replayHash: string };              // document hash == ログ replay hash
```

- **verifySnapshotIntegrity**: `createDocument(columnOrder)` から `operationLog` を revision 順に replay して hash を計算し、
  復元 document の hash と比較（一致で ok）。no-op はログに無い＝replay に影響しない（元々 document を変えない）ため一致する。
- **復元後 revision 継続**（S-K4）: `currentRevision` を復元 → 次 accepted は `R+1`（単調維持）。
- **再送誤 reject 防止**（DA 重点）: ackCache/clientSequenceTable を復元するため、復元後の再送は
  「既処理 opId→キャッシュ ACK」「新規 opId→seq 継続で受理」の両経路とも正しく動く（欠落させると誤 reject 経路が開く）。

## 7. 注入依存（決定性）

```ts
export interface Clock { now(): number }                 // Date.now 非参照。app 層で実クロックを注入（Phase 4）
export interface IdGenerator { next(): string }          // connectionId 払い出し。既定=決定的連番 `conn-${n}`
export function createCounterIdGenerator(prefix?: string): IdGenerator;   // テスト再現用の既定実装
```

- Room/Sequencer は `Date.now()`/`Math.random()`/`setInterval` を直接呼ばない（時刻＝注入クロック・colorKey＝決定的・
  connectionId＝注入 IdGenerator・TTL 失効＝明示 sweep）。

## 8. 相互整合（scenarios / protocol-subset との対応）

| 本設計の要素 | scenarios | protocol-subset |
|-------------|-----------|-----------------|
| 処理順 opId→seq→base→validate→apply | S-F2/F3/F6 | §5 |
| SetCells 原子性・stale 全体 reject・全違反列挙 | S-C1/C2/C4・G1/G4 | §3・§4-1・§5-5 |
| duplicate-row（新設） | S-D6 | §3・§4（追記） |
| tombstone アンカー Insert・受付順逐次 | S-D2/D5 | §4-2 |
| DeleteRows 冪等・no-op 非消費・ACK 前進 | S-E3/E4 | §4-3・Q-1 |
| catch-up off-by-one | S-I5 | §7 |
| snapshot export/import・復元 hash・revision 継続 | S-K1〜K4 | §7（初期接続） |
| Presence colorKey/sequence/TTL/close | S-L1〜L7 | §6 |
| validateOperation 共有（サーバー=クライアント判定一致） | S-C2 相当 | §3（reject 契機） |
