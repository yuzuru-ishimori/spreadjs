// migration guide dry-run 検証（DD-028・S2-3「migration guide の存在と dry-run 検証」）。
//
// doc/migration/ の全ガイド（NNNN-*.md）から fenced code block（```ts before / ```ts after）を抽出し、
// consumer 視点の仮想 TS ファイルとして現行 API に対し型検査する:
//   - before ブロック: **現行 API で型 error（≥1 diagnostic）** — 「移行が必要な変更である」ことの証拠。
//     （型検査基盤が壊れて全て 0 diagnostics になる故障は、この ≥1 検査が canary として検出する。）
//     info string の `expect=TS2367,TS2741` で**期待エラーコード集合を固定**できる（Codex P2・DD-028）:
//     1 ブロックに独立した複数の移行点を書いた場合、片方だけが将来の API 変化で valid になっても
//     「≥1」では素通りするため、expect 指定時は観測コード集合との**完全一致**を要求する。
//   - after ブロック: **型検査 green（0 diagnostics）** — 「ガイドの手順が現行 API で通る」ことの証拠。
// CI（checks job・DD-028）で継続実行され、API が進化してガイドが古くなった時点で fail する
// （その時はガイドを現行 API に合わせて更新する。運用規定: doc/migration/README.md §3）。
//
// before/after ブロックを持たないガイド（型に現れない挙動変更）は、本文へ「型 dry-run の対象外」と
// 明記されている場合のみ許容する（README §3）。
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT_ABS = fileURLToPath(new URL('../../', import.meta.url)).replace(/\\/g, '/');
const MIGRATION_DIR = `${ROOT_ABS}doc/migration`;
const GUIDE_FILE_RE = /^\d{4}-.+\.md$/;
const SNIPPET_RE = /```ts (before|after)([^\n]*)\n([\s\S]*?)```/g;
const EXPECT_RE = /expect=(TS\d+(?:,TS\d+)*)/;
const EXEMPT_MARKER = '型 dry-run の対象外';

interface Snippet {
  /** 仮想 TS ファイルの絶対パス（POSIX）。リポジトリルート直下に置き node_modules 解決を効かせる。 */
  readonly virtualPath: string;
  readonly kind: 'before' | 'after';
  readonly guide: string;
  readonly code: string;
  /** before の期待エラーコード集合（info string `expect=TS2367,TS2741`。指定時は完全一致を要求）。 */
  readonly expectedCodes: readonly string[] | undefined;
}

/** doc/migration/ のガイドから before/after snippet を抽出する（改行は LF へ正規化）。 */
function collectSnippets(): { snippets: Snippet[]; guides: string[]; exemptGuides: string[] } {
  const guides = readdirSync(MIGRATION_DIR)
    .filter((name) => GUIDE_FILE_RE.test(name))
    .sort();
  const snippets: Snippet[] = [];
  const exemptGuides: string[] = [];
  for (const guide of guides) {
    const content = readFileSync(`${MIGRATION_DIR}/${guide}`, 'utf8').replace(/\r\n/g, '\n');
    let found = 0;
    for (const match of content.matchAll(SNIPPET_RE)) {
      const kind = match[1] === 'before' ? 'before' : 'after';
      const expectMatch = EXPECT_RE.exec(match[2]);
      snippets.push({
        virtualPath: `${ROOT_ABS}__migration-dryrun__/${guide.replace(/\.md$/, '')}.${kind}-${found}.ts`,
        kind,
        guide,
        code: match[3],
        expectedCodes: expectMatch === null ? undefined : expectMatch[1].split(','),
      });
      found += 1;
    }
    if (found === 0 && content.includes(EXEMPT_MARKER)) {
      exemptGuides.push(guide);
    }
  }
  return { snippets, guides, exemptGuides };
}

/**
 * 全 snippet を 1 program に束ねて型検査し、仮想ファイルごとの diagnostics 件数を返す
 * （lib 読込のコールドコストを 1 回に抑える）。仮想ファイルは CompilerHost で in-memory 供給する。
 */
function typecheckSnippets(snippets: readonly Snippet[]): Map<string, readonly ts.Diagnostic[]> {
  const options: ts.CompilerOptions = {
    noEmit: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    strict: true,
    skipLibCheck: true,
    types: ['node'],
  };
  const byPath = new Map(snippets.map((s) => [s.virtualPath, s]));
  const host = ts.createCompilerHost(options);
  const realGetSourceFile = host.getSourceFile.bind(host);
  const realFileExists = host.fileExists.bind(host);
  const realReadFile = host.readFile.bind(host);
  const normalize = (fileName: string): string => fileName.replace(/\\/g, '/');
  host.fileExists = (fileName) => byPath.has(normalize(fileName)) || realFileExists(fileName);
  host.readFile = (fileName) => byPath.get(normalize(fileName))?.code ?? realReadFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const snippet = byPath.get(normalize(fileName));
    if (snippet !== undefined) {
      return ts.createSourceFile(fileName, snippet.code, languageVersion, true);
    }
    return realGetSourceFile(fileName, languageVersion, onError, shouldCreate);
  };
  const program = ts.createProgram([...byPath.keys()], options, host);
  const result = new Map<string, readonly ts.Diagnostic[]>();
  for (const path of byPath.keys()) {
    const sourceFile = program.getSourceFile(path);
    if (sourceFile === undefined) {
      throw new Error(`仮想 snippet が program に載っていません: ${path}`);
    }
    result.set(path, [
      ...program.getSyntacticDiagnostics(sourceFile),
      ...program.getSemanticDiagnostics(sourceFile),
    ]);
  }
  return result;
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics
    .map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`)
    .join('\n');
}

// createProgram（lib 読込込み）のコールドコストがあるため明示 timeout（facade-surface と同じ扱い）。
const TYPECHECK_TIMEOUT_MS = 60_000;

describe('contract: migration guide dry-run（before=現行APIで型error／after=green・S2-3）', () => {
  const { snippets, guides, exemptGuides } = collectSnippets();

  it('ガイドが1本以上あり、各ガイドは before/after を持つ（または対象外マーカーを明記）', () => {
    expect(guides.length).toBeGreaterThan(0);
    for (const guide of guides) {
      const kinds = new Set(snippets.filter((s) => s.guide === guide).map((s) => s.kind));
      const exempt = exemptGuides.includes(guide);
      // before/after の両方があるか、無い場合は「型 dry-run の対象外」の明記が必要（README §3）。
      expect(
        (kinds.has('before') && kinds.has('after')) || exempt,
        `${guide}: before/after ブロックが欠けています（挙動変更のみなら「${EXEMPT_MARKER}」を本文へ明記）`,
      ).toBe(true);
    }
  });

  it(
    '全 before ブロックは現行 API で型 error・全 after ブロックは型検査 green',
    () => {
      const dryrunTargets = snippets.filter((s) => s.kind === 'before' || s.kind === 'after');
      expect(dryrunTargets.length).toBeGreaterThan(0);
      const diagnosticsByPath = typecheckSnippets(dryrunTargets);
      for (const snippet of dryrunTargets) {
        const diagnostics = diagnosticsByPath.get(snippet.virtualPath) ?? [];
        if (snippet.kind === 'before') {
          expect(
            diagnostics.length,
            `${snippet.guide} の before は現行 API で型 error になるべきです（0 件＝移行不要になった可能性。ガイドを見直すこと）`,
          ).toBeGreaterThan(0);
          if (snippet.expectedCodes !== undefined) {
            // expect 指定時は観測コード集合と完全一致（独立した移行点の片方だけ陳腐化しても検出する・Codex P2）。
            const observed = [...new Set(diagnostics.map((d) => `TS${d.code}`))].sort();
            expect(
              observed,
              `${snippet.guide} の before の型 error 集合が期待とズレています（ガイドの一部が陳腐化した可能性）:\n${formatDiagnostics(diagnostics)}`,
            ).toEqual([...snippet.expectedCodes].sort());
          }
        } else {
          expect(
            diagnostics.length,
            `${snippet.guide} の after が現行 API で型 error です:\n${formatDiagnostics(diagnostics)}`,
          ).toBe(0);
        }
      }
    },
    TYPECHECK_TIMEOUT_MS,
  );
});
