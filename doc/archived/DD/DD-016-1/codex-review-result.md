The Facades cannot currently be consumed through the documented packed-tarball path, and several lifecycle contracts are incomplete. Connection-error reporting, boot-time cleanup/focus, and pending-status behavior also contain reachable regressions.

Full review comments:

- [P1] Make Facade runtime dependencies installable — C:\repo\spreadjs\packages\grid\package.json:16-22
  When a consumer installs only the packed Facade tarballs, npm omits these `devDependencies`, but `mount-controller.ts` imports all six packages at runtime; `server-hono` similarly runtime-imports internal packages listed as dev-only. The documented `npm run consumer-harness` path therefore fails module resolution, while workspace tests pass only because root workspace links mask the problem. Declare or bundle the complete runtime dependency closure for both Facades.

- [P1] Emit WebSocket failures as connect errors — C:\repo\spreadjs\packages\grid\src\mount-controller.ts:393-397
  When `/config` succeeds but the WebSocket upgrade is rejected or unavailable, `BrowserWebSocketTransport` only logs its error and subsequently reports an offline connection state; no `GridEvent` with `phase: 'connect'` is emitted. Synchronous WebSocket construction failures are also classified as `runtime`, contradicting the approved lifecycle mapping and leaving consumers unable to distinguish an initial connection failure from ordinary offline/reconnect state.

- [P2] Update the packed-consumer fixture for this API — C:\repo\spreadjs\packages\grid\src\index.ts:81-81
  Running `scripts/consumer-harness.sh` with the current tarballs leaves `consumer-harness/src/index.ts` importing the removed `GRID_FACADE_STAGE` and `SERVER_HONO_FACADE_STAGE` exports; it also omits required `serverUrl` and assigns async `serve` to a synchronous function type. Consequently this existing pack-and-typecheck validation fails even after dependency resolution is fixed, so the fixture must be updated to the finalized API.

- [P2] Abort the config request when destroying the grid — C:\repo\spreadjs\packages\grid\src\mount-controller.ts:347-347
  If `/config` accepts the connection but does not settle, calling `destroy()` cancels DOM listeners, RAF, and timers but leaves this fetch pending because the existing `AbortController.signal` is not passed to it. Repeated mount/destroy cycles against a stalled endpoint accumulate network requests and retain each controller closure until timeout, violating the boot-in-progress cleanup contract.

- [P2] Preserve focus requests made during boot — C:\repo\spreadjs\packages\grid\src\mount-controller.ts:498-500
  Because `mount()` returns synchronously while `editor` is created only after asynchronous config resolution, an immediate `mount(...).focus()` silently does nothing. Even focusing from the first online event can target the still-hidden textarea before the first placement redraw, with no later retry, so the public focus operation is ineffective during the normal startup path.

- [P2] Refresh status on pending-count events — C:\repo\spreadjs\apps\playground\src\integration\main.ts:48-50
  After disconnecting and committing an offline edit, the session emits only a `pending` event for the new backlog count because connection events are suppressed while the state remains offline. Ignoring that event leaves the playground displaying `pending: 0` indefinitely despite queued operations, whereas the previous `updateReadout()` path refreshed on every session event.