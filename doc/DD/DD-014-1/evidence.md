# DD-014-1 Evidence（full・A区分）

CG-3 の残解除条件（クライアント snapshot bootstrap＝全 replay 非依存・durable frontier 整合・実ブラウザー再読込 E2E）の証跡を集約する。親DD-014 `evidence.md`（サーバー側 durable ACK・fault matrix・100k 復旧計測）と対をなす。

## 1. join protocol の変更（snapshot@R＋tail）

| join 種別 | 条件 | サーバー応答 | クライアント動作 |
|-----------|------|-------------|-----------------|
| fresh（初回） | lastAppliedRevision=0 かつ frontier>0 | welcome(R)＋**bootstrap(document@R)**＋presenceSnapshot | `awaitingBootstrap` で welcome の catch-up を抑止 → bootstrap で committed@R を確立（全 operationLog を replay しない） |
| 空文書 | lastAppliedRevision=0 かつ frontier=0 | welcome(0)＋presenceSnapshot | 通常 operations 経路（後方互換） |
| partial/reconnect | lastAppliedRevision>0 | welcome(R)＋operations(tail: L+1..R)＋presenceSnapshot | committed@L に tail を適用（従来経路） |

- **wire 形式**: `bootstrap.document` は `DocumentSnapshot`（core `document-snapshot.ts`・rowOrder/rowMeta/columnOrder/cells）。サーバー snapshot と同一実装を共有し hash 決定性を保つ（CG-2/DD-013 収束テスト green 維持）。
- welcome.currentRevision / requestCatchup.toRevision / `/snapshot`.currentRevision はすべて **durable frontier** に制限（未 fsync revision 非観測）。

## 2. durable frontier 契約（親DD-014 §2 durable ACK 契約との差分）

親DD-014 の durable ACK 契約は「accepted submit は oplog append(fsync) 後に ACK/broadcast」。本DDはこれに **読取側の境界**を追加する:

- **配布境界 = durable frontier**（fsync 完了済み最大 revision）。join / requestCatchup / `/snapshot` / welcome は frontier 以下のみを配布する（P1-3）。
- frontier は `DurableFrontier`（persistent-room.ts）が保持し、append(fsync) 解決後に `advance(revision, document@revision)` で単調前進する。document は COW（applyOperation が新インスタンス）ゆえ frontier 時点の参照保持で以降の op に不変。
- 永続化無効時（`persistenceDir` 未指定）は Room が Sequencer の現在値を frontier とみなす（in-memory 全読取可・fast-path で余計な filter 割当を避ける）。
- **snapshot barrier**: snapshot 生成は frontier == currentRevision の完全 durable 状態からのみ（snapshot.revision ≦ durable frontier を常に満たす＝再起動時 snapshot.revision > oplog 長 の fail-fast を構造的に排除）。in-flight で currentRevision>frontier の間は延期（opsSinceSnapshot 据え置き→次 append 解決後に再評価）。
- **poisoned 応答**: append 失敗で room を poisoning（write 全停止）。以降の submit は throw（RoomBridge が 1011 で接続を閉じる）＝Sequencer をこれ以上前進させない（fail-stop・revision 欠番0）。rollback はしない。

## 3. durable frontier fault matrix（AC2/AC3/AC4）

| # | 注入 | 期待 | 検証（テスト名） |
|---|------|------|-----------------|
| F1 | append 未解決（in-flight）中に join | bootstrap.revision = frontier（未 durable revision を含まない） | durable-frontier.test「append 待機中は join/catch-up/durableSnapshot が未 durable revision を観測しない」 |
| F2 | 同上・requestCatchup / `/snapshot` | toRevision/currentRevision = frontier・operationLog ≦ frontier | 同上 |
| F3 | append 解決後 | frontier 前進・以降の join が新 revision を bootstrap | 同上 |
| F4 | snapshotIntervalOps 到達だが in-flight（frontier<current） | snapshot 未生成（barrier で延期） | durable-frontier.test「in-flight のとき snapshot を生成せず、durable 化後に生成する」 |
| F5 | barrier 解除（frontier==current） | snapshot.revision = frontier（≦ durable oplog 長） | 同上 |
| F6 | oplog append 失敗注入 | handleMessage throw・poisoned=true | durable-frontier.test「append 失敗後は後続 submit を reject し oplog に欠番を作らない」 |
| F7 | poisoning 後の submit | reject（/poisoned/ throw）・Sequencer 非前進 | 同上 |
| F8 | poisoning 後の oplog 内容 | revision 連番に欠番なし（[1] のみ） | 同上 |

## 4. bootstrap 計測（AC1/AC8・全 replay 非依存の定量実証）

`scripts/dd014-1/measure-bootstrap.mts`（生ログ: `bootstrap-perf-raw.txt`）。20,000 個別 SetCells op（DD-006 の「個別 op で 14分」経路の縮小版）で構築した権威文書（2,000 行 × 10 列）への fresh join:

| 経路 | 受信メッセージ | 適用サーバー op | committed | hash 一致 | 時間 |
|------|--------------|----------------|-----------|----------|------|
| **snapshot bootstrap（本DD）** | welcome + **bootstrap** + presenceSnapshot（operations 0 通） | **0** | revision 20001 | ✔ | **4.8ms** |
| 対照: 全 operationLog replay（旧経路） | operations（全 20,001 件） | 20,001 | revision 20001 | ✔ | 26,268ms |

→ fresh join / ブラウザー再読込は bootstrap 1 通で committed@R を確立し operationLog を 1 件も replay しない（appliedServerOpCount=0）。DD-006 実測では 100k 個別 op replay=14分＝本DDでその経路を排除した。

## 5. 実ブラウザー再読込復元 E2E（AC8）

`apps/playground/e2e/reload-bootstrap.spec.ts`（headless chromium・実 WS サーバー〔非永続・in-memory〕・50,000 行シード）:

1. セル(7,3)を編集・確定 → pending 0・committed 反映を待つ（`reload-01-before-edit-committed.png`）。
2. `page.reload()` → 新 ClientSession が fresh join → bootstrap で復元。
3. **検証**: `bootstrapRevision > 0`（snapshot bootstrap で確立）・`appliedServerOpCount == 0`（tail 無し＝全 replay 非依存）・編集済み確定値が復元・rowCount ≧ 50,000（`reload-02-after-reload-restored.png`）。

結果: **green**（1 passed）。integration-scenario.spec 6 件も bootstrap 経路で green（回帰なし）。

> 注: 統合 E2E サーバーは非永続（in-memory）＝本 E2E が検証するのは **クライアント側 bootstrap（再読込復元）**。サーバー再起動をまたぐ durable 復元は `apps/collaboration-server/src/server.persistence.test.ts`（node・fsync＋snapshot＋tail）が担う。

## 6. 検証サマリ（AC6）

- `npm run test`: 687 pass / 1 fail。唯一の fail は既知flaky `ws-convergence.smoke`（実 WS 3×1,000 op 収束の**タイムアウト**・assertion 不一致ではない）。**本DD変更なしの baseline でも同一環境負荷下で同条件再現**（stash 検証: baseline も 54s でタイムアウト）＝環境（連続高負荷）依存で本DDと無関係。
- `npm run typecheck` green ／ `npm run lint`（eslint＋boundary **new=0**・DD-016 委譲維持）green ／ `npm run build` green ／ `npm run test:invariants` green（persistence/collab invariant 含む）。
- 追加テスト: collab `bootstrap.test.ts`（4）・server `durable-frontier.test.ts`（6）・server `room.test.ts`（+1）。既存 collab/server/convergence/protocol-contract/persistence/restart-restore は全 green（bootstrap 経路で回帰なし）。
