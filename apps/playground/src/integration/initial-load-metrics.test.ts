import { describe, expect, it } from 'vitest';

import { createLoadMetrics } from './initial-load-metrics';

/** 手動時計（now を制御して経過を決定的に測る）。 */
function fakeClock(): { now: () => number; set: (t: number) => void } {
  let t = 1000;
  return { now: () => t, set: (v) => (t = v) };
}

describe('createLoadMetrics（#6 初期ロード計測）', () => {
  it('マイルストーンは pageStart からの経過を記録し one-shot', () => {
    const clock = fakeClock();
    const metrics = createLoadMetrics(clock.now);
    clock.set(1050);
    metrics.mark('wsConnected');
    clock.set(1600);
    metrics.mark('firstSync');
    clock.set(9999);
    metrics.mark('wsConnected'); // 2 回目は無視

    const report = metrics.report();
    expect(report.elapsed.pageStart).toBe(0);
    expect(report.elapsed.wsConnected).toBe(50);
    expect(report.elapsed.firstSync).toBe(600);
  });

  it('主要スパンは両端が揃ったものだけ計算する', () => {
    const clock = fakeClock();
    const metrics = createLoadMetrics(clock.now);
    clock.set(1100);
    metrics.mark('wsConnected');
    clock.set(1400);
    metrics.mark('firstSync');
    clock.set(1450);
    metrics.mark('axisBuilt');

    const report = metrics.report();
    expect(report.spans.wsConnect).toBe(100);
    expect(report.spans.clientSessionInit).toBe(300);
    expect(report.spans.axisBuild).toBe(50);
    expect(report.spans.firstDraw).toBeUndefined(); // firstDraw 未到達
    expect(report.spans.toFirstOperable).toBeUndefined();
  });

  it('recordFrame で転送量を加算する', () => {
    const metrics = createLoadMetrics(() => 0);
    metrics.recordFrame({ chars: 1000, parseMillis: 5 });
    metrics.recordFrame({ chars: 2000, parseMillis: 7 });
    const report = metrics.report();
    expect(report.transfer.frames).toBe(2);
    expect(report.transfer.chars).toBe(3000);
    expect(report.transfer.parseMillis).toBe(12);
  });

  it('toText は経過と転送量を含む', () => {
    const metrics = createLoadMetrics(() => 0);
    metrics.recordFrame({ chars: 2048, parseMillis: 3 });
    expect(metrics.toText()).toContain('初期ロード');
    expect(metrics.toText()).toContain('2KB');
  });
});
