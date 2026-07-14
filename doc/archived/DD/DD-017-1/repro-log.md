# DD-017-1 再現ログ（Before / 切り分け）

日付: 2026-07-15 / 環境: Windows 11・Node v22.20.0・vite 6.4.3（ルート overrides で hoist・playground も同一実体を解決）

## 1. 再現ループ（修正前・Before）

### ルート `npm run build`（no-cd 起動＝シェル cwd のドライブレターが小文字 `c:` のまま）
8/8 **FAIL**（間欠ではなく、この起動条件では決定的に失敗）:

```
run 1..8: exit=1
error during build:
[vite:html-inline-proxy] Could not load
  C:/repo/spreadjs/apps/playground/poc-integration.html?html-proxy&inline-css&index=0.css
  (imported by poc-integration.html):
  No matching HTML proxy module found from
  C:/repo/spreadjs/apps/playground/poc-integration.html?html-proxy&inline-css&index=0.css
```

### 対照: `cd apps/playground && npx vite build`
8/8 **green**（`✓ built in ~400-620ms`）。

## 2. 「間欠」の正体（決定的な起動条件差）

再現ループ中に「同一コード・無変更で fail→green に転じる」現象を観測し、原因を起動時 cwd のドライブレター casing に特定した:

| 起動方法 | node `process.cwd()` | ルート build 結果 |
|---|---|---|
| bash が cwd をリセットした既定状態から `npm run build`（cd なし） | `c:\repo\spreadjs`（**小文字 c**） | **FAIL** |
| `cd /c/repo/spreadjs; npm run build`（明示 cd で再正規化） | `C:\repo\spreadjs`（**大文字 C**） | **green** |

→ DD-017 で「間欠 flake」に見えたのは、実行時シェルの cwd ドライブレターが大文字/小文字どちらだったかに依存していたため。git-bash は既定で小文字 `/c/` を用いるため、実運用では失敗側に倒れやすい。

## 3. 切り分けマトリクス（各因子を1つずつ実測）

| 因子 | 実測 | 結論 |
|---|---|---|
| vite 実解決版（overrides `^6.4.3` vs devDeps `^6.0.5`） | 両経路とも `vite/6.4.3`・同一実体 `node_modules/vite`（hoisted） | **無関係**（版差は生じていない） |
| `.vite` キャッシュ / `dist` 残置 | 削除後も結果不変（cd あり=green / cd なし=FAIL） | **無関係** |
| 並行 vite/vitest プロセス | 無関係（単独実行でも決定的に再現） | **無関係** |
| 実行時 cwd のドライブレター casing | 小文字 `c:`→FAIL / 大文字 `C:`→green（上表） | **これが真因** |
| `vite.config.ts` input（相対 `'poc-integration.html'` vs 大文字ドライブ絶対パス） | 相対→FAIL（cd なし時）/ 大文字ドライブ絶対→6/6 green（cd なし時） | **是正点**（input を大文字ドライブ絶対パス固定で解消） |

補足: `config.root` を大文字化するだけ（input 相対のまま）では **解消せず**（4/4 FAIL）。input を rollup の正規化（大文字ドライブ）に合わせるのが必須。詳細は cause-analysis.md 参照。

## 4. 修正後の確認は verification.md（Phase 2）へ
