# DD-013: 共同編集同期・OCC

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-13 | 2026-07-13 | 検討中 | roadmap §4/§5 Alpha必須ライン。DD-012の次・DD-014（永続化）の前 |

```text
Risk Class: A
Risk Triggers: sequencer/protocol/rollback-replay/OCC を変更（受理・reject契約と duplicate 受理側の harden）／サイレント上書き＝利用者入力を黙って失う可能性（beforeRevision 照合欠陥）／自動試験で判定不能な受け入れ条件（2実ブラウザー相互反映の headed smoke）
Human Spec Gate: required（起票後にユーザー提示。要確認①〜④の確定後に実装開始）
Codex: xhigh（protocol・OCC の実質変更が生じた場合＝A区分必須シグナル複合〔並行処理×外部I/F×複雑な状態遷移〕。Phase 0 精査で差分が「挙動保存の harden＋テスト実充足」に留まると判明したら high へ下げ、判断をログへ記録）
Manual Gate: 2実ブラウザー相互反映の headed smoke（Phase 4・DD-005 の headed 2タブ手法踏襲）。実機IMEは不要と判断＝CG-1 解除済（DD-012-1）・本DDは IME 状態機械/textarea/focus を無変更・composition×remote update は synthetic 不変条件で担保（最終確認は DD-016 統合後スモークが担う）
External Review: 不要（Phase境界・公開API確定・ADR転換・Go/No-Go に該当せず。protocol の設計転換が必要になった場合のみ停止して再判定・ユーザー提示）
Evidence Level: full（A区分: randomized seed・再現コマンド・event trace・収束hash生ログ・既知の未保証境界〔reconnect=DD-015／durable=DD-014〕を doc/DD/DD-013/ へ省略なく格納）
```

> アプローチ: TDD（収束hash一致・OCC契約という「正解」が明確なロジック中心のため。Phase 4 のみ headed smoke で実ブラウザー実証）
> CG: 担当CGなし。ただし §2.3 共同編集不変条件（reconnect/catch-up・snapshot復旧行を除く）の実充足を担う。
> 想定外の派生作業は子DD `DD-013-M` として起票し、トップレベル連番（DD-014〜）を崩さない（roadmap §0）。

## 目的

複数クライアントの同時編集で「サーバー受理・全順序確定・cell-level OCC・他クライアント反映」を製品品質にする（roadmap §4 DD-013・計画書 §19 Phase 2 の最小）。**「同期」のみを扱い「保存」を扱わない**（durable ACK・versioned snapshot は DD-014、reconnect/catch-up の製品保証は DD-015）。DD-011 が設置した常設不変条件スイート `tests/invariants/collab`（現状は最小ケースのみ）を randomized 収束テスト含めて実充足する。

## 背景・課題

- **PoC実証済み＝ゼロから作らない。** DD-003（10,000 op×3〜10クライアント hash一致・二重適用0）・DD-005（cell-level beforeRevision OCC 確定＝`SetCellsChange.beforeRevision`＋`CellRecord.lastChangedRevision`＋server `validateSetCells`・E2E17）で同期の成立性は確認済み。DD-009 資産台帳は `@nanairo-sheet/collab`（ClientSession 楽観適用/rollback/replay・Conflict Queue）と `@nanairo-sheet/server`（全順序シーケンサー・権威Room）を **Harden** 指定・担当DD-013 とした。
- **現存コード**: `packages/collab/src/session.ts`（operationId・clientSequence・conflictQueue）／`packages/server/src/{sequencer,room}.ts`／`packages/collab/src/inprocess-transport.ts`（InProcessHub＝duplicate/drop/delay fault 注入・seed付き）／`apps/collaboration-server`（実WS）／`apps/playground` 統合ページ（commit-bridge・ime-editing-session）。DD-010 で CellStore は RowId キー移行済（CG-2 解除）。
- **不足（本DDで埋める）**: ①`tests/invariants/collab` が最小 replay ケースのみで randomized 3+クライアント収束・OCC・idempotency・draft保持の常設検証がない ②roadmap §4 契約の「2実ブラウザーで相互反映」の headed 証跡が製品品質の AC として未取得 ③duplicate 受理・reject 応答の契約がテストで固定されていない箇所の精査が必要。
- 物理抽出・Facade 配線・baseline 縮退は DD-016 委譲（DD-012 と同方針＝縦切りDDで boundary baseline を肥大させない。統合ページは現位置のまま）。

## スコープ

- **対象**: server 全順序・受理/reject 契約の harden／cell-level beforeRevision OCC（`validateSetCells`）の製品化／duplicate operation の受理側 idempotency（同一 operationId の二重適用なし）／client 楽観適用 rollback/replay 収束／reject 後の編集中 draft 保持＋conflict の内部通知契約／IME composition 中 remote update の draft 不変（synthetic）／randomized 収束テスト（3クライアント以上・fault 注入・seed）常設化／2実ブラウザー相互反映 headed smoke。
- **対象外**: durable ACK・versioned snapshot・再読込復元（**DD-014**・CG-3）／reconnect・catch-up・pending 再送・fault injection の製品保証（**DD-015**・CG-5。`packages/collab` の既存 reconnect/catchup テストは回帰維持のみ）／Facade 公開API確定・物理抽出・独立consumer pack 実証（**DD-016**）／Presence（DD-019）／Clipboard・行操作の製品保証（DD-020/021）・数式・Undo。

## 検討内容

- **OCC 粒度**: DD-005 #3 で cell-level 確定済み（セル単位 beforeRevision 照合）。本DDは方式変更せず契約をテストで固定・欠陥経路（照合漏れ・黙殺 accept）を潰す。
- **要確認: ① InsertRows/DeleteRows の同期扱い** — protocol 上は既存（PoC実証済み）だが、行操作の製品保証は DD-021（Stage 2）。本DDでは「既存テストの回帰維持＋randomized ログに含めるが、行操作特有の競合仕様（IME×行削除等）は保証外」と明記する案。可否の確認要。
- **要確認: ② reject/conflict の利用者通知の深さ** — 本DDは内部イベント契約（conflictQueue・通知コールバック）と playground 統合ページでの可視確認まで。公開APIとしての整形（error notification・connection state）は DD-016 の consumer lifecycle 契約へ委譲する案。可否の確認要。
- **要確認: ③ AC「2実ブラウザーconsumer」の解釈** — 独立consumer（pack済み成果物）実証は DD-016 のため、本DDでは `apps/playground` 統合ページを **2つの実ブラウザー（Chrome＋Edge 推奨・最低でも独立プロファイル2枚）** で開く headed smoke を「2実ブラウザーconsumer」の充足と読み替える案。可否の確認要。
- **要確認: ④ randomized 常設スイートの規模** — 既定案: 3〜5クライアント×500 op 以上×複数 seed（CI 時間を抑える。DD-003 の 10,000 op 級はワンショット証跡として `doc/DD/DD-013/` に保存し常設化しない）。可否の確認要。

## 決定事項

（Human Spec Gate＝要確認①〜④の確定後に記入）

- 方針（起票時）: 新規設計ではなく **DD-003/005 実証済み資産の Harden**。protocol の設計転換が必要になったら停止してユーザー提示（External Review 再判定）。

## 受け入れ基準

> roadmap §4「共同編集同期DD 完了条件」（レビュー §4.3/4.4/7.1-4 反映）を全項目カバーする。

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | 2実ブラウザーで A のセル確定が B に反映され、逆方向も反映される（相互反映） | Phase 4 headed smoke（Manual Gate）＋証跡 `doc/DD/DD-013/` |
| 2 | randomized test（3クライアント以上・duplicate/drop/delay 注入・seed 記録）→ 全クライアントが収束 | Phase 3 `npm run test:invariants`（`tests/invariants/collab`）＋seed/再現コマンド格納 |
| 3 | server 確定順の replay hash と各 client 最終 hash が一致する | Phase 3 randomized＋収束hash生ログ `doc/DD/DD-013/` |
| 4 | duplicate operation（再送・重複配信）を流しても二重適用なし＝同一 operationId は server 受理1回・client 適用1回 | Phase 1/2 単体テスト＋Phase 3 duplicate 注入 randomized |
| 5 | beforeRevision 不一致の SetCells を server が reject し文書へ適用しない（サイレント上書き 0） | Phase 1 OCC テスト（`validateSetCells` 系） |
| 6 | reject 発生後も編集中 draft が保持され（rollback で利用者入力を失わない）、conflict が通知される | Phase 2 テスト＋Phase 4 smoke で可視確認 |
| 7 | IME composition 中に remote update を受けても draft（textarea.value/selection）が不変 | Phase 2 不変条件テスト（synthetic・`tests/invariants/ime` 接続） |
| 8 | §2.3 共同編集不変条件の本DD担当行（全順序hash一致／rollback/replay収束／OCC非上書き／reject入力保持／idempotency／RowId・ColumnId安定）が最小ケース→実ケースへ拡充され green | Phase 3 `npm run test:invariants` green |
| 9 | 回帰なし: `npm run test`／`typecheck`／`lint`（boundary 新規違反0）／`build` green | Phase 4 🔬 一括機械検証 |

## タスク一覧

### Phase 0: 事前精査・テスト設計（Red）
- [ ] 📋 **各Phaseのタスク精査・詳細化**（AC↔検証対応・対象ファイルパス・🔬タスクの有無を確認）
- [ ] 現行 protocol の受理/reject/duplicate 経路を精査: `packages/server/src/{sequencer,room}.ts`・`packages/collab/src/session.ts`・`apps/collaboration-server/src/server.ts`（duplicate 受理と reject 応答の既存契約・欠陥経路を列挙し、**実質変更の有無で Codex effort xhigh/high を確定**）
- [ ] 🧪 **テスト設計（Red）**: 収束・OCC・idempotency・draft保持・IME×remote の境界値/エッジケースを自然言語シナリオ化 → `doc/DD/DD-013/scenarios.md` → 👀 ユーザー合意後にテストコード化
- [ ] 📐 **実装前詳細化トリガー判定**: Phase 1・2 → **詳細化要**（3ファイル以上・並行処理・既存状態遷移の変更に該当）／Phase 3・4 → 不要
- [ ] 🧑‍⚖️ **Codexレビュー要否判定**: `Phase 3 → 必須・effort: xhigh（並行処理・外部I/F・複雑な状態遷移の複合。挙動保存に留まれば high へ下げ理由をログへ）`。Codex 利用可確認済（2026-07-13 `--check` exit 0）
- [ ] 😈 **Devil's Advocate調査**（synthetic randomized が実WS の順序保証と乖離しないか／「収束するが利用者入力を失う」経路の見落とし／DD-014/015 との境界崩れ）

### Phase 1: server 受理・全順序・OCC harden（Red→Green→Refactor）
- [ ] 📐 **実装前詳細化**（触る関数・reject応答契約・データフロー・エッジケース → 👀 ユーザーレビュー後にコーディング）
- [ ] `packages/server/src/{sequencer,room}.ts`: 合意済みシナリオのテスト作成（Red）→ `validateSetCells` の照合網羅（黙殺acceptなし）・duplicate operationId の受理側拒否・reject 応答契約を harden（Green→Refactor）
- [ ] 🔬 **機械検証**: `npm run test -w @nanairo-sheet/server` green（OCC reject・duplicate 二重適用0 のテスト名を明記）
- [ ] 😈 **DA批判レビュー**（「このPhaseで何が壊れるか」: 既存 E2E17・collab セッションテストの回帰。基準: da-method.md §3.4）

### Phase 2: client 収束・draft 保護（Red→Green→Refactor）
- [ ] 📐 **実装前詳細化**（同上・👀 ユーザーレビュー）
- [ ] `packages/collab/src/session.ts`: reject 受信時の rollback/replay 後 draft 保持・conflict 通知の内部契約・remote update の楽観適用整合をテスト固定（Red→Green→Refactor）
- [ ] `apps/playground/src/integration/`（commit-bridge・ime-editing-session）: IME composition 中 remote update の draft 不変を synthetic 不変条件へ追加（現位置のまま・抽出しない）
- [ ] 🔬 **機械検証**: `npm run test -w @nanairo-sheet/collab` green＋`npm run test:invariants`（ime）green
- [ ] 😈 **DA批判レビュー**（rollback 中の描画・selection 破壊／conflict 通知の取りこぼし）

### Phase 3: randomized 収束スイート常設化＋Codexレビュー
- [ ] `tests/invariants/collab/`: randomized 収束テスト実装（3〜5クライアント×InProcessHub fault注入〔duplicate/drop/delay〕×seed 記録・server確定順 replay hash と全 client hash 比較・§2.3 担当行の実充足）
- [ ] 収束hash生ログ・seed・再現コマンドを `doc/DD/DD-013/` へ格納（Evidence full）
- [ ] 🔬 **機械検証**: `npm run test:invariants` green（randomized 含む・失敗時 seed 再現手順つき）
- [ ] Codexレビュー自動実行（依頼書 `doc/DD/DD-013/codex-review-request.md` 生成 → `bash scripts/codex-review.sh --request ... --out doc/DD/DD-013/codex-review-result.md`・effort は Phase 0 確定値）
- [ ] Codexレビュー指摘への対応、または見送り理由をログに記録
- [ ] 😈 **DA批判レビュー**（randomized が「通るように書いたテスト」化していないか＝欠陥を注入して落ちることを確認）

### Phase 4: 2実ブラウザー headed smoke・完了確認（Manual Gate）
- [ ] `bash scripts/dev-start.sh --integration` で起動し、2実ブラウザー（要確認③の確定構成）で相互反映・reject時 draft 保持/conflict 可視を確認・📸 証跡を `doc/DD/DD-013/` へ（DD-005 手法踏襲）
- [ ] 🔬 **機械検証**: `npm run test`・`typecheck`・`lint`（boundary 新規違反0）・`build`・`test:invariants` 一括 green（AC9）
- [ ] 密度計測を記録（人間確認時間・Codex effort/回数・ゲート待ち・findings数・manual gate 実施内容 → ログへ。roadmap §2.4）
- [ ] 😈 **DA批判レビュー**（Evidence full 監査: seed・再現コマンド・event trace・実施ブラウザー/バージョンが証跡に欠けていないか）

## ログ

### 2026-07-13
- DD作成（roadmap §4 DD-013 定義・§5 Alpha必須ライン・DD-009 資産台帳〔collab/server=Harden・担当DD-013〕・DD-011 不変条件スイート最小設置を前提に起票。dd-drafter）
- Codex 利用可否: **利用可**（`bash scripts/codex-review.sh --check` exit 0・codex-cli 0.144.0-alpha.4）
- 前提状態: CG-1 解除済（DD-012-1）・CG-2 解除済（DD-010）・CG-6 指標pass（DD-012-2・精密確定は DD-016）。本DDの担当CGなし。
- **要確認①〜④を提示**（①InsertRows/DeleteRows の扱い ②reject/conflict 通知の深さ ③「2実ブラウザーconsumer」の解釈 ④randomized 常設規模）。Human Spec Gate: required＝確定後に Phase 1 開始。

---

## DA批判レビュー記録

### Phase N DA批判レビュー

**DA観点:** （このPhaseで最も壊れやすいポイントは何か？）

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | (具体的に記述) | 高/中/低 | (高/中: 操作→結果) | (どのDA観点で発見したか) | ✅修正済/⏭️別DD/❌不要 |
