The patch leaves Canvas rendering stale after rejected optimistic edits, does not repaint remote Presence automatically, and loses active-cell identity across row insertions. It also regresses Navigation-mode Delete and overstates Presence E2E coverage.

Full review comments:

- [P1] Invalidate Canvas after rejecting an optimistic edit — C:\repo\spreadjs\apps\playground\src\integration\session-sync.ts:112-112
  When a stale SetCells rejection arrives after the optimistic value has already been painted, `ClientSession.handleRejected` rebuilds `viewDocument` to the server value, but this branch marks no `DocumentView` dirty flag. The Canvas can therefore continue showing A's rejected draft until an unrelated scroll, resize, or operation, even though the committed-state assertions pass; rejection must invalidate cell rendering.

- [P1] Rebase active-cell indices after row insertions — C:\repo\spreadjs\apps\playground\src\integration\ime-editing-session.ts:308-315
  When B inserts a row above A's edited row, this re-resolves only the textarea placement while the state machine's `activeCell` remains at the old display index. The selection is consequently drawn on the wrong row, a subsequent composition event publishes the wrong `activeCell`, and Enter moves from the stale index to the shifted edit row rather than the following row; the active selection must be rebased from the stable editing RowId.

- [P1] Redraw the overlay on presence-only messages — C:\repo\spreadjs\apps\playground\src\integration\session-sync.ts:112-112
  When an idle receiver gets a presence snapshot, delta, or removal, `knownPresences()` changes but no redraw is requested, so the remote cursor and name do not appear, move, or disappear until an unrelated viewport or document update. The E2E test's explicit one-pixel repaint workaround demonstrates this user-visible failure of scenario 10; presence messages need to invalidate the overlay.

- [P2] Resolve Navigation Delete from the Commit effect cell — C:\repo\spreadjs\apps\playground\src\integration\ime-editing-session.ts:233-235
  When a selected cell is in Navigation mode and the user presses Delete, the reused state machine emits a `Commit` without first emitting `BeginEdit`, leaving `editingTarget` null. This handler discards `effect.cell`, so `performCommit` returns without submitting the blank value and Delete becomes a no-op in the integration grid.

- [P2] Assert selectionRanges in the Presence E2E — C:\repo\spreadjs\apps\playground\e2e\integration-scenario.spec.ts:313-316
  This test is labeled as covering `activeCell`, `selectionRanges`, and `editingCell`, but the test hook and assertions expose only the first and third fields. A regression that drops or corrupts `selectionRanges` during send, relay, or rendering would still pass while the evidence claims scenario 10 is established, so the range must also be observed and asserted.