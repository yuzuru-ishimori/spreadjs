# DD 索引

> `bash scripts/dd-index-gen.sh` で自動生成。手動編集禁止。

## 進行中

| DD | 件名 | ステータス | 補足 |
|----|------|-----------|------|
| DD-007 | Phase0GoNoGo判定 | 検討中 | 要確認1〜4回答済み。着手条件=DD-002〜006全完了（現状: DD-002完了・DD-004確認待ち・DD-005未起票・DD-006起票済み着手待ち） |
| DD-006 | PoC-Dデータ表現・簡易数式 | 検討中 | 要確認1〜5回答済み・外部レビュー6指摘反映。着手条件: DD-005（統合PoC）完了後 |
| DD-005 | 統合PoC-IME・Canvas・共同編集 | 検討中 | 起票済み・要確認1〜3確定（案A/Codex2回/初期約10万セル）。着手条件=DD-002・003・004完了。実装前にクリーンアップ先行（DD-004実機run→DD-003/004アーカイブ）→その後Phase 1着手 |
| DD-004 | PoC-BCanvas仮想スクロール | 確認待ち | 実装＋headed計測完了・AC1〜5合格（p95 16.8ms/再描画0.39ms/選択15.3ms/メモリ17KB/s/anchor維持）。ユーザー実機での確認run待ち |
| DD-003 | PoC-C共同編集Operation | 完了 | Operation収束性を実証（10,000件×3〜10体でhash一致・二重適用0・AC1〜5合格）。sheet-core/sheet-server-core/collaboration-server実装＋ADR-005/008ドラフト |

## 保留・見送り

| DD | 件名 | ステータス | 理由 |
|----|------|-----------|------|

## 完了済み

| DD | 件名 | 主な成果 |
|----|------|---------|
| DD-002 | PoC-A日本語IME | PoC-A成立（R-01回避）。常駐textarea＋状態機械＋E2E11＋実機4環境合格（申告）。順序A/BはDD-005で採取 |
| DD-001 | 開発基盤monorepo構築 | npm workspaces基盤（sheet-types+playground）構築。dev/test/typecheck/lint整備、D-001/D-002記録 |
