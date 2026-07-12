import { defineConfig } from 'vite';

// マルチエントリー build（PoC-A: index.html ／ PoC-B: poc-b.html ／ 統合PoC: poc-integration.html）。
// dev（`npm run dev`）は Vite が任意の .html を配信するため設定不要（/poc-integration.html を開く）。
// build は rollup の input に各エントリーを列挙する。新規 npm 依存は追加しない。
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        pocb: 'poc-b.html',
        integration: 'poc-integration.html',
      },
    },
  },
});
