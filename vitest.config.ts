import { defineConfig } from 'vitest/config';

// ルート集約のテスト設定。types はブラウザー非依存のため node 環境で実行する。
// 画面を伴う PoC が入ったら、対象 workspace 側の設定で jsdom 等へ切り替える。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
  },
});
