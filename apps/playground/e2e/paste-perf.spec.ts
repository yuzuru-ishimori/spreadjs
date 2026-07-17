// DD-020 Phase 4 / AC11: 10,000 セル paste の「ローカル適用」headed 計測。
//
// 計測対象＝**ローカル楽観適用**（計画書 §21「ローカル適用 250〜500ms」）。paste フローは同期:
//   parse(TSV) → buildPaste（型変換 parseCellInput・beforeRevision 捕捉）→ submitSetCells
//   → session.submitLocalOperation（optimistic apply を同期実行）→ recordUndoEntry。
// この一連の同期処理を、常駐 textarea への合成 ClipboardEvent(paste) dispatch を
// performance.now() で挟んで in-page 計測する（サーバー ACK は待たない＝pending へ積まれる）。
// 再描画（rAF）は本計測に含めない（frame 予算は DD-004/012-2 で別途担保）。
//
// 形状: 1,000 行 × 10 列 = 10,000 セル（値のみ・number/string 混在で parseCellInput を実運用相当に働かせる）。
// 複数アンカーで N 回計測し min/median/max を report する（1 回のノイズに依存しない）。
//
// 再現コマンド:
//   npx playwright test --config apps/playground/playwright.config.ts paste-perf --headed
// （webServer は playwright.config.ts が自動起動＝playground:5885 相当ポート＋server-hono 50,000行×200列シード）

import { expect, test } from '@playwright/test';

import { colIdAt, committedCell, openClient, rowIdAt, selectCell } from './integration-helpers';

const ROWS = 1000;
const COLS = 10;
const CELLS = ROWS * COLS; // 10,000
const RUNS = 5;

// アンカーは可視域の先頭付近（scroll+click の座標マッピングに依存しない＝行安定）。paste は下方向 1,000 行へ
// 展開するが対象 RowId は全 50,000 行の Axis に存在するため可視である必要はない（buildPaste は index→RowId 解決）。
// run ごとに top-left セルは別（read 対象が run 固有値で衝突しない）。範囲の重なりは計測に無影響。
const ANCHORS = [2, 4, 6, 8, 10];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

test('PP-1: 10,000 セル paste のローカル適用時間を計測する（AC11・§21 目標 250〜500ms）', async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await openClient(browser, 'paste-perf');
  try {
    const samples: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const anchor = ANCHORS[run];
      // アンカー行は可視域先頭付近を単一選択（paste は左上アンカーから ROWS×COLS 展開）。
      await selectCell(page, anchor, 1);

      const anchorRowId = await rowIdAt(page, anchor);
      const anchorColId = await colIdAt(page, 1);

      // in-page: TSV を組み立て、常駐 textarea への合成 paste dispatch を performance.now() で挟む（同期のローカル適用を計測）。
      const result = await page.evaluate(
        ({ rows, cols, runIndex }) => {
          const ta = document.querySelector('textarea.int-cell-editor');
          if (!(ta instanceof HTMLTextAreaElement)) {
            throw new Error('int-cell-editor が見つからない');
          }
          // number/string 混在の TSV（値のみ）。列 0,2,4,.. は数値・奇数列は文字列。run ごとに値を変える。
          const lines: string[] = [];
          for (let r = 0; r < rows; r += 1) {
            const row: string[] = [];
            for (let c = 0; c < cols; c += 1) {
              row.push(c % 2 === 0 ? String(runIndex * 100000 + r * cols + c) : `v${runIndex}-${r}-${c}`);
            }
            lines.push(row.join('\t'));
          }
          const tsv = lines.join('\n');

          ta.focus();
          const dt = new DataTransfer();
          dt.setData('text/plain', tsv);
          const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
          const t0 = performance.now();
          ta.dispatchEvent(event);
          const t1 = performance.now();
          return { ms: t1 - t0, prevented: event.defaultPrevented, bytes: tsv.length };
        },
        { rows: ROWS, cols: COLS, runIndex: run },
      );

      // グリッドが paste を消費し（preventDefault）、左上アンカーへ TSV[0][0]（=run 固有の数値）が入る（ローカル適用が起きた）。
      // pending 件数は ACK 到着と競合するため、値ベースで検証する（ACK 非依存で堅牢）。
      expect(result.prevented, `run ${run}: グリッドが paste を消費`).toBe(true);
      const expectedTopLeft = String(run * 100000);
      await expect
        .poll(async () => committedCell(page, anchorRowId!, anchorColId!), { message: `run ${run}: paste がローカル適用` })
        .toBe(expectedTopLeft);

      samples.push(result.ms);
      console.log(`[paste-perf] run ${run}: anchor=${anchor} cells=${CELLS} localApplyMs=${result.ms.toFixed(1)} bytes=${result.bytes}`);
    }

    const min = Math.min(...samples);
    const med = median(samples);
    const max = Math.max(...samples);
    const report = `[paste-perf] cells=${CELLS} runs=${RUNS} min=${min.toFixed(1)}ms median=${med.toFixed(1)}ms max=${max.toFixed(1)}ms budget(§21)=250〜500ms`;
    console.log(report);
    test.info().annotations.push({ type: 'paste-perf', description: report });

    // 回帰ガード: 中央値が明確な退行域（>2,000ms＝目標の 4〜8 倍）に無いこと。実測値は DD へ記録（AC11 の evidence）。
    expect(med, `median localApply ${med.toFixed(1)}ms が回帰ガード内`).toBeLessThan(2000);
  } finally {
    await context.close();
  }
});
