# DD-007 Phase 3: Phase 1 正式バックログ（採択記録）

> DD-007 Phase 0 判定＝**条件付きGo**（2026-07-12・`DD-007_Phase0GoNoGo判定.md` 決定事項）を受けて Phase 1 正式バックログを確定する。
> **本ファイルは薄い採択記録**である。縦切りDD一覧・密度レジーム・Stage 1 移行条件・§19境界整合の実体は **`doc/plan/phase1-dd-roadmap.md` を正本**とし、ここでは重複させない。本ファイルの役割は 4 点＝ (1) 採択の宣言 (2) 条件付きGo条件 CG-1〜6 のロードマップDDへの対応づけ (3) SDK Alpha完了条件の適用先 (4) テンプレート反映方針。

## 1. 採択

- **Phase 1 正式バックログ = `doc/plan/phase1-dd-roadmap.md`**（Stage 1 社内SDK Alpha までの縦切り計画）を採択する。**2026-07-12 ユーザー承認**（この路線で確定）。
- **確定範囲**: DD-007 要確認2 の回答どおり「**最初のDD＋候補リスト**」まで。全順序は進行中に見直す（候補DD番号 DD-009〜018 は暫定）。
- **最初の縦切り**（`phase0-dd-roadmap.md` ユーザー確定「日本語でセルを連続入力し、確定値が共同編集で保存される」）は、単体DDへの過積載（DD-005化）を避けるため **DD-010（単一利用者入力）→ DD-011（共同編集保存）→ DD-011P（永続化）→ DD-012（SDK組み込み）** の連結で達成する（roadmap §1.4）。
- ⚠️ **未了の前提**: `phase1-dd-roadmap.md` は**草案**で、**ChatGPTレビューがこれから**（Codexレビューは反映済み）。**正式ロック（草案→確定）はそのレビュー反映後**とする。本採択は「路線の確定」であり、レビューでロードマップの分割・順序が変わりうる。

## 2. 条件付きGo 条件（CG-1〜6）→ ロードマップDD 対応

> 7項目（条件・対象範囲・解除条件・期限・確認方法・未解除時の扱い・ブロックDD）の正は `DD-007_Phase0GoNoGo判定.md` 決定事項。ここでは解除を担うDDを示す。

| 条件 | 内容 | 主担当DD（roadmap） |
|---|---|---|
| CG-1 | 実機IME検証（順序A/B・先頭欠落・新 `integration-editor` アダプタ×実IME） | **DD-010**（IME・Risk Class A・Manual Gate 実機必須）＋常設 IME不変条件スイート（DD-009 §2.3） |
| CG-2 | CellStore index→RowId キー移行 | **DD-009**（PoC去就＝CellStore Harden）＋ DD-016（行操作で RowId 追従を実証） |
| CG-3 | snapshot 正式形式（replay O(N²) 対策） | **DD-011P**（最小永続化 snapshot+log）＋ DD-015（snapshotベース初期化） |
| CG-4 | 対応ブラウザー Tier 1（Win Chrome/Edge） | 全縦切りDD共通の対象範囲。DD-018 移行判定で Tier 確認 |
| CG-5 | client→server 収束境界（D27/D34） | **DD-015**（reconnect・catch-up・idempotency＝DD-005 既知制約の回収）＋常設 共同編集不変条件スイート |
| CG-6 | 精密ブラウザーメモリ計測 | DD-009（性能回帰予算の設置）／データ表現に触れるDDのフル再計測トリガー（roadmap §2.3） |

> 条件付きGoの**対象範囲・SLO反映**（Tier 1限定・500k基準等）は roadmap §0 が「条件付きGoの条件を対象範囲・SLO・受け入れ基準へ反映する」と明記。各DD起票時に7項目の②〜⑦（期限・確認方法・ブロックDD）を最終化する。

## 3. SDK Alpha 完了条件の適用先

- `DD-007/phase1-sdk-alpha-conditions.md` §2 の9条件・§3 consumer fixture 要件は、最初の縦切りの公開面を担う **DD-012** の正式な完了条件へ昇格する（roadmap DD-012・S1-2/3/4/5/6）。
- 機能を担う DD-010/011/011P は各 Stage 1 条件（S1-1/S1-3）を前進させ、SDK 公開境界は DD-012 で確定する。
- 技術Go と Phase 1開始前提条件の分離は `phase1-sdk-alpha-conditions.md` §4（記入済み）を正とする。

## 4. テンプレート反映方針（要確認3＝方針のみ本DD・実ファイルは別DD）

- Phase 1用DD差分テンプレートへ **Risk Class ヘッダ（roadmap §2.1）＋製品化6観点の高速チェック**を反映する方針とする。
- **実ファイル改修は別DD**（dd-update 管理系との整合確認が必要・DD-007 要確認3 の回答）。roadmap では **DD-009 タスク5** がこの反映を担う（実施可否は要確認3方針に従う）。

## 5. 残タスク（Phase 3 の締め）

- [ ] `phase1-dd-roadmap.md` の **ChatGPTレビュー**（これから）→ 反映 → 草案から正式版へ昇格。**レビューパック `phase1-roadmap-review-20260712/` 準備完了**（並行セッション作成→本セッションが条件付きGo・CG-1〜6 反映で最新化）。ChatGPTに 01_プロンプト を貼り、02〜06 を添付して実行。
- [ ] レビュー反映後、本採択記録と roadmap のDD番号・順序の最終整合を確認。
- [x] `phase0-dd-roadmap.md`「Phase 1以降」節へ本バックログ／roadmap への参照を追記（本DDで実施）。
