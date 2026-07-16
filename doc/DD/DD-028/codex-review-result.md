The CI and declaration-closure implementation are generally sound, but the migration dry-run can miss partially stale guides and the manual gate omits a declared Tier 1 IME. These gaps weaken two of DD-028's permanent regression controls.

Full review comments:

- [P2] Require every expected before diagnostic — C:\repo\spreadjs\tests\contract\migration-dryrun.test.ts:138-142
  The current `0001` before block intentionally demonstrates two independent migrations (TS2367 and TS2741), but this assertion only requires one aggregate diagnostic. If a future API change makes either old usage valid while the other remains invalid, the guide’s stale instruction still passes CI, contrary to the promised staleness detection; split independent failures into separate snippets or assert the expected diagnostic codes for each block.

- [P2] Cover every Tier 1 IME in the manual gate — C:\repo\spreadjs\doc\plan\ime-manual-gate-ledger.md:24-25
  The product charter defines Tier 1 as Chrome/Edge with both Microsoft IME and Google Japanese Input, while this gate only requires Microsoft IME. Consequently, every future T1/T2 gate can be recorded as passing without testing a declared Tier 1 IME; require both IMEs here or explicitly narrow the charter’s Tier 1 definition.