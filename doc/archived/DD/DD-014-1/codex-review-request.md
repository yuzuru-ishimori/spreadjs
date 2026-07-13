# Codex レビュー依頼: DD-014-1 クライアント snapshot bootstrap・durable 整合（CG-3 解除）

## 目的・背景
親 DD-014（永続化・durable ACK・snapshot format v1・再起動復旧）の Codex xhigh レビューが検出した CG-3 ブロッカー（P1-3〜P1-7）を解消する子DD。**CG-3（snapshot 正式形式・クライアント全 replay 非依存）解除がゴール**。本レビューの承認をもって ADR-0023 を Proposed→Accepted へ昇格する（DD-010/012-1 先例・ChatGPT 不要）。

親DDのサーバー側（oplog-store / snapshot-store / persistent-room / apply.ts 二相 replay / recoverSequencerState）はコミット済み。本DDは以下の 5 点を追加する。

## 本DDのスコープ（対応した Codex findings）
1. **P1-6/P1-7（最重要・AC1/AC8）**: fresh join / ブラウザー再読込が全 operationLog を replay していた。→ **join protocol を snapshot@R＋tail 化**。fresh join（lastAppliedRevision=0）には `bootstrap` メッセージ（document@frontier）を 1 通返し、クライアントは全 replay せず committed@R を確立する。§8 既知制約「snapshotベース初期化」回収。
2. **P1-3（durable frontier 読取ゲート）**: 未 fsync revision を join/requestCatchup/`/snapshot`/welcome から観測させない（durable frontier 以下のみ配布）。
3. **P1-4（snapshot barrier）＋P2-5（併修）**: snapshot 生成を durable frontier == currentRevision の完全 durable 状態からのみ行う（snapshot.revision > durable oplog 長＝再起動 fail-fast を構造的に防ぐ）。snapshot 生成中の蓄積分を完了時に再判定（P2-5）。
4. **P1-5（room poisoning）**: oplog append 失敗時に room を poisoning（write 全停止・後続 submit reject）し revision 欠番を防ぐ。

## 対象外（親DD-014 の既知制約へ据え置き・ユーザー確定 2026-07-13）
- **P2-1**: 単一行 InsertRows 連発の apply.ts nextSlot Θ(N²)（行操作=Stage 2/DD-021）。
- **P2-3 / P2-4**: recovery の documentId/revision 相互検証・restoreFrom＋persistenceDir 併用の revision 不連続（異常構成のエッジケース）。

## 設計意図・実装の要点
- **frontier の COW 前提**: document は applyOperation が毎回新インスタンスを返す（COW）ため、frontier 時点の document 参照を保持すれば以降の op で不変。`DurableFrontier`（persistent-room.ts）が revision と document@revision を保持し、append（fsync）解決後に `advance()` で単調前進する。
- **Room への注入**: `Room.attachDurableBoundary(DurableBoundary)` で PersistentRoom が frontier を注入。永続化無効時は Room が Sequencer の現在値を frontier とみなす（fast-path で余計な filter 割当を避け、実 WS 収束経路のオーバーヘッドを増やさない）。
- **wire 形式の単一化**: 文書の serialize/deserialize を `@nanairo-sheet/core`（document-snapshot.ts）へ集約し、サーバー snapshot（server/snapshot.ts）と クライアント bootstrap（collab/session.ts）が同一実装を共有（両端の乖離＝hash 非決定化を防ぐ・CG-2/DD-013 収束テスト維持）。
- **クライアント bootstrap**: fresh join（committed.revision=0）で `awaitingBootstrap` を立て、welcome の catch-up 発火を抑止（全 log 要求＝全 replay 経路への逆戻りを防ぐ）。`bootstrap` 受信で committed を document@R へ差し替え、R+1.. の buffer を drain。reconnect（committed.revision>0）は従来の tail 経路。
- **poisoning**: append 失敗で `poisoned=true`・throw（RoomBridge が接続を閉じる）。以降の submit は poisoned チェックで reject＝Sequencer をこれ以上前進させない（fail-stop・欠番0）。rollback はしない。

## 重点的に見てほしい観点（findings 優先）
1. **仕様一致**: snapshot@R＋tail の join protocol と durable frontier ゲートが「ACK 受領＝再起動後も失われない」「未 durable を配らない」を破っていないか。fresh/partial/reconnect/空文書 の各 join 分岐の正しさ。
2. **frontier 一貫性**: in-flight append 中の join/catch-up/snapshot が frontier 超過 revision を漏らさないか。frontier.advance の順序（複数 in-flight・group commit）・COW 参照保持の妥当性。
3. **snapshot barrier**: snapshot.revision ≦ durable frontier が常に成り立つか。barrier での延期が snapshot 永久未生成（tail 無限肥大）に陥らないか（P2-5 再判定の十分性）。
4. **poisoning**: append 失敗後に revision 欠番/二重適用/未配信 revision の観測が起きないか。poisoning が過剰（一過性エラーで全停止）でないかの妥当性。
5. **クライアント bootstrap の収束整合**: bootstrap が committed を差し替えても DD-013 OCC（beforeRevision 照合）・rollback/replay・pending 再適用・二重適用0 を壊さないか。buffer 破棄の off-by-one。
6. **回帰・テスト不足**: 既存 join/catch-up/convergence テストの回帰。AC1〜AC4/AC8 の検証（全 replay 経路不在の固定・frontier fault・barrier・poisoning・再読込 E2E）に穴がないか。

## 対象差分
- core: `packages/core/src/{document-snapshot.ts(新),protocol.ts,message-codec.ts,index.ts}`
- server: `packages/server/src/{room.ts,persistent-room.ts,snapshot.ts}`（＋テスト `durable-frontier.test.ts` 新・`room.test.ts`）
- collab: `packages/collab/src/{session.ts}`（＋テスト `bootstrap.test.ts` 新）
- app: `apps/collaboration-server/src/server.ts`（`/snapshot` gating）・`apps/playground/src/integration/{main.ts,session-sync.ts}`・E2E `apps/playground/e2e/{reload-bootstrap.spec.ts(新),integration-helpers.ts}`
- 計測: `scripts/dd014-1/measure-bootstrap.mts`（bootstrap 4.8ms vs full-replay 26s / 20k op）

## 検証状況
- `npm run test`: 687 pass / 1 fail（既知flaky ws-convergence.smoke のタイムアウト＝baseline でも本DD変更なしで同条件再現・環境負荷依存）。
- `npm run typecheck` / `npm run lint`（boundary new=0）/ `npm run build` / `npm run test:invariants` green。
- E2E: reload-bootstrap.spec（AC8・再読込復元）＋ integration-scenario 6 件 green（headless chromium）。
