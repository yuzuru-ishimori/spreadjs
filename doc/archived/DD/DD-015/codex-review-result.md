The reconnect reconciliation can discard operations based on non-durable state and can invalidate dependent pending edits before authoritative catch-up is applied. Bootstrap loss can also stall synchronization indefinitely, so the claimed exactly-once and convergence guarantees are not yet satisfied.

Full review comments:

- [P1] Reconcile only against the durable frontier — C:\repo\spreadjs\packages\server\src\room.ts:169-171
  When persistence is enabled and a client reconnects while an accepted submit is still awaiting fsync, these lines read the live sequence table and ACK cache even though `welcome.currentRevision` and bootstrap/tail stop at the older durable frontier. The client can therefore remove the pending operation as accepted; if the append later fails or the server stops, the operation is absent from durable storage and cannot be resent, causing silent input loss. Derive both values from state captured at the durable frontier.

- [P1] Keep accepted dependencies until catch-up is applied — C:\repo\spreadjs\packages\collab\src\session.ts:408-410
  If pending operation A inserted a row and was accepted while later operation B editing that row remains unprocessed, removing A and rebuilding against the pre-catch-up committed document makes B fail with `unknown-row` and moves it permanently to the Conflict Queue. The following tail/bootstrap would make B valid, but it is no longer pending or resent. Preserve accepted optimistic effects or defer this rebuild until the authoritative state containing A has been applied.

- [P1] Retry when the bootstrap response is missing — C:\repo\spreadjs\packages\collab\src\session.ts:368-370
  When a reconnect gap exceeds the threshold and the welcome arrives but its following bootstrap frame is dropped while the connection remains open, this state is never cleared: `tick()` returns for every poll while `awaitingBootstrap` is true, and no protocol path re-requests a snapshot. On a quiescent document the client therefore remains permanently behind and never resends pending operations. Add a timeout or repeatable request path that can return bootstrap again.

- [P2] Emit the post-rebuild pending count — C:\repo\spreadjs\packages\collab\src\session.ts:737-739
  For conflicts produced inside `rebuildView`, `pushConflict` runs before `this.pending` is replaced with the surviving entries, so the rejected event reports the old pending count. An immediately invalid local submission can consequently emit `pendingCount: 1` even though the queue ends at zero, with no later pending event to correct it because the last emitted count was already zero.

- [P2] Account for every submitted operation in the invariant — C:\repo\spreadjs\tests\invariants\collab\reconnect-fault.invariant.test.ts:271-278
  The invariant records `submittedOps` but only asserts final hash convergence and snapshot replay integrity. An implementation that silently removes a pending operation still reaches identical client/server hashes with pending zero, so this test passes the exact input-loss failure it claims to prevent. Track operation IDs and assert every submitted operation is accepted or retained in a conflict outcome.
---

## 対応（2026-07-14・実装者反映）

Codex xhigh レビュー（第1回）の 5 findings を全て反映した。第2回レビューで確認する。

- **[P1-1] Reconcile only against the durable frontier** — ✅修正: `Room.computeReconcile`（room.ts）を durable frontier で判定するよう変更。`ackedClientSequence` は `DurableBoundary.frontierClientSequenceTable()`（frontier 時点の表）を使い、`acceptedOperationIds` は `ackedRevisionOf(opId) <= frontier` に限定（未 fsync の in-flight 受理を accepted としない＝append 失敗/停止時のサイレント喪失を防ぐ）。永続化無効時は現在値（全 durable）を使う。
- **[P1-2] Keep accepted dependencies until catch-up is applied** — ✅修正: reconcile を **committed が権威化した後**に適用するよう再構成。welcome では `reconcileInfo` に保留し、`handleBootstrap`（committed=frontier 確立直後）と `maybeFinalizeSync`（tail drain 完了時）で `applyReconcile()`＋rebuild する。受理済み依存元 A を含む committed に対して rebuild するため未処理依存 B が unknown-row で誤 Conflict 化しない。回帰テスト追加（`reconnect-reconcile.test.ts` 「Codex P1-2 回帰」）。
- **[P1-3] Retry when the bootstrap response is missing** — ✅修正: `tick()` で `awaitingBootstrap` 中も resend タイムアウト経過で `sendJoin()` を再送し bootstrap を再要求する（catch-up 経路には戻さない）。bootstrap フレーム drop で永久静止しない。
- **[P2-1] Emit the post-rebuild pending count** — ✅修正: `rebuildView` は conflict を収集し `this.pending = survived` **後**に `pushConflict` する。`applyReconcile` も同様。rejected イベントが再構築後の正しい pending 件数を報告する。
- **[P2-2] Account for every submitted operation in the invariant** — ✅修正: `reconnect-fault.invariant.test.ts` が全 submit の operationId を追跡し、各 op が **ackCache（accepted/noop）在** または **いずれかの client の Conflict Queue 在**であることを assert（`unaccountedIds` が空＝サイレント喪失0）。silent removal がこの assert を通過できないようにした。

### 併修（レビュー反映中に検出）
- **offlineSince 初回接続前の誤発火**: `checkOfflineLimits` が初回接続前（`offlineSince=0`・real clock）に offline 時間上限を誤って発火し stopped 化する潜在バグを修正（`hasConnected` ゲート）。playground/実 WS テストが接続確立前に tick する経路で顕在化。
