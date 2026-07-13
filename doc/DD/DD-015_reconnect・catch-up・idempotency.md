# DD-015: reconnect・catch-up・idempotency

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-13 | 2026-07-13 | 検討中 | roadmap §4/§5 Alpha必須ライン・**CG-5担当**（D27/D34回収）。DD-014の次・DD-016の前 |

```text
Risk Class: A
Risk Triggers: protocol/rollback-replay を変更（WS切断→再接続→catch-up→再送→収束の製品契約を新規に固定＝reconnect protocol・server側 join/catch-up 応答・受理側 idempotency 範囲の実質変更）／利用者入力を失う可能性（未ACK pending の喪失＝DD-005 既知制約 D27/D34「client→server 欠落時の完全再整列」）
Human Spec Gate: required（起票後にユーザー提示。要確認①〜④の確定後に実装開始）
Codex: xhigh（reconnect protocol・再送・idempotency の実質変更＝A区分必須シグナル複合〔並行処理×外部I/F〔protocol〕×複雑な状態遷移〔切断×op状態の直積〕〕。roadmap §2.2 L3「protocol を実質変更した場合」に該当）
Manual Gate: 要＝実ブラウザーでのネットワーク断→復帰 headed smoke（Phase 4）。判断: fault injection（切断・duplicate・遅延・server再起動）はテストハーネスで自動化可能だが、ブラウザーWSスタック固有の挙動（close イベント遅延・タブ生存中のソケット状態・自動リトライのタイマー実挙動）は synthetic では代替できないため、最低1回の実ブラウザー断線 smoke（dev server kill or Playwright offline 化）を Manual Gate とする。実機IMEは不要（IME 状態機械/textarea 無変更・composition×reconnect は synthetic 不変条件で担保）
External Review: 不要（原則＝Phase境界・Stable API確定・ADR転換・Go/No-Go に非該当。reconnect 契約は Alpha Experimental 0.x・§6 製品境界内。DD-013/014 と同様に Codex xhigh を別モデルレビューとして充てる。reconnect 方式の設計転換〔例: ローカル永続キュー導入〕が必要になったら停止して再判定・ユーザー提示）
Evidence Level: full（A区分: fault matrix〔障害種別ごと保証/非保証〕・randomized seed・再現コマンド・event trace〔切断→再接続→catch-up→再送→ACK の時系列ログ〕・実施ブラウザー/バージョン・既知の未保証境界〔ACK前クラッシュ等 §6〕を doc/DD/DD-015/ へ省略なく格納）
```

> アプローチ: TDD（fault matrix の各セル＝「障害注入 → 期待収束/期待喪失なし」という正解が明確なロジック中心のため。Phase 4 のみ headed smoke で実ブラウザー実証）
> CG: **CG-5 reconnect境界（D27/D34）** 担当。解除証拠=fault injection・再送・収束（**障害種別ごと保証/非保証を分ける**＝fault matrix）。期限=**Alpha exit前**。未解除=**Alpha不可**。
> 想定外の派生作業は子DD `DD-015-M` として起票し、トップレベル連番（DD-016〜）を崩さない（roadmap §0）。

## 目的

WS 切断→再接続→catch-up→pending 再送→収束を**製品保証**にし、DD-005 の最重要既知制約「client→server 欠落時の完全再整列（D27/D34）」を回収して **CG-5 を解除**する（roadmap §4 DD-015・§8・計画書 §19 Phase 2）。設計の中心は**障害マトリクス（fault matrix）**＝切断タイミング×operation 状態（送信前/送信済未ACK/ACK済）×server 再起動有無×duplicate 到達の各セルに保証/非保証を割り当て、保証セルは全て自動テストで固定し、非保証セル（§6: ACK前ブラウザークラッシュ・OSクラッシュ・長時間offline・複数端末offline merge）は文書で明示する。同期契約は DD-013・durable/snapshot は DD-014 の確定値に従い、本DDはその上の**接続復帰層**のみを扱う。

## 背景・課題

- **既存資産＝ゼロから作らない**: DD-005 で `packages/collab/src/session.ts` に pending queue・楽観適用 rollback/replay・欠落検知→requestCatchup・重複無視・offline 上限（maxOfflineMillis/maxOfflinePending）が実装済みで、`reconnect.test.ts`（S-J1〜J5）・`catchup.test.ts`（S-I1〜I5）が **in-process transport レベル**で通っている。
- **不足（本DDで埋める）**: ①上記は synthetic（InProcessHub）契約であり、**実WS（`apps/collaboration-server/src/client-session/ws-transport.ts`）の切断→再接続→catch-up→再送→収束は製品保証されていない**（D27/D34 が既知制約のまま）②再接続の自動リトライポリシー（回数・バックオフ・諦め）が未定義 ③server 再起動（DD-014 snapshot＋log 復旧）を跨ぐ再接続の接続復帰側が未実装 ④pending/rejected の可視化またはイベント通知（§6 保証項目）が契約化されていない ⑤`tests/invariants/collab` の §2.3「idempotency／reconnect・catch-up」行が最小ケースのみ。
- **既知flaky**: `apps/collaboration-server/test/ws-convergence.smoke.test.ts` が実WS・タイミング依存で flaky（DD-011 で環境依存として据え置き）。本DDは実WSテストを大量に増やすため、**静止点待ち（revision 到達待ち・ACK 完了待ち）等の決定的同期手法**が設計論点になる（要確認④）。
- **前提**: DD-013（受理/reject/duplicate 契約の harden）・DD-014（durable ACK・snapshot＋log 復旧・CG-3）の完了が前提。CG-3 期限=「reconnect DD 前」（§0）。

## スコープ

- **対象**: fault matrix の定義と全セルの保証/非保証割当（§6 と整合）／WS 切断検知と自動再接続（リトライポリシー・諦め時通知）／再接続時 catch-up（revision 差分 pull・閾値超は snapshot 再取得）／pending queue の再送（送信前・送信済未ACK の両状態）／受理側・適用側 idempotency（再送 duplicate の二重適用0・server 再起動跨ぎ含む）／server 再起動後の接続復帰（DD-014 復旧との突合せ＝revision 連続性検証）／pending・rejected 状態のイベント通知契約／fault injection randomized テスト常設化（§2.3「idempotency／reconnect・catch-up」行の実充足）／実ブラウザーネットワーク断 headed smoke。
- **対象外**: ACK前のブラウザークラッシュ・OSクラッシュ・ローカル永続キュー・長時間offline編集・複数端末offline merge（**§6 非保証**＝fault matrix で「非保証」明記のみ）／同期・OCC 契約自体の変更（**DD-013**）／durable ACK・snapshot format・復旧アルゴリズム自体（**DD-014**）／通知の公開API整形・connection state の consumer lifecycle 契約（**DD-016** へ委譲。本DDは内部イベント契約＋playground 可視確認まで）／Presence・Clipboard・行操作・数式。

## 検討内容

- **fault matrix（起票時案・Phase 0 で確定しユーザー合意）**: 行=切断タイミング（op 送信前／送信済未ACK／ACK済・broadcast未受信／catch-up 応答待ち中／再切断の重畳）×列=（server 継続稼働／server 再起動〔DD-014 復旧〕）×横断条件（duplicate 到達・遅延・順序逆転）。各セルに「保証（収束＋入力喪失0）／非保証（§6 該当）」と検証テスト名を割り当てる。ACK済 op は server 継続・再起動どちらでも喪失0（DD-014 durable ACK）、未ACK op はタブ生存中に限り再送で喪失0、ACK前タブクラッシュは非保証、が §6 の外形。
- **要確認: ① 再接続の自動リトライポリシー** — 既定案: **指数バックオフ（初回 1s・倍々・上限 30s）＋ジッタ、タブ生存中は無期限リトライ**（§6「タブ生存中の一時切断」を保証する以上、回数上限で諦めると保証が破れるため）。ただし既存の offline 上限（maxOfflineMillis/maxOfflinePending 超過で編集停止）は維持＝「接続は試み続けるが編集は停止し、その旨をイベント通知」。諦め＝ユーザー通知のみで自動 giveup なし。可否（特に無期限リトライと編集停止閾値の関係）の確認要。
- **要確認: ② catch-up 方式の閾値** — 既定案: 再接続時 `lastAppliedRevision` を添えて join し、**差分 op 数が閾値 T（既定 1,000＝DD-014 snapshot 生成間隔 N と同値）以内なら revision 差分 pull、超えたら snapshot 再取得＋tail**（DD-014 の初期ロード経路を再利用）。切断中 pending との突合せは snapshot 再取得経路でも beforeRevision 再検証（stale→reject→draft保持＝DD-013 契約）を通す。T の値と「snapshot 再取得時も pending 再送を保証する」ことの可否の確認要。
- **要確認: ③ pending/rejected の可視化方式** — §6 は「可視化**または**イベント通知」。既定案: 本DDは **イベント通知契約（connection state 変化・pending 件数・rejected 発生のコールバック/イベント）を正**とし、playground 統合ページに最小の状態表示（接続状態・未送信件数バッジ程度）を付けて可視確認する。公開APIとしての整形・UI コンポーネント化は DD-016 consumer lifecycle 契約（connection state・error notification）へ委譲。可否の確認要。
- **要確認: ④ ws-convergence.smoke flaky の扱い** — 既定案: **本DDに含める**。本DDは実WS の切断・再接続テストを常設するため、タイミング依存を放置すると flaky が増殖する。既存 smoke を「静止点待ち（対象 revision 到達・ACK 完了・pending 空を明示的に await）」方式へ書き換えて安定化し、本DDの新規実WSテストも同方式で書く。スコープ外にする場合は flaky 据え置きの明示が必要。可否の確認要。
- **idempotency の範囲（起票時案）**: 同一 operationId の重複は (a) server 継続稼働中=受理側 dedupe（DD-013 で harden）、(b) server 再起動跨ぎ=**operation log 由来の確定 revision との突合せ**で二重適用を防ぐ（再起動で受理側メモリの dedupe 集合が消えても、log に載った op の再送は同一 operationId で検出できることを DD-014 の log 形式に依存して実証）。(b) が log 形式変更を要する場合は DD-014 側と調整し、変更が生じたら Codex 対象へ含める。

## 決定事項

（Human Spec Gate＝要確認①〜④の確定後に記入）

- 方針（起票時）: DD-005 実証済みの pending queue・catch-up 状態機械（synthetic 契約）を土台に、**実WS 経路の製品保証を追加する層**として実装。ローカル永続キュー等の保証拡大（§6 非保証域への踏み込み）はしない。設計転換が必要になったら停止してユーザー提示（External Review 再判定）。

## 受け入れ基準

> §0 CG-5 解除証拠（fault injection・再送・収束＝障害種別ごと保証/非保証）＋§6 製品境界の保証項目を全カバーする。

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | **fault matrix** が文書化され（切断タイミング×op状態×server再起動×duplicate）、各セルの保証/非保証が §6 と整合し、**保証セル全てに対応する自動テスト名**が割り当てられている | Phase 0 で `doc/DD/DD-015/fault-matrix.md` 作成→👀 合意。Phase 3 でテスト名を全セルへ記入し監査 |
| 2 | 送信済未ACK の op を持つクライアントが WS 切断→再接続すると、op が再送され**正確に1回だけ**適用される（二重適用0・喪失0） | Phase 1 実WSテスト＋Phase 3 randomized（duplicate 注入） |
| 3 | 切断中に編集した送信前 pending が再接続後に catch-up→再検証を経て送信され、stale なら reject＋draft 保持（サイレント喪失0＝D27/D34 回収） | Phase 1/2 実WSテスト（DD-013 reject 契約に接続） |
| 4 | 再接続時、切断中の他者確定 op を catch-up（差分 pull・閾値超は snapshot 再取得）で取得し、全クライアント hash 一致に収束する | Phase 2 テスト＋Phase 3 randomized（収束hash生ログ） |
| 5 | **server 再起動**（DD-014 snapshot＋log 復旧）を挟む再接続でも、ACK済 op は喪失0・未ACK 再送は idempotent・revision 連続性が検証され収束する | Phase 2 再起動跨ぎテスト（テストハーネスから server 再生成） |
| 6 | randomized fault injection（切断・duplicate・遅延・server再起動・seed 記録）で、保証セル範囲の全シナリオが収束しデータ損失0 | Phase 3 `npm run test:invariants`（§2.3「idempotency／reconnect・catch-up」行の実充足）＋seed/再現コマンド格納 |
| 7 | 切断・再接続・pending 滞留・rejected 発生が**イベント通知**され、playground 統合ページで接続状態・未送信件数が可視確認できる。offline 上限超過時は編集停止＋通知（自動リトライは継続） | Phase 1 イベント契約テスト＋Phase 4 headed smoke で可視確認 |
| 8 | 非保証セル（ACK前ブラウザークラッシュ・OSクラッシュ・長時間offline・複数端末offline merge）が fault matrix に「非保証」と明記され、保証と誤読される記述がない | Phase 3 fault-matrix 文書監査（😈 DA タスク） |
| 9 | 実ブラウザーでネットワーク断→復帰（server kill→再起動 or offline 化）し、切断中の編集が復帰後に反映・他者編集が catch-up され、双方 hash 一致相当の表示になる | Phase 4 headed smoke（Manual Gate）＋証跡 `doc/DD/DD-015/` |
| 10 | 回帰なし: `npm run test`／`typecheck`／`lint`（boundary 新規違反0）／`build`／`test:invariants` green。`ws-convergence.smoke` が安定化方式（要確認④確定値）で green | Phase 4 🔬 一括機械検証 |

## タスク一覧

### Phase 0: 事前精査・fault matrix 設計（Red）
- [ ] 📋 **各Phaseのタスク精査・詳細化**（AC↔検証対応・対象ファイルパス・🔬タスクの有無を確認）
- [ ] 現行資産の精査: `packages/collab/src/session.ts`（pending queue・requestCatchup・offline上限）・`reconnect.test.ts`/`catchup.test.ts`（synthetic 契約）・`apps/collaboration-server/src/client-session/ws-transport.ts`・`server.ts`（join/切断処理）を確認し、**synthetic 契約と実WS 経路のギャップ**（再接続時 join 手順・server 側 catch-up 応答・dedupe 範囲）を列挙
- [ ] 🧪 **fault matrix 設計（Red）**: 切断タイミング（送信前/送信済未ACK/ACK済/catch-up中/再切断重畳）×server 再起動有無×duplicate/遅延 の各セルに保証/非保証（§6 整合）と検証シナリオを割当て → `doc/DD/DD-015/fault-matrix.md` → 👀 ユーザー合意後にテストコード化（要確認①〜④の確定を反映）
- [ ] 📐 **実装前詳細化トリガー判定**: Phase 1・2 → **詳細化要**（3ファイル以上・外部I/F〔reconnect protocol〕・並行処理・既存状態遷移の変更に該当）／Phase 3・4 → 不要
- [ ] 🧑‍⚖️ **Codexレビュー要否判定**: `Phase 3 → 必須・effort: xhigh（reconnect protocol・再送・idempotency の実質変更＝並行処理×外部I/F×複雑な状態遷移の複合。§2.2 L3 該当）`。Codex 利用可確認済（2026-07-13 `--check` exit 0）
- [ ] 😈 **Devil's Advocate調査**（「収束するが利用者入力を静かに落とす」経路の見落とし／再接続 join と通常 join の contract 分岐が protocol を複雑化しないか／snapshot 再取得経路で pending 再検証が抜ける穴／無期限リトライの thundering herd／DD-013/014/016 との境界崩れ）

### Phase 1: WS 再接続・再送・イベント通知契約（Red→Green→Refactor）
- [ ] 📐 **実装前詳細化**（再接続状態機械・リトライポリシー・再接続 join 手順〔lastAppliedRevision・pending 再送順序〕・イベント通知契約のデータフロー → 👀 ユーザーレビュー後にコーディング）
- [ ] `apps/collaboration-server/src/client-session/ws-transport.ts`（＋必要なら `packages/collab/src/session.ts` の transport 契約）: 切断検知・指数バックオフ自動再接続（要確認①確定値）・再接続時の同一 clientId join＋pending 再送を TDD で実装（Red→Green→Refactor）
- [ ] `packages/collab/src/session.ts`: connection state・pending 件数・rejected 発生のイベント通知契約（コールバック/イベント）と offline 上限超過時の「編集停止＋通知＋リトライ継続」をテスト固定
- [ ] `apps/playground/src/integration/`: 接続状態・未送信件数の最小表示（要確認③確定値・現位置のまま抽出しない）
- [ ] 🔬 **機械検証**: `npm run test -w @nanairo-sheet/collab`＋`npm run test -w collaboration-server` green（未ACK再送の二重適用0・切断中 pending 保持のテスト名を明記）
- [ ] 😈 **DA批判レビュー**（「このPhaseで何が壊れるか」: 既存 E2E17・ws-convergence.smoke・DD-013 reject 契約の回帰／再接続中の submit 競合。基準: da-method.md §3.4）

### Phase 2: catch-up 製品化・server 再起動跨ぎ（Red→Green→Refactor）
- [ ] 📐 **実装前詳細化**（catch-up 応答契約・閾値 T 分岐・snapshot 再取得＋pending 再検証・再起動跨ぎ dedupe〔log 突合せ〕 → 👀 ユーザーレビュー）
- [ ] `apps/collaboration-server/src/server.ts`＋`packages/server/src/room.ts`: 再接続 join への catch-up 応答（revision 差分 pull・閾値超は DD-014 snapshot＋tail 経路を再利用）を TDD で実装
- [ ] server 再起動跨ぎの idempotency: 再起動後の再送 duplicate を operation log 由来の確定 revision と突合せて二重適用0を固定（DD-014 log 形式に依存。形式変更が必要なら停止して DD-014 と調整・ログへ記録）
- [ ] revision 連続性検証: 再接続時に client `lastAppliedRevision` と server 復旧後 revision の不整合（巻き戻り等）を検出し fail-fast（黙って分岐した歴史を merge しない）
- [ ] 🔬 **機械検証**: `npm run test -w @nanairo-sheet/server`＋実WS 再起動跨ぎテスト green（snapshot再取得経路でも pending 再検証が走るテスト名を明記）
- [ ] 😈 **DA批判レビュー**（古い snapshot＋catch-up の突合せ誤り／再起動直後の同時再接続殺到／catch-up 中の再切断で状態機械が固まらないか）

### Phase 3: fault injection randomized 常設化・実WSテスト安定化＋Codexレビュー
- [ ] `tests/invariants/collab/`: fault matrix 保証セル全件の fault injection テスト（切断タイミング×再起動×duplicate/遅延・seed 記録・収束 hash 比較）を実装し、§2.3「idempotency／reconnect・catch-up」行を実充足。全セル↔テスト名対応を `doc/DD/DD-015/fault-matrix.md` へ記入
- [ ] `apps/collaboration-server/test/ws-convergence.smoke.test.ts`: 静止点待ち方式（revision 到達・ACK 完了・pending 空の明示 await）へ書き換えて flaky 恒久是正（要確認④確定値。スコープ外確定なら据え置き理由をログへ）
- [ ] event trace（切断→再接続→catch-up→再送→ACK の時系列）・seed・再現コマンド・収束hash生ログを `doc/DD/DD-015/` へ格納（Evidence full）
- [ ] 🔬 **機械検証**: `npm run test:invariants` green（randomized 含む・失敗時 seed 再現手順つき）＋ws-convergence.smoke 連続 10 回 green
- [ ] Codexレビュー自動実行（依頼書 `doc/DD/DD-015/codex-review-request.md` 生成 → `bash scripts/codex-review.sh --request ... --out doc/DD/DD-015/codex-review-result.md --effort xhigh`・バックグラウンド実行）
- [ ] Codexレビュー指摘への対応、または見送り理由をログに記録
- [ ] 😈 **DA批判レビュー**（fault matrix に「通るように書いた」セルがないか＝欠陥注入で落ちることを確認／非保証セルが保証と誤読される記述の監査＝AC8）

### Phase 4: 実ブラウザー断線 headed smoke・CG-5 解除記録（Manual Gate）
- [ ] `bash scripts/dev-start.sh --integration` で起動し、実ブラウザー2枚で編集中に server kill→再起動（or offline 化→復帰）: 切断表示→自動再接続→切断中編集の反映→他者編集の catch-up→双方一致を確認・📸 証跡（接続状態表示含む）を `doc/DD/DD-015/` へ
- [ ] 🔬 **機械検証**: `npm run test`・`typecheck`・`lint`（boundary 新規違反0）・`build`・`test:invariants` 一括 green（AC10）
- [ ] CG-5 解除証拠を `doc/plan/cg-ledger.md` へ記録（fault matrix・再送/収束テスト・seed・event trace・headed 証跡のパス一式）＋roadmap §8 の D27/D34 行を解消済みへ更新
- [ ] 密度計測を記録（人間確認時間・Codex effort/回数・ゲート待ち・findings数・manual gate 実施内容 → ログへ。roadmap §2.4）
- [ ] 😈 **DA批判レビュー**（Evidence full 監査: fault matrix・seed・再現コマンド・event trace・実施ブラウザー/バージョン・未保証境界〔§6〕が証跡に欠けていないか）

## ログ

### 2026-07-13
- DD作成（roadmap §4 DD-015 定義・§0 CG-5・§5 Alpha必須ライン・§6 製品境界〔reconnect 保証/非保証〕・§8 既知制約 D27/D34 回収を前提に起票。dd-drafter）
- Codex 利用可否: **利用可**（`bash scripts/codex-review.sh --check` exit 0・codex-cli 0.144.0-alpha.4）
- 前提状態: DD-013（同期・OCC）・DD-014（永続化・CG-3）は起票済・検討中。本DDは両者の完了が実装前提（CG-3 期限=「reconnect DD 前」）。synthetic レベルの reconnect/catchup 契約は DD-005 実装済（`packages/collab` S-J1〜J5・S-I1〜I5）＝実WS 経路の製品保証が本DDの差分。
- 既知flaky `ws-convergence.smoke`（実WS・タイミング依存）の恒久是正を要確認④として本DDスコープ候補に含めた。
- **要確認①〜④を提示**（①自動リトライポリシー〔既定案: 指数バックオフ＋タブ生存中無期限・編集停止閾値は既存維持〕②catch-up 閾値〔既定案: T=1,000・超過は snapshot 再取得＋pending 再検証〕③pending/rejected 可視化〔既定案: イベント通知を正・playground 最小表示・公開API整形は DD-016〕④ws-convergence.smoke 安定化〔既定案: 本DDに含め静止点待ち方式へ〕）。Human Spec Gate: required＝確定後に Phase 1 開始。

---

## DA批判レビュー記録

### Phase N DA批判レビュー

**DA観点:** （このPhaseで最も壊れやすいポイントは何か？）

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | (具体的に記述) | 高/中/低 | (高/中: 操作→結果) | (どのDA観点で発見したか) | ✅修正済/⏭️別DD/❌不要 |
