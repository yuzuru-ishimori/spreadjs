// Facade 公開面 contract test（DD-016 で実 API 確定）。
//
// ① export surface（公開 value シンボル名）を snapshot 契約として固定する（意図しない export の追加/削除で fail
//    ＝公開 API の破壊的変更検出・§2.3 公開API不変条件）。
// ② R7 型漏洩0: Facade エントリ（src/index.ts）の公開 .d.ts を in-memory で emit し、内部パッケージ
//    （core/collab/server/types/selection/render/ime/formula）の specifier が公開宣言に現れないことを検証する
//    （公開シグネチャへ内部型を漏らさない・境界文書 §4.2 R7。boundary lint の AST 検査〔check.mjs〕と二重化）。
//
// 【意図的な surface 変更の手順】
//   1. Facade の公開 export を変える。
//   2. `npx vitest run tests/contract -u` で snapshot を更新する。
//   3. 変更を CHANGELOG（Experimental `0.x`・ADR-0015・DD-017）へ記録し、DD の公開API影響へ明記する。
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import * as grid from '@nanairo-sheet/grid';
import * as serverHono from '@nanairo-sheet/server-hono';

const INTERNAL_PACKAGE_RE = /@nanairo-sheet\/(core|collab|server|types|selection|render|ime|formula)\b/;

function valueSurface(mod: Record<string, unknown>): string[] {
  return Object.keys(mod).sort();
}

/** Facade エントリの**公開 .d.ts** を in-memory で emit する（依存 package の .d.ts は対象外＝公開面のみ走査）。 */
function publicDeclaration(entryRelPath: string): string {
  const entry = fileURLToPath(new URL(`../../${entryRelPath}`, import.meta.url)).replace(/\\/g, '/');
  const program = ts.createProgram([entry], {
    declaration: true,
    emitDeclarationOnly: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    strict: true,
    skipLibCheck: true,
    types: ['node'],
  });
  let dts = '';
  program.emit(undefined, (fileName, data) => {
    // エントリ index.ts に対応する .d.ts のみを採取する（内部 package の .d.ts は公開面ではない）。
    if (fileName.replace(/\\/g, '/').replace(/\.d\.ts$/, '.ts') === entry) {
      dts = data;
    }
  });
  return dts;
}

describe('contract: Facade export surface snapshot', () => {
  it('@nanairo-sheet/grid の公開 value surface', () => {
    expect(valueSurface(grid)).toMatchSnapshot();
  });

  it('@nanairo-sheet/server-hono の公開 value surface', () => {
    expect(valueSurface(serverHono)).toMatchSnapshot();
  });
});

// 各ケースは公開 .d.ts を in-memory で emit する（ts.createProgram＝lib 読込込みのコールドコスト大）。
// 既定 5s では全体スイート同時実行の負荷下で稀に timeout するため、明示 timeout を与える（DD-017）。
const DTS_EMIT_TIMEOUT_MS = 30_000;

describe('contract: R7 内部型漏洩0（公開 .d.ts に内部パッケージ型が現れない）', () => {
  it(
    '@nanairo-sheet/grid の公開宣言は内部パッケージ型を漏らさない',
    () => {
      const dts = publicDeclaration('packages/grid/src/index.ts');
      expect(dts.length).toBeGreaterThan(0);
      expect(dts).not.toMatch(INTERNAL_PACKAGE_RE);
    },
    DTS_EMIT_TIMEOUT_MS,
  );

  it(
    '@nanairo-sheet/server-hono の公開宣言は内部パッケージ型を漏らさない',
    () => {
      const dts = publicDeclaration('packages/server-hono/src/index.ts');
      expect(dts.length).toBeGreaterThan(0);
      expect(dts).not.toMatch(INTERNAL_PACKAGE_RE);
    },
    DTS_EMIT_TIMEOUT_MS,
  );
});
