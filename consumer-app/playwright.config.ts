import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

// consumer-app 実挙動 E2E（DD-016-2 Phase 3・synthetic）。
// webServer:
//   1) serve-runner: 公開 Facade serve()（@nanairo-sheet/server-hono）で同期サーバーを起動（tsx 実行）。
//   2) vite dev: consumer-app（pack 展開の @nanairo-sheet/grid tarball を bundle）。
// dev ツール（vite/tsx/playwright）はリポジトリルートの node_modules から実行し、consumer-app/node_modules には
// SDK tarball のみを置く（S1-3 独立性）。ポートは他プロジェクト/既存 E2E（5199/8799・5885/9499）と非衝突。

const root = dirname(fileURLToPath(import.meta.url));
const repoNodeModules = join(root, '..', 'node_modules');

const VITE_PORT = 5886;
const SERVE_PORT = 8791;
const BASE_URL = `http://127.0.0.1:${VITE_PORT}`;

export default defineConfig({
  testDir: join(root, 'e2e'),
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: join(root, 'test-results'),
  timeout: 90_000,
  expect: { timeout: 12_000 },
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: [
    {
      command: `node ${join(repoNodeModules, 'tsx', 'dist', 'cli.mjs')} server/serve-runner.ts`,
      cwd: root,
      env: { PORT: String(SERVE_PORT), DOC_ID: 'consumer-doc', SEED_ROWS: '60' },
      url: `http://127.0.0.1:${SERVE_PORT}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // 本番 build を preview で配信する（dev の HMR WebSocket / dev interval を持ち込まない＝leak 計測を production 相当で clean にする）。
      // build は scripts/consumer-app.sh が事前に実行する（webServer は preview のみ）。
      command: `node ${join(repoNodeModules, 'vite', 'bin', 'vite.js')} preview --host 127.0.0.1 --port ${VITE_PORT} --strictPort`,
      cwd: root,
      url: `${BASE_URL}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
