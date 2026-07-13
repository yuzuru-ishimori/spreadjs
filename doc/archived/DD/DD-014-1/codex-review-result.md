Concurrent append failure can still create a durable revision gap, and the durable snapshot leaks live sequence metadata. Bootstrap also mishandles already-committed pending operations and retains a periodic full-log catch-up path, so the stated CG-3 contracts are not yet satisfied.

Full review comments:

- [P1] Serialize appends before poisoning the room — C:\repo\spreadjs\packages\server\src\persistent-room.ts:216-221
  When two clients submit while the first fsync is pending, both calls can pass the pre-append `poisoned` check. If the first append fails before writing its revision but a later queued append succeeds, the later call still advances the frontier and dispatches its ACK/broadcast, leaving a revision gap; `FileOpLogStore` continues processing batches after rejecting a failed batch. Serialize the append/commit path or reject all already in-flight submissions when any append fails.

- [P1] Reconcile bootstrapped pending operations before replay — C:\repo\spreadjs\packages\collab\src\session.ts:338-339
  If a connection drops after the server durably accepts an operation but before its operations echo reaches the client, the client can reconnect with `committed.revision === 0` and that operation still pending. The bootstrap already contains the operation, so replaying an `insertRows` pending entry against it produces `duplicate-row` and incorrectly moves a successfully committed operation to the conflict queue; the old full-replay path received the envelope and removed it from pending. Bootstrap must carry or otherwise reconcile committed operation IDs before pending revalidation.

- [P1] Snapshot client sequences at the durable frontier — C:\repo\spreadjs\packages\server\src\persistent-room.ts:295-298
  While revision R+1 is awaiting fsync, `Sequencer.submit` has already advanced `clientSequenceTable`, but this snapshot combines that current table with document/log/currentRevision at R. Consequently `/snapshot` exposes state from an uncommitted operation, and restoring that snapshot can reject the client's retry of R+1 as a sequence violation. Preserve the sequence table alongside the frontier document instead of copying the live table.

- [P1] Suppress polling while waiting for bootstrap — C:\repo\spreadjs\packages\collab\src\session.ts:304-305
  This guard only suppresses the immediate catch-up request from `handleWelcome`; `tick()` still sends `requestCatchup{afterRevision:0}` after `catchupPollMillis`. If a large bootstrap takes longer than that to arrive, `Room.handleRequestCatchup` returns revisions 1..frontier and retransmits the entire operation log, restoring the full-log path this change is meant to remove. Gate periodic catch-up while `awaitingBootstrap`, or make catch-up from revision zero return another bootstrap.