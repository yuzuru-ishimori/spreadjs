// React Facade（DD-025）E2E #4（AC6）: React root の mount→unmount→再mount 反復でリークしない。
//
// standalone-lifecycle.spec.ts（DD-024）の範型を React Facade へ適用。WS/rAF/interval/DOM を addInitScript で
// 計装し外部観測する。React unmount → NanairoSheetView の effect cleanup → grid.destroy が走ることを、
// #react-root 内の canvas/textarea/scroller 解放と rAF 停止・WS 非生成で確認する。

import { expect, test, type Page } from '@playwright/test';

import { evidencePath, waitReactReady } from './react-facade-helpers';

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
  scroller: number;
  totalSockets: number;
  activeRaf: number;
  activeIntervals: number;
}

async function counts(page: Page): Promise<Counts> {
  return page.evaluate(() => {
    const rootHost = document.getElementById('react-root');
    const l = (
      window as unknown as {
        __leakState: { sockets: WebSocket[]; totalSockets: number; activeRaf: number; activeIntervals: number };
      }
    ).__leakState;
    // SDK（grid transport）の WS だけを数える（pathname==='/ws'）。単独モードは 0 のはず。vite HMR は除外。
    const isSdk = (url: string): boolean => {
      try {
        return new URL(url).pathname === '/ws';
      } catch {
        return false;
      }
    };
    return {
      canvas: rootHost?.querySelectorAll('canvas').length ?? 0,
      textarea: rootHost?.querySelectorAll('textarea').length ?? 0,
      scroller: rootHost?.querySelectorAll('.nsheet-scroller').length ?? 0,
      totalSockets: l.sockets.filter((s) => isSdk(s.url)).length,
      activeRaf: l.activeRaf,
      activeIntervals: l.activeIntervals,
    };
  });
}

test('#4 AC6: React root mount→unmount→再mount 反復で leak しない・WS を張らない', async ({ page }) => {
  await page.addInitScript(instrumentation);
  await page.goto('/react-standalone.html');
  // ハーネスは自動 mount する。保存モックを消してから計測（初期表示を固定）。
  await waitReactReady(page);
  await page.evaluate(() => window.__reactStandalone?.clearSaved());

  const afterMount = await counts(page);
  expect(afterMount.canvas, 'base+overlay canvas').toBe(2);
  expect(afterMount.textarea, '常駐 textarea').toBe(1);
  expect(afterMount.scroller, 'scroller').toBe(1);
  expect(afterMount.totalSockets, 'standalone は WS を張らない').toBe(0);

  // React unmount → effect cleanup → grid.destroy。DOM/rAF が解放される。
  await page.evaluate(() => window.__reactStandalone?.unmount());
  await expect.poll(async () => (await counts(page)).activeRaf, { message: 'rAF ループ停止' }).toBe(0);
  const afterUnmount = await counts(page);
  expect(afterUnmount.canvas, 'canvas 解放').toBe(0);
  expect(afterUnmount.textarea, 'textarea 解放').toBe(0);
  expect(afterUnmount.scroller, 'scroller 解放').toBe(0);
  const intervalBaseline = afterUnmount.activeIntervals;
  expect(afterMount.activeIntervals, 'standalone は mount で interval を追加しない').toBeLessThanOrEqual(
    intervalBaseline,
  );

  // 再mount × N: 各サイクルで解放され、DOM/rAF/socket が単調増加しない。
  const cycles = 5;
  for (let i = 0; i < cycles; i += 1) {
    await page.evaluate(() => window.__reactStandalone?.mount());
    await waitReactReady(page);
    const m = await counts(page);
    expect(m.canvas, `cycle ${i}: canvas`).toBe(2);
    expect(m.textarea, `cycle ${i}: textarea`).toBe(1);
    expect(m.scroller, `cycle ${i}: scroller`).toBe(1);
    expect(m.totalSockets, `cycle ${i}: WS 0`).toBe(0);
    expect(m.activeIntervals, `cycle ${i}: interval がベースラインから増えない`).toBeLessThanOrEqual(
      intervalBaseline,
    );

    await page.evaluate(() => window.__reactStandalone?.unmount());
    await expect.poll(async () => (await counts(page)).activeRaf, { message: `cycle ${i}: rAF 停止` }).toBe(0);
    const d = await counts(page);
    expect(d.canvas, `cycle ${i}: canvas 解放`).toBe(0);
    expect(d.scroller, `cycle ${i}: scroller 解放`).toBe(0);
    expect(d.activeIntervals, `cycle ${i}: interval leak なし`).toBeLessThanOrEqual(intervalBaseline);
  }

  const final = await counts(page);
  expect(final.totalSockets, 'standalone は最後まで WS 0').toBe(0);
  expect(final.activeRaf, '全 unmount 後 rAF 0').toBe(0);

  await page.screenshot({ path: evidencePath('e2e-react-4-lifecycle.png') });
});
