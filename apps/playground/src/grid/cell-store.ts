// セル値ストア。DOM 非依存で、値の保持（Map）と変更通知（購読）だけを担う。
// 再描画のトリガー元であり、リモート更新シミュレーター（Phase 3）の書込先でもある。
//
// 「値の正」は編集確定後にここへ書き込まれた文字列とする。編集中のドラフト
// （composition 中の未確定文字列）はここには入れない — それは編集状態機械
// （Phase 2）と textarea 側が保持する（計画書 §11.5）。

import { type CellPosition, cellKey } from './geometry';

/** ストア内の 1 セル分の記録。 */
export interface CellEntry {
  readonly pos: CellPosition;
  readonly value: string;
}

/** 変更通知の購読解除関数。 */
export type Unsubscribe = () => void;

export interface CellStore {
  /** セルの現在値を返す（未設定なら空文字）。 */
  get(pos: CellPosition): string;
  /** セル値を設定する。値が実際に変化したときだけ購読者へ通知する。 */
  set(pos: CellPosition, value: string): void;
  /** セル値をクリアする（`set(pos, '')` と等価。Delete 操作用）。 */
  clear(pos: CellPosition): void;
  /** 非空セルのスナップショット配列（描画時の走査用）。 */
  entries(): readonly CellEntry[];
  /** 変更通知を購読する。返り値で購読解除する。 */
  subscribe(listener: () => void): Unsubscribe;
}

/**
 * セル値ストアを生成する。
 * @param initial 初期セル値（省略可）。
 */
export function createCellStore(
  initial?: Iterable<readonly [CellPosition, string]>,
): CellStore {
  const cells = new Map<string, CellEntry>();
  const listeners = new Set<() => void>();

  const notify = (): void => {
    // 通知中の購読解除に備えてスナップショットを回す。
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const setInternal = (pos: CellPosition, value: string): boolean => {
    const key = cellKey(pos);
    const currentValue = cells.get(key)?.value ?? '';
    if (currentValue === value) {
      return false;
    }
    if (value === '') {
      cells.delete(key);
    } else {
      cells.set(key, { pos, value });
    }
    return true;
  };

  if (initial !== undefined) {
    for (const [pos, value] of initial) {
      setInternal(pos, value);
    }
  }

  return {
    get(pos) {
      return cells.get(cellKey(pos))?.value ?? '';
    },
    set(pos, value) {
      if (setInternal(pos, value)) {
        notify();
      }
    },
    clear(pos) {
      if (setInternal(pos, '')) {
        notify();
      }
    },
    entries() {
      return [...cells.values()];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
