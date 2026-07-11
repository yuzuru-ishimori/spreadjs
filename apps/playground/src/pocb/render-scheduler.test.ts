import { describe, expect, it } from 'vitest';

import { createRenderScheduler, type RenderScheduler } from './render-scheduler';

/** 手動スケジューラ: フレームコールバックを保持し、flush() で同期実行させる。 */
function setup(): {
  scheduler: RenderScheduler;
  baseDraws: () => number;
  overlayDraws: () => number;
} {
  let baseDraws = 0;
  let overlayDraws = 0;
  const scheduler = createRenderScheduler({
    drawBase: () => {
      baseDraws += 1;
    },
    drawOverlay: () => {
      overlayDraws += 1;
    },
    // 手動スケジューラ: 予約だけして自動実行しない（flush で走らせる）。
    scheduleFrame: () => {
      /* 予約のみ。flush() で runFrame が同期実行される。 */
    },
  });
  return { scheduler, baseDraws: () => baseDraws, overlayDraws: () => overlayDraws };
}

describe('RenderScheduler: 選択・Presence は overlay のみ（base 再描画しない）', () => {
  it("invalidate('selection') は overlay のみ描画", () => {
    const { scheduler, baseDraws, overlayDraws } = setup();
    scheduler.invalidate('selection');
    scheduler.flush();
    expect(baseDraws()).toBe(0);
    expect(overlayDraws()).toBe(1);
    expect(scheduler.baseDrawCount).toBe(0);
    expect(scheduler.overlayDrawCount).toBe(1);
  });

  it("invalidate('presence') は overlay のみ描画（全セル再描画しない）", () => {
    const { scheduler, baseDraws, overlayDraws } = setup();
    scheduler.invalidate('presence');
    scheduler.flush();
    expect(baseDraws()).toBe(0);
    expect(overlayDraws()).toBe(1);
  });

  it('選択・Presence を連続で 10 回更新しても base は 0 回', () => {
    const { scheduler, baseDraws } = setup();
    for (let i = 0; i < 10; i += 1) {
      scheduler.invalidate(i % 2 === 0 ? 'selection' : 'presence');
      scheduler.flush();
    }
    expect(baseDraws()).toBe(0);
  });
});

describe('RenderScheduler: cells/geometry/full は base+overlay', () => {
  it.each(['cells', 'geometry', 'full'] as const)('%s は base と overlay を描画', (flag) => {
    const { scheduler, baseDraws, overlayDraws } = setup();
    scheduler.invalidate(flag);
    scheduler.flush();
    expect(baseDraws()).toBe(1);
    expect(overlayDraws()).toBe(1);
  });
});

describe('RenderScheduler: rAF 集約（同一フレームで重複描画しない）', () => {
  it('1 フレーム内に selection と cells を出しても base1・overlay1', () => {
    const { scheduler, baseDraws, overlayDraws } = setup();
    scheduler.invalidate('selection');
    scheduler.invalidate('cells');
    scheduler.invalidate('presence');
    expect(scheduler.isFramePending()).toBe(true);
    scheduler.flush();
    expect(baseDraws()).toBe(1);
    expect(overlayDraws()).toBe(1);
    expect(scheduler.isFramePending()).toBe(false);
  });

  it('flush 後に再度 invalidate すると次フレームが予約される', () => {
    const { scheduler, baseDraws } = setup();
    scheduler.invalidate('cells');
    scheduler.flush();
    expect(baseDraws()).toBe(1);
    scheduler.invalidate('cells');
    scheduler.flush();
    expect(baseDraws()).toBe(2);
  });
});
