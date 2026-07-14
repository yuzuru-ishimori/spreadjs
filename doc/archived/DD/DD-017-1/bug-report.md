# DD-017-1 バグレポート（Before 要約）

## 現象

ルート集約の `npm run build`（= `npm run build --workspace apps/playground` = playground の Vite 本番ビルド）が
`[vite:html-inline-proxy] No matching HTML proxy module found ... poc-integration.html?html-proxy&inline-css&index=0.css`
で失敗する。直接 `cd apps/playground && npx vite build` は成功する。DD-017 で「間欠 flake」として観測された。

## 重要度

MEDIUM。製品コード（packages/*）の挙動には影響しないが、全 DD の検証ゲート「build green」を
ルートコマンドで判定できず、検証の信頼性を汚染する。

## 再現条件（決定的）

- ルート `npm run build` を、シェル cwd のドライブレターが小文字 `c:` の状態（git-bash 既定 `/c/...`）で実行 → **決定的に FAIL**（本セッションで 8/8 FAIL を採取）。
- 直接 build、または明示 `cd`（ドライブレター大文字 `C:` に再正規化）後のルート build → **green**。
- vite 版・キャッシュ・並行プロセスは無関係（env-diff.md / repro-log.md）。

## 根本原因

`vite:html-inline-proxy` の仮想 CSS モジュールキー `entryId.replace(config.root, '')` が、
add 時（cwd 由来・小文字 `c:`）と load 時（rollup が大文字 `C:` に正規化）でドライブレター
casing が食い違い不一致になるため。詳細は cause-analysis.md。

## 是正（採用）

`apps/playground/vite.config.ts` の build input を、ドライブレター大文字固定の絶対パスに変更
（`withUpperDrive(dirname(fileURLToPath(import.meta.url)))` を base に `resolve`）。案 a を精緻化した最小変更。
非 Windows では no-op。packages/*・画面・vite 版・HTML 非接触。

## エビデンス

- repro-log.md（Before 8/8 FAIL・対照 8/8 green・切り分けマトリクス）
- env-diff.md（経路別 cwd/vite 実測）
- cause-analysis.md（コードレベル機序）
- verification.md（Phase 2: After 8/8 green・dist 同等性）
