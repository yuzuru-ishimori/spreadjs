import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

// DD-017-2: showcase（紹介サイト＋動作デモ）の起動・主要導線 smoke。
// 「壊れたデモは無いより悪い」を機械的に防ぐ（AC7）。apps/playground/playwright.config.ts と同型。
//
// ポートは playground E2E（Vite 5199 / WS 8799）・手動 dev（5885/5886/9499）と衝突しない専用値。

const PORT = 5201;
const BASE_URL = `http://localhost:${PORT}`;
const WS_PORT = 8801;

const serverHonoDir = fileURLToPath(new URL('../../packages/server-hono', import.meta.url));

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  outputDir: 'test-results',
  timeout: 45_000,
  expect: { timeout: 8_000 },
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
      command: `npm run dev -- --port ${PORT} --strictPort`,
      url: `${BASE_URL}/index.html`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // デモ smoke 用の実 WS サーバー。SEED_NONEMPTY で初期 replay を軽くして安定・高速化
      // （playground E2E と同じ判断。行数 50,000 は保つ）。
      command: 'npm run dev:integration',
      cwd: serverHonoDir,
      env: { PORT: String(WS_PORT), SEED_NONEMPTY: '3000' },
      url: `http://127.0.0.1:${WS_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
