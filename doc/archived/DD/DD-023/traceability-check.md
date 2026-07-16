# DD-023 Phase 2 突合チェック（traceability）

> 実施日: 2026-07-16。対象: `phase2-dd-roadmap.md` 草案。AC1/AC2/AC3/AC4 の機械検証記録。

## (a) 憲章 §15 Stage 2 移行条件 ↔ S2 ゲート表（AC1）

| 憲章 §15 の条件（原文） | roadmap §0 | 判定 |
|---|---|---|
| 2つ以上の異なる社内アプリで利用 | S2-1（DD-026＋DD-030） | OK |
| 内部パッケージの直接importがない | S2-2（boundary lint＋consumer 側検証） | OK |
| API差分監視と移行ガイドがある | S2-3（DD-028） | OK |
| 主要ブラウザー／IME回帰が継続実行される | S2-4（DD-028 CI 常設） | OK |
| Testkit、診断ログ、サンプルが整備される | S2-5（DD-029＋各機能DD） | OK |
| 主要Plugin／Adapter境界が実案件で検証される | S2-6（DD-026/027/030） | OK |

6/6 対応 → **OK**（過不足なし・1対1）

## (b) stage2-backlog.md 全項目 ↔ 回収先（AC2）

| backlog 節 | 項目 | 回収先（roadmap §7） | 判定 |
|---|---|---|---|
| §1 | DD-019 Presence | 条件付き着手（共同編集採用トリガー） | OK |
| §1 | DD-020 Clipboard | 機能DD群先頭想定（DD-026 要件調査で確定） | OK |
| §1 | DD-021 行操作 | 機能DD群（K3/K4/P2-1 回収） | OK |
| §1 | DD-022 数式 | 要件判定（外れれば DD-032 で Stage 3 送り） | OK |
| §2 | dist ビルド配布切替 | DD-031 | OK |
| §2 | private registry 昇格 | DD-031 | OK |
| §2 | PostgreSQL 本採用 | 条件付き保留（不成立なら Stage 3 バックログ） | OK |
| §2 | React 薄ラッパー Facade | DD-025（必須化確定） | OK |
| §2 | 複数配布チャネル運用 | DD-031 | OK |
| §2 | 汎用診断/テレメトリ基盤 | DD-029（P-12） | OK |
| §3 | K3（行挿入後の再ベース） | DD-021 | OK |
| §3 | K4（IME×行削除） | DD-021 | OK |
| §3 | P2-1（InsertRows Θ(N²)） | DD-021 | OK |
| §3 | P2-3/P2-4 | DD-018-1 で回収済（backlog 上も取消線）＝対象外 | OK |
| §3.5 | 列幅・行高・wrap の全ユーザー共有 | DD-027-3（設計整合）＋発火条件付き実装子DD／不成立時は DD-032 が Stage 3 バックログへ登録（Codex P2-3 反映） | OK |
| §3.5 | セル単位の書式モデル | DD-027-3 | OK |
| §3.5 | ダブルクリック auto-fit | DD-027 配下 C 級タスク | OK |
| §3.6 | 選択式入力列 | DD-027-1 | OK |
| §3.6 | ハイパーリンク列 | DD-027-2 | OK |
| §3.6 | 背景色・バッジ表示 | DD-027-3 | OK |
| §4 | 境界化項目（CG-4/CG-6/K9） | roadmap §6 で境界継続明示 | OK |

21/21 → **OK**（回収先なしの項目 0）

## (c) 憲章 §27 期限到来の未決事項 ↔ 処理（AC4）

| ID | roadmap §5 の処理 | 判定 |
|---|---|---|
| P-01 製品名 | 命名ゲート（DD-025 起票前・ユーザー決定）・反映=DD-031（Codex P2-4 反映） | OK |
| P-14 repo 名 | 命名ゲートで P-01 と同時決定・反映=DD-031（Codex P2-4 反映） | OK |
| P-06 versioning | lockstep 暫定継続→DD-031 正式化 | OK |
| P-10 非推奨期間 | DD-028 | OK |
| P-12 Telemetry | DD-029-3 | OK |
| P-07 Plugin API v1 | P-07 判断ゲート（DD-030 起票前の独立ゲート・材料=DD-027＋ReadyCrew 事前要件調査）（Codex P1-6 反映） | OK |

6/6 → **OK**

## (AC3) Stage 3 準備条件の逆算項目

roadmap §4 R1〜R5 に Plugin API v1（R1）・fork 計測（R2）・SLO/runbook/アップグレード手順（R3）・API 見直し材料（R4）・3件目探索の扱い（R5）を確認 → **OK**（AC3 の必須4項目〔Plugin API v1・SLO 雛形・API差分監視・移行ガイド運用〕を包含）

**総合: 全行 OK（AC1・AC2・AC3・AC4 充足）**
