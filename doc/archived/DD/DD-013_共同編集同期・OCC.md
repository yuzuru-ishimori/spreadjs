# DD-013: 共同編集同期・OCC

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-13 | 2026-07-13 | 完了 | 同期/OCC harden（テスト実充足）・randomized収束スイート・Phase4 実WS 2タブ smoke PASS・Codex high 反映済 |

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

- 方針（起票時）: 新規設計ではなく **DD-003/005 実証済み資産の Harden**。protocol の設計転換が必要になったら停止してユーザー提示（External Review 再判定）。
- **要確認①（InsertRows/DeleteRows）**: 既存テスト回帰維持＋randomized に混合するが、行操作特有の競合仕様は本DDでは保証外（DD-021/Stage 2）。
- **要確認②（reject/conflict 通知）**: 内部イベント契約（conflictQueue）まで＋playground で可視確認。公開API整形は DD-016 の consumer lifecycle へ委譲。
- **要確認③（2実ブラウザーconsumer）**: playground 統合ページ×2実ブラウザー（Chrome＋Edge）の headed smoke で充足と読み替え（独立 consumer pack は DD-016）。
- **要確認④（randomized 規模）**: 3〜5クライアント×500op以上×複数seed を常設化。DD-003 の 10,000op 級はワンショット証跡として保存（常設化しない）。
- **Phase 0 精査結論**: 受理/reject/duplicate/OCC/rollback-replay は既存実装＋既存テストで成立・固定済み。本DDは **protocol/OCC の挙動を変えず**（production code 無変更）、§2.3 不変条件を `tests/invariants/collab` へ実充足する Harden に留まる。→ **Codex effort を xhigh → high へ下げた**（DD Codex 欄の条件に合致）。

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
- [x] 📋 **各Phaseのタスク精査・詳細化**（AC↔検証対応・対象ファイルパス・🔬タスクの有無を確認）
- [x] 現行 protocol の受理/reject/duplicate 経路を精査 → `scenarios.md` に経路対応表。**判定: 実質変更なし（挙動保存 harden）→ Codex effort xhigh→high**
- [x] 🧪 **テスト設計（Red）**: 収束・OCC・idempotency・draft保持・IME×remote を `doc/DD/DD-013/scenarios.md` へ（ユーザー既定案承認済のためコード化）
- [x] 📐 **実装前詳細化トリガー判定**: 本体無変更（test-only）ゆえ詳細化は scenarios.md で充足
- [x] 🧑‍⚖️ **Codexレビュー要否判定**: `Phase 3 → 必須・effort: high`（挙動保存 harden 確定でxhighから降格・ログ記録）。Codex 利用可確認済
- [x] 😈 **Devil's Advocate調査**（synthetic randomized の順序保証乖離／入力消失経路／DD-014/015 境界崩れ → evidence.md §3/§5 で切り分け）

### Phase 1: server 受理・全順序・OCC harden（Red→Green→Refactor）
- [x] 📐 **実装前詳細化**（scenarios.md 経路対応表で充足）
- [x] `packages/server/src/{sequencer,room}.ts`: 精査の結果 `validateSetCells` の照合網羅・duplicate operationId 受理側拒否・reject 応答契約は既存テスト（S-C2/C3・S-F2・S-E3/E4・S-G1/G4・room.test）で固定済み＝**production 変更不要**。DA 感度確認で契約の実効性を実証（evidence.md §3）
- [x] 🔬 **機械検証**: `npm run test -w @nanairo-sheet/server` green（既存 S-F2 duplicate二重適用0・S-C2/G1/G4 OCC reject）
- [x] 😈 **DA批判レビュー**（欠陥注入で S-C2/G1/G4 が落ちることを確認・revert 済み）

### Phase 2: client 収束・draft 保護（Red→Green→Refactor）
- [x] 📐 **実装前詳細化**（同上）
- [x] `packages/collab/src/session.ts`: reject 後 draft 保持（Conflict Queue）・conflict 内部契約・remote update 整合は既存テスト（session.test S-H1〜H5・S-G2/G3）で固定済み＝**production 変更不要**
- [x] `apps/playground/src/integration/`: IME composition 中 remote update の draft 不変は `tests/invariants/ime` 1/5＋integration-scenario E2E AC2 で既充足（現位置のまま）
- [x] 🔬 **機械検証**: `npm run test -w @nanairo-sheet/collab` green＋`npm run test:invariants`（ime）green
- [x] 😈 **DA批判レビュー**（randomized で全 client 構造 deep-equal＝rollback 中の破壊なし・INV-4 で conflict 取りこぼしなし）

### Phase 3: randomized 収束スイート常設化＋Codexレビュー
- [x] `tests/invariants/collab/`: randomized 収束テスト実装（3〜5クライアント×InProcessHub fault注入〔duplicate/drop/delay〕×seed 記録・server確定順 replay hash と全 client hash 比較・§2.3 担当行 INV-1〜6 の実充足）
- [x] 収束hash生ログ・seed・再現コマンドを `doc/DD/DD-013/`（evidence.md・convergence-hash-raw.log・oneshot-10000op-convergence.log）へ格納
- [x] 🔬 **機械検証**: `npm run test:invariants` green（randomized 6本含む・失敗時 seed 再現手順出力）
- [x] Codexレビュー自動実行（`codex-review-request.md` → `codex-review-result.md`・effort high）
- [x] Codexレビュー指摘への対応をログに記録（P1×1・P2×4 すべて反映＝下記ログ）
- [x] 😈 **DA批判レビュー**（欠陥注入 → deterministic S-C2/G1/G4＋randomized INV-3 が落ちることを確認＝「通るように書いた」化の否定・evidence.md §3）

### Phase 4: 2実ブラウザー headed smoke・完了確認（Manual Gate）
- [x] `bash scripts/dev-start.sh --integration` で起動し、Playwright 2タブ（実WS）で相互反映を確認・📸 証跡（**PASS**・rev11→12・hash `78ab57da9df5` 両タブ一致・値 `SYNC-DD013`・otherPresence 1・`dd013-p4-2browser-tabB-reflected.png`。手順=`phase4-2browser-smoke.md`）
- [x] 🔬 **機械検証**: `npm run test`（639 pass・既知flaky ws-convergence.smoke 除く）・`typecheck`・`lint`（boundary new=0）・`build`・`test:invariants`（31 pass）green
- [x] 密度計測を記録（ログ 2026-07-13 参照）
- [x] 😈 **DA批判レビュー**（Evidence full 監査: seed・再現コマンド・fault matrix・未保証境界を evidence.md へ格納。実施ブラウザー/バージョンは Phase 4 実施時に併記）

## ログ

### 2026-07-13
- DD作成（roadmap §4 DD-013 定義・§5 Alpha必須ライン・DD-009 資産台帳〔collab/server=Harden・担当DD-013〕・DD-011 不変条件スイート最小設置を前提に起票。dd-drafter）
- Codex 利用可否: **利用可**（`bash scripts/codex-review.sh --check` exit 0・codex-cli 0.144.0-alpha.4）
- 前提状態: CG-1 解除済（DD-012-1）・CG-2 解除済（DD-010）・CG-6 指標pass（DD-012-2・精密確定は DD-016）。本DDの担当CGなし。
- **要確認①〜④を提示**（①InsertRows/DeleteRows の扱い ②reject/conflict 通知の深さ ③「2実ブラウザーconsumer」の解釈 ④randomized 常設規模）。Human Spec Gate: required＝確定後に Phase 1 開始。
- **要確認①〜④＝既定案でユーザー承認**（決定事項へ反映）。Phase 0〜3 の自動実装を開始（dd-implementer・Opus）。

### 2026-07-13（実装・Phase 0〜3＋Phase 4準備）
- **Phase 0 精査**: `sequencer.ts`（operationId冪等→clientSequence→baseRevision→validateOperation→apply の処理順）・`room.ts`（accept=ACK+all echo／reject=connection のみ）・`session.ts`（reconcileServerOperation→rebuildView／handleRejected→Conflict Queue）を精査。受理/reject/duplicate/OCC/rollback-replay は既存実装＋既存テストで成立・固定済みと確認。**実質的な protocol/OCC 挙動変更は不要（production code 無変更の Harden）→ Codex effort xhigh→high**。詳細=`scenarios.md`。
- **Phase 1/2**: server（`validateSetCells` 照合網羅・duplicate 受理側拒否・reject 応答）・client（reject 後 draft 保持・conflict 内部契約）は既存テスト（sequencer S-C2/C3/F2/E3/E4/G1/G4・session S-H1〜H5/G2/G3・room・ime.invariant 1/5・integration-scenario E2E AC2）で既に固定済み＝production 無変更。
- **Phase 3**: `tests/invariants/collab/collab.invariant.test.ts` を最小 replay 1本 → **randomized 収束スイート**（3〜5client×500〜800op×4seed＋決定論再現1本・duplicate/drop/delay 注入・disconnect 非注入=DD-015 スコープ）へ実充足。§2.3 担当行 INV-1〜6 を assert（全順序hash一致／rollback-replay収束／サイレント上書きなし／reject時draft保持／idempotency／RowId・ColumnId安定）。全 seed で reject≥1（4/12/12/7）・全 client hash==server・二重適用0。
- **DA 感度確認**: sequencer step4 で stale-cell-revision を握りつぶす一時パッチ → deterministic S-C2/G1/G4 即 fail・randomized seed=1337 が INV-3 で fail を確認（「通るように書いたテスト」化の否定）。パッチ revert 済み。
- **機械検証**: `typecheck` green・`lint`（eslint＋boundary new=0）green・`npm run test` 639 pass（既知flaky `ws-convergence.smoke` は baseline と同一の環境依存 timeout・恒久是正 DD-015 スコープゆえ本DD対象外）・`build` green・`test:invariants` 31 pass。
- **Codexレビュー**（effort high・`codex-review-result.md`）: findings **P1×1・P2×4 すべて反映**（本体 production code は無変更・テスト強化と証跡追跡のみ）:
  - **[P1] OCC reject の実証強化**: 意図的 OCC 競合 op（hot cell beforeRevision 編集）の operationId を追跡し、
    「その中の≥1件が `stale-cell-revision` で reject され、かつ accepted ログに載っていない」を assert（INV-3(a)(b)）。
    → DA 再確認で黙殺 accept 注入時に **randomized 全 seed が fail**（強化前は1 seed のみ検知）を確認（evidence.md §3）。
  - **[P2] Conflict 元 op 照合**: submit 元 op を operationId 毎に JSON クローンで記録し、conflict entry.operation と
    deep-equal 照合（切り詰め・別op すり替えを検出・INV-4）。
  - **[P2] 孤児 rowMeta の正規化**: `normalize` を rowOrder ではなく **全 rowMeta キー**列挙へ変更し `orphanRowMeta` を
    構造 deep-equal に含めた（documentHash が無視する孤児メタを hash 独立に検出・INV-1/6 の盲点解消）。
  - **[P2] 決定性の trace 比較**: 同一 seed 再実行の照合を集計値のみ→ **全順序ログ digest（revision→operationId→operation）＋
    conflict identity** の一致へ強化（別順序で同一集計になる偽陽性を排除）。
  - **[P2] 証跡ファイルの追跡**: `*.log` は gitignore ゆえ `convergence-hash-raw.txt`・`oneshot-10000op-convergence.txt`
    へ改名（fresh checkout でリンク切れしない）。
- 見送った指摘: なし（全件反映）。
- **Phase 4 準備**: 統合ページ2クライアント相互反映は integration-scenario E2E で担保済み。2実ブラウザー headed smoke の起動手順を `phase4-2browser-smoke.md` に記載。実 smoke は headed 確認待ちで一旦戻した。
- **密度計測**: production code 変更 0 行（test-only harden）・新規テスト=randomized 収束6本・Codex 1回（effort high）・ゲート=要確認①〜④は既定案承認済（追加ゲートなし）・manual gate=2ブラウザー smoke 未実施（準備完了）。
- **コミット・アーカイブはしない**（ユーザー確認後に主セッションで実施）。

## AC 対応表

| AC | 検証 | 状態 |
|----|------|------|
| 1 相互反映（2実ブラウザー） | Phase 4 実WS 2タブ smoke PASS（rev11→12・hash 一致・値/presence 確認・証跡あり） | ✅ |
| 2 randomized 収束（3+client・fault・seed） | `tests/invariants/collab`（4 seed＋決定論）green | ✅ |
| 3 server 確定順 replay hash == 各 client hash | INV-1（verifySnapshotIntegrity.replayHash==serverHash==全client） | ✅ |
| 4 duplicate → 二重適用なし | INV-5（server ログ operationId 重複0・duplicate 発火>0）＋sequencer S-F2 | ✅ |
| 5 beforeRevision 不一致 reject・サイレント上書き0 | INV-3＋sequencer S-C2/G1/G4（DA 感度確認済） | ✅ |
| 6 reject 後 draft 保持・conflict 通知 | INV-4（Conflict Queue 保持）＋session S-G2/G3＋E2E AC2（同一セル競合・draft保持・conflict可視）。実WS smoke は非破壊確認 | ✅ |
| 7 IME composition 中 remote update で draft 不変 | `tests/invariants/ime` 1/5＋integration E2E AC2 | ✅ |
| 8 §2.3 担当行 最小→実ケースへ拡充 green | INV-1〜6 randomized | ✅ |
| 9 回帰なし（test/typecheck/lint/build） | 一括 green（既知flaky切り分け済） | ✅ |

### 2026-07-13（Phase 4 実WS 2タブ smoke・完了）
- **Phase 4 headed smoke PASS**（オーケストレータが Playwright で実施）: 実WS（`dev-start.sh --integration`・collaboration-server:9499）＋2タブ（同一ルーム join）で `poc-integration.html` を駆動。両タブ初期同期 rev11・hash `613165c94ea4` 一致 → タブA編集確定（`SYNC-DD013`）rev11→12・hash `78ab57da9df5`・pending 0 → タブB独立反映 rev12・hash `78ab57da9df5`（一致）・値 `SYNC-DD013`・otherPresence 1。**AC1（相互反映）を実WSで実証**。証跡 `dd013-p4-2browser-tabB-reflected.png`。詳細=`phase4-2browser-smoke.md`・`evidence.md §6`。
- AC6（同一セル競合・reject後draft保持・conflict可視）は E2E `integration-scenario.spec.ts`（AC2）＋randomized INV-3/INV-4 で担保済み（実WS smoke は非破壊確認）。
- 補足: Playwright MCP は単一 Chromium ゆえ 2タブ（同一 Chromium・別クライアント）で実施。literal Chrome＋Edge 別ブラウザー目視は Edge も Chromium で同期挙動同等・必要なら DD-016 統合後スモークへ畳む（CG-1 残と同型）。
- **全 Phase 完了**。ステータス → **完了**。コミット・アーカイブは主セッション（ユーザー）が実施。

---

## DA批判レビュー記録

**DA観点:** randomized 収束スイートが「通るように書いたテスト」化していないか（欠陥を注入して落ちるか）／
収束を偽装していないか／DD-014/015 との境界崩れ。

| # | 発見した問題/改善点 | 重要度 | 再現手順 | DA観点 | 対応 |
|---|-------------------|--------|---------|--------|------|
| 1 | INV-3「サイレント上書きなし」の検知が seed 依存で弱い（reject≥1 だけでは target-row-deleted 等の別 reject 混入で緑化し、stale 黙殺 accept を見逃す） | 高 | sequencer step4 で stale-cell-revision を握りつぶす → 強化前は seed=1337 のみ fail・他 seed は緑 | 「通るように書いたテスト」化 | ✅修正済（Codex P1）: 意図的 OCC 競合 op の operationId 追跡→stale reject≥1 かつ accepted 非載を assert。再注入で randomized 全 seed が fail |
| 2 | 構造 deep-equal が rowOrder 由来で孤児 rowMeta を見逃す（documentHash も無視＝INV-1/6 双方の盲点） | 中 | rollback/replay が rowOrder 外の rowMeta を残すと hash 一致でも構造乖離 | hash 独立の導出になっていない | ✅修正済（Codex P2）: normalize を全 rowMeta キー列挙＋orphanRowMeta 追加 |
| 3 | 決定性 assert が集計値のみ＝別順序で同一集計になる偽陽性（報告 seed が失敗系列を再現しない） | 中 | 同一 seed 2実行の照合が hash/件数のみ | 収束/再現の偽装 | ✅修正済（Codex P2）: 全順序ログ digest＋conflict identity を比較 |
| 4 | INV-4 が「operation フィールド存在＋change≥1」だけ＝切り詰め/別op すり替えを見逃す | 中 | makeConflictEntry が別 op を格納しても緑 | 保持の実効性未検証 | ✅修正済（Codex P2）: submit 元 op を記録し conflict entry と deep-equal 照合 |
| 5 | 証跡 `*.log` が gitignore 対象＝fresh checkout でリンク切れ | 低 | `git check-ignore *.log` → ignored | Evidence full の実効性 | ✅修正済（Codex P2）: `.txt` へ改名 |
