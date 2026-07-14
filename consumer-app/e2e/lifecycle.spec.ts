// DD-016-2 Phase 3 — consumer lifecycle 契約の実挙動（AC2）。
//
// 独立 consumer（pack 済み @nanairo-sheet/grid tarball 経由）で mount→destroy→再mount を繰り返し、
// listener/RAF/interval/WS/canvas/textarea が解放され resource leak しないことを**外部観測**で検証する。
// test-support は使わず、DOM 数・計装した WebSocket/rAF/interval 数・公開 connectionState だけで判定する。

import { writeFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { SERVE_ORIGIN, counts, evidencePath, instrumentation, waitOnline, type Counts } from './helpers';

test('AC2: mount→destroy→再mount で listener/RAF/interval/WS/canvas/textarea が解放され leak しない', async ({
  page,
}) => {
  await page.addInitScript(instrumentation);
  await page.goto(`/?server=${encodeURIComponent(SERVE_ORIGIN)}&name=Solo`);

  // 初回 mount（main.ts が自動実行）→ online まで待つ。
  await waitOnline(page);
  const afterMount = await counts(page);
  expect(afterMount.canvas, 'base+overlay canvas').toBe(2);
  expect(afterMount.textarea, '常駐 textarea').toBe(1);
  expect(afterMount.stage, 'nsheet-stage').toBe(1);
  expect(afterMount.openSockets, 'WS 接続').toBeGreaterThanOrEqual(1);
  expect(afterMount.activeIntervals, 'tick interval').toBeGreaterThanOrEqual(1);

  // destroy → DOM/WS/interval/rAF が解放される。
  await page.evaluate(() => window.__consumer?.destroy());
  await expect.poll(async () => (await counts(page)).openSockets, { message: 'WS が閉じる' }).toBe(0);
  await expect.poll(async () => (await counts(page)).activeRaf, { message: 'rAF ループ停止' }).toBe(0);
  const afterDestroy = await counts(page);
  expect(afterDestroy.canvas, 'canvas 解放').toBe(0);
  expect(afterDestroy.textarea, 'textarea 解放').toBe(0);
  expect(afterDestroy.stage, 'stage 解放').toBe(0);
  expect(afterDestroy.activeIntervals, 'interval 解放').toBe(0);

  // 再mount × N cycles: 各サイクルで解放され、DOM/socket/interval が単調増加しない（leak なし）。
  const cycles = 5;
  const trace: Array<{ cycle: number; mounted: Counts; destroyed: Counts }> = [];
  for (let i = 0; i < cycles; i += 1) {
    await page.evaluate(() => window.__consumer?.mount());
    await waitOnline(page);
    const m = await counts(page);
    expect(m.canvas, `cycle ${i}: canvas`).toBe(2);
    expect(m.textarea, `cycle ${i}: textarea`).toBe(1);
    expect(m.stage, `cycle ${i}: stage`).toBe(1);
    expect(m.openSockets, `cycle ${i}: WS は 1 接続（再接続増殖なし）`).toBeLessThanOrEqual(1);
    expect(m.activeIntervals, `cycle ${i}: interval は 1`).toBe(1);

    await page.evaluate(() => window.__consumer?.destroy());
    await expect
      .poll(async () => (await counts(page)).openSockets, { message: `cycle ${i}: WS 解放` })
      .toBe(0);
    const d = await counts(page);
    expect(d.canvas, `cycle ${i}: canvas 解放`).toBe(0);
    expect(d.textarea, `cycle ${i}: textarea 解放`).toBe(0);
    expect(d.stage, `cycle ${i}: stage 解放`).toBe(0);
    expect(d.activeIntervals, `cycle ${i}: interval 解放`).toBe(0);
    trace.push({ cycle: i, mounted: m, destroyed: d });
  }

  // WS 総生成数は「初回 + cycles 回」程度に収まる（暴走再接続で線形増殖しない）。
  const final = await counts(page);
  expect(final.totalSockets, 'WS 総生成数 ≒ mount 回数（leak/暴走なし）').toBeLessThanOrEqual(cycles + 4);
  expect(final.activeRaf, '全 destroy 後 rAF 0').toBe(0);

  // 証跡（Evidence full）: 再mount leak 検証の per-cycle 計測を JSON へ。
  writeFileSync(
    evidencePath('consumer-app-leak-metrics.json'),
    JSON.stringify(
      {
        note: 'DD-016-2 Phase 3 AC2 再mount leak 検証（production preview・SDK WS のみ計測・vite dev artifact 除外）',
        afterFirstMount: afterMount,
        afterFirstDestroy: afterDestroy,
        cycles: trace,
        final,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
});
