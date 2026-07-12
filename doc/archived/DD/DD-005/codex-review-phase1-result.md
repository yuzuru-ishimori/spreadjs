移設された実装・テスト9ファイルは旧HEADと完全一致し、import差し替えにも挙動変更はありません。しかし、環境非依存性を保証する型検査へ Node 型が混入しており、明示されたパッケージ境界の回帰防止要件を満たしていません。

Review comment:

- [P2] Vitest 型を環境非依存チェックから分離する — C:\repo\spreadjs\packages\sheet-collaboration\tsconfig.json:13-13
  `src/**/*.ts` は移設した `*.test.ts` も含み、各テストの `vitest` import が `@types/node` をプログラムへ読み込むため、`types: []` でも `process` や `Buffer` が解決されます。そのため今後 `session.ts` や `message-codec.ts` に Node API が混入しても typecheck が通り、テストを除外していた旧 `tsconfig.core.json` の環境非依存ゲートを引き継げていません。実装ファイル用の純度検査とテスト用 typecheck を分離してください。