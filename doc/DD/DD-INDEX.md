# DD 索引

> `bash scripts/dd-index-gen.sh` で自動生成。手動編集禁止。

## 進行中

| DD | 件名 | ステータス | 補足 |
|----|------|-----------|------|
| DD-012 | 単一利用者IME縦切り | 進行中 | 仕様確認ゲート4点確定（2026-07-13）。案Y 2分割を採択し親アンブレラ化。実作業は DD-012-1（入力縦切り・CG-1）→ DD-012-2（性能縦切り・CG-6）で実施 |
| DD-012-1 | 入力縦切り | 完了 | Phase 1〜4完了。型変換/date/ローカルOp/IME不変6項目/ADR-012/Codex＋CG-1解除済（実機PASS・先頭欠落0・順序B×Chrome/Edge）。実機で順序A不発（Chromium150）の知見を記録。抽出はDD-016委譲 |
| DD-012-2 | 性能縦切り | 検討中 | 親=DD-012（案Y分割・2026-07-13確定）。CG-6 担当。依存: DD-012-1 完了後に着手 |

## 保留・見送り

| DD | 件名 | ステータス | 理由 |
|----|------|-----------|------|

## 完了済み

| DD | 件名 | 主な成果 |
|----|------|---------|
| DD-011 | 基盤実装 | 要確認①〜④回答済。DD-011-1 完了前提で全Phase実装＋Codex(high)4件全対応。Facade skeleton・boundary lint(baseline 41)・不変条件runner・consumer harness雛形・Risk Classヘッダ新設。typecheck/lint(+boundary)/build/test:invariants/contract/consumer-harness green。差分テストflaky恒久是正。ws-convergence.smokeは環境依存flaky据え置き。コミット済 |
| DD-011-1 | packageリネーム | 実装完了（rename 5 package・66 renames＋import 全置換・dir==name 統一）・test 561/561・typecheck/lint/build green・Codex(medium) findings 0・旧名/旧dir 参照 0＋正典パッケージ名の現行構成整合。DD-011 の前提確定。コミット cbf7064系列（159d5e8） |
| DD-010 | 安定ID・CellStore移行 | 実装・テスト（561 green）・Codexレビュー反映（findings 4件全対応）・**CG-2 解除**（index→RowId slot間接・serialization/replay整合証拠）まで完了。**ADR-0011 は Codex レビューをもって Accepted 確定**（ユーザー判断 2026-07-13＝ChatGPT ではなく Codex で十分・AC6 性能 baseline 解釈も同承認に含む）。コミット cbf7064 |
| DD-009 | 基盤判断 | 成果物完成（台帳・境界・CG台帳・ADR）＋Codex反映済＋Q1〜Q7暫定確定。外部レビュー(ChatGPT)は保留・事後実施可（ユーザー決定で完了） |
| DD-008 | 製品憲章導入と文書体系同期 | 憲章Accepted・3層文書体系確立（D-004昇格）・5文書同期・Codex指摘4件全対応。コミット 6bfc2bd |
| DD-007 | Phase0GoNoGo判定 | **全Phase完了**（Phase 1 判定材料集約 → Phase 2 判定＝**条件付きGo**〔CG-1〜6・前提条件記録〕→ Phase 3 バックログ確定）。🔬doc-check green・😈DA 7所見・🧑‍⚖️Codex証拠監査6指摘全対応（見送り0）。Phase 3: `phase1-dd-roadmap.md` を採択→**ChatGPTレビュー（要修正）反映で正式版へ昇格**（Alpha必須ライン全面採用〔reconnect必須・Presence他除外〕・CG-1〜6ハードゲート本体化・過積載DD分割・製品境界/consumer実証明記）。採択記録=`phase1-backlog.md`。**→ 2026-07-12 完了・アーカイブ（`doc/archived/DD/DD-007/`）**。要確認1〜4回答済み・外部レビュー3回反映済み |
| DD-006 | PoC-Dデータ表現・簡易数式 | **Phase 1〜5 実装＋Codexレビュー反映（P1×6・P2×6）＋AC9ブラウザ実機実測（Chrome 150・乖離なし）完了**。**AC1〜9 全実測合格**（AC2 fanout-100 p95 1.09ms／メモリ全方式300MB内／AC5 replay 100k=14分＝snapshot必須／固定ID数式評価を実文書で実証／AC9 Node比1.0〜1.2倍で乖離なし・§18.6メモリNo-Go非該当）。sheet-formula 74＋結合3テスト green。成果=CellStore用途別選択表・ADR-011拡充・ADR-022ドラフト・計測レポート。DD-007（Go/No-Go）判定材料が揃った |
| DD-005 | 統合PoC-IME・Canvas・共同編集 | 要確認1〜3確定（案A/Codex2回/初期約10万セル）。**Phase 1**（sheet-collaboration 抽出・Codex xhigh 済）＋**Phase 2**（統合ページ土台）＋**Phase 3**（IME×共同編集結線＝commit-bridge cell-level beforeRevision・ime-editing-session・integration-editor・Presence・#8不変/AC4退避）＋**Phase 4**（統合E2E・証跡・Codex xhigh 済）実装完了。**#3 protocol 検証＝cell-level 確定**（SetCellsChange.beforeRevision＋CellRecord.lastChangedRevision＋server validateSetCells がセル単位で照合）。test 434／**E2E 17**（DD-002 11＋統合 6・回帰0）green。統合シナリオ10項目＋AC1〜4 を synthetic composition＋実WS 2コンテキストで自動実証（証跡 `dd005-p4-e2e-*.png`・`integration-evidence.md`）。**Phase 5（実機IMEゲート）はユーザー判断で実機テストなしでクローズ**（2026-07-12・根拠は AC6/下記ログ）: IME正しさは DD-002 実機4環境＋E2E順序A/B両方＋Codex で担保済み・状態機械を無改変再利用。残余（新 integration-editor アダプタ×実IME候補ウィンドウ・順序A/Bの実機記録）は低リスクゆえ Phase 1 製品化＋DD-007 既知制約へ。headed 2タブ smoke（#9競合・スクロール追従）は Phase 2/3 で主セッション実行済み。**DD-005 完了** |
| DD-004 | PoC-BCanvas仮想スクロール | 実装＋headed計測＋**実機確認run（2026-07-12・実Chrome・overall pass）**でAC1〜5合格（p95 16.8ms/再描画0.33ms/選択16.9ms/メモリ−79KB/s・純減/anchor維持）。measurement-report.md「実機確認run」節・pocb-measurement-realrun-20260712.json 参照 |
| DD-003 | PoC-C共同編集Operation | Operation収束性を実証（10,000件×3〜10体でhash一致・二重適用0・AC1〜5合格）。sheet-core/sheet-server-core/collaboration-server実装＋ADR-005/008ドラフト |
| DD-002 | PoC-A日本語IME | PoC-A成立（R-01回避）。常駐textarea＋状態機械＋E2E11＋実機4環境合格（申告）。順序A/BはDD-005で採取 |
| DD-001 | 開発基盤monorepo構築 | npm workspaces基盤（sheet-types+playground）構築。dev/test/typecheck/lint整備、D-001/D-002記録 |
