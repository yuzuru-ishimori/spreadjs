# DD-017-1 原因分析（cause-analysis）

## 結論（一行）

`vite:html-inline-proxy` が inline `<style>` を退避する仮想 CSS モジュールのキーを
「エントリ id のドライブレター casing」に依存して計算するため、**add 時（小文字 `c:`）と
load 時（rollup が大文字 `C:` へ正規化）でキーが食い違い** `No matching HTML proxy module found`
で build が失敗する。実行時シェル cwd のドライブレター casing に依存するため「間欠」に見えた。

## コードレベルの機序（vite 6.4.3）

`node_modules/vite/dist/node/chunks/dep-*.js`（`vite:html-inline-proxy`）:

- **add（build html plugin, `<style>` 処理）**:
  ```js
  const filePath = id.replace(normalizePath(config.root), "");
  addToHTMLProxyCache(config, filePath, inlineModuleIndex, { code: styleNode.value });
  js += `\nimport "${id}?html-proxy&inline-css&index=${inlineModuleIndex}.css"`;
  ```
- **load（`vite:html-inline-proxy` の load hook）**:
  ```js
  const file = cleanUrl(id);
  const url = file.replace(normalizePath(config.root), "");
  const result = htmlProxyMap.get(config).get(url)?.[index]; // ← ここで undefined → throw
  ```

キーは両側とも `entryId.replace(config.root, '')`。同一 `config` 上の同一 `config.root` を使うので、
本来は `id` の casing さえ add/load で一致すれば一致する。

問題は `id`（HTML エントリの絶対パス）の casing が add と load で異なりうること:

- **add 時の `id`** = ルート `npm run build`（npm workspace 経由）で流れ込むシェル cwd 由来。
  git-bash 既定の `/c/...` が node `process.cwd()` で **小文字 `c:`** となり、相対 input
  `'poc-integration.html'` はこの小文字 root 基準で解決 → エントリ id も小文字 `c:`。
- **load 時の `id`** = rollup がモジュール解決の過程でドライブレターを **大文字 `C:`** に正規化する。

結果、`config.root` が小文字なら:
- add: `c:/…/poc-integration.html`.replace(`c:/…/apps/playground`) → `/poc-integration.html`（strip 成功）
- load: `C:/…/poc-integration.html`.replace(`c:/…/apps/playground`) → **strip されず全長 `C:/…`**

→ キー `/poc-integration.html`（add）と `C:/…/poc-integration.html`（load）が不一致 → throw。

`config.root` を大文字化しても、今度は add 側（小文字 id）が strip されず load 側（大文字 id）が
strip されるため、依然不一致（実測 4/4 FAIL）。**真に必要な不変条件は「add 時 id casing == load 時 id casing == rollup 正規化形（大文字ドライブ）」**。

## なぜ「間欠」だったか

実行時シェルの cwd ドライブレターが大文字 `C:` のとき（例: 明示 `cd` 後や特定ターミナル）は
add 時 id も大文字となり load 時と一致して green。小文字 `c:` のとき FAIL。DD-017 の観測
「4/4 FAIL / 直接実行 4/4 green」は、直接実行が `cd apps/playground`（＝再正規化で大文字）を
含んでいたため。恒常バグ（環境依存の決定的失敗）であり真のランダム flake ではない。

## 是正（最小変更・案 a を精緻化）

`apps/playground/vite.config.ts` の build input を、**ドライブレターを大文字へ固定した絶対パス**にする:

```ts
function withUpperDrive(p: string): string {
  return p.replace(/^([a-z]):/, (_m, d: string) => `${d.toUpperCase()}:`);
}
const rootDir = withUpperDrive(dirname(fileURLToPath(import.meta.url)));
// input: { integration: resolve(rootDir, 'poc-integration.html') }
```

- add 時のエントリ id が rollup の load 正規化（大文字ドライブ）と一致 → キー一致 → 解消。
- `config.root` の casing に依存しない（root 小文字のままでも add/load とも「strip されず全長・同一」で一致）。
- 非 Windows（先頭 `/`）では `withUpperDrive` は no-op → 副作用なし・クロスプラットフォーム安全。
- packages/*・画面挙動・vite 版・HTML には非接触（Risk Class C 維持）。

### 検討して却下した他案
- **案 b（`<style>` を外部 css へ分離）**: html-inline-proxy 自体を回避できるが dist 出力構造（inline vs link/asset）が変わり AC3「dist 実質同等」を脅かす。変更範囲も HTML＋新規 css と広い。→ 却下。
- **案 c（vite 版統一）**: 版差は実測で無関係（両経路 6.4.3 同一実体）。→ 無効。
- **案 d（build script の cwd/env 変更）**: cwd casing は npm workspace の仕様側に起因し、script 変更での安定化は脆い（呼び出し側シェル casing に依存し続ける）。→ 案 a より非本質的。
- **案 e（境界化）**: 恒久是正が可能（案 a）なので不採用。要確認により案 e は選択せず。
