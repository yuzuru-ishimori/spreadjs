# consumer-harness（独立 consumer 雛形）

> 設置: DD-011（基盤実装DD）Phase 4。要確認③確定＝**雛形**（pack 経由の独立プロジェクト）。

Stage 1 SDK Alpha の Facade（`@nanairo-sheet/grid`・`@nanairo-sheet/server-hono`）を、**monorepo の外にいる
利用者と同じ経路**（`npm pack` した tarball を install）で取り込み、公開面だけで型が解決できることを検証する。

## これは fixture の言い換えではない（DA 回答）

`bash scripts/consumer-harness.sh` が **S1-3 不合格条件**を機械検査する点が、単なる sample と決定的に違う:

1. **内部パッケージ直接 import 禁止**（R1 full-error・§4.3-1）: `@nanairo-sheet/{core,types,collab,server,formula,…}` を
   import していたら FAIL。
2. **source path 直接参照 禁止**: `../../packages/...` 等のリポジトリ内パス参照があれば FAIL。
3. **workspace link 禁止**: `node_modules/@nanairo-sheet/*` が symlink（workspace link）なら FAIL。tarball 展開実体のみ許可。

これらは workspace 内では素通りしてしまう結合を、**外部利用者の視点で**塞ぐための否定検査である。

## DD-016（S1-3 本実証）との違い

本 harness は **雛形**（型疎通と経路検査まで）。実在社内アプリへの統合・mount/destroy の実挙動・
再 mount での resource leak・lifecycle 契約の実証は **DD-016** が担当する（Facade が stub を脱し実 API を持つ段階）。

## 実行

```bash
npm run consumer-harness   # = bash scripts/consumer-harness.sh（pack→install→tsc --noEmit＋不合格条件検査）
```
