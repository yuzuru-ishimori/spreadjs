# DD-017-1 環境差分（env-diff）

## 経路別 cwd / vite 実体

| 項目 | ルート `npm run build`（cd なし起動） | 直接 `cd apps/playground && npx vite build` |
|---|---|---|
| 外側 node `process.cwd()` | `c:\repo\spreadjs`（**小文字**） | `C:\repo\spreadjs\apps\playground`（**大文字**） |
| build プロセス内 `process.cwd()` | `c:\repo\spreadjs\apps\playground`（**小文字**） | `C:\repo\spreadjs\apps\playground`（**大文字**） |
| vite `config.root`（probe 実測） | `c:/repo/spreadjs/apps/playground`（**小文字**） | `C:/repo/spreadjs/apps/playground`（**大文字**） |
| `vite --version` | `vite/6.4.3` | `vite/6.4.3` |
| `require.resolve('vite')` 実体 | `node_modules/vite`（hoisted・同一） | `node_modules/vite`（同一） |
| build 結果 | **FAIL**（html-inline-proxy） | **green** |

## 判定

- vite 版・実体・PATH は両経路で同一 → 版/hoist 差は無関係。
- 差分は **cwd のドライブレター casing** の一点。小文字 `c:` のとき `config.root` も小文字となり、
  rollup が大文字 `C:` に正規化するエントリ id とキー不一致を起こして FAIL。
- 「間欠」の実体は、起動シェルの cwd casing（git-bash 既定 `/c/`＝小文字 / 明示 cd＝大文字）に依存する決定的挙動。
