# Codex レビュー依頼: DD-017-1 ルートbuild間欠flake是正

## DDの目的

ルート集約 `npm run build`（= `npm run build --workspace apps/playground` = playground の Vite 本番ビルド）が
`[vite:html-inline-proxy] No matching HTML proxy module found ... poc-integration.html?html-proxy&inline-css&index=0.css`
で間欠失敗する問題を恒久是正し、全 DD の検証ゲート「build green」をルートコマンドで安定判定できる状態に戻す。

## スコープ / 制約（Risk Class C）

- 変更対象は **`apps/playground/vite.config.ts` のみ**（build 設定）。
- packages/*（製品コード）・playground の画面挙動・vite メジャー版・HTML には**触れない**。
- 非 Windows 環境での挙動を壊さない（クロスプラットフォーム no-op であること）。

## 根本原因（実測で確定）

`vite:html-inline-proxy` は inline `<style>` を仮想 CSS モジュールへ退避し、そのキーを
`entryId.replace(config.root, '')` で計算する（add=build html plugin / load=rollup 解決後の load hook）。
ルート `npm run build`（npm workspace 経由）ではシェル cwd のドライブレターが小文字 `c:` のまま
`config.root` に流れ込む一方、rollup はエントリ id のドライブレターを大文字 `C:` に正規化する。
相対 input だと add 時 id（小文字）と load 時 id（大文字）でキーが食い違い FAIL する。
実行時シェル cwd の casing に依存するため「間欠」に見えていた（実体は決定的な環境依存バグ）。
詳細: `cause-analysis.md` / `repro-log.md` / `env-diff.md`。

## 対象差分（設計意図）

`apps/playground/vite.config.ts`:
- build input を `withUpperDrive(dirname(fileURLToPath(import.meta.url)))` を base にした絶対パス
  `resolve(rootDir, 'poc-integration.html')` へ固定。
- `withUpperDrive` は先頭 `x:` のドライブレターのみ大文字化（POSIX パスは先頭 `/` で no-op）。
- 意図: add 時のエントリ id casing を rollup の load 正規化（大文字ドライブ）に一致させ、
  `config.root` の casing に依存せずキーを一致させる。

## 検証済みエビデンス

- 修正前: ルート `npm run build`（cd なし=小文字 cwd）で 8/8 FAIL。
- 修正後: ルート `npm run build` 連続 green（Phase 2 で 8/8 採取予定）。probe 段階で 6/6 green。
- 回帰: 直接 `npx vite build` green・`typecheck`/`lint`(+boundary)/`test`(730) green・
  `dist/poc-integration.html` は修正前と**バイト同一**（inline-css 反映維持）・asset 集合も同一。

## 重点的に見てほしい観点（findings 優先）

1. **仕様一致**: この is 根本原因への正しい対処か。add/load キー不一致の解消として `input` 大文字化で十分か（`config.root` 側や rollup 版差で再発する穴はないか）。
2. **回帰/クロスプラットフォーム**: 非 Windows（Linux CI）・UNC パス・既に大文字 cwd の場合に破綻しないか。`withUpperDrive` の正規表現の妥当性。
3. **より堅牢/最小な代替**: vite 標準の `normalizePath` 等で意図を表現すべきか、`root` 明示指定の方が適切か（ただし実測では root 大文字化のみでは解消せず）。
4. **バリデーション/副作用**: `dist` 出力・dev（`npm run dev`）・E2E（playwright config）・consumer-app 経路への波及の有無。
5. **テスト不足**: このリグレッションを将来検出する仕組み（あるべきか、過剰か）。
