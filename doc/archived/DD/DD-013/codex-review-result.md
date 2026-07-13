The randomized suite does not reliably prove the central OCC and draft-retention invariants, and its determinism and structural checks have observable blind spots. The referenced raw evidence would also be absent from a normal commit because the files are ignored.

Full review comments:

- [P1] Require an actual stale OCC rejection — C:\repo\spreadjs\tests\invariants\collab\collab.invariant.test.ts:449-452
  If stale-cell validation regresses but another operation is rejected for `target-row-deleted` or a similar reason, `run.rejects.length` still satisfies this assertion and `rejectedValueNotInCommitted` usually returns true; a stale write can also be accepted and later overwritten before the final-document check. Track the deliberately generated OCC attempts and assert a `stale-cell-revision` rejection for them, plus absence of their operation IDs from the accepted log.

- [P2] Compare conflicts with the originally submitted operation — C:\repo\spreadjs\tests\invariants\collab\collab.invariant.test.ts:455-459
  When `makeConflictEntry` accidentally stores a different or truncated operation, these assertions still pass as long as the required `operation` field exists and contains one change. Record submitted operations by operation ID and compare each conflict entry with its exact original value; if deep-copy behavior is part of INV-4, mutate the caller-owned input after submission and verify the queued copy is unchanged.

- [P2] Include orphan metadata in structural normalization — C:\repo\spreadjs\tests\invariants\collab\collab.invariant.test.ts:359-368
  If rollback/replay leaves an extra `rowMeta` entry that is absent from `rowOrder`, this normalization omits it entirely; `documentHash` also ignores such metadata, so INV-1 and INV-6 can both pass despite divergent document structure. Normalize the complete `rowMeta` key set, and ideally any otherwise unreachable cell-store records, rather than deriving metadata solely from `rowOrder`.

- [P2] Compare the deterministic operation trace — C:\repo\spreadjs\tests\invariants\collab\collab.invariant.test.ts:546-550
  Two runs can accept different operation orders or produce different conflict identities yet end with the same overwritten cell state, revision count, rejection count, and fault counters, so these checks do not establish seed-level reproducibility. Compare the operation log and conflict entries, or a digest of the complete event trace, so a reported seed reproduces the sequence that caused a failure.

- [P2] Track the referenced convergence logs — C:\repo\spreadjs\doc\DD\DD-013\evidence.md:10-11
  The two linked `.log` files exist locally but match the repository's `*.log` ignore rule, so a normal `git add` and commit will omit them and these evidence links will be broken in a fresh checkout. Force-add the files or store the evidence under a tracked extension before marking the Evidence-full task complete.