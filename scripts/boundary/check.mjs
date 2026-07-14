// package boundary lint — AST/path ベースの境界検査（正本: DD-009 package-boundary.md §4）。
//
// 本スクリプトが担当するルール（正規表現のみでは不可なもの・baseline が要るもの）:
//   R1: consumer/apps/* が内部パッケージを直接 import（既存 apps は baseline・新規のみ ERROR。§4.3）
//   R4: package 境界を越える相対 import（`../` で隣接 package dir へ侵入）
//   R7: Facade が内部パッケージを再エクスポート／内部型を公開シグネチャへ漏洩（AST・正規表現不可）
// R2/R3/R5（specifier ベースの full-error）は eslint.config.js が担当する。
//
// baseline: `scripts/boundary/baseline.json` の既知例外（R1/R4/R5）は WARN 表示のみで ERROR にしない。
//   新規違反（baseline 外）が 1 件でもあれば exit 1。R7 は baseline 対象外（Facade は常に clean）。
//   `node scripts/boundary/check.mjs --update-baseline` で現在の baseline 可能な違反を baseline へ固定化する。
//
// 縮退責務: baseline は各抽出DD（DD-012〜016）が縮小し、DD-018（S1-1）が baseline 空を機械確認する。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  packageOfFile,
  sdkTargetOfSpecifier,
  INTERNAL_PACKAGES,
  ALL_SDK_PACKAGES,
} from './policy.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE_PATH = path.join(REPO_ROOT, 'scripts', 'boundary', 'baseline.json');
const UPDATE_BASELINE = process.argv.includes('--update-baseline');

/** repo 相対の posix パスへ正規化。 */
function toRel(abs) {
  return path.relative(REPO_ROOT, abs).split(path.sep).join('/');
}

// §4.3 の test 例外: *.test.ts と、テスト専用ハーネス（test-support / InProcessHub＝Room 依存の
// inprocess-transport）は境界検査の対象外（本体エントリからは公開しない試験専用資産）。
const TEST_INFRA_FILES = new Set(['test-support.ts', 'inprocess-transport.ts']);

/** packages/* と apps/* の src 配下 .ts を列挙（*.test.ts・テスト専用ハーネスは §4.3 で除外）。 */
function collectSourceFiles() {
  const roots = [];
  for (const area of ['packages', 'apps']) {
    const areaDir = path.join(REPO_ROOT, area);
    if (!fs.existsSync(areaDir)) continue;
    for (const name of fs.readdirSync(areaDir)) {
      const srcDir = path.join(areaDir, name, 'src');
      if (fs.existsSync(srcDir)) roots.push(srcDir);
    }
  }
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (
        /\.tsx?$/.test(ent.name) &&
        !/\.test\.tsx?$/.test(ent.name) &&
        !TEST_INFRA_FILES.has(ent.name)
      ) {
        out.push(full);
      }
    }
  };
  for (const r of roots) walk(r);
  return out.sort();
}

/**
 * 1 ファイルの module 参照を AST 全体から抽出する。
 * 静的 import/export に加え、**動的 import（`import('x')`）と型位置の import（`import('x').Y`）も対象**にする
 * （Codex P1: トップレベル宣言のみだと動的 import で境界を回避できる）。
 */
function readModuleRefs(absPath, text) {
  const sf = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true);
  /** @type {{spec:string, isReexport:boolean}[]} */
  const refs = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      refs.push({ spec: node.moduleSpecifier.text, isReexport: false });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      // `export * from 'x'` / `export { A } from 'x'` / `export type { A } from 'x'`
      refs.push({ spec: node.moduleSpecifier.text, isReexport: true });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      // 動的 import: `import('x')` / `await import('x')`
      refs.push({ spec: node.arguments[0].text, isReexport: false });
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      // 型位置の import: `import('x').Y`
      refs.push({ spec: node.argument.literal.text, isReexport: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { sf, refs };
}

/** Facade ファイルの R7 検査: 内部 import の再エクスポート／公開シグネチャへの内部型漏洩を検出する。 */
function analyzeFacadeR7(sf, rel, addFn) {
  // 1. 内部パッケージから import した **ローカル名**を集める（named/default/namespace）。
  const internalNames = new Set();
  const walkImports = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const target = sdkTargetOfSpecifier(node.moduleSpecifier.text);
      if (target && INTERNAL_PACKAGES.includes(target) && node.importClause) {
        const { name, namedBindings } = node.importClause;
        if (name) internalNames.add(name.text);
        if (namedBindings) {
          if (ts.isNamespaceImport(namedBindings)) internalNames.add(namedBindings.name.text);
          else for (const el of namedBindings.elements) internalNames.add(el.name.text);
        }
      }
    }
    ts.forEachChild(node, walkImports);
  };
  walkImports(sf);

  // 2. 公開宣言（export 修飾子付き）の**シグネチャ**（本体 Block は除外）に内部名が現れたら R7 漏洩。
  const collectSignatureRefs = (node, acc) => {
    ts.forEachChild(node, (child) => {
      if (ts.isBlock(child)) return; // 関数/メソッド本体は実装＝シグネチャでない
      if (ts.isIdentifier(child) && internalNames.has(child.text)) acc.add(child.text);
      collectSignatureRefs(child, acc);
    });
  };
  const hasExportModifier = (node) =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

  for (const stmt of sf.statements) {
    // `import {X} from 'core'; export {X};`（moduleSpecifier なし）での内部名 re-export も R7。
    if (ts.isExportDeclaration(stmt) && !stmt.moduleSpecifier && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) {
        const local = (el.propertyName ?? el.name).text;
        if (internalNames.has(local)) {
          addFn('R7', rel, `reexport:${local}`, `Facade は内部パッケージ由来のシンボル（${local}）を再エクスポートできない（内部 API 漏洩）`);
        }
      }
      continue;
    }
    if (!hasExportModifier(stmt)) continue;
    const acc = new Set();
    collectSignatureRefs(stmt, acc);
    for (const leaked of acc) {
      addFn('R7', rel, `signature:${leaked}`, `Facade の公開シグネチャに内部パッケージ由来の型（${leaked}）が漏洩している。公開型は Facade 自身で定義する`);
    }
  }
}

const violations = []; // {rule, file, detail, message}（signature 単位で重複排除）
const seenSig = new Set();
function add(rule, file, detail, message) {
  const s = `${rule}|${file}|${detail}`;
  if (seenSig.has(s)) return;
  seenSig.add(s);
  violations.push({ rule, file, detail, message });
}

for (const abs of collectSourceFiles()) {
  const rel = toRel(abs);
  const owner = packageOfFile(rel);
  if (!owner) continue;
  // R7 は Facade の**公開エントリ（package.json "exports" が指す src/index.ts）**のみを対象にする。
  // Facade package 内の内部実装ファイル（glue）は公開面ではないため R7 検査から除外する（DD-016）:
  // grid Facade は collab+render+selection+ime を束ねる glue を内包し、glue の export は内部 package 型を
  // 使うが、これは「公開シグネチャ」ではない。R7 の意図＝公開面（src/index.ts）の非漏洩を担保する。
  // test-support.ts は collectSourceFiles で既に除外済み（TEST_INFRA_FILES）。
  const isFacadeEntry = owner.kind === 'facade' && rel === `${owner.root}/src/index.ts`;
  const text = fs.readFileSync(abs, 'utf8');
  const { sf, refs } = readModuleRefs(abs, text);

  for (const ref of refs) {
    const spec = ref.spec;

    // ---- R4: package 境界を越える相対 import ----
    if (spec.startsWith('.')) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
      if (!resolved.startsWith(owner.root + '/')) {
        add('R4', rel, spec, `package 境界を越える相対 import（${spec} → ${resolved}）。package 参照は package 名で行う`);
      }
      continue;
    }

    const target = sdkTargetOfSpecifier(spec);
    if (target === null) continue; // SDK 外（node/ws/vite 等）は対象外

    // ---- R1: consumer/apps/* が内部パッケージを直接 import ----
    if (owner.kind === 'app' && INTERNAL_PACKAGES.includes(target)) {
      add('R1', rel, spec, `consumer/apps は内部パッケージ（@nanairo-sheet/${target}）を直接 import できない。Facade 経由にする`);
    }

    // ---- R7（再エクスポート）: Facade の公開エントリが `export … from '@nanairo-sheet/内部'` で内部を素通し ----
    if (isFacadeEntry && ref.isReexport && ALL_SDK_PACKAGES.includes(target)) {
      add('R7', rel, `reexport-from:${spec}`, `Facade は内部/他 package（@nanairo-sheet/${target}）を再エクスポートできない（内部 API 漏洩）`);
    }
  }

  // ---- R7（内部型の公開シグネチャ漏洩・named re-export）: 公開エントリ（src/index.ts）のみ検査する ----
  if (isFacadeEntry) {
    analyzeFacadeR7(sf, rel, add);
  }
}

// ---- baseline 突合 ----
function sig(v) {
  return `${v.rule}|${v.file}|${v.detail}`;
}
function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return { entries: [] };
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

const BASELINEABLE = new Set(['R1', 'R4', 'R5']); // R7 は baseline 不可（Facade は常に clean）

if (UPDATE_BASELINE) {
  const entries = violations
    .filter((v) => BASELINEABLE.has(v.rule))
    .map((v) => ({
      rule: v.rule,
      file: v.file,
      detail: v.detail,
      owner: ownerDdOf(v.file),
      reason: reasonOf(v),
    }));
  const doc = {
    _doc:
      'package boundary lint の既知例外（baseline）。新規違反のみ ERROR（scripts/boundary/check.mjs）。' +
      'DD-011 設置・縮退は各抽出DD（DD-012〜016）・baseline 空の確認は DD-018（S1-1）。',
    entries,
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  console.log(`[boundary] baseline updated: ${entries.length} entries → ${toRel(BASELINE_PATH)}`);
  process.exit(0);
}

function ownerDdOf(file) {
  if (file.startsWith('apps/playground/')) return 'DD-012/DD-016（grid consumer 抽出・統合で縮退）';
  if (file.startsWith('apps/collaboration-server/')) return 'DD-016（server-hono Facade 統合で縮退）';
  if (file.startsWith('apps/pocd-')) return 'none（PoC-D throwaway・DD-006・製品憲章 §25 対象外）';
  return 'unassigned';
}
function reasonOf(v) {
  if (v.rule === 'R1') return 'Facade 未配線のため apps が内部 package を直接 import（抽出前の既知状態）';
  if (v.rule === 'R4') return 'package 境界越え相対 import（PoC-D throwaway・構造変更不要のため baseline）';
  return v.message;
}

const baseline = loadBaseline();
const baselineSigs = new Set(baseline.entries.map(sig));

const knownBaselined = [];
const newViolations = [];
for (const v of violations) {
  if (BASELINEABLE.has(v.rule) && baselineSigs.has(sig(v))) {
    knownBaselined.push(v);
  } else {
    newViolations.push(v);
  }
}

// baseline に残っているが今は解消済みのエントリ（縮退の進捗確認用）。
const liveSigs = new Set(violations.map(sig));
const staleBaseline = baseline.entries.filter((e) => !liveSigs.has(sig(e)));

console.log(
  `[boundary] scanned SDK/app src. baselined=${knownBaselined.length} new=${newViolations.length} stale-baseline=${staleBaseline.length}`,
);

if (newViolations.length > 0) {
  console.error('\n[boundary] NEW boundary violations (ERROR):');
  for (const v of newViolations) {
    console.error(`  [${v.rule}] ${v.file}\n        ${v.message}`);
  }
  console.error(
    '\n修正するか、baseline 可能（R1/R4/R5）なら `node scripts/boundary/check.mjs --update-baseline` で固定化し理由を記録すること。',
  );
  process.exit(1);
}

console.log('[boundary] OK — 新規境界違反なし。');
