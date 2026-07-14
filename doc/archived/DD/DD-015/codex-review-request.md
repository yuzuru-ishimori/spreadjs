# Codex レビュー依頼: DD-015 reconnect・catch-up・idempotency（CG-5 解除 / D27・D34 回収）

## 目的・背景
WS 切断→再接続→catch-up→pending 再送→収束を**製品保証**にし、DD-005 最重要既知制約「client→server 欠落時の完全再整列（D27/D34）」を回収して **CG-5 を解除**する。設計の中心は**障害マトリクス**（`doc/DD/DD-015/fault-matrix.md`）＝切断タイミング×op 状態×server 再起動×duplicate の各セルに保証/非保証を割り当て、保証セルを全て自動テストで固定する。roadmap §6 製品境界（reconnect 保証/非保証）と整合。Risk Class A・protocol/idempotency の実質変更ゆえ effort=xhigh。

同期契約は DD-013（受理/reject/duplicate・OCC）、durable/snapshot は DD-014/DD-014-1（durable ACK・bootstrap・durable frontier）で確定済み。本DDはその上の**接続復帰層**のみを追加する。

## 本DDのスコープ（対応した設計要素）
1. **exactly-once 再接続 reconcile（中核・AC2/3・D27/D34・DD-014-1 引継ぎの un-acked-drop race 封鎖）**: 再接続 join に未ACK pending の `{operationId, clientSequence}` を添え（`join.pending`・bounded ≤ maxOfflinePending）、server は各 opId が確定ログ（ackCache＝accepted/noop）に在るかで判定し `welcome.reconcile{ackedClientSequence, acceptedOperationIds}` を返す。client は pending を **受理済（accepted 集合 → 除去）／reject 済（accepted 外 かつ clientSequence≦acked → Conflict Queue・再送しない）／未処理（clientSequence>acked → 再送）** の3分類する。bootstrap 経路（own-echo で除去できない snapshot 再取得）でも二重適用0・喪失0 を成立させる。
2. **catch-up snapshot 再取得閾値 T=1000（要確認②）**: 再接続で差分（frontier − lastAppliedRevision）> T なら tail（operations）ではなく bootstrap（document@frontier・DD-014 経路再利用）を返す。**client と server が同一の (frontier, lastAppliedRevision) から同一判定**を導く（`CATCHUP_SNAPSHOT_THRESHOLD` を core で共有）。
3. **revision 連続性 fail-fast（C11）**: server が `join.lastAppliedRevision > durable frontier`（client が権威より先＝巻き戻り）を検出し `welcome.diverged=true` を返す。client は黙って merge せず divergence 通知＋編集停止。**判定は server 側**（frontier 権威・応答の順序入れ替えに非依存＝in-process reorder で誤検出しない）。
4. **指数バックオフ自動再接続（要確認①）**: `ws-transport.ts` を初回 1s・倍々・上限 30s＋equal jitter・**タブ生存中は無期限リトライ**へ。純粋関数 `nextReconnectDelay` に切出し単体検証。open 成功で attempt リセット。
5. **イベント通知契約（要確認③）**: `ClientSession` が connection state（online/offline/stopped）・pending 件数・rejected・divergence を observer へ通知（変化時のみ・冗長発火なし）。offline 上限超過は編集停止＋stopped 通知＋接続リトライ継続。playground は本イベントで接続状態・未送信件数を表示。
6. **fault injection 常設化（§2.3 実充足）**: `tests/invariants/collab/reconnect-fault.invariant.test.ts` が切断/再接続＋duplicate/drop/delay＋**client→server 欠落（D27 経路）**を seed 付き注入し収束・二重適用0・喪失0 を固定。
7. **ws-convergence.smoke flaky 恒久是正（要確認④）**: 一括同期 submit（pending ~1000 深→O(N²) 40s timeout）を有界バッチ＋静止点待ちへ書換え（1.1s・10 連続 green）。

## 対象外（roadmap §6 非保証・fault-matrix N1〜N5・据え置き）
ACK前ブラウザークラッシュ／OSクラッシュ／ローカル永続キュー／長時間offline編集／複数端末offline merge。同期・OCC 契約自体（DD-013）／durable・snapshot 復旧アルゴリズム（DD-014）／通知の公開API整形・consumer lifecycle（DD-016）。

## 設計意図・実装の要点
- **reconcile の完全性**: server が記憶するのは ackCache（accepted/noop の opId→revision）と clientSequenceTable（clientId→処理済み高水位）のみ。reject 済み opId は記憶しない。よって「opId ∈ ackCache＝受理済」「opId ∉ ackCache かつ clientSequence≦高水位＝reject 済（seq 消費済み・再送は seq 違反ループ）」「clientSequence>高水位＝未処理（再送）」で 3 分類が**必要十分**。noop も ackCache 登録ゆえ受理済扱い（効果なし＝除去で正）。
- **reconcile は handleWelcome で bootstrap/tail 適用より前に実行**: accepted を先に除去してから rebuildView するため bootstrap の phantom conflict（受理済み insertRows の duplicate-row 誤判定）を封鎖。tail 経路では echo が accepted を除去するが reconcile で先に除去しても二重除去は冪等。
- **閾値対称性**: server `frontier>0 && (lastApplied≤0 || frontier−lastApplied>T)` → bootstrap。client handleWelcome も同式で `awaitingBootstrap` を立て catch-up を抑止（全 operationLog 要求＝全 replay への逆戻りを防ぐ）。両者の入力 (frontier=welcome.currentRevision, lastApplied=committed.revision) は join 送信〜welcome 受信間で不変。
- **stale welcome 耐性**: reorder で currentRevision<committed の古い welcome が届いても knownServerRevision を下げない（後続 ACK/operations が high-water を保つ）。divergence は server の diverged シグナルのみで判定（client 側の revision 比較は使わない）。
- **backoff のオーバーフロー安全**: `2^attempt` を cap 前に max で頭打ち（無期限リトライで attempt が増え続けても Infinity 化しない）。

## 重点的に見てほしい観点（findings 優先）
1. **exactly-once の穴**: reconcile 3 分類に「収束するが利用者入力を静かに落とす」経路・二重適用経路はないか。特に (a) accepted 除去後に tail echo が同 op を再適用して revision 不整合を生まないか (b) bootstrap 経路で未処理 pending の再検証（stale→reject）が抜けないか (c) reject 済分類が accepted 済 op を誤って Conflict へ送らないか（clientSequence 境界の off-by-one）。
2. **clientSequence 高水位判定の正しさ**: duplicate（ackCache ヒットで seq 非消費）・noop（seq 消費・ackCache 登録）・client-sequence-violation（seq 非消費・reject）の各分岐で「acked 高水位」と「pending の clientSequence」の比較が正しく分類するか。seq5 reject＋seq6 accepted の混在で seq5 のみ Conflict になるか。
3. **閾値・bootstrap 再取得の収束**: 差分>T の再接続で client committed が document@frontier へ飛んだ後、未処理 pending の再送・再検証・収束が成立するか。閾値境界（==T / ==T+1）の分岐。fresh join が閾値によらず常に bootstrap になる回帰。
4. **divergence fail-fast**: `lastAppliedRevision>frontier` 判定が durable frontier 前提で false positive/negative を出さないか。永続化有効（durable ACK）下では発火しない・非永続 server 再起動（データ喪失）では発火する、の両立。
5. **backoff / 無期限リトライ**: タブ生存中に諦めない（回数上限で保証が破れない）こと・thundering herd（jitter）・open 成功でのリセット・close/dropForTest 後始末。`dropForTest/resumeAfterDrop` がテスト専用で本番挙動を変えないこと。
6. **回帰・テスト十分性**: 既存 reconnect/catchup/convergence/restart-restore/bootstrap の回帰。event 通知の冗長発火抑止。§2.3 invariant の fault 実発火（disconnect/drop/delay>0）と決定論再現。ws-convergence.smoke 安定化が挙動を偽装していないか。boundary lint 新規違反0。

## 対象差分（--uncommitted）
- core: `packages/core/src/{protocol.ts, protocol-limits.ts(新), message-codec.ts, index.ts}`
- server: `packages/server/src/{room.ts, sequencer.ts}`（＋テスト `room-reconnect.test.ts` 新）
- collab: `packages/collab/src/{session.ts}`（＋テスト `reconnect-reconcile.test.ts` 新・`session-events.test.ts` 新）
- app: `apps/collaboration-server/src/client-session/ws-transport.ts`（＋`ws-transport.test.ts` 新・test `reconnect-fault.test.ts` 新・`ws-convergence.smoke.test.ts` 書換）・`apps/playground/src/integration/main.ts`
- invariant: `tests/invariants/collab/reconnect-fault.invariant.test.ts`（新・§2.3 実充足）

## 検証状況
- 対象パッケージ green: collab / server / core / collaboration-server（smoke 除く 389 pass）＋ reconnect-reconcile(9) / room-reconnect(8) / reconnect-fault WS(3) / reconnect-fault invariant(5) / ws-transport(6) / session-events(5)。
- convergence.test（10,000 op・切断注入）green（reconcile 経路を in-process で通過）。ws-convergence.smoke 10 連続 green（1.1s）。
- typecheck 全 workspace green。フルスイート・lint・build・test:invariants は Phase 4 最終ゲートで一括実行予定。
- Evidence: `doc/DD/DD-015/{fault-matrix.md, reconnect-fault-evidence.json}`。
