import { defineConfig } from '@playwright/test';

// DD-002 Phase 5: 基本操作 E2E（Playwright）。
//
// 対象は PoC-A 環境（index.html = 20×10 グリッド + 常駐 textarea + 編集状態機械）。
// vitest（src/**/*.test.ts, node 環境）とは分離する:
//   - vitest  … `src/**/*.test.ts`（状態機械・geometry 等のユニット）
//   - playwright … `e2e/**/*.spec.ts`（実ブラウザーでの DOM 配線検証）
// 命名（.test.ts / .spec.ts）で棲み分け、testDir も e2e/ に限定して二重実行を避ける。
//
// webServer は明示ポート 5199 + strictPort で dev サーバーを起動し、ポート衝突時は
// 黙って別ポートへ逃げず即失敗させる（baseURL とズレて検証が空振りするのを防ぐ）。
// ランタイム依存は増やさない（Playwright は devDependencies のみ）。

const PORT = 5199;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  // 単一 dev サーバー相手に共有状態はないが、ログを追いやすく決定的にするため直列実行する。
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  outputDir: 'test-results',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    // 設定ファイルの位置（apps/playground）が cwd。playground の `dev` = vite を明示ポートで起動。
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
