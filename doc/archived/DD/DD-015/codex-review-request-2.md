# Codex レビュー依頼（第2回・修正確認）: DD-015 reconnect・catch-up・idempotency（CG-5）

第1回 xhigh レビューの 5 findings（P1-1/1-2/1-3・P2-1/2-2）を反映した。**修正が findings を正しく塞いだか**と、修正で新たな穴を作っていないかを確認してほしい。第1回の指摘・対応は `doc/DD/DD-015/codex-review-result.md` 末尾「対応」節に記載。

## 修正の要点（確認観点）
1. **[P1-1] durable frontier で reconcile**（`packages/server/src/room.ts` `computeReconcile`＋`DurableBoundary.frontierClientSequenceTable`）: `ackedClientSequence` を frontier 時点の clientSequenceTable から、`acceptedOperationIds` を `ackedRevisionOf(opId) <= frontier` に限定。**確認**: in-flight（accepted 未 fsync）op を accepted と誤判定しないか。永続化無効時（frontier=current）に退行がないか。
2. **[P1-2] reconcile を committed 権威化後に適用**（`packages/collab/src/session.ts`）: welcome では `reconcileInfo` に保留し、`handleBootstrap`（committed=frontier 直後・rebuild 前）と `maybeFinalizeSync`（tail drain 完了時）で `applyReconcile()`＋`rebuildView()`。**確認**: (a) 受理済み依存元を含む committed に対して rebuild するため未処理依存 op が誤 Conflict 化しないこと (b) bootstrap 経路で受理済み未ACK op の phantom duplicate-row を依然封鎖できていること (c) tail 経路で own accepted は echo 済み＝applyReconcile の除去が no-op で二重処理しないこと (d) reconcileInfo の適用が高々1回（handleConnected でクリア・applyReconcile で消費）。
3. **[P1-3] bootstrap 再要求**（`tick`）: `awaitingBootstrap` 中に resend タイムアウトで `sendJoin` 再送。**確認**: 再送が catch-up 全 replay 経路へ戻さないか（awaitingBootstrap 中は requestCatchup を出さない）。bootstrap 到着後に無限再送しないか。
4. **[P2-1] rebuild 後の pending 件数で通知**（`rebuildView`/`applyReconcile`）: conflict を `this.pending=survived` 後に push。**確認**: rejected イベントの pendingCount が再構築後の値になっているか。
5. **[P2-2] 全 submit の説明責任**（`tests/invariants/collab/reconnect-fault.invariant.test.ts`）: 各 op が ackCache（accepted/noop）or Conflict に存在することを assert。**確認**: silent removal を確実に検出するか（noop の扱いに穴がないか）。
6. **併修 offlineSince**（`checkOfflineLimits`）: `hasConnected` ゲートで初回接続前の誤 stopped を防ぐ。**確認**: S-J5（offline 時間上限）の保証が維持されているか。

## 特に見てほしい残存リスク
- reconcile の適用点が bootstrap/tail で分岐する（handleBootstrap vs maybeFinalizeSync）。**両経路で高々1回・committed 権威化後**という不変が全ケース（fresh/reconnect/差分>閾値/再切断重畳/reconcileInfo が finalize 前に別 welcome で上書き）で崩れないか。
- `applyReconcile` が rebuildView を呼ばない設計（呼び出し側が rebuild）。呼び出し側（handleBootstrap・maybeFinalizeSync）以外に reconcileInfo が残ったまま rebuild される経路がないか（view と pending の不整合）。

## 対象差分（--uncommitted）
第1回と同じ範囲（core/server/collab/app/invariant）。主要な追加変更: `room.ts`（computeReconcile・DurableBoundary）・`session.ts`（reconcileInfo/applyReconcile/handleBootstrap/maybeFinalizeSync/tick/checkOfflineLimits/rebuildView）・`persistent-room.ts`（DurableFrontier は既存 frontierClientSequenceTable を interface へ露出）・`reconnect-reconcile.test.ts`（bootstrap 経路へ書換＋P1-2 回帰）・`reconnect-fault.invariant.test.ts`（P2-2 accounting）。

## 検証状況
対象パッケージ green: collab / server / core / collaboration-server（reconnect-fault WS 3・invariant 5〔D27 含む・unaccountedIds=[]〕・convergence 10,000op・reconnect-reconcile 9〔P1-2 回帰含む〕・room-reconnect 8・session-events 5）。ws-convergence.smoke 10 連続 green。実ブラウザー headed smoke green（証跡 `headed-01〜04.png`）。typecheck 全 workspace green。フル `npm run test`/lint/build/test:invariants は最終ゲートで一括実行。
