# DD-013 テスト設計（Phase 0・自然言語シナリオ）

> ユーザー確定事項（2026-07-13・要確認①〜④＝既定案承認）を反映。TDD。
> 本DDは **DD-003/005 実証済み資産の Harden**。protocol/OCC の挙動は変えず、§2.3 共同編集不変条件を
> `tests/invariants/collab` へ **randomized 収束スイートとして実充足**する。

## Phase 0 精査結論（受理/reject/duplicate 経路）

現行コードの精査結果（`packages/server/src/{sequencer,room}.ts`・`packages/collab/src/session.ts`・
`apps/collaboration-server/src/server.ts`）:

| 経路 | 現行実装 | 既存テストで固定済みか | 本DDの扱い |
|------|---------|---------------------|-----------|
| operationId 冪等（duplicate 受理側拒否） | `Sequencer.submit` step1: ackCache ヒットで `duplicate`・二重適用なし | ✅ sequencer.test S-F2 / S-E3 | randomized で duplicate 注入・二重適用0 を再確認 |
| clientSequence 検査（欠番 reject・advance しない） | step2: `client-sequence-violation`・seq スロット消費 | ✅ S-F3/F4/F5 | 回帰維持 |
| baseRevision 検査 | step3: `invalid-base-revision` | ✅ S-F6 / room.test | 回帰維持 |
| cell-level OCC（beforeRevision 照合・黙殺 accept なし） | step4: `validateOperation`（core 共有）→ 1件でも stale なら全体 reject・部分適用なし | ✅ S-C2/C3・S-G1/G4 | randomized で「サイレント上書き0」を不変条件化 |
| no-op（全件 tombstone DeleteRows） | step5: revision 非消費・ackCache 登録・clientSequence 前進 | ✅ S-E3/E4 | 回帰維持 |
| reject 応答契約（送信元のみ・broadcast しない） | `Room.handleSubmit`: reject は `connection` 宛て | ✅ room.test | 回帰維持 |
| client rollback/replay 収束 | `session.reconcileServerOperation`→`rebuildView` | ✅ session.test S-H1〜H5 | randomized で全 client hash 一致 |
| reject 後 draft 保持（Conflict Queue） | `handleRejected`→`makeConflictEntry`（深いコピー） | ✅ session.test S-G2/G3 | randomized で reject 済み値が committed に載らないことを不変条件化 |
| IME composition 中 remote update draft 不変 | editor-state-machine（MarkConflict のみ） | ✅ tests/invariants/ime 1/5 | 既充足を参照（現位置のまま） |

**判定: 実質的な protocol/OCC の挙動変更は不要（挙動保存の harden＋テスト実充足に留まる）。**
→ Codex effort を **xhigh → high** へ下げる（DD Codex 欄の条件に合致・ログへ記録）。

## randomized 収束スイート設計（`tests/invariants/collab`・AC2/3/4/5/6/8）

要確認④確定: **3〜5 クライアント × 500 op 以上 × 複数 seed**。DD-003 の 10,000op 級は
`apps/collaboration-server/test/convergence.test.ts` にワンショット証跡として残す（常設化しない・二重維持しない）。

- **構成**: `Room`＋`Sequencer`＋`ClientSession`×N を `InProcessHub` で結線（既存 `convergence.test.ts` と同じ本番配線）。
- **フォールト**: duplicate / drop / delay を注入（seed 付き mulberry32）。**disconnect/reconnect は注入しない**
  （reconnect 製品保証は DD-015 スコープ・本DDは「同期」のみ）。server→client（operations/operationAck）へ注入。
- **op 生成**: SetCells 中心＋InsertRows/DeleteRows 混合（要確認①: 行操作は回帰維持＋randomized に含めるが
  行操作特有の競合仕様は保証外）。pending 0 の client が hot cell を beforeRevision 付きで編集 → OCC reject を誘発。
- **静止点**: 全送信後にフォールト無効化 → 有限 tick で全 client committed hash == server hash。

### 検証する §2.3 不変条件（本DD担当行）

| ID | 不変条件 | assert |
|----|---------|--------|
| INV-1 | 全順序 → client 最終 hash 一致 | 全 client `committedHash()` == server `documentHash`・snapshot replay hash とも一致 |
| INV-2 | rollback/replay 収束 | 全 client `pendingCount==0`・`nextExpectedRevision==serverRev+1`・構造 deep-equal |
| INV-3 | beforeRevision 不一致でサイレント上書きなし | reject された setCells（beforeRevision 付き）の値が committed セルに載っていない・reject≥1 |
| INV-4 | reject 時に利用者入力を保持 | conflictQueue 各エントリが元 operation を保持（深いコピー・値消失0） |
| INV-5 | idempotency（二重適用0） | server ログ operationId 重複なし・revision 連番 1..N・duplicate 注入発火>0 |
| INV-6 | RowId・ColumnId 安定 | 構造 deep-equal（rowOrder/rowMeta/セル）が全 client==server で一致（hash 独立の導出） |
| meta | フォールト実発火・非自明 | duplicate/drop/delay カウンター>0・非空セル>0・reject≥1（「通るように書いた」化の否定・DA） |

### 欠陥注入による感度確認（DA: テストが本当に落ちるか）

- server 側で beforeRevision 照合を無効化（黙殺 accept）した場合 → INV-1/INV-3 が落ちること（サイレント上書き検知）。
- client rebuildView で own 除去を止めた場合 → INV-2/INV-5 が落ちること（二重適用検知）。
  ※恒久コードは変えず、レビュー時の思考実験＋（必要なら）一時パッチで確認しログに記録する。

## Phase 4（2実ブラウザー headed smoke）— 要確認③確定

独立 consumer pack 実証は DD-016。本DDは `apps/playground` 統合ページ（poc-integration.html）を
**Chrome＋Edge の2実ブラウザー**で開く headed smoke を「2実ブラウザーconsumer」の充足と読み替える。
実装コード側の準備（2クライアント相互反映が動く構成・起動手順）まで本DDで行い、実 smoke は headed 確認待ちで戻す。
起動手順は `doc/DD/DD-013/phase4-2browser-smoke.md`。
</content>
</invoke>
