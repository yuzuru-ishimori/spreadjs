# DD 索引

> `bash scripts/dd-index-gen.sh` で自動生成。手動編集禁止。

## 進行中

| DD | 件名 | ステータス | 補足 |
|----|------|-----------|------|
| DD-004 | PoC-BCanvas仮想スクロール | 確認待ち | 実装＋headed計測完了・AC1〜5合格（p95 16.8ms/再描画0.39ms/選択15.3ms/メモリ17KB/s/anchor維持）。ユーザー実機での確認run待ち |
| DD-003 | PoC-C共同編集Operation | 完了 | Operation収束性を実証（10,000件×3〜10体でhash一致・二重適用0・AC1〜5合格）。sheet-core/sheet-server-core/collaboration-server実装＋ADR-005/008ドラフト |
| DD-002 | PoC-A日本語IME | 進行中 | Phase 3-5実装＋dev目視で実行時バグ2件修正・エビデンス取得。E2E保留・実機IME検証はPhase 6 |

## 保留・見送り

| DD | 件名 | ステータス | 理由 |
|----|------|-----------|------|

## 完了済み

| DD | 件名 | 主な成果 |
|----|------|---------|
| DD-001 | 開発基盤monorepo構築 | npm workspaces基盤（sheet-types+playground）構築。dev/test/typecheck/lint整備、D-001/D-002記録 |
