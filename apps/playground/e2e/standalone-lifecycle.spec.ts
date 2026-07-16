// DD-024 Phase 3 E2E #4（AC5）: 単独モードの destroy→再mount 反復でリークしない。
//
// consumer-app/e2e/lifecycle.spec.ts の範型を単独モードへ適用。WS/rAF/interval/DOM を addInitScript で
// 計装し外部観測する。単独モードは WS を一切張らない（openSockets 常に 0）・tick interval を持たない
// （activeIntervals 0）ことも確認する。

import { expect, test } from '@playwright/test';

import { evidencePath, waitReady } from './standalone-helpers';

/** WebSocket / rAF / setInterval を計装して leak を外部観測可能にする（page 初期化前に注入）。 */
function instrumentation(): void {
  interface LeakState {
    sockets: WebSocket[];
    totalSockets: number;
    activeRaf: number;
    activeIntervals: number;
  }
  const w = window as unknown as { __leakState: LeakState };
  const leak: LeakState = { sockets: [], totalSockets: 0, activeRaf: 0, activeIntervals: 0 };
  w.__leakState = leak;

  const OrigWS = window.WebSocket;
  class CountingWS extends OrigWS {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      leak.totalSockets += 1;
      leak.sockets.push(this);
    }
  }
  window.WebSocket = CountingWS as unknown as typeof WebSocket;

  const rafIds = new Set<number>();
  const origRAF = window.requestAnimationFrame.bind(window);
  const origCAF = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const id = origRAF((t) => {
      rafIds.delete(id);
      leak.activeRaf = rafIds.size;
      cb(t);
    });
    rafIds.add(id);
    leak.activeRaf = rafIds.size;
    return id;
  };
  window.cancelAnimationFrame = (id: number): void => {
    rafIds.delete(id);
    leak.activeRaf = rafIds.size;
    origCAF(id);
  };

  const intervalIds = new Set<number>();
  const origSI = window.setInterval.bind(window);
  const origCI = window.clearInterval.bind(window);
  // @ts-expect-error テスト計装のため setInterval を薄くラップする（型は元と同等）。
  window.setInterval = (handler: TimerHandler, timeout?: number, ...args: unknown[]): number => {
    const id = origSI(handler, timeout, ...args);
    intervalIds.add(id);
    leak.activeIntervals = intervalIds.size;
    return id;
  };
  window.clearInterval = (id?: number): void => {
    if (id !== undefined) {
      intervalIds.delete(id);
      leak.activeIntervals = intervalIds.size;
    }
    origCI(id);
  };
}

interface Counts {
  canvas: number;
  textarea: number;
  stage: number;
  totalSockets: number;
  activeRaf: number;
  activeIntervals: number;
}

async function counts(page: import('@playwright/test').Page): Promise<Counts> {
  return page.evaluate(() => {
    const stageHost = document.getElementById('int-stage');
    const l = (window as unknown as { __leakState: { sockets: WebSocket[]; totalSockets: number; activeRaf: number; activeIntervals: number } }).__leakState;
    // SDK（grid transport）の WS だけを数える（pathname==='/ws'）。単独モードは 0 のはず。vite HMR は除外。
    const isSdk = (url: string): boolean => {
      try {
        return new URL(url).pathname === '/ws';
      } catch {
        return false;
      }
    };
    return {
      canvas: stageHost?.querySelectorAll('canvas').length ?? 0,
      textarea: stageHost?.querySelectorAll('textarea').length ?? 0,
      stage: document.querySelectorAll('.nsheet-stage').length,
      totalSockets: l.sockets.filter((s) => isSdk(s.url)).length,
      activeRaf: l.activeRaf,
      activeIntervals: l.activeIntervals,
    };
  });
}

test('#4 AC5: 単独モード mount→destroy→再mount で leak しない・WS/interval を張らない', async ({ page }) => {
  await page.addInitScript(instrumentation);
  await page.goto('/standalone.html');
  await expect(page.locator('textarea.int-cell-editor')).toBeAttached({ timeout: 30_000 });
  await waitReady(page);

  const afterMount = await counts(page);
  expect(afterMount.canvas, 'base+overlay canvas').toBe(2);
  expect(afterMount.textarea, '常駐 textarea').toBe(1);
  expect(afterMount.stage, 'nsheet-stage').toBe(1);
  expect(afterMount.totalSockets, '単独モードは WS を張らない').toBe(0);

  // destroy → DOM/rAF が解放される。
  await page.evaluate(() => window.__standalone?.destroy());
  await expect.poll(async () => (await counts(page)).activeRaf, { message: 'rAF ループ停止' }).toBe(0);
  const afterDestroy = await counts(page);
  expect(afterDestroy.canvas, 'canvas 解放').toBe(0);
  expect(afterDestroy.textarea, 'textarea 解放').toBe(0);
  expect(afterDestroy.stage, 'stage 解放').toBe(0);
  // interval のベースライン（grid 非依存の環境由来＝Vite dev の常駐 interval 等）。grid destroy 後に確定させ、
  // 以降の mount/destroy でこのベースラインから増えないこと（＝単独モードが interval を張らない・leak しない）を確認する。
  const intervalBaseline = afterDestroy.activeIntervals;
  // mount 直後もベースライン相当（単独モードは tick interval を追加しない）。
  expect(afterMount.activeIntervals, '単独モードは mount で interval を追加しない').toBeLessThanOrEqual(
    intervalBaseline,
  );

  // 再mount × N: 各サイクルで解放され、DOM/rAF/socket が単調増加しない。
  const cycles = 5;
  for (let i = 0; i < cycles; i += 1) {
    await page.evaluate(() => window.__standalone?.mount());
    await waitReady(page);
    const m = await counts(page);
    expect(m.canvas, `cycle ${i}: canvas`).toBe(2);
    expect(m.textarea, `cycle ${i}: textarea`).toBe(1);
    expect(m.stage, `cycle ${i}: stage`).toBe(1);
    expect(m.totalSockets, `cycle ${i}: WS 0`).toBe(0);
    // interval はベースラインから増えない（単独モードは interval を張らず、環境由来の常駐分のみ）。
    expect(m.activeIntervals, `cycle ${i}: interval がベースラインから増えない`).toBeLessThanOrEqual(
      intervalBaseline,
    );

    await page.evaluate(() => window.__standalone?.destroy());
    await expect.poll(async () => (await counts(page)).activeRaf, { message: `cycle ${i}: rAF 停止` }).toBe(0);
    const d = await counts(page);
    expect(d.canvas, `cycle ${i}: canvas 解放`).toBe(0);
    expect(d.stage, `cycle ${i}: stage 解放`).toBe(0);
    expect(d.activeIntervals, `cycle ${i}: interval leak なし`).toBeLessThanOrEqual(intervalBaseline);
  }

  const final = await counts(page);
  expect(final.totalSockets, '単独モードは最後まで WS 0').toBe(0);
  expect(final.activeRaf, '全 destroy 後 rAF 0').toBe(0);

  await page.screenshot({ path: evidencePath('e2e-standalone-4-lifecycle.png') });
});
