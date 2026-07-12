# DD-007 Phase 3: Phase 1 正式バックログ（採択記録）

> DD-007 Phase 0 判定＝**条件付きGo**（2026-07-12・`DD-007_Phase0GoNoGo判定.md` 決定事項）を受けて Phase 1 正式バックログを確定する。
> **本ファイルは薄い採択記録**である。縦切りDD一覧・密度レジーム・Stage 1 移行条件・§19境界整合の実体は **`doc/plan/phase1-dd-roadmap.md` を正本**とし、ここでは重複させない。本ファイルの役割は 4 点＝ (1) 採択の宣言 (2) 条件付きGo条件 CG-1〜6 のロードマップDDへの対応づけ (3) SDK Alpha完了条件の適用先 (4) テンプレート反映方針。

## 1. 採択

- **Phase 1 正式バックログ = `doc/plan/phase1-dd-roadmap.md`**（Stage 1 社内SDK Alpha までの縦切り計画）を採択する。**2026-07-12 ユーザー承認**（この路線で確定）。
- **確定範囲**: DD-007 要確認2 の回答どおり「**最初のDD＋候補リスト**」まで。全順序は進行中に見直す（候補DD番号 DD-009〜018 は暫定）。
- **最初の縦切り**（`phase0-dd-roadmap.md` ユーザー確定「日本語でセルを連続入力し、確定値が共同編集で保存される」）は、単体DDへの過積載（DD-005化）を避けるため **DD-010（単一利用者入力）→ DD-011（共同編集保存）→ DD-011P（永続化）→ DD-012（SDK組み込み）** の連結で達成する（roadmap §1.4）。
- ✅ **正式版へ昇格済み**: `phase1-dd-roadmap.md` は **ChatGPTレビュー（要修正）反映済みで正式版**（2026-07-12）。Alpha必須ラインをユーザー全面採用（reconnect必須・Presence/Clipboard/行操作/数式を除外）・CG-1〜6ハードゲート表を本体へ・過積載DD分割・製品境界/consumer実証明記。

## 2. 条件付きGo 条件（CG-1〜6）→ ロードマップDD 対応

> 7項目（条件・対象範囲・解除条件・期限・確認方法・未解除時の扱い・ブロックDD）の正は `DD-007_Phase0GoNoGo判定.md` 決定事項。ここでは解除を担うDDを示す。

> ChatGPTレビュー反映で担当が更新（CG-2 は安定ID移行DDへ・CG-6 は単一利用者性能DDへ明確化）。正は roadmap §0 CGハードゲート表。

| 条件 | 内容 | 主担当DD（roadmap §0 正） |
|---|---|---|
| CG-1 | 実機IME検証（順序A/B・先頭欠落0） | **単一利用者IME DD＋最終consumer統合後のTier 1実機スモーク**＋IME不変条件スイート。未解除=Alpha不可 |
| CG-2 | CellStore index→RowId キー移行 | **安定ID・CellStore移行DD**（共同編集永続化DDより前・必須）。未解除=Alpha不可 |
| CG-3 | snapshot 正式形式（replay O(N²) 対策） | **永続化・snapshot復元DD**（durable ACK/versioned snapshot）。未解除=Alpha不可 |
| CG-4 | 対応ブラウザー Tier 1（Win Chrome/Edge） | 基盤判断＋全DD共通。未解除=対象外環境を明示 |
| CG-5 | client→server 収束境界（D27/D34） | **reconnect/catch-up/idempotency DD（Alpha必須）**。未解除=Alpha不可 |
| CG-6 | 精密ブラウザーメモリ計測 | **単一利用者性能DD（統合性能・メモリゲート）**。未解除=データ上限明示 or Alpha不可 |

> 条件付きGoの**対象範囲・SLO反映**（Tier 1限定・500k基準等）は roadmap §0 が「条件付きGoの条件を対象範囲・SLO・受け入れ基準へ反映する」と明記。各DD起票時に7項目の②〜⑦（期限・確認方法・ブロックDD）を最終化する。

## 3. SDK Alpha 完了条件の適用先

- `DD-007/phase1-sdk-alpha-conditions.md` §2 の9条件・§3 consumer fixture 要件は、最初の縦切りの公開面を担う **DD-012** の正式な完了条件へ昇格する（roadmap DD-012・S1-2/3/4/5/6）。
- 機能を担う DD-010/011/011P は各 Stage 1 条件（S1-1/S1-3）を前進させ、SDK 公開境界は DD-012 で確定する。
- 技術Go と Phase 1開始前提条件の分離は `phase1-sdk-alpha-conditions.md` §4（記入済み）を正とする。

## 4. テンプレート反映方針（要確認3＝方針のみ本DD・実ファイルは別DD）

- Phase 1用DD差分テンプレートへ **Risk Class ヘッダ（roadmap §2.1）＋製品化6観点の高速チェック**を反映する方針とする。
- **実ファイル改修は別DD**（dd-update 管理系との整合確認が必要・DD-007 要確認3 の回答）。roadmap では **DD-009 タスク5** がこの反映を担う（実施可否は要確認3方針に従う）。

## 5. 残タスク（Phase 3 の締め）

- [x] `phase1-dd-roadmap.md` の **ChatGPTレビュー実施**（2026-07-12・判定=要修正）→ **Alpha必須ラインを全面採用（ユーザー判断）** → 反映 → **草案から正式版へ昇格**。結果 `phase1-roadmap-review-20260712/chatgpt_review_result.md`・反映は roadmap §10。
- [x] レビュー反映後の最終整合確認: CG-2/CG-6 の担当DD更新・Alpha必須ライン確定を本採択記録（§2）へ反映済み。
- [x] `phase0-dd-roadmap.md`「Phase 1以降」節へ本バックログ／roadmap への参照を追記（本DDで実施）。

**→ Phase 3（Phase 1 正式バックログ確定）完了。DD-007 の全Phase（判定＋バックログ）完了。**
