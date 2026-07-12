# ADR-0008: 楽観適用＋rollback/replay

- **Status**: Proposed（Go/No-Go 確定は Phase 0 ロードマップ⑥）
- **関連**: 計画書 §7.7（クライアント適用の 6 手順）・§10（競合解決）・§18.6（No-Go 条件）／DD-003（PoC-C 共同編集 Operation）／ADR-0005（サーバー主導型全順序 Operation ログ）

## 背景・課題

サーバー確定（RTT 分）を待ってからローカルへ反映すると、日本語 IME・高速入力の体感が著しく劣化する。ローカル入力を**即時に楽観適用**しつつ、サーバー確定 Operation の到着時に整合させて収束させたい。ただし「rollback/replay が入力遅延を恒常的に発生させる」ことは Phase 0 の No-Go 条件（§18.6）。

## 選択肢

| 選択肢 | 概要 | 長所 | 短所 |
|--------|------|------|------|
| **(A) 楽観適用＋rollback/replay** | committed（サーバー確定・権威）と pending（未 ACK のローカル）の二層。server op 到着で pending を逆順 rollback → server op を committed へ適用 → 残 pending を再検証・再適用（§7.7 の 6 手順） | 入力即時反映（遅延 0）／サーバー主導順序と両立し収束保証 | pending 逆操作・再検証の実装が複雑／競合時に楽観適用が覆る |
| (B) 悲観（サーバー確定待ち） | ローカルは確定後に反映 | 実装単純・楽観の巻き戻し無し | 入力遅延が RTT 分＝IME/高速入力の UX 劣化（本製品の最優先要件に反する） |
| (C) 楽観適用のみ（rollback なし） | ローカル即時反映のみ | 実装単純・即時 | 競合時に発散、収束保証なし |

## 決定

**(A) 楽観適用＋rollback/replay**を採用する（Status: Proposed）。

- クライアント（`ClientSession`）は committed / pending の二層と Conflict Queue を持ち、server op 到着で §7.7 の 6 手順（pending 逆順 rollback → server op 適用 → own 除去 → 残 pending 再検証 → 再適用 → 不成立は Conflict Queue）を実行する。
- 再検証は**サーバーと同一の共有 `validateOperation`**（core）で行い、判定乖離を構造的に防ぐ。
- 前提条件（No-Go 判定材料）: rollback/replay が**入力遅延を恒常的に発生させない**こと。

Go/No-Go の確定は Phase 0 ロードマップ⑥。

## 結果（本 PoC の計測・観察）

DD-003（PoC-C）で `apps/collaboration-server/src/client-session/`（依存ゼロ・トランスポート注入）に実装し、in-process フォールト注入試験と実 WS 試験で検証した。

- **入力あたりの rollback/replay コストは有界**: 収束試験で **最大 pending 深度 = 4〜8**（3〜10 クライアント × 10,000 件）。pending が肥大しない設計（committed を毎回前進させ pending を回収）で、rollback（`applyInverseSeed` 逆順）と再検証（`rebuildView`）は O(pending) に留まる。
- **恒常的遅延の兆候なし**: ops/sec ≈ 5,000〜16,000（in-process）を維持し、rollback/replay が入力遅延を恒常化させる観察はなかった（No-Go 条件の判断材料）。総 rollback/replay 量の代理値（各クライアントの適用 revision 数の総和）は 3 体で ≈ 28,000、10 体で ≈ 91,000。
- **競合時の入力保全（AC4・消失0）**: stale（beforeRevision 不一致）・削除行 SetCells は敗者の入力を Conflict Queue にコピー可能な形で保持（サーバー reject 経由と、echo 先着時のクライアント再検証経由の両経路で保全）。3 体 10,000 件で reject 147・conflict 617。
- **D22（InverseSeed の before-revision 欠如）**: `InverseSeed` は cell の before-**value** のみ保持し before-**revision** を持たないため、既存セル上書きの rollback は `lastChangedRevision` を厳密復元できない。よって **committed を権威として別管理**し（server op を committed へ直接適用・rollback から導出しない）収束を担保。`rollbackBaselineHash()==committedHash` は行構造・空セル前値では厳密、既存セル上書きは非厳密であることをテストで実証。
- **D26（tail 欠落）**: 受信済み revision より先を 1 件も受け取れない静止系で gap 検知が起きない場合、**周期 catch-up ポーリング**（`requestCatchup{afterRevision: expectedRevision-1}`）が差分を取り戻し収束（既存プロトコルのみで回復）。
- **D27（境界・未実装）**: `submitOperation` 欠落起点の `client-sequence-violation` の**完全な clientSequence 再整列**は未実装の境界。violation 受信 → 全 pending 同期再送 は out-of-order 再送下で指数的に増幅し得る（Phase 5 収束試験で実測・確認）。本 PoC の収束試験は**フォールトを server→client 経路（operations/operationAck の欠落/重複/遅延）と切断/再接続に限定**し、catch-up・冪等・reorder で回復する経路を検証する（submitOperation drop 起点の seq 再整列は後続の課題）。

## 再検討条件

- rollback/replay コストが O(pending) で、**大規模 pending**（長時間オフライン・大量未確定入力）時に UI 遅延を生む → 構造共有・差分 rollback・pending 上限の再設計。
- `InverseSeed` の before-revision 欠如が、収束以外の要件（厳密な Undo/Redo・監査再現）を破る → InverseSeed の拡張（revision 込み）。
- **D27 の seq 再整列**が実 WS で問題化する（TCP は順序保証だが、切断跨ぎの再送で seq gap が残るケース）→ violation 時の決定論的再整列（受信 seq に基づく先頭再送のべき等抑制）を本実装する。
