import { defineConfig } from 'vite';

// 統合PoC（poc-integration.html = @nanairo-sheet/grid Facade の consumer）を build する。
// dev（`npm run dev`）は Vite が任意の .html を配信するため設定不要（/poc-integration.html を開く）。
// PoC-A（index.html）・PoC-B（poc-b.html）の単体デモは DD-016 で package へ昇華し削除した。
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        integration: 'poc-integration.html',
      },
    },
  },
});
