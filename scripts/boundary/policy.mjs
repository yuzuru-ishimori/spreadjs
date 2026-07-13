// package 境界の DAG 定義（正本: DD-009 `doc/archived/DD/DD-009/package-boundary.md` §4.1）。
// eslint.config.js（R2/R3/R5・specifier ベース）と scripts/boundary/check.mjs（R1/R4/R7・path/AST ベース）が
// 共有する **単一定義**。規約の新規発明はしない（DD-011 は実装のみ）。

export const SCOPE = '@nanairo-sheet';

/** 内部パッケージ（consumer 直接 import 禁止・R1 の対象）。 */
export const INTERNAL_PACKAGES = [
  'types',
  'core',
  'collab',
  'server',
  'selection',
  'render',
  'ime',
  'formula',
];

/** Facade パッケージ（consumer が import してよい唯一の公開面）。 */
export const FACADE_PACKAGES = ['grid', 'server-hono', 'element', 'react'];

/** §4.1 許可 import 方向。key=package 名、value=許可される import 先 package 名の配列。 */
export const ALLOWED_DEPS = {
  // Facade
  grid: ['core', 'types', 'collab', 'render', 'selection', 'ime'],
  'server-hono': ['server', 'core', 'types'],
  element: ['grid'],
  react: ['grid'],
  // Internal
  render: ['core', 'types', 'selection'],
  ime: ['core', 'types'],
  selection: ['core', 'types'],
  collab: ['core', 'types'],
  server: ['core', 'types'],
  formula: ['core', 'types'],
  core: ['types'],
  types: [],
};

/** consumer（apps/*・独立 consumer harness）は Facade のみ import 可。 */
export const CONSUMER_ALLOWED = [...FACADE_PACKAGES];

/** SDK package 全体（内部＋Facade）。 */
export const ALL_SDK_PACKAGES = [...INTERNAL_PACKAGES, ...FACADE_PACKAGES];

/** 現行 apps/* の package 名（R5: apps 間 import 禁止の by-name 判定用）。 */
export const APP_PACKAGES = [
  'playground',
  'collaboration-server',
  'pocd-bench',
  'pocd-browser-bench',
];

/**
 * package P が import してよい SDK package の集合（P 自身を除く）。
 * P が未知（=consumer/app）なら CONSUMER_ALLOWED（Facade のみ）。
 */
export function allowedTargetsOf(pkgName) {
  if (Object.prototype.hasOwnProperty.call(ALLOWED_DEPS, pkgName)) {
    return ALLOWED_DEPS[pkgName];
  }
  return CONSUMER_ALLOWED;
}

/**
 * package P が import してはいけない SDK package の集合（R2/R3 用）。
 * = 全 SDK package − 許可先 − 自身。
 */
export function forbiddenSdkTargetsOf(pkgName) {
  const allowed = new Set(allowedTargetsOf(pkgName));
  return ALL_SDK_PACKAGES.filter((q) => q !== pkgName && !allowed.has(q));
}

/** repo 相対（posix）ファイルパスから所属 package を判定する。SDK/app 外は null。 */
export function packageOfFile(relPathPosix) {
  const m = /^(packages|apps)\/([^/]+)\//.exec(relPathPosix);
  if (!m) return null;
  const [, area, name] = m;
  if (area === 'packages') {
    const kind = FACADE_PACKAGES.includes(name) ? 'facade' : 'internal';
    return { area, name, kind, root: `packages/${name}` };
  }
  return { area, name, kind: 'app', root: `apps/${name}` };
}

/** import specifier から `@nanairo-sheet/<pkg>` の <pkg> を返す（subpath 対応）。SDK 外は null。 */
export function sdkTargetOfSpecifier(spec) {
  const m = /^@nanairo-sheet\/([^/]+)/.exec(spec);
  return m ? m[1] : null;
}
