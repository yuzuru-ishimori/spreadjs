# Codex レビュー依頼: DD-003 PoC-C 共同編集 Operation（Phase 1〜5 全差分）

別モデル視点で、実装（Claude）の差分をレビューしてほしい。**findings 優先**で「仕様一致・バリデーション・回帰・テスト不足」を指摘すること。重大度（Critical/Warning/Info）を付けてほしい。

## レビュー対象スコープ（重要）

**対象は以下のみ**:
- `packages/sheet-core/**`（決定論適用・文書モデル・ハッシュ・共有バリデーター・プロトコル型）
- `packages/sheet-server-core/**`（Sequencer・Room・Presence・Snapshot）
- `apps/collaboration-server/**`（ヘッドレスクライアント・in-process ハブ・WS アダプター・**Phase 5 の 4 テスト**）
- `doc/DD/DD-003*`・`doc/adr/0005-*.md`・`doc/adr/0008-*.md`

**対象外（レビューしない）**: `apps/playground/**`（別 DD=DD-002）・DD-002/DD-004 関連・`.playwright-mcp/`・`doc/DD/DD-INDEX.md`（自動生成）・`package-lock.json`・`doc/DOC-MAP.md`。これらの差分が git 上に見えても findings に含めないこと。

これらはほぼ**未コミット（untracked）**なので、`git status` とファイル内容から対象ファイルを列挙して読むこと。

## DD の目的

「サーバー主導の全順序 Operation ログ＋楽観適用 rollback/replay が、切断・競合・重複・遅延を経ても収束するか」を検証する PoC-C（計画書 §18.3）。受け入れ基準 AC1〜5 は `doc/DD/DD-003_PoC-C共同編集Operation.md` を参照。

## 設計意図（この前提で仕様一致を評価してほしい）

- **§7.6 決定論**: `applyOperation`（`packages/sheet-core/src/apply.ts`）は時刻・乱数・DOM・ネットワークを参照せず、同一 (文書, Operation, 付与revision) → 同一 ApplyResult。ID 採番は apply の外（クライアント Command 側）。二相適用（validate-all → commit・`cloneDocument` バッファ）で SetCells 原子性（全件適用/全件拒否）。
- **§7.7 rollback/replay**（`apps/collaboration-server/src/client-session/session.ts`）: committed（サーバー確定・権威）と pending（未 ACK ローカル）の二層。server op 到着で「pending 逆順 rollback → server op を committed へ適用 → own 除去（operationId 冪等）→ 残 pending を `validateOperation` で再検証 → 再適用 → 不成立は Conflict Queue」。**committed は rollback から導出せず権威管理**（下記 D22）。
- **§8.4/処理順**（`packages/sheet-server-core/src/sequencer.ts`・protocol-subset §5）: `submitOperation` を **operationId 冪等 → clientSequence 検査 → baseRevision 検査 → validateOperation → applyOperation** の順で処理。順序が正しさを決める（重複再送を冪等で先に救済しないと clientSequence 違反で誤 reject＝AC2 破綻）。
- **§10.2 競合**: SetCells の `beforeRevision` が現在セル revision と不一致なら `operationRejected` code=`stale-cell-revision`＋details に現在値・現在 revision。SetCells は 1 件でも stale/不正なら**全体 reject**（部分適用しない）。
- **Q-1〜Q-5 裁定**: Q-1=全件 tombstone 済み DeleteRows は空 changeSet の no-op（revision 非消費・ackCache 登録・clientSequence 前進）。Q-2=clientSequence 欠番は `client-sequence-violation` で reject。Q-3=Conflict Queue は保持のみ（自動再送なし）。Q-4=切断上限 30 秒/100 Operation。Q-5=実 WS スモークは 3 クライアント×1,000 件。
- **既知トレードオフ（バグではない・意図的境界）**:
  - **D22**: `InverseSeed` は cell の before-value のみで before-revision を持たない → 既存セル上書きの rollback は lastChangedRevision を厳密復元できない → committed を権威として別管理し収束担保。
  - **D26**: tail 欠落（gap 検知が起きない静止系）は周期 catch-up ポーリングで回復。
  - **D27**: `submitOperation` 欠落起点の `client-sequence-violation` の完全な clientSequence 再整列は**未実装の境界**。violation 時の同期 `resendAllPending` は out-of-order 再送下で指数増幅し得る（Phase 5 収束試験で実測）。そのため **Phase 5 収束試験（convergence.test.ts）はフォールトを server→client 経路のみに限定**（`InProcessHub` の `injectClientToServer: false`）し、catch-up/冪等/reorder で回復する経路を検証する。submitOperation drop 起点の seq 再整列は後続課題（ADR-0008 の再検討条件）。

## 制約（この不変を守れているか確認してほしい）

- `packages/*` は**ランタイム依存ゼロ**（hono/ws/@hono/node-server を import しない・`dependencies` 空）。ws/hono を使うのは `apps/collaboration-server` のアダプター層（`server.ts`・`ws-transport.ts`）のみ。
- **client-session コア（`session.ts`・`deps.ts`・`inprocess-transport.ts`）は server-core 非依存**（`session.ts` の非相対 import は `@nanairo-sheet/sheet-core` / `@nanairo-sheet/sheet-types` のみ）。`inprocess-transport.ts` は試験ハーネスゆえ Room を import してよい。`tsconfig.core.json`（types:[]）でコア純度を機械検証。
- コーディング規約 `doc/templates/coding-standards.md`（P01 no-any・P02 no-unsafe-cast・P08 no-swallow・P19 no-double-cast・P20 no-stub・P21 no-console.log〔console.error/warn は許容〕）。test/ 配下もシミュレーションで Date.now/Math.random 非使用（シード PRNG・注入クロック。実 WS テストの待機はイベント駆動ポーリング・実行時間計測のみ performance.now）。

## Phase 5 の主な差分（重点レビュー対象）

- `apps/collaboration-server/test/convergence.test.ts`（新規）: 10,000 件収束試験。決定論 PRNG（mulberry32）・注入クロック・収束 assert（hash / ログ replay hash / **構造 deep-equal** / 二重適用0 / フォールト発火カウンター / 自明でない invariant）。同一シード再現（S-M2）。
- `apps/collaboration-server/test/doc-compare.ts`（新規）: hash 非依存の構造正規化（D12 盲点対策・hash と独立の導出になっているか）。
- `apps/collaboration-server/test/protocol-contract.test.ts`（新規）: 重複/欠落/stale ＋ 切断経由 reject 喪失（D27 境界）。
- `apps/collaboration-server/test/ws-convergence.smoke.test.ts`・`test/restart-restore.test.ts`（新規・実 WS）。
- `apps/collaboration-server/src/client-session/inprocess-transport.ts`（Phase 5 追加）: `disableFaults()`・`injectClientToServer` オプション・切断時に旧 Room 接続を解放（fan-out 抑制）・deliverAll の maxSteps ガード（メッセージ storm 検知で明示失敗）。
- `apps/collaboration-server/src/server.ts`（Phase 5 追加）: `restoreFrom?: SnapshotData` で snapshot 復元起動。
- `doc/adr/0005-*.md`・`doc/adr/0008-*.md`（新規・Status: Proposed）。

## 特に確認してほしい観点

1. **仕様一致**: 処理順（§5）・SetCells 原子性・no-op 裁定（Q-1）・catch-up off-by-one（`fromRevision=afterRevision+1`）・clientSequence が clientId 単位・stale reject の details。
2. **バリデーション**: `validateOperation` の網羅（unknown-row/target-row-deleted/unknown-anchor/duplicate-row/stale）とサーバー/クライアント共有の一貫性。信頼できないクライアント入力（Room 境界）の防御。
3. **回帰**: 既存 153 テスト＋Phase 5 追加で 163 テスト green。Phase 5 で `session.ts` は無変更（reviewed Phase 3 コードのまま）。`inprocess-transport.ts`/`server.ts` の追加が既存挙動を壊していないか。
4. **テスト不足・偽陽性の緑**: 収束 assert が弱くないか（全 no-op で通らないか）。構造 deep-equal が hash と同じ関数から導出されていないか。フォールト発火カウンターがモックでなく実発火か。収束試験の server→client 限定が「たまたま収束」を招いていないか。
5. **決定論違反の混入**: Date.now/Math.random/Map 反復順/localeCompare への依存が本番コードに無いか（テストのシミュレーションにも無いか）。
