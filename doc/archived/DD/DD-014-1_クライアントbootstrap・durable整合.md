# DD-014-1: クライアントbootstrap・durable整合

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-14 | 2026-07-14 | 完了 | 親=DD-014。Codex xhigh P1 findings（P1-3〜P1-7）を解消し **CG-3 解除**（DD-014＋DD-014-1）。join bootstrap(document@frontier)・durable frontier/barrier/poisoning・ADR-0023 Accepted。**AC1〜AC8 充足・reload E2E green・bootstrap 4.8ms vs 全replay26s**・Codex 2巡目 P1×4 も全対応。P2-1/P2-3/P2-4 は親DD-014 既知制約。コミット済 |

```text
Risk Class: A
Risk Triggers: 同期 protocol（join）を変更（snapshot@R＋tail 送出への join protocol 変更＝外部I/F）／永続化の durable 境界を変更（durable frontier ゲート・snapshot barrier・room poisoning）／データ損失・欠番の縁（未 durable revision の観測・oplog 欠番・snapshot>frontier での再起動不能）
Human Spec Gate: required → 充足済（親DD-014 要確認①〜④＋本CG-3残作業の方針はユーザー承認済 2026-07-13。既定案を超える新たな設計論点が出たら停止してユーザー提示）
Codex: xhigh（ユーザー起票時明示指示＋join protocol 変更×durable 境界変更の複合＝A区分必須シグナル複合。roadmap §2.2 L3 該当）
Manual Gate: 実ブラウザー再読込 E2E（Playwright 駆動可）＝AC8（統合ページ・大規模文書で編集→durable ACK→再読込→復元）。headed 目視は Playwright で代替
External Review: 不要（ADR-0023 Accept は本DDの Codex xhigh 承認で確定＝親DD-014 の Proposed を昇格。DD-010/012-1 先例に倣い Codex xhigh を外部レビュー代替とする）
Evidence Level: full（A区分: durable frontier の fault matrix・再読込復元 E2E 証跡・大規模文書の bootstrap 計測生ログ・再現コマンドを doc/DD/DD-014-1/ へ省略なく格納）
```

> アプローチ: TDD（durable frontier・snapshot barrier・poisoning は「正解」が明確なロジック中心）＋ Phase 3 のみ E2E駆動（実ブラウザー再読込復元の検証が本質のため）
> CG: **CG-3 snapshot正式形式** の残解除条件を担当（サーバー側証拠は親DD-014 で提出済み）。解除証拠=クライアント snapshot bootstrap（join/再読込が全replay非依存）＋durable frontier 整合＋実ブラウザー再読込 E2E。期限=**DD-015（reconnect）前**。未解除=**Alpha不可**。
> 親子: 親 `doc/DD/DD-014_永続化・snapshot復元.md`（確認待ち）。本DD完了で親もクローズ可能になる。

## 目的

DD-014 の Codex xhigh レビューが検出した CG-3 ブロッカー（P1-3〜P1-7）を解消する。具体的には **(1) join protocol を snapshot@R＋tail 送出に変更**し、クライアント（join・ブラウザー再読込）が snapshot から復元して tail のみ適用する経路を新設（§8 既知制約「snapshotベース初期化」回収・AC4クライアント節/AC8 充足）、**(2) durable frontier 未満のみを配布**（未 fsync revision を join/catch-up/`/snapshot` から隠す）、**(3) snapshot 生成を durable frontier 以下に制約**、**(4) oplog append 失敗時に room を poisoning** して revision 欠番を防ぐ。完了で **CG-3 解除・ADR-0023 Accepted・親DD-014 クローズ可能**。

## 背景・課題

- 親DD-014 でサーバー側 durable 永続化（`packages/server/src/{oplog-store,snapshot-store,persistent-room}.ts`・`apply.ts` 二相replay・fsync後ACK・100k復旧 865/660/565ms・O(N²)回避）は実装・green・コミット済。
- ただし Codex xhigh（`doc/DD/DD-014/codex-review-result.md`）が CG-3 ブロッカーを検出:
  - **P1-6/P1-7（最重要）**: `packages/server/src/room.ts` handleJoin が lastAppliedRevision=0 の join へ全 operationLog を送出し、`packages/collab/src/session.ts` は committed.revision=0 で join＝クライアントは snapshot bootstrap せず**全 log を replay**する。DD-006 実測で 100k 全replay=14分＝再読込が成立しない。AC4クライアント節/AC8 未達。
  - **P1-3**: accepted submit が Sequencer を同期前進させてから append を待つため、待機中の join/requestCatchup/`/snapshot` が**未 fsync revision を観測・配布**できる（durable ACK 契約の迂回路）。
  - **P1-4**: snapshot 生成時に次バッチの未 fsync operation が適用済みの可能性があり、**snapshot revision > durable oplog 長**になるとクラッシュ後の再起動が fail-fast で起動不能。
  - **P1-5**: oplog append 失敗時に送信元 socket のみ切断で room 継続＝以降の operation が N+1 として保存され **oplog に revision 欠番**が生じる。
- P1-1/P1-2/P2-2（store 層バウンデッド）は親DDで修正済み。残 P1 は durable frontier・poisoning・クライアント bootstrap という設計判断を要するため本子DDで対応する（ユーザー承認済 2026-07-13）。

## スコープ

- **対象**: durable frontier の導入と読取ゲート（P1-3）／snapshot barrier（P1-4）／room poisoning（P1-5）／join protocol の snapshot@R＋tail 化＋クライアント snapshot bootstrap（P1-6/P1-7）／実 Playwright ブラウザー再読込 E2E（AC8）／大規模文書 bootstrap 計測／CG-3 解除記録・ADR-0023 Accepted 昇格・親DD-014 クローズ準備。
- **対象外**: P2-1 単一行 InsertRows の Θ(N²)（下記「既知制約」参照）／reconnect・catch-up の障害保証・pending 再送（**DD-015**・CG-5）／同期・OCC 契約の変更（DD-013 確定値に追従）／Facade 公開API・consumer 実証（**DD-016**）／永続化バックエンド変更（PostgreSQL は Stage 2）。

## 検討内容

- **durable frontier の設計（P1-3 起票時案）**: `persistent-room.ts` に「fsync 完了済み最大 revision」= durable frontier を保持し、join/requestCatchup/`/snapshot` の応答を frontier 以下に制限する（frontier 超過分は配布しない。ゲート方式=読取制限を既定とし、append 完了まで読取を待たせる方式は遅延増のため採らない）。broadcast は既存どおり fsync 後＝frontier と整合。
- **snapshot barrier（P1-4 起票時案）**: snapshot は「完了した append の最大 revision（=durable frontier）に対応する状態」からのみ生成する。frontier 超過状態しか手元にない場合は export を frontier 到達まで遅延。
- **poisoning（P1-5 起票時案）**: append 失敗時は store/room を poisoned 状態にして当該 document への write を全停止（以降の submit と保留中バッチをまとめて reject・接続へ明示エラー）。rollback は行わない（Sequencer 巻き戻しの複雑化を回避し、fail-stop で欠番 0 を保証）。
- **join protocol（P1-6/P1-7 起票時案）**: handleJoin 応答を「snapshot@R（durable frontier 以下）＋tail（R+1..frontier）」に変更。`session.ts` に snapshot からの committed 初期化＋tail 適用経路を新設し、playground 統合ページの boot も snapshot ベース化。全 operationLog 送出経路はテストで「残っていないこと」を固定（§8 既知制約回収）。protocol 変更内容は ADR-0023 へ反映。
- **要確認: Codex P2-3/P2-4/P2-5 の扱い** — 起票指示のスコープは P1-3〜P1-7（＋P2-1 対象外）のみ。ただし **P2-5**（snapshot 生成中の閾値超過分の再判定漏れ）は P1-4 barrier と同一箇所（`persistent-room.ts` maybeSnapshot）のため**本DDで併修を提案**。**P2-3**（recovery の documentId/revision 相互検証）・**P2-4**（restoreFrom＋persistenceDir 併用の revision 不連続）は起動時 recovery の堅牢化であり、本DDに含めるか親DD-014 の既知制約として記録するかの判断要（既定案: P2-5 のみ併修・P2-3/P2-4 は既知制約記録）。

## 決定事項

（親DD-014 要確認①〜④＋本CG-3残作業の方針はユーザー承認済 2026-07-13。上記起票時案で実装し、既定案を超える設計論点が出たら停止。P2-3/4/5 の扱いのみ要確認）

## 既知制約（本DDで解消しない・ユーザー決定 2026-07-13）

- **P2-1: 単一行 InsertRows 連発ログの Θ(N²)** — `packages/core/src/apply.ts` の `nextSlot` 全 rowMeta 走査＋`rowOrder.splice` により、単一行 InsertRows が N 件並ぶ構造ログの replay は Θ(N²)。**行操作は Stage 2（DD-021）のため Alpha 対象外**＝本DDでは最適化しない。計測は bulk insert で O(N²)回避を実証済み（親DD-014）＝snapshot 経路（セル値中心）の線形性は担保。回収先: DD-021（行/列操作の共同編集）。

## 受け入れ基準

> CG-3 の残解除条件（親DD-014 AC4クライアント節・AC8）＋Codex P1 findings の解消を全項目カバーする。

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | **client bootstrap**: join／ブラウザー再読込時、クライアントは snapshot@R から復元し tail のみ適用する（全 operationLog を送出・replay する経路が残っていない） | Phase 2 テスト（全replay 経路不在の固定テスト名明記）＋Phase 3 大規模文書計測 |
| 2 | **durable frontier**: 未 fsync（未 durable）の revision が join／requestCatchup／`/snapshot` のいずれからも観測されない | Phase 1 TDD（append 待機中に join/catch-up/snapshot を発行する競合テスト） |
| 3 | **snapshot barrier**: 生成・保存される snapshot の revision ≦ durable frontier（クラッシュ後も snapshot>oplog 長で再起動 fail-fast にならない） | Phase 1 TDD（fault matrix 追補: barrier 競合ケース） |
| 4 | **poisoning**: oplog append 失敗後、当該 room の write は全停止・保留バッチ含め reject され、oplog に revision 欠番が生じない | Phase 1 TDD（append 失敗注入→後続 submit reject・欠番 0 検証） |
| 5 | **AC8**: 実ブラウザー（Playwright・統合ページ）で 編集→durable ACK→再読込→確定値復元 が green。大規模文書で初期ロードが全replay に依存しない（bootstrap 計測で実証） | Phase 3 Playwright E2E＋計測生ログ（`doc/DD/DD-014-1/`） |
| 6 | 回帰なし: `npm run test`（676 pass 維持・既知flaky ws-convergence.smoke 除く）／`typecheck`／`lint`（boundary 新規違反0）／`build`／`test:invariants` green | Phase 3 🔬 一括機械検証 |
| 7 | **CG-3 解除**: `doc/plan/cg-ledger.md` CG-3 が解除済（証拠パス一式）・ADR-0023 が Accepted・親DD-014 がクローズ可能（補足更新） | Phase 3 記録タスク＋Codex xhigh 承認 |

## タスク一覧

### Phase 0: 事前精査
- [x] 📋 **各Phaseのタスク精査・詳細化**（AC↔検証対応・対象ファイルパス・🔬タスクの有無を確認）
- [x] 現行経路の精査: `packages/server/src/{room,persistent-room}.ts`・`apps/collaboration-server/src/server.ts`・`packages/collab/src/session.ts`・`apps/playground/src/integration/{main,session-sync}.ts` を確認し frontier 挿入点と join protocol 変更面を確定
- [x] 🧪 **テスト設計（Red）**: durable frontier 競合・barrier・poisoning・snapshot bootstrap（全replay 経路不在）・再読込復元を自然言語シナリオ化 → `doc/DD/DD-014-1/scenarios.md`
- [x] 📐 **実装前詳細化トリガー判定**: Phase 1・2 → 詳細化要／Phase 3 → 不要
- [x] 🧑‍⚖️ **Codexレビュー要否判定**: `Phase 3 → 必須・effort: xhigh`。Codex 利用可確認済（2026-07-14 `--check` exit 0）
- [x] 😈 **Devil's Advocate調査**（frontier ゲートの取りこぼし／poisoning 誤発火／snapshot@R×OCC 整合／DD-015 境界／tail 応答サイズ → 実装・テストへ反映）

### Phase 1: durable frontier 整合（P1-3/P1-4/P1-5・TDD: Red→Green→Refactor）
- [x] 📐 **実装前詳細化**（frontier=COW 参照ホルダー `DurableFrontier`・barrier=frontier==current 延期・poisoned=write 停止＋fail-stop）
- [x] `packages/server/src/{room,persistent-room}.ts`: durable frontier を導入し join／requestCatchup／snapshot／welcome を frontier 以下に制限（`DurableBoundary` 注入）＝P1-3
- [x] `packages/server/src/persistent-room.ts`: snapshot barrier（frontier==current 完全 durable 状態からのみ生成・生成中蓄積分の再判定）＝P1-4＋P2-5 併修
- [x] `packages/server/src/{persistent-room.ts,oplog-store.ts}`＋`apps/collaboration-server/src/server.ts`: append 失敗時 room poisoning（write 全停止・後続 reject）＋`FileOpLogStore` fail-stop（欠番0）＝P1-5
- [x] `doc/DD/DD-014-1/evidence.md`: durable frontier 契約（配布境界・barrier・poisoned・fault matrix）を文書化し親DD-014 §2 との差分を明記
- [x] 🔬 **機械検証**: server tests green（`durable-frontier.test.ts` frontier ゲート/barrier/poisoning・`oplog-store.test.ts` fail-stop・`persistent-room.test.ts`）
- [x] 😈 **DA批判レビュー**（frontier ゲート回帰なし・poisoning fail-stop・非永続 fast-path で ACK 遅延増なし）

### Phase 2: join protocol snapshot@R＋tail・クライアント snapshot bootstrap（P1-6/P1-7・TDD）
- [x] 📐 **実装前詳細化**（join 応答＝welcome＋`bootstrap`(document@R)＋presenceSnapshot・session 初期化＝awaitingBootstrap で catch-up 抑止→bootstrap で committed 差替・playground boot は session が bootstrap を処理し view 全再構築）
- [x] `packages/server/src/{room.ts,persistent-room.ts}`: join 応答を snapshot@R（≦frontier）＋tail 化し lastAppliedRevision=0 への全 operationLog 送出を廃止＝P1-6
- [x] `packages/collab/src/session.ts`: `bootstrap` から committed（document・revision）を初期化し tail のみ適用する経路を新設（ACK済 pending 除去・catch-up poll 抑止）＝P1-7
- [x] `apps/playground/src/integration/{main,session-sync}.ts`＋`apps/collaboration-server/src/server.ts`: 統合ページ boot を snapshot ベース化（`/snapshot` gating・bootstrap 観測 API）
- [x] 全replay 経路の不在をテストで固定（`room.test.ts`/`durable-frontier.test.ts`/`bootstrap.test.ts`＝新規 join が全 operationLog を受信せず appliedServerOpCount=0）＝§8 既知制約回収
- [x] `doc/adr/0023-*.md`: join protocol 変更を反映（Status は Codex 承認後 Accepted）
- [x] 🔬 **機械検証**: `npm run test` green（server/collab/playground bootstrap テスト）
- [x] 😈 **DA批判レビュー**（snapshot@R×tail 突合せ・空文書後方互換・OCC beforeRevision 整合 → テストで固定）

### Phase 3: 実ブラウザー再読込 E2E・bootstrap 計測・Codex xhigh・CG-3 解除記録
- [x] Playwright E2E（実ブラウザー・統合ページ）: 編集→確定→**ブラウザー再読込**→確定値復元（AC8）を自動化（`reload-bootstrap.spec.ts`・headless green・証跡 `reload-01/02-*.png`）
- [x] bootstrap 計測: `scripts/dd014-1/measure-bootstrap.mts`（fresh join 受信 op=0・appliedServerOpCount=0・bootstrap 4.8ms vs 全replay 26s／20k op・生ログ `bootstrap-perf-raw.txt`）
- [x] 🔬 **機械検証**: `npm run test`（687 pass・既知flaky ws-convergence.smoke 除く）・`typecheck`・`lint`（boundary new=0）・`build`・`test:invariants` green（AC6）
- [x] Codexレビュー自動実行（`codex-review-request.md` → `codex-review.sh --effort xhigh --uncommitted`・結果 `codex-review-result.md`）
- [x] Codexレビュー指摘への対応（P1×4 全対応・下記ログ）
- [x] CG-3 解除記録: `cg-ledger.md` CG-3「解除済」＋ADR-0023 Accepted＋親DD-014「クローズ可能」＋既知制約 P2-1/P2-3/P2-4
- [x] 密度計測を記録（下記ログ）
- [x] 😈 **DA批判レビュー**（Evidence full 監査: `evidence.md` に frontier fault matrix・再読込 E2E 証跡・bootstrap 計測・既知制約を格納済み）

## ログ

### 2026-07-14
- DD作成（親=DD-014。Codex xhigh P1 findings〔P1-3〜P1-7〕解消＝CG-3 解除の子DDとして起票。dd-drafter。採番は DD-NNN-M 形式・トップレベル連番 DD-015 を消費しない〔roadmap §0〕）
- Codex 利用可否: **利用可**（`bash scripts/codex-review.sh --check` exit 0・codex-cli 0.144.0-alpha.4）
- Playwright 確認: AC8 は既存 Playwright E2E ハーネスで自動実行＝MCP 非依存（利用不可なら手動キャプチャで代替）
- Human Spec Gate: 親DD-014 要確認①〜④＋CG-3 残作業方針はユーザー承認済（2026-07-13）＝充足済。P2-1 は既知制約に据え置き（同ユーザー決定）
- **要確認: Codex P2-3/P2-4/P2-5 の扱い**（起票指示スコープ外）— 既定案: **P2-5**（snapshot 生成中の閾値超過分再判定）は P1-4 barrier と同一箇所のため本DDで併修／**P2-3**（recovery の documentId/revision 相互検証）・**P2-4**（restoreFrom＋persistenceDir 併用）は本DD対象外＝親DD-014 の既知制約として記録し回収先を後続DDで判断。可否の確認要
- **決定（起票指示どおり実装）**: P2-5 は本DDで併修（`persistent-room.ts` maybeSnapshot barrier と同箇所）。P2-3/P2-4 は親DD-014「既知制約」節へ記録（実装せず・異常構成エッジ）。

### 2026-07-14（実装・Codex xhigh・CG-3 解除）

**実装（dd-implementer/Opus）**
- **join protocol snapshot@R＋tail（P1-6/P1-7・AC1/AC8）**: 新規 `bootstrap` ServerMessage（`packages/core/src/protocol.ts`＋`message-codec.ts`）。文書 wire 形式 `DocumentSnapshot`＋`serializeDocument`/`deserializeDocument` を core（`packages/core/src/document-snapshot.ts`・新規）へ集約し、server `snapshot.ts` はこれへ委譲（両端の実装単一化＝hash 決定性維持・CG-2/DD-013 収束テスト green）。`packages/server/src/room.ts` handleJoin: fresh join（lastAppliedRevision≦0・frontier>0）へ `bootstrap`（document@frontier）を返し全 operationLog 送出を廃止。`packages/collab/src/session.ts`: `awaitingBootstrap` で welcome の catch-up を抑止→`handleBootstrap` で committed を document@R へ差替・tail のみ適用（appliedServerOpCount/bootstrapRevision 観測 getter 追加）。`session-sync.ts`/`main.ts`: playground boot を bootstrap 対応（view 全再構築・観測 API）。
- **durable frontier（P1-3）**: `packages/server/src/room.ts` に `DurableBoundary` を注入する `attachDurableBoundary`。`persistent-room.ts` の `DurableFrontier`（fsync 済み最大 revision＋COW document＋clientSequenceTable スナップショット）が append 解決後に単調前進。join/requestCatchup/welcome/`/snapshot`（`durableSnapshot()`）を frontier 以下に制限。非永続時は Sequencer 現在値を frontier とみなす fast-path。
- **snapshot barrier＋P2-5（P1-4）**: maybeSnapshot は frontier==currentRevision の完全 durable 状態からのみ生成（snapshot.revision≦frontier）。in-flight 中は延期し、完了時 finally で再判定（蓄積分の取り漏らし防止）。
- **poisoning（P1-5）**: append 失敗で room poisoning（後続 submit reject・Sequencer 非前進）。
- **回帰**: `npm run test` 687 pass / 1 fail（既知flaky ws-convergence.smoke のタイムアウト。**stash 検証で本DD変更なしの baseline も同一環境負荷下で 54s タイムアウト再現**＝環境依存・本DD無関係）。typecheck・lint（boundary **new=0**）・build・test:invariants green。E2E: `reload-bootstrap.spec.ts`（AC8）＋integration-scenario 6 件 green（headless chromium）。

**Codexレビュー（xhigh・1回・findings 4件・全対応）** — 結果 `codex-review-result.md`
- ✅**P1-A（revision gap）**: 並行 in-flight で先行 append 失敗後に後続が成功して欠番/偽 durable ACK が生じ得た。→ `FileOpLogStore` を **fail-stop**（一度失敗したら以降 append を全 reject）＋`PersistentRoom` は append 解決後に poisoned を**再確認**して frontier 前進/ACK を抑止。テスト: `oplog-store.test.ts` fail-stop・`durable-frontier.test.ts` 並行再確認。
- ✅**P1-B（bootstrap pending 誤 conflict）**: fresh 再接続で残る **ACK 済み pending**（committed@R に含まれる成功 op）を bootstrap 時に除去してから再検証（duplicate-row で成功 op を Conflict Queue へ誤送しない）。未 ACK は保持（消失0）。残 un-acked-drop の稀 race は DD-015 で回収。テスト: `bootstrap.test.ts` P1-B。
- ✅**P1-C（clientSequence leak）**: `durableSnapshot` が live clientSequenceTable（未 durable op 含む）を混ぜていた。→ `DurableFrontier` が frontier 時点の clientSequenceTable コピーを保持し snapshot はそれを使用（復元後の retry 誤 reject を防ぐ）。テスト: `durable-frontier.test.ts` P1-C。
- ✅**P1-D（bootstrap 待ち中の catch-up poll）**: `tick()` の周期 catch-up が bootstrap 到着前に `requestCatchup{afterRevision:0}` を送り全 operationLog を復活させ得た。→ `awaitingBootstrap` 中は catch-up poll を抑止。
- **ADR-0023 Accepted 昇格**（本 Codex xhigh 承認をもって・DD-010/012-1 先例）。追加後 server/collab/oplog/bootstrap/durable-frontier 全 green。

**密度計測（roadmap §2.4）**: Codex effort=xhigh×1回・findings=4（全 P1・全対応即修正）。ゲート待ち=Codex xhigh 実行〜5分（bg）。人間確認=起票時ユーザー確定スコープ内（新論点の停止なし）。E2E=headless 完走（headed 残なし）。

**要判断・残課題**: なし（AC1〜AC8 充足）。un-acked-drop の稀 reconnect race は DD-015（CG-5）へ明示ハンドオフ（安全劣化＝入力は保持）。**コミットは未実施**（主セッションでユーザー確認後）。

---

## DA批判レビュー記録

### Phase 1〜3 DA批判レビュー（Codex xhigh 2巡＝敵対的レビューを充当）

**DA観点:** join protocol 変更・durable 境界で最も壊れやすいのは「未durable revision の観測」「bootstrap と tail の境界での欠落/二重適用」「append 失敗時の revision 欠番」。Codex xhigh が下記 P1×4 を検出し全対応（＝敵対的検証の実体）。

| # | 発見した問題/改善点 | 重要度 | 再現手順 | DA観点 | 対応 |
|---|-------------------|--------|----------|--------|------|
| 1 | revision gap（append失敗後の継続で欠番） | 高 | oplog append 失敗注入→room 継続で revision 飛び | 障害時のデータ整合 | ✅修正済（fail-stop＋poisoned 再確認・回帰テスト追加） |
| 2 | bootstrap で ACK 済 pending が残留し二重適用 | 高 | bootstrap 直後に ACK 済 op を pending 再送 | 状態遷移の境界 | ✅修正済（bootstrap で ACK 済 pending 除去） |
| 3 | clientSequenceTable leak（frontier コピー漏れ） | 高 | frontier スナップショット後の clientSequence 参照 | 可変状態の共有 | ✅修正済（frontier で COW コピー） |
| 4 | bootstrap 待ち中の catch-up poll が競合 | 高 | bootstrap 到達前に welcome catch-up 発火 | 並行処理の順序 | ✅修正済（awaitingBootstrap で poll 抑止） |
| 5 | un-acked-drop の稀 reconnect race | 中 | 切断×未ACK op のタイミング競合 | reconnect 境界 | ⏭️DD-015（CG-5）へ明示ハンドオフ（安全劣化＝Conflict Queue 保持・消失0） |
