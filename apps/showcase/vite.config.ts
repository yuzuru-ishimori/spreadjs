import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// SDK紹介サイト（index.html＝機能カタログ）＋動作デモ（demo.html）を build する。
// dev（`npm run dev`）は Vite が任意の .html を配信するため設定不要。
//
// input を realpathSync.native の正準 casing 絶対パスで固定する理由は
// apps/playground/vite.config.ts（DD-017-1: vite:html-inline-proxy の casing 不一致対策）を参照。
const rootDir = realpathSync.native(dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        catalog: resolve(rootDir, 'index.html'),
        demo: resolve(rootDir, 'demo.html'),
      },
    },
  },
});
