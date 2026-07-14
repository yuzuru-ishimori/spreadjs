The patch still has production-reachable durable reconciliation errors, an unreconciled catch-up bootstrap path, and an offline timeout that can be continually reset. The randomized evidence also does not exercise the claimed persistent restart behavior.

Full review comments:

- [P1] Reconcile pending ops on catch-up bootstraps — C:\repo\spreadjs\packages\collab\src\session.ts:494-495
  When a periodic or retry `requestCatchup` crosses the snapshot threshold, the server returns a `bootstrap` without a new `welcome.reconcile`, so this call uses absent or stale reconciliation data. If an own operation was accepted but its ACK/echo was dropped, the snapshot contains its effect while the pending entry remains: an insert becomes a false duplicate conflict, while a SetCells entry can remain acknowledged forever after the dedupe ACK because no echo follows. The bootstrap response needs reconciliation for its current frontier.

- [P1] Keep pre-fsync accepts pending during reconciliation — C:\repo\spreadjs\packages\server\src\room.ts:162-162
  With persistence enabled, a client can reconnect while its previous submit is awaiting `oplog.append`: the live sequence table already includes the sequence, but `acceptedOperationIds` excludes its revision because the durable frontier is older. The client therefore marks the operation rejected; when append succeeds, the `all` echo reaches the new connection while the ACK remains addressed to the closed one. This produces a production false conflict without message reordering, so pre-fsync state must remain unknown/pending.

- [P1] Persist non-revision outcomes before reconciling them — C:\repo\spreadjs\packages\server\src\room.ts:162-169
  When a rejection or no-op response is lost, reconnect removes the pending entry using the live sequence table/ACK cache even though these outcomes were not appended to the oplog. If the server restarts before a later durable state capture, it recovers the older client sequence while the client sends the next sequence, causing a permanent `client-sequence-violation` resend loop. In particular, `revision <= frontier` does not prove a no-op is durable because its ACK uses the unchanged current revision.

- [P1] Preserve the original offline deadline across retry failures — C:\repo\spreadjs\packages\collab\src\session.ts:314-317
  During a prolonged outage, every failed WebSocket reconnect attempt calls `handleDisconnected()` again while the session is already offline, resetting `offlineSince`. With the default retry delay capped at 30 seconds and `maxOfflineMillis` also 30 seconds, these retries can indefinitely postpone the timeout, allowing low-volume editing beyond the configured offline window. Set the timestamp only on the initial online-to-offline transition.

- [P2] Exercise persistent restarts in the randomized invariant — C:\repo\spreadjs\tests\invariants\collab\reconnect-fault.invariant.test.ts:137-139
  Every randomized run constructs one in-memory `Sequencer` and `Room` and keeps them for the entire run, so no server restart, oplog recovery, or durable-frontier transition is injected despite the C10/AC6 claims of randomized S-restart coverage. Persistence/recovery reconciliation regressions therefore pass this invariant; add an actual persistent restart path or narrow the claimed coverage.
---

## 対応（2026-07-14・第3回反映）

第3回 xhigh レビューの 5 findings を反映した。**P1-a は第2回で自分が入れた回帰**（reachable）・**P1-b/P1-d も reachable**（永続化）ゆえ全て修正。

- **[P1-a] requestCatchup→bootstrap が reconcile 無し**（`room.ts`）— ✅修正（**自己回帰の是正**）: 第2回で入れた「requestCatchup が差分>閾値で bootstrap を返す」を**撤回**。requestCatchup は **tail（operations）のみ**返す（reconcile 情報を伴わない snapshot 再取得は受理済み未ACK op を phantom conflict/永久 acknowledged 化するため）。snapshot 再取得は reconcile を伴う **join 経路限定**。bootstrap フレーム自体は welcome 同梱で TCP が確実配送・hub 非 drop ゆえ「open 中喪失」は到達不能。client の awaitingBootstrap 中 requestCatchup 再送も撤回。テスト更新。
- **[P1-b] pre-fsync accept の false conflict**（`room.ts` computeReconcile／`session.ts` applyReconcile）— ✅修正（**中核・reachable**）: reconcile に **`inFlightOperationIds`**（ackCache 在だが revision>frontier＝未 durable な in-flight）を追加。client は除去も reject もせず **pending 保持（再送）**する（除去は喪失〔P1-1〕・reject は durable 化後 false conflict〔P1-b〕）。durable 化後 echo で正規化。回帰 `reconnect-reconcile.test.ts`（P1-b）。
- **[P1-c] non-revision outcome の非 durable seq → restart 後 seq違反ループ**（`session.ts`）— ✅修正（**D27 完全再整列**）: `handleRejected` の client-sequence-violation で **expectedSequence が pending 先頭 seq より小さい**（server が restart で noop/reject の seq 消費を失い後退）とき、未ACK pending を expected から **連番へ再整列**（`rebaselinePendingSequence`・operationId 不変＝dedup キーゆえ冪等）。永久ループを解消。回帰 `reconnect-reconcile.test.ts`（P1-c）。
- **[P1-d] offline 期限が再接続失敗ごとに reset**（`session.ts` handleDisconnected）— ✅修正: `offlineSince` を **online→offline 遷移時のみ**設定（`if (this.online)`）。長時間 outage で再接続試行失敗の再 disconnect が期限を無限に後ろ倒しするのを防ぐ。
- **[P2] invariant が persistent restart を injしない**（`reconnect-fault.invariant.test.ts`）— ✅修正（claim 分離）: randomized invariant は単一 Sequencer/Room ゆえ **S-cont のみ**と明示（fault-matrix C10＝S-cont・C10r＝S-restart を分離）。S-restart reconcile は決定論テスト（reconnect-fault WS-R5〔永続化再起動〕・restart-restore）で固定。

### 反映後の到達性まとめ
reachable な findings（P1-a 自己回帰・P1-b 永続化 false conflict・P1-c restart seq ループ・P1-d offline 期限）は全て修正。残 boundary は fault-matrix §3.1 の echo-ahead-without-ack（false conflict・**サイレント喪失ではない**・TCP 到達不能）のみ。

### レビュー打ち切り（ユーザー判断・2026-07-14）
第4回は実施せず締める。第2〜3回の findings は狭い永続化/順序入替エッジに収束（実害＝false conflict〔喪失なし〕・緩い安全弁・自作回帰の後始末が中心・実害の高い P1-c〔stall〕は反映済み）。CG-5 核心保証は第1回反映時点で確立済み。**到達性×実害で線を引き、低価値は境界化で先送り**する方針。反映済みの修正は全て green ゆえ残置。
