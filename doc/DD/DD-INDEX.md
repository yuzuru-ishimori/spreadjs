# DD 索引

> `bash scripts/dd-index-gen.sh` で自動生成。手動編集禁止。

## 進行中

| DD | 件名 | ステータス | 補足 |
|----|------|-----------|------|
| DD-007 | Phase0GoNoGo判定 | 検討中 | 要確認1〜4回答済み。外部レビュー第2回反映（証拠レベルA〜E・技術Go/Phase1前提の分離・ADR非自動Accepted・SDK Alpha完了条件案）。判定材料テンプレート先出し済み。着手条件=DD-002〜006全完了（現状: DD-002完了・DD-004完了・DD-005進行中〔Phase 1完了〕・DD-006 Phase 0事前精査済〔検討中〕） |
| DD-006 | PoC-Dデータ表現・簡易数式 | 確認待ち | **Phase 1〜5 実装完了＋Codexレビュー反映（P1×6・P2×6 全対応）**。sheet-formula 74＋結合3テスト green・**AC1〜6/8 実測合格**（AC2 fanout-100 p95 1.09ms・メモリ全方式300MB内・AC5 replay O(N²)＝snapshot要・**固定ID数式評価をInsertRows/DeleteRows実文書で実証**）・AC9ページ build green。外部レビュー2回＋Codex反映済み。**残（確認待ち）: AC9ユーザー実機Chrome/Edge run のみ** |

## 保留・見送り

| DD | 件名 | ステータス | 理由 |
|----|------|-----------|------|

## 完了済み

| DD | 件名 | 主な成果 |
|----|------|---------|
| DD-008 | 製品憲章導入と文書体系同期 | 憲章Accepted・3層文書体系確立（D-004昇格）・5文書同期・Codex指摘4件全対応。コミット 6bfc2bd |
| DD-005 | 統合PoC-IME・Canvas・共同編集 | 要確認1〜3確定（案A/Codex2回/初期約10万セル）。**Phase 1**（sheet-collaboration 抽出・Codex xhigh 済）＋**Phase 2**（統合ページ土台）＋**Phase 3**（IME×共同編集結線＝commit-bridge cell-level beforeRevision・ime-editing-session・integration-editor・Presence・#8不変/AC4退避）＋**Phase 4**（統合E2E・証跡・Codex xhigh 済）実装完了。**#3 protocol 検証＝cell-level 確定**（SetCellsChange.beforeRevision＋CellRecord.lastChangedRevision＋server validateSetCells がセル単位で照合）。test 434／**E2E 17**（DD-002 11＋統合 6・回帰0）green。統合シナリオ10項目＋AC1〜4 を synthetic composition＋実WS 2コンテキストで自動実証（証跡 `dd005-p4-e2e-*.png`・`integration-evidence.md`）。**Phase 5（実機IMEゲート）はユーザー判断で実機テストなしでクローズ**（2026-07-12・根拠は AC6/下記ログ）: IME正しさは DD-002 実機4環境＋E2E順序A/B両方＋Codex で担保済み・状態機械を無改変再利用。残余（新 integration-editor アダプタ×実IME候補ウィンドウ・順序A/Bの実機記録）は低リスクゆえ Phase 1 製品化＋DD-007 既知制約へ。headed 2タブ smoke（#9競合・スクロール追従）は Phase 2/3 で主セッション実行済み。**DD-005 完了** |
| DD-004 | PoC-BCanvas仮想スクロール | 実装＋headed計測＋**実機確認run（2026-07-12・実Chrome・overall pass）**でAC1〜5合格（p95 16.8ms/再描画0.33ms/選択16.9ms/メモリ−79KB/s・純減/anchor維持）。measurement-report.md「実機確認run」節・pocb-measurement-realrun-20260712.json 参照 |
| DD-003 | PoC-C共同編集Operation | Operation収束性を実証（10,000件×3〜10体でhash一致・二重適用0・AC1〜5合格）。sheet-core/sheet-server-core/collaboration-server実装＋ADR-005/008ドラフト |
| DD-002 | PoC-A日本語IME | PoC-A成立（R-01回避）。常駐textarea＋状態機械＋E2E11＋実機4環境合格（申告）。順序A/BはDD-005で採取 |
| DD-001 | 開発基盤monorepo構築 | npm workspaces基盤（sheet-types+playground）構築。dev/test/typecheck/lint整備、D-001/D-002記録 |
