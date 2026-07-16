# Stage 3 展望（outlook）＝薄い前方視界・ロードマップではない

> **位置づけ**: Stage 2 開始時点（DD-023・2026-07-16）で作成する **Stage 3（実案件採用・Goal 2）の展望書**。
> 目的は「Stage 2 の終わりをブレさせない」こと＝Stage 3 の移行条件から逆算した準備項目を可視化する。
> **本書はロードマップではない**。Stage 3 の DD ロードマップ化は、DD-032（Stage 2 移行判定DD）が
> Stage 3 バックログを確定した後に行う（DD-018→stage2-backlog→DD-023 の先例を踏襲）。
> 実案件（3件以上）が未確定な現時点で作業順序を推測で固定しない。

## 1. Stage 3 の定義（憲章 §15 再掲・正本は憲章）

**目的**: 3件以上の実案件で、コアを案件ごとに fork せず利用する。

**移行条件**: ①3件以上で本番または限定本番利用 ②案件固有要件の大半が設定・Command・Event・Adapter・Plugin で実現 ③重大なコア fork がない ④SLO・障害対応・アップグレード手順が運用できる ⑤利用者フィードバックに基づく API 見直しが完了。

## 2. Stage 2 のうちに仕込む準備条件

正本は `phase2-dd-roadmap.md` §4（R1〜R5）。要点のみ:

- **Plugin API v1**（P-07）: 列タイプ体系DD（DD-027）が実質プロトタイプ。2案件目（DD-030）開始前に v1 範囲を判断。
- **fork ゼロの計測**: consumer 統合①②で「コア変更なしで案件要件を満たせたか」を KPI として記録（DD-029）。
- **運用可能性の層**: runbook 雛形・error code 対応表・migration guide の運用実績（DD-028/029）。これが無いと「2アプリで動いた」だけで Stage 2 が終わり、Stage 3 の SLO 運用条件で詰む。
- **API 見直しの材料**: API 差分監視＋consumer フィードバック記録を DD-032 が棚卸しする。

## 3. 現時点で見えている Stage 3 候補項目（バックログの種・確定は DD-032）

| 候補 | 出典 |
|---|---|
| 3件目以降の consumer 探索・採用（本番/限定本番） | 憲章 §15 |
| PostgreSQL 本採用・運用（共同編集を本番運用する案件が出た場合） | stage2-backlog §2・ADR-0023 |
| 共同編集の本番運用整備（HA・バックアップ・監視・Presence=DD-019 が未着手のまま残った場合の回収） | roadmap §6 |
| 数式DD（DD-022）が Stage 2 で要件外となった場合の回収 | phase2-dd-roadmap §1 |
| SemVer 1.0 に向けた API 安定化・非推奨運用の本格化（P-10 の運用実績を経て） | 憲章 §18 |
| Tier 2 環境（macOS Chrome/Safari 等）の拡大判定 | 憲章 §20 |
| サポート体制の役割分担（憲章 §23・Stage 4 以降の兼務解消の前段） | 憲章 §23 |

## 4. 再検討トリガー（憲章 §24 のうち Stage 2〜3 で観測しうるもの)

- consumer 2〜3件中2件以上でコア fork が必要になる → 拡張モデル（Plugin/Adapter）の再設計を ADR で判断
- パッケージ数・導入手順が利用者の障壁になる → Facade 統合の再編
- 単独グリッドモード利用が支配的で共同編集需要が出ない → 共同編集層の投資配分を製品判断として見直す

## 5. 参照

- Stage 2 ロードマップ（S2 ゲート・Stage 3 準備条件の正本）: `doc/plan/phase2-dd-roadmap.md`
- 製品憲章（Stage 定義の正本）: `doc/product/nanairo_sheet_product_charter_v1.md` §15
- Stage 1 送りバックログ: `doc/plan/stage2-backlog.md`
