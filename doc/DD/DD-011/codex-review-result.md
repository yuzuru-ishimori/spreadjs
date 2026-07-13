境界 lint と consumer harness に複数の機械的な回避経路があり、R7 は逆に正規の Facade 実装まで禁止します。DD-011 の中心目的である将来の package 境界の強制と独立 consumer 検証を現状では保証できません。

Full review comments:

- [P1] Facade の内部依存を一律 R7 違反にしないでください — C:\repo\spreadjs\scripts\boundary\check.mjs:133-140
  DD-016 で `grid` や `server-hono` が §4.1 で許可された内部 package を実装依存として import すると、公開シグネチャに内部型が一切現れなくても、この条件が無条件に R7 を発生させて lint を失敗させます。R7 は再エクスポートまたは公開引数・戻り値への型漏洩だけを禁止する規則なので、予定されている Facade 実装を阻害しない型情報ベースの公開シグネチャ検査が必要です。

- [P1] 動的 import も境界検査の AST 走査対象にしてください — C:\repo\spreadjs\scripts\boundary\check.mjs:74-80
  `readModuleRefs` はトップレベルの `ImportDeclaration` と `ExportDeclaration` しか収集しないため、app の `await import('@nanairo-sheet/core')` や隣接 package への `import('../other/src/x')` は R1/R4 を通過します。`no-restricted-imports` も動的 import を補完しないため、AST を再帰走査して import expression も検査しない限り full-error の境界を容易に回避できます。

- [P1] consumer harness の全 import 形式を検査してください — C:\repo\spreadjs\scripts\consumer-harness.sh:17-20
  この grep は `from` を伴う import だけを対象にするため、`import '@nanairo-sheet/core'`、`await import('@nanairo-sheet/core')`、型位置の `import('@nanairo-sheet/core').X` などは検出されません。harness はリポジトリ内にあり TypeScript の親ディレクトリ探索でルートの workspace-linked `node_modules` を参照できるため、これらを追加しても `tsc` が成功し、S1-3 の「内部直接 import なし」を誤って合格にできます。

- [P2] TSX ファイルにも boundary lint を適用してください — C:\repo\spreadjs\scripts\boundary\check.mjs:56-59
  列挙条件が `.ts` のみに限定され、ESLint 側の R2/R3/R5 glob も同様に `**/*.ts` なので、React component や将来の `@nanairo-sheet/react` Facade を `.tsx` で実装すると R1〜R5/R7 の検査をすべて回避できます。React を採用する本リポジトリでは `.tsx` も同じ test 例外規則で対象に含める必要があります。