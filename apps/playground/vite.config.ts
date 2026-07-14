import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// 統合PoC（poc-integration.html = @nanairo-sheet/grid Facade の consumer）を build する。
// dev（`npm run dev`）は Vite が任意の .html を配信するため設定不要（/poc-integration.html を開く）。
// PoC-A（index.html）・PoC-B（poc-b.html）の単体デモは DD-016 で package へ昇華し削除した。

// DD-017-1: build エントリを「ディスク上の正準（canonical）casing」の絶対パスで固定する。
//   vite:html-inline-proxy は inline `<style>` を仮想 CSS モジュールへ退避し、そのキーを
//   `entryId.replace(config.root, '')` で計算する（add 時 = build html plugin / load 時 = rollup 解決後）。
//   ルート `npm run build`（npm workspace 経由）ではシェル cwd の casing（git-bash 既定は小文字ドライブ
//   `c:` 等）がそのまま流れ込む一方、rollup はエントリ id を realpath 相当の正準 casing（大文字ドライブ・
//   実ディスク表記）へ正規化する。相対 input だと add 時 id（cwd 由来）と load 時 id（正準）で casing が
//   食い違い、`[vite:html-inline-proxy] No matching HTML proxy module found` で build 失敗する（間欠に見えるが
//   起動シェルの cwd 表記に依存する決定的挙動）。
//   realpathSync.native で input を rollup と同じ正準 casing に揃えると add/load のキーが一致し解消する。
//   これはドライブレターだけでなくパス全区間の casing・シンボリックリンクも正規化する（ドライブレター単独の
//   大文字化では中間セグメントの casing 差で再発しうるため realpath を採用）。POSIX では実体パスを返すのみで副作用なし。
const rootDir = realpathSync.native(dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        integration: resolve(rootDir, 'poc-integration.html'),
      },
    },
  },
});
