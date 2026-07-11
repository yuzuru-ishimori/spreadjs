import { describe, expect, it } from 'vitest';

import { DEFAULT_GRID_LAYOUT, type CellPosition, isValidCell } from '../grid/geometry';
import {
  type RemoteUpdateSink,
  type Scheduler,
  createRemoteUpdateSimulator,
  pickDistinctCell,
} from './remote-update-simulator';

const layout = DEFAULT_GRID_LAYOUT;

describe('pickDistinctCell', () => {
  it('avoid とは常に異なる有効セルを返す（全 index で成立）', () => {
    const avoid: CellPosition = { row: 2, col: 3 };
    for (let index = 0; index < layout.rowCount * layout.columnCount + 5; index += 1) {
      const cell = pickDistinctCell(layout, avoid, index);
      expect(isValidCell(layout, cell)).toBe(true);
      expect(cell).not.toEqual(avoid);
    }
  });

  it('負の index でも範囲内の有効セルを返す', () => {
    const cell = pickDistinctCell(layout, { row: 0, col: 0 }, -1);
    expect(isValidCell(layout, cell)).toBe(true);
    expect(cell).not.toEqual({ row: 0, col: 0 });
  });
});

/** 記録用の擬似 sink（applyRemoteUpdate の呼び出しを蓄積）。 */
function createFakeSink(activeCell: CellPosition): {
  sink: RemoteUpdateSink;
  writes: Array<{ cell: CellPosition; value: string | null }>;
} {
  const writes: Array<{ cell: CellPosition; value: string | null }> = [];
  return {
    writes,
    sink: {
      applyRemoteUpdate: (cell, value) => writes.push({ cell, value }),
      getActiveCell: () => activeCell,
    },
  };
}

/** 手動発火できる擬似スケジューラ。 */
function createManualScheduler(): { scheduler: Scheduler; tick: () => void; active: () => boolean } {
  let callback: (() => void) | null = null;
  return {
    scheduler: {
      setInterval: (cb) => {
        callback = cb;
        return 1;
      },
      clearInterval: () => {
        callback = null;
      },
    },
    tick: () => callback?.(),
    active: () => callback !== null,
  };
}

describe('createRemoteUpdateSimulator', () => {
  it('writeActiveCell はアクティブセルへ書込む（＝編集中セルへの競合投入）', () => {
    const active: CellPosition = { row: 1, col: 1 };
    const { sink, writes } = createFakeSink(active);
    const sim = createRemoteUpdateSimulator({ layout, sink, scheduler: createManualScheduler().scheduler });
    sim.writeActiveCell();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.cell).toEqual(active);
    expect(typeof writes[0]?.value).toBe('string');
  });

  it('writeOtherCell はアクティブセル以外へ書込む', () => {
    const active: CellPosition = { row: 1, col: 1 };
    const { sink, writes } = createFakeSink(active);
    const sim = createRemoteUpdateSimulator({ layout, sink });
    sim.writeOtherCell();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.cell).not.toEqual(active);
    expect(isValidCell(layout, writes[0]?.cell ?? active)).toBe(true);
  });

  it('startBurst/stopBurst で連続書込を制御し、全てアクティブ以外のセルへ向かう', () => {
    const active: CellPosition = { row: 0, col: 0 };
    const { sink, writes } = createFakeSink(active);
    const manual = createManualScheduler();
    const sim = createRemoteUpdateSimulator({ layout, sink, scheduler: manual.scheduler });

    expect(sim.isBursting()).toBe(false);
    sim.startBurst();
    expect(sim.isBursting()).toBe(true);

    manual.tick();
    manual.tick();
    manual.tick();
    expect(writes).toHaveLength(3);
    for (const write of writes) {
      expect(write.cell).not.toEqual(active);
    }

    sim.stopBurst();
    expect(sim.isBursting()).toBe(false);
    expect(manual.active()).toBe(false);
  });

  it('二重 startBurst は 1 本のタイマーだけを張る（多重起動しない）', () => {
    const { sink } = createFakeSink({ row: 0, col: 0 });
    let intervals = 0;
    const scheduler: Scheduler = {
      setInterval: () => {
        intervals += 1;
        return intervals;
      },
      clearInterval: () => {},
    };
    const sim = createRemoteUpdateSimulator({ layout, sink, scheduler });
    sim.startBurst();
    sim.startBurst();
    expect(intervals).toBe(1);
  });
});
