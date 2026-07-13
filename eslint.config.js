// ESLint flat config（typescript-eslint recommended ベース）。
// package boundary lint（DD-009 package-boundary.md §4 が正本）を DD-011 で導入した。
//   - R2（Facade 同士の import 禁止）・R3（依存方向の逆流禁止）・R5（apps/* 間 import 禁止）を
//     specifier ベースで no-restricted-imports として本ファイルが担当する（full-error・全体適用）。
//   - R1（consumer→内部）・R4（境界越え相対 import）・R7（Facade 再エクスポート/型漏洩）は
//     baseline / path / AST が要るため `scripts/boundary/check.mjs`（`npm run lint:boundary`）が担当する。
// DAG の単一定義は `scripts/boundary/policy.mjs`。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import {
  ALL_SDK_PACKAGES,
  APP_PACKAGES,
  SCOPE,
  forbiddenSdkTargetsOf,
} from './scripts/boundary/policy.mjs';

/** package 名の配列を no-restricted-imports の patterns（本体＋subpath）へ展開する。 */
function forbidPatterns(pkgNames, message) {
  if (pkgNames.length === 0) return [];
  return [
    {
      group: pkgNames.flatMap((p) => [`${SCOPE}/${p}`, `${SCOPE}/${p}/*`]),
      message,
    },
  ];
}

// R2/R3: 各 SDK package（内部＋Facade）の src に、許可されない SDK package への import を禁止する。
const sdkBoundaryConfigs = ALL_SDK_PACKAGES.map((pkg) => {
  const forbidden = forbiddenSdkTargetsOf(pkg);
  return {
    files: [`packages/${pkg}/src/**/*.{ts,tsx}`],
    ignores: ['**/*.test.{ts,tsx}', '**/test-support.ts', '**/inprocess-transport.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: forbidPatterns(
            forbidden,
            `boundary(R2/R3): @nanairo-sheet/${pkg} からこの package への import は許可されていません（DD-009 §4.1・逆流/Facade間禁止）。`,
          ),
        },
      ],
    },
  };
});

// R5: apps/* の src から他 apps/* package の by-name import を禁止する（consumer 実証の独立性・§4.2 R5）。
const appBoundaryConfig = {
  files: ['apps/*/src/**/*.{ts,tsx}'],
  ignores: ['**/*.test.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: forbidPatterns(
          APP_PACKAGES,
          'boundary(R5): apps/* 間の相互 import は禁止です（consumer 実証の独立性）。共有コードは package へ切り出すこと。',
        ),
      },
    ],
  },
};

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/build/**', '**/node_modules/**', 'consumer-harness/**'],
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
  ...sdkBoundaryConfigs,
  appBoundaryConfig,
  {
    // Node 製の tooling スクリプト（boundary lint 等）。node グローバルを許可する。
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
      },
    },
  },
);
