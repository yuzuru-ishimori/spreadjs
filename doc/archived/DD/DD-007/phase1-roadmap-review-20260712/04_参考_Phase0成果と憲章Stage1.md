# 参考: Phase 0 で確認できたこと／できていないこと ＋ 製品憲章 Stage 1

> 2026-07-12 時点スナップショット。正本は各DD・`doc/DD/DD-INDEX.md`・`doc/product/nanairo_sheet_product_charter_v1.md`。

## 1. Phase 0（技術PoC）各DDの成果

| DD | 題 | 確認できたこと | 主な「確認していないこと」 |
|----|----|--------------|------------------------|
| DD-001 | 開発基盤・monorepo | npm workspaces・TS strict・test/typecheck/lint の骨格 | — |
| DD-002 | 日本語IME | 常駐textarea＋状態機械で先頭文字欠落を回避（R-01回避）。E2E11＋実機4環境合格 | 新アダプタ×実IME候補ウィンドウ・確定Enter順序A/Bの実機記録は一部Phase 1へ |
| DD-003 | 共同編集・Operation収束 | サーバー全順序で10,000件×3〜10体 hash一致・二重適用0。楽観適用rollback/replay・Presence | あらゆる client→server 欠落からの自動復旧・全障害パターン・本番認証認可 |
| DD-004 | Canvas・仮想スクロール | 5万行×200列で p95 16.8ms・再描画0.33ms・メモリ純減・anchor維持（実機Chrome pass） | 共同編集・IME統合後も同性能を維持できるか（統合負荷） |
| DD-005 | 統合PoC（IME・Canvas・共同編集） | 3PoCを単一セル編集フローへ結線。統合シナリオ10項目＋AC1〜4 を自動E2E＋headed で成立。cell-level beforeRevision 検証 | 実機IMEゲート（Phase 5）はユーザー判断で実機テストなしでクローズ。client→server欠落の完全再整列・行挿入後の再ベース・snapshotベース初期化 等は既知制約としてPhase 1へ |
| DD-006 | データ表現・簡易数式 | CellStore用途別選択・500k非空セル計測・固定ID数式評価・replay計測（AC1〜9実測合格・Chrome実機乖離なし） | 完全な数式体系・Formula Worker・大規模range最適化（後段） |

**要点**: Phase 0 は各技術の**成立性**と**統合フローの成立**を確認した。ただし「PoC成功＝製品完成／全障害対応済み」ではない。実機IME・全障害復旧・本番プロトコル安全性・統合負荷下の性能は Phase 1 以降で回収する。

## 2. Phase 0 の Go/No-Go 基準（計画書 §18.6・参考）

- **Go**: IME合格／Canvas 5万行で実用速度／Operation収束確認／メモリ見積が実用範囲／主要ADR化。
- **条件付きGo**: 主要ブラウザーのうち1つに限定すれば成立／性能目標をデータ密度・列数制約で達成可能。
- **No-Go**: 先頭文字欠落を安定回避できない／rollback/replayが入力遅延を恒常発生／想定データ量でメモリ上限超過。

## 2.5 Phase 0 判定の結果（DD-007・2026-07-12・**条件付きGo で確定**）

> 本パック作成後に判定が確定した（DD-007 決定事項・`go-nogo-package.md` §7）。**判定＝条件付きGo**。技術成立性の中核（Canvas 実機pass・共同編集収束は全て自動seed試験A・データ/数式・メモリ）は堅く成立。唯一のクリティカルギャップ＝**IME実機検証**（自動/synthetic は成立だが実機受入は申告のみ＝証拠 D/E・実機トレース未採取）ゆえクリーンGoにはできず、該当する No-Go 証拠もないため **条件付きGo**。

**条件付きGo の解除条件（CG-1〜6）＝この草案が満たす／各DDへ割り付けるべき対象**:

| # | 条件 | ロードマップでの主担当（草案） |
|---|---|---|
| CG-1 | 実機IME検証（確定Enter順序A/B・先頭欠落0・新 `integration-editor` アダプタ×実IME） | **DD-010**＋常設 IME不変条件スイート（筆頭・SDK配布可否に直結） |
| CG-2 | CellStore index→RowId キー移行 | DD-009／DD-016 |
| CG-3 | snapshot 正式形式（replay O(N²)＝100k で14分の回避） | DD-011P／DD-015 |
| CG-4 | 対応ブラウザー Tier 1（Windows Chrome/Edge・macOS/Firefox 対象外） | 全DD共通の対象範囲 |
| CG-5 | client→server 収束境界（D27/D34・欠落起点の再整列）＝データ損失経路 | DD-015 |
| CG-6 | 精密ブラウザーメモリ計測（`performance.memory` 封鎖の回避） | DD-009／データ表現DD |

→ **レビュー観点**: この草案は CG-1〜6 を各DDへ適切に割り付けているか。特に **CG-1（実機IME検証）が Alpha 配布可否の筆頭条件**として扱われているか、**CG-5（データ損失境界）が Alpha 最小ライン（DD-015 必須/推奨）の判断に反映**されているか。

## 3. 製品憲章の成熟段階（開発Phase とは別軸）

技術機能が実装されても SDK として提供可能とは限らない、という前提で段階管理している。

- **Stage 0：技術PoC** — 成立性確認。移行条件＝Phase 0 Go／条件付きGo。（＝いま完了間際）
- **Stage 1：社内SDK Alpha（Goal 1）** ← **本草案の到達目標**
  - 目的: 別の社内プロジェクトから npm パッケージとして利用可能にする。
  - 移行条件:
    - PoCコードが `packages/*` へ抽出されている
    - 利用者向け Facade パッケージがある
    - 1つの社内アプリが直接内部importなしで統合できる
    - Quick Start・型定義・最小サンプルがある
    - API は `0.x` で変更可能だが、変更履歴を残す
- **Stage 2：社内SDK Beta** — 2つ以上の社内アプリで利用・内部import無し・API差分監視・回帰継続・Testkit・主要Plugin/Adapter境界を実案件で検証。
- **Stage 3：実案件採用（Goal 2）** — 3件以上でコアをforkせず利用・案件固有要件の大半を設定/Command/Event/Adapter/Pluginで実現・SLO/障害対応/アップグレード運用。

**含意**: Stage 1 は「本番完成」ではない。**API は Experimental 中心（0.x）で、Stable 固定は Stage 3 pilot 後**。Phase 1 で全APIを Stable にすると Stage 2/3 の設計変更が困難になる。
