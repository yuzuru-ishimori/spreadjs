Deferred bootstrap application can leave the integration renderer permanently stale under the supported reorder path. Large-gap reconnects can also bypass the snapshot optimization while waiting for welcome.

Full review comments:

- [P1] Redirty consumers after applying the buffered bootstrap — C:\repo\spreadjs\packages\collab\src\session.ts:385-385
  When `bootstrap` arrives before `welcome`, the earlier bootstrap notification marks `DocumentView` dirty before the snapshot is actually applied. This call later mutates `committed` and `view` while the outer message is `welcome`, which `SessionSync` ignores for rendering; if a frame flushes between the two messages, the canvas can remain empty or stale indefinitely. Applying the deferred bootstrap must trigger a new render invalidation.

- [P2] Block pre-welcome catch-up on large-gap reconnects — C:\repo\spreadjs\packages\collab\src\session.ts:394-395
  For reconnects with a nonzero committed revision, `awaitingBootstrap` remains false until this welcome branch runs. If the welcome takes longer than the polling interval, `tick()` sends `requestCatchup` first, and the server returns the entire missed tail even when the gap exceeds the snapshot threshold; the subsequent bootstrap makes those operations redundant but they have already been serialized, transferred, and decoded. Suppress polling until the current join's welcome establishes whether bootstrap is required.
---

## 対応（2026-07-14・打ち切り時の仕分け）

第4回は停止（TaskStop）したが停止直前に上記 2 findings を出力していた。**仕分けの結果、両方とも見送り**（到達性×実害の方針）:

- **[P1] buffered bootstrap 適用後の redirty**: bootstrap-before-welcome の **reorder 経路でのみ**発生。**実 WS（TCP）は welcome→bootstrap を順序保証**で配送するため browser（唯一の renderer）では到達不能。in-process hub は renderer を持たない。→ **見送り**（unreachable・boundary）。将来 unreliable な順序入替 transport を入れる場合のみ再検討。
- **[P2] large-gap reconnect の pre-welcome catch-up**: welcome が poll 間隔より遅れた狭い窓で requestCatchup が tail を先に取り後続 bootstrap と冗長になり得る。**正しさの問題はない（phantom/喪失なし・収束）**・実害＝帯域の一時的冗長のみ・窓は極小（welcome は再接続後の初回メッセージ）。→ **見送り**（efficiency-only）。

**結論**: 第4回の findings も狭い/到達不能/効率のみで CG-5 核心保証には無関係。打ち切り判断は妥当と確認。
