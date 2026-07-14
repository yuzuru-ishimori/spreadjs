import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

// consumer-app のビルド/dev（Playwright webServer が dev を起動する）。
// root を consumer-app 自身に固定し、@nanairo-sheet/* は consumer-app/node_modules の **pack 展開実体**（tarball）から
// 解決させる（root workspace の symlink を拾わない＝S1-3 独立性）。SDK は .ts main を持つため optimizeDeps で pre-bundle する。
const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  server: { strictPort: true },
  // .ts main の SDK tarball を esbuild で事前バンドルさせる（node_modules 内 .ts の解決）。
  optimizeDeps: {
    include: ['@nanairo-sheet/grid'],
  },
});
