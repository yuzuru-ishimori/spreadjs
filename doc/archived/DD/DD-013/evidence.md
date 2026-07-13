# DD-013 エビデンス（Evidence full）

> A区分 Evidence full: randomized seed・再現コマンド・event trace・収束hash生ログ・未保証境界を格納。

## 1. randomized 収束スイート（常設・`tests/invariants/collab`）

要確認④確定: **3〜5 クライアント × 500op 以上 × 複数 seed**。フォールト = duplicate/drop/delay
（disconnect は注入しない＝reconnect 製品保証は DD-015 スコープ）。

- **再現コマンド**: `npm run test:invariants`（= `vitest run tests/invariants`） / 単体: `npx vitest run tests/invariants/collab`
- **収束hash生ログ**: [`convergence-hash-raw.txt`](convergence-hash-raw.txt)（`.log` は gitignore ゆえ `.txt` で追跡・Codex P2）

| seed | clients | ops | accepted | rejects(OCC) | faults(dup/drop/delay) | serverHash | quiescenceTicks |
|------|---------|-----|----------|--------------|------------------------|-----------|-----------------|
| 20260713 | 3 | 600 | 578 | 4 | 481/534/644 | c08520fbf2188c1c | 1 |
| 1337 | 4 | 600 | 566 | 12 | 582/665/895 | 5f7c0baf50292614 | 1 |
| 987654 | 5 | 500 | 464 | 12 | 520/638/790 | f30165118448134a | 1 |
| 424242 | 4 | 800 | 754 | 7 | 747/880/1111 | 0c2a8fecb2bc6ce0 | 1 |

全 seed で全 client の committed hash == serverHash（INV-1）、pending 0・revision 連続（INV-2/5）、
構造 deep-equal（INV-6）、OCC reject≥1 かつ reject 値が committed に非載（INV-3）、Conflict Queue が
元 operation を保持（INV-4）。決定論テスト（同一 seed → 同一 serverHash/受理数/reject 数）も green。

失敗時の再現: ログ末尾に `reproduce with: seed=… clients=… ops=…` を出力する。

## 2. fault matrix（本DD = 受理/reject/duplicate 中心）

| フォールト | 注入経路 | 回復機構 | 検証 |
|-----------|---------|---------|------|
| duplicate（operations/operationAck 二重配信） | InProcessHub server→client | 受信側 revision 無視（I-3）／server ackCache 冪等 | INV-5・sequencer S-F2 |
| duplicate（submitOperation 再送） | 再送タイマー | ackCache ヒット → duplicate ACK・二重適用0 | sequencer S-F2 |
| drop（operations 欠落） | InProcessHub server→client | drainBuffer gap 検知 → requestCatchup | INV-1 収束 |
| delay（reorder） | InProcessHub キュー順操作 | revisionBuffer で順序整列 | INV-1/2 |
| OCC 競合（beforeRevision stale） | hot cell 同時編集 | server reject → Conflict Queue（draft 保持） | INV-3/4・sequencer S-G1/G4 |

## 3. DA 感度確認（欠陥注入 → テストが落ちる）

サーバー `sequencer.ts` step4 で `stale-cell-revision` 違反を握りつぶす（黙殺 accept）一時パッチを当てると:
- **deterministic 一次センサー**: sequencer.test `S-C2`・`S-G1`・`S-G4` が即 fail（OCC 契約を精密に固定）。
- **randomized 二次センサー**（Codex P1 反映で強化後）: `tests/invariants/collab` の **randomized 全 seed**
  （20260713/1337/987654/424242＋determinism）が `INV-3(a) an intentional OCC attempt was rejected with
  stale-cell-revision: expected 0 to be greater than or equal to 1` で fail。強化前は seed 依存で1 seed のみ
  検知だったが、OCC 狙い op の operationId を追跡し「意図的 OCC 競合が stale-cell-revision で reject された
  件数≥1」を assert することで全 seed で確実に検知する。

→ 「通るように書いたテスト」ではなく、サイレント上書き欠陥を実検知することを確認。パッチは revert 済み。

## 4. ワンショット証跡（DD-003 10,000op 級・常設化しない）

`apps/collaboration-server/test/convergence.test.ts`（3/10 クライアント × 10,000op・disconnect/reconnect 含む）。
- 生ログ: [`oneshot-10000op-convergence.txt`](oneshot-10000op-convergence.txt)
- 3 clients × 10,000op: accepted 9418・rejects 136・全 hash 一致・二重適用0（1 tick で収束）。

## 5. 未保証境界（本DDの対象外）

- reconnect・catch-up の製品保証 → **DD-015**（本 randomized スイートは disconnect を注入しない）。
- durable ACK・versioned snapshot・再読込復元 → **DD-014**。
- 行操作特有の競合仕様（IME×行削除等） → **DD-021**（本DDは回帰維持＋randomized 混合のみ・保証外）。
- 公開API整形（error notification・connection state） → **DD-016**（本DDは内部イベント契約まで）。
- 既知 flaky `ws-convergence.smoke`（実 WS・環境依存 timeout）→ 恒久是正は **DD-015**。本DDでは差分に応じたグリーン確認のみ。

## 6. Phase 4（2実ブラウザー headed smoke）— PASS（2026-07-13）

オーケストレータが Playwright で実施し **PASS**。実WS（`dev-start.sh --integration`・collaboration-server:9499）
＋2タブ（同一ルーム join）で統合ページ `poc-integration.html` を駆動。

| 段階 | revision | committedHash | 確認 |
|------|----------|---------------|------|
| 両タブ初期同期 | 11 | `613165c94ea4`（両タブ一致） | online・共有状態一致 |
| タブA編集確定（`SYNC-DD013`） | 11→12 | `78ab57da9df5`・pending 0 | 自タブ確定 |
| タブB独立反映 | 12 | `78ab57da9df5`（タブAと一致） | 該当セル値 `SYNC-DD013`・otherPresence 1 |

- **AC1（相互反映）を実WSで実証**（編集の伝播・hash 収束・presence 相互認識）。
- **AC6（同一セル競合・reject後draft保持・conflict可視）**: E2E `integration-scenario.spec.ts`（AC2）＋
  randomized invariant INV-3/INV-4 で担保済み（実WS smoke は非破壊確認のみ）。
- 証跡: [`dd013-p4-2browser-tabB-reflected.png`](dd013-p4-2browser-tabB-reflected.png)。
- 補足: Playwright MCP は単一 Chromium のため 2タブ（同一 Chromium・別クライアント）で実施。literal な
  Chrome＋Edge 別ブラウザー目視は Edge も Chromium ゆえ同期挙動は同等。literal 別ブラウザーは必要なら
  DD-016 統合後スモークへ畳む（CG-1 残と同型）。手順: [`phase4-2browser-smoke.md`](phase4-2browser-smoke.md)。
</content>
