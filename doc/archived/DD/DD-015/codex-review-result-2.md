The bootstrap retry remains ineffective against the production server and can regress to full replay. Reordered control frames, buffered post-frontier operations, and non-durable reject/no-op sequence state also leave exactly-once and convergence guarantees unsatisfied.

Full review comments:

- [P1] Retry bootstrap through a server-supported request — C:\repo\spreadjs\packages\collab\src\session.ts:285-285
  When a bootstrap frame is lost while the WebSocket remains open, this retry cannot obtain another snapshot because `RoomBridge.route` ignores every `join` after the connection is established. Fresh joins therefore wait forever; for gap-over-threshold reconnects, `sendJoin()` also resets `awaitingBootstrap` to false because `committed.revision > 0`, causing the next tick to request the entire tail instead. Use a retry request the server accepts while preserving bootstrap mode.

- [P1] Keep a separate deadline for bootstrap retries — C:\repo\spreadjs\packages\collab\src\session.ts:284-285
  When bootstrap and ACK delivery are both missing while unacknowledged pending operations exist, `tick()` calls `resendAllPending()` first, which updates the same `lastSendAt` used here. This condition is consequently false on every resend cycle, so the bootstrap request is never retried and synchronization can remain stalled indefinitely.

- [P1] Wait for welcome reconciliation before rebuilding bootstrap — C:\repo\spreadjs\packages\collab\src\session.ts:466-467
  Under the promised delay/order-reversal fault model, `bootstrap` can arrive before its `welcome`. In that case `applyReconcile()` is a no-op, and rebuilding against a snapshot containing an accepted pending insert moves that operation to `duplicate-row` conflict; the later welcome cannot restore it from the Conflict Queue. Buffer the bootstrap until the corresponding reconcile information is available.

- [P1] Drain authoritative tail before rebuilding dependencies — C:\repo\spreadjs\packages\collab\src\session.ts:466-468
  If operation A is accepted at `R+1` after bootstrap frontier `R`, its ACK and operations frame can be reordered ahead of the bootstrap while dependent operation B's submit is dropped. The ACK causes A to be removed as acknowledged, the `R+1` echo remains buffered, and this rebuild marks B `unknown-row` before `drainBuffer()` applies A on the next line. Apply the now-contiguous authoritative buffer before rebuilding remaining pending operations.

- [P1] Make non-revision sequence outcomes durable before reconciling — C:\repo\spreadjs\packages\server\src\room.ts:175-181
  With persistence enabled, rejected and no-op submits consume `clientSequence` but do not append an accepted revision or advance `DurableFrontier`. A lost rejection is therefore absent from this frontier table and is retried into a permanent `client-sequence-violation` loop; conversely, a live no-op remains in `ackCache` with a revision at or below the frontier and can be discarded even though a restart cannot recover its consumed sequence. These outcomes need durable/idempotent representation before they can participate in reconciliation.

- [P2] Bind reconcile data to its join generation — C:\repo\spreadjs\packages\collab\src\session.ts:367-369
  When retried joins produce multiple delayed welcomes, a newer response can arrive before an older one, but `knownServerRevision` is maintained as a high-water mark while `reconcileInfo` is overwritten unconditionally. The eventual high-frontier bootstrap or tail can then be paired with stale pending classifications, incorrectly conflicting or resending an operation accepted between the two joins. Associate reconciliation with a join nonce/frontier or merge it monotonically instead of replacing it.
---

## 対応（2026-07-14・第2回反映）

第2回 xhigh レビューの 6 findings を反映した。**到達性の分析**: これらは概ね「永続化＋メッセージ順序入替（reorder）＋特定 drop」の合成条件でのみ顕在化し、**順序保証・信頼性のある実 WS（TCP）では到達不能**（welcome→bootstrap→operations は順序保証・bootstrap フレームは非 drop）。また多くは**サイレント喪失ではなく false conflict（入力は Conflict Queue に保持・収束は維持）**。CG-5 中核保証（サイレント喪失0・fault injection〔C→S欠落含む〕収束）は invariant の全 submit 説明責任 assert で担保済み。

- **[P1-e] non-durable reject/no-op seq**（`room.ts` computeReconcile）— ✅修正（**中核**）: `ackedClientSequence` を **live** clientSequenceTable の高水位に戻した（第1回 P1-1 で durable frontier 表にしたが、reject/no-op は seq を消費しても frontier 表に反映されず＝reject 済み op を「未処理」と誤判定→再送→client-sequence-violation ループになる）。`acceptedOperationIds` の frontier revision gating（P1-1 の除去安全側）は維持＝in-flight は accepted 外＝seq≦acked なら reject 分類で **Conflict Queue に保持**（喪失0）。永続化下の reject ループを解消。
- **[P1-a/b] bootstrap 再要求が ineffective/never-fire** — ✅修正: (a) `room.handleRequestCatchup` を差分>閾値/fresh で **bootstrap（snapshot）を返す**よう変更（server-supported・`shouldBootstrap` を join と共有）＝bootstrap 喪失時の再要求が全 tail replay に退行しない。(b) client tick は `awaitingBootstrap` 中に **別デッドライン**（`lastBootstrapRequestAt`・resend の `lastSendAt` と非共有）で `requestCatchup` を再送。旧: 既存接続で server が無視する re-join＝ineffective を廃止。テスト: `room-reconnect.test.ts`（requestCatchup→bootstrap）。
- **[P1-c] bootstrap が welcome より先着** — ✅修正: `welcomeSeen`＋`bufferedBootstrap` で welcome 前に届いた bootstrap を **buffer** し、welcome 受信時（reconcile 情報が揃った時点）に処理。reconcile なしで rebuild して受理済み op を phantom duplicate-row にしない。テスト: `reconnect-reconcile.test.ts`（P1-c 回帰）。
- **[P1-d] ACK/echo が bootstrap より先着で依存 op を誤 Conflict** — ✅修正（ACK-ahead ケース）: `PendingEntry.ackRevision` を導入し、bootstrap の filter を「acknowledged **かつ** ackRevision≦R」に限定（旧: 全 acknowledged 除去）。in-flight acked（ackRevision>R）は pending に**保持**＝optimistic に効果が残り依存 op が valid のまま。echo/drain で正規化。**残 boundary**（下記）。
- **[P2] reconcile を join 世代に束縛** — ✅修正: welcome の `currentRevision` が既知 high-water 以上（＝最新 join の応答）のときだけ `reconcileInfo` を採用（`isNewest` ガード）。reorder で古い welcome が後着しても stale な分類で新しい bootstrap を処理しない。

### 残 boundary（文書明示・§6 Alpha 0.x 内・fault-matrix §5 追記）
- **echo-ahead-without-ack（in-flight op の echo だけが bootstrap より先着し ACK 未着）× 永続化**: 当該 in-flight op が reject 分類で false conflict になり得る（**入力は Conflict Queue に保持＝サイレント喪失ではない・収束は維持**）。順序保証のある実 WS（TCP）では echo が ACK/ bootstrap より先着し得ないため到達不能。信頼性の低い順序入替トランスポート導入時に再検討（設計転換＝External Review 事項）。
