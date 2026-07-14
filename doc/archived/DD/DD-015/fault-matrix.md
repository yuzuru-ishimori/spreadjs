# DD-015 fault matrix（障害マトリクス）— CG-5 解除の中核証拠

> **正**: roadmap §6 製品境界（reconnect 保証/非保証）と §8 既知制約 D27/D34。本表は「切断タイミング × op 状態
> × server 再起動有無 × duplicate 到達」の各セルに **保証（収束＋入力喪失0）／非保証（§6 該当・文書明示のみ）** を
> 割り当て、保証セルは全て自動テストで固定する。テスト名は Phase 3 完了時に全セルへ確定記入する（AC1）。
>
> 作成: 2026-07-13（Phase 0・要確認①〜④の確定を反映）／テスト名確定: Phase 3

## 0. 用語と前提

- **op 状態**（切断が起きた瞬間の、あるローカル operation の状態）:
  - **T1 送信前（pre-send）**: pending にあるが WS へ未送信、または送信が drop された（server 未受信）。
  - **T2 送信済・未ACK（sent, un-acked）**: server へ届いたが ACK/echo をクライアントが受け取っていない。実際の server 側処理は
    「受理済（accepted）」「reject 済」「未処理（transit で消失）」のいずれか — クライアントからは区別不能。
  - **T3 ACK済・broadcast未適用（acked, echo not applied）**: 自分の ACK は受けたが operations echo（committed 前進）が未適用。
  - **T4 catch-up 応答待ち中（awaiting catch-up）**: gap 検知後 requestCatchup を送り応答待ちの最中に切断。
  - **T5 再切断の重畳（re-disconnect during reconnect）**: 再接続ハンドシェイク（join→welcome→catch-up→再送）の途中で再度切断。
- **server 状態**: **S-cont**（継続稼働）／**S-restart**（DD-014 snapshot＋log 復旧を挟む）。
- **横断条件**: duplicate 到達（同一 operationId 二重）／遅延・順序逆転。全セルで注入し、二重適用0・収束を要求する。
- **タブ生存前提**: 本DDの保証は全て **タブ（JS ヒープ）が生存**している前提（§6「タブ生存中の一時切断」）。
  pending queue・committed・clientSequence はメモリ保持される。タブ/OS が死ぬ＝メモリ喪失は §6 非保証（§3）。

## 1. 保証セル（全て自動テストで固定）

> 判定基準（全保証セル共通）: **①全クライアント committed hash が server 権威 hash と一致（収束）②二重適用0（server
> operationLog に operationId 重複なし・revision 連番）③利用者入力の喪失0（受理 op は反映・reject op は Conflict Queue
> に元値保持＝サイレント喪失なし）④pending/rejected がイベント通知される**。

| # | 切断タイミング×op状態 | server | duplicate | 保証 | 収束メカニズム | 検証テスト（実装済み） |
|---|----------------------|--------|-----------|------|--------------|-----------|
| C1 | T1 送信前 | S-cont | あり | **保証** | 再接続 join→差分同期→pending 再送（seq連番・server 初見ゆえ通常受理／stale なら reject＋draft保持） | `collab/reconnect-reconcile.test.ts` S-R1・legacy ／ 実WS `test/reconnect-fault.test.ts` WS-R1（offline 編集）|
| C2 | T2 送信済・未ACK（server=**受理済**） | S-cont | あり | **保証** | tail echo で own 除去 or reconcile（accepted 集合）で除去＝**正確に1回**。再送は ackCache dedup で duplicate ACK（二重適用0） | `collab/reconnect-reconcile.test.ts` S-R2（un-acked-drop race）・混在ケース ／ `collab/session-events.test.ts`（ACK除去）|
| C3 | T2 送信済・未ACK（server=**reject済**・reject喪失） | S-cont | あり | **保証** | reconcile: opId が ackCache 不在＋clientSequence≦acked → **rejected と判定し Conflict Queue へ**（サイレント喪失0・再送しない＝seq違反ループ回避） | `collab/reconnect-reconcile.test.ts` S-R3・S-R3+R4 混在 |
| C4 | T2 送信済・未ACK（server=**未処理**・transit消失） | S-cont | あり | **保証** | reconcile: opId 不在＋clientSequence>acked → **未処理と判定し再送**（server 初見で受理） | `collab/reconnect-reconcile.test.ts` S-R4 ／ `server/room-reconnect.test.ts`（accepted 集合計算）|
| C5 | T3 ACK済・broadcast未適用 | S-cont | あり | **保証** | 再接続 catch-up（差分 pull）で当該 revision を取得・own は除去済ゆえ committed 前進のみ（二重適用0） | 既存 `collab/catchup.test.ts` S-I1〜I3 ／ `test/convergence.test.ts`（10,000op）|
| C6 | T4 catch-up 応答待ち中 | S-cont | あり | **保証** | 再接続で lastAppliedRevision から catch-up 再要求（gap 前進で afterRevision 前進・重複要求抑止） | 既存 `collab/catchup.test.ts` S-I4/S-I5 ／ `tests/invariants/collab/reconnect-fault.invariant.test.ts` |
| C7 | T5 再切断の重畳 | S-cont | あり | **保証** | 各再接続で状態機械は同一手順を冪等反復（awaitingSync/awaitingBootstrap は再 join でリセット）＝有限回で収束 | `tests/invariants/collab/reconnect-fault.invariant.test.ts`（切断率×連続再接続）／ `test/convergence.test.ts` |
| C8 | 差分>閾値T（切断中に他者が大量編集） | S-cont | あり | **保証** | 再接続で **snapshot 再取得（document@frontier）＋pending 再検証**（差分 pull を回避・DD-014 bootstrap 経路再利用）。reconcile で own accepted 除去 | `server/room-reconnect.test.ts`（閾値==T/T+1 分岐）／ 実WS `test/reconnect-fault.test.ts` WS-R4（>1000op・appliedDelta<100）|
| C9 | T1/T2 混在 | **S-restart** | あり | **保証** | server 復旧（snapshot＋log tail）で ackCache/clientSequenceTable 復元 → reconcile が復元済 ackCache と突合せ二重適用0・revision 継続 | 実WS `test/restart-restore.test.ts`（既存）＋ `test/reconnect-fault.test.ts` WS-R5（永続化再起動＋offline編集跨ぎ）|
| C10 | 全 op 状態 × duplicate/遅延/順序逆転/**client→server欠落** | S-cont | **あり（高確率注入）** | **保証** | randomized fault injection（disconnect＋duplicate＋drop＋delay＋C→S欠落〔D27〕・seed 記録）で保証セル範囲が全収束・損失0 | `tests/invariants/collab/reconnect-fault.invariant.test.ts`（4 config・seed 記録・`reconnect-fault-evidence.json`）|
| C10r | 全 op 状態 × duplicate/遅延 | **S-restart** | あり | **保証** | S-restart（server 再起動）跨ぎは**決定論テスト**で固定（randomized invariant は単一 Sequencer ゆえ非対象・Codex 第3回 P2 に沿い claim を分離） | 実WS `test/reconnect-fault.test.ts` WS-R5（永続化再起動＋offline編集跨ぎ）＋ `test/restart-restore.test.ts`（数百op→再起動→再接続 catch-up 収束） |

### 1.1 revision 連続性（fail-fast・保証の一部）

| # | 条件 | 期待 | 検証テスト（実装済み） |
|---|------|------|-----------|
| C11 | 再接続で **client の lastAppliedRevision > server durable frontier**（client が権威より先＝server 巻き戻り＝分岐した歴史） | **fail-fast**（黙って merge しない・server が `welcome.diverged` を立て client は divergence イベント通知＋編集停止） | `server/room-reconnect.test.ts`（server 側 diverged 判定）／ `collab/reconnect-reconcile.test.ts` S-R7・reorder 耐性 |

## 2. 非保証セル（§6・文書明示のみ・テストで「保証しない」ことを固定）

> これらは §6「reconnect で保証しない」に対応する。**保証と誤読される記述を作らない**（AC8）。該当時の挙動は
> 「収束はするが当該 op は失われ得る／編集停止」であり、データ**破壊**（他 op の喪失・hash 分岐の放置）は起こさない。

| # | 障害 | §6 分類 | 非保証の理由 | 該当時の実挙動（破壊はしない） |
|---|------|---------|------------|------------------------------|
| N1 | **ACK前のタブ/ブラウザークラッシュ** | 非保証 | pending queue は JS ヒープのみ・ローカル永続キューを持たない（本DDスコープ外） | 当該未ACK op は喪失（タブ再読込で committed@frontier から再開＝他 op は無傷・収束） |
| N2 | **OS クラッシュ／電源断** | 非保証 | 同上（メモリ喪失） | 同上 |
| N3 | **ローカル永続キュー** | 非保証（対象外） | IndexedDB 等の永続 pending は設計転換（External Review 再判定事項） | 未実装（保証しない旨のみ明示） |
| N4 | **長時間 offline 編集** | 非保証 | maxOfflineMillis / maxOfflinePending 超過で **編集停止**（stopped）。接続リトライは継続するが編集は再開しない | 上限超で submit が throw・stopped イベント通知（リトライは継続＝§6「一時切断」との境界） |
| N5 | **複数端末 offline merge** | 非保証 | 同一利用者が複数タブ/端末で offline 編集し同時復帰した際の merge 順序は保証しない（後着は stale reject＝draft保持で喪失0だが merge 収束順は未定義） | 各端末は個別に catch-up＋reject＋draft保持（サイレント喪失はしないが「両方の編集が両立」は保証しない） |

## 3. §6 との対応監査（AC8）

- §6 **保証する**: タブ生存中の一時切断【C1〜C11】／未ACK operation のメモリ保持【C2〜C4】／再接続後の再送【C1,C4】／
  idempotency【C2,C9,C10】／catch-up【C5,C6,C8】／server再起動後の snapshot＋log 復旧【C9】／pending・rejected の
  イベント通知【全 C・§判定基準④】。→ **全て保証セルとしてテスト固定**。
- §6 **保証しない**: ACK前ブラウザークラッシュ【N1】／OSクラッシュ【N2】／ローカル永続キュー【N3】／
  長時間offline編集【N4】／複数端末offline merge【N5】。→ **非保証として明示のみ**（テストは「保証しないこと」を固定）。

## 3.1 順序入替＋永続化の残 boundary（Codex 第2回・§6 Alpha 0.x 内・文書明示のみ）

- **echo-ahead-without-ack（in-flight op〔accepted 未 fsync・revision>frontier〕の operations echo だけが bootstrap より先着し
  ACK 未着）× 永続化 × 順序入替**: 当該 in-flight op が reconcile で reject 分類され **false conflict**（Conflict Queue に保持）になり得る。
  **サイレント喪失ではなく・収束は維持**（op は Conflict Queue に保全され、echo で committed にも入る）。
  **順序保証・信頼性のある実 WS（TCP）では到達不能**（welcome→bootstrap→operations は順序保証・echo が ACK/bootstrap より先着しない）。
  信頼性の低い順序入替トランスポート導入時に再検討（設計転換＝External Review 事項）。第1〜2回 Codex xhigh で分析・`codex-review-result-2.md`。

## 4. 既知の flaky（Phase 3 で恒久是正・要確認④）

- `apps/collaboration-server/test/ws-convergence.smoke.test.ts`: 3,000 op を **同期ループで一括 submit** し JS イベント
  ループを塞ぐため、echo が drain されず pending が ~1,000 深に達し rollback/replay が O(N²) 化 → 40s 収束 timeout（環境依存で毎回失敗）。
  **恒久是正（Phase 3）**: op を有界バッチで submit し、バッチ間で **静止点（pending 空・target revision 到達・ACK 完了）を明示 await**
  してから次バッチへ進む方式へ書き換える（現実の利用パターン＝pending 有界に沿わせる）。本DDの新規実WSテストも同方式で書く。
