import { describe, expect, it } from 'vitest';

import { MAX_LEFT_INFLOW_SCAN, nearestLeftNonEmpty, overflowRightExtent } from './text-overflow';

/** 非空列の集合から isEmpty 述語を作る。 */
function emptiness(nonEmpty: readonly number[]): (col: number) => boolean {
  const set = new Set(nonEmpty);
  return (col) => !set.has(col);
}

describe('overflowRightExtent（右方向の延長・D2）', () => {
  it('右隣が非空なら延長なし・blocked（AC2 の即クリップ）', () => {
    // origin=0・col1 非空。
    const ext = overflowRightExtent(0, 10, emptiness([0, 1]));
    expect(ext).toEqual({ endColExclusive: 1, blocked: true });
  });

  it('連続空セルを跨いで非空セル手前で止まる（blocked）', () => {
    // origin=0・col1,2 空・col3 非空 → [1,2] を跨ぎ col3 手前で止まる。
    const ext = overflowRightExtent(0, 10, emptiness([0, 3]));
    expect(ext).toEqual({ endColExclusive: 3, blocked: true });
  });

  it('可視範囲端まで空が続けば blocked=false（AC1 の全文はみ出し）', () => {
    // origin=0・右は全部空・maxCol=5 → 端まで延長・blocked なし。
    const ext = overflowRightExtent(0, 5, emptiness([0]));
    expect(ext).toEqual({ endColExclusive: 5, blocked: false });
  });
});

describe('nearestLeftNonEmpty（左外流入元の探索・D3）', () => {
  it('直近の左の非空セルを返す', () => {
    // 可視開始 col=5・col2 が非空・col3,4 空 → 2 を返す。
    const origin = nearestLeftNonEmpty(5, 0, MAX_LEFT_INFLOW_SCAN, emptiness([2]));
    expect(origin).toBe(2);
  });

  it('minCol（pane 境界）を越えて遡らない', () => {
    // col1 が非空だが minCol=3 → 探索対象外 → null。
    const origin = nearestLeftNonEmpty(6, 3, MAX_LEFT_INFLOW_SCAN, emptiness([1]));
    expect(origin).toBeNull();
  });

  it('20 列を超える流入は探索しない（D3 境界）', () => {
    // 可視開始 col=100・非空は col=70（30 列左）→ maxScan=20 では届かず null。
    const origin = nearestLeftNonEmpty(100, 0, MAX_LEFT_INFLOW_SCAN, emptiness([70]));
    expect(origin).toBeNull();
    // ちょうど 20 列左（col=80）は届く。
    expect(nearestLeftNonEmpty(100, 0, MAX_LEFT_INFLOW_SCAN, emptiness([80]))).toBe(80);
  });

  it('左に非空セルが無ければ null', () => {
    expect(nearestLeftNonEmpty(5, 0, MAX_LEFT_INFLOW_SCAN, emptiness([]))).toBeNull();
  });
});
