// ESLint flat config（typescript-eslint recommended ベース）。
// 対象は packages/** と apps/** の TypeScript。package boundary lint（計画書 §17.2）は
// パッケージが増える PoC-C 以降で別途導入する（DD-001 では基本設定まで）。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/build/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // 未定義参照は TypeScript コンパイラが検出するため no-undef は無効化する
      // （typescript-eslint 推奨の運用。DOM グローバル等の誤検知を避ける）。
      'no-undef': 'off',
    },
  },
);
