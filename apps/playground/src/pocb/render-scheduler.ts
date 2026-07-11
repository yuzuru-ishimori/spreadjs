// RenderScheduler: dirty flags → rAF 集約 → 必要レイヤーのみ描画（計画書 §12.3）。
// 選択・Presence 変更で base（全セル）を再描画しないことを構造で保証する（§12.1）。
//
// scheduleFrame は注入可能（既定は requestAnimationFrame）。テストでは同期/手動スケジューラを
// 注入して base/overlay の描画回数を機械検証する（DOM 非依存でロジックを確認）。

/** dirty flag（§12.3）。styles/editor は PoC-B 範囲外のため未使用。 */
export type DirtyFlag = 'geometry' | 'cells' | 'selection' | 'presence' | 'full';

export interface RenderSchedulerDeps {
  /** base レイヤー（背景・文字・罫線・ヘッダー）の描画。 */
  drawBase: () => void;
  /** overlay レイヤー（選択・Presence・ドラッグガイド）の描画。 */
  drawOverlay: () => void;
  /** フレームスケジューラ（既定 requestAnimationFrame）。テストで差し替える。 */
  scheduleFrame?: (callback: () => void) => void;
}

export interface RenderScheduler {
  /** dirty flag を立て、フレームを 1 回だけ予約する（同一フレーム内は集約）。 */
  invalidate(flag: DirtyFlag): void;
  /** 予約済みフレームを同期実行する（計測の強制 full 再描画・テスト用）。 */
  flush(): void;
  /** フレームが予約中か。 */
  isFramePending(): boolean;
  /** base レイヤーの累積描画回数（検証用カウンタ）。 */
  readonly baseDrawCount: number;
  /** overlay レイヤーの累積描画回数（検証用カウンタ）。 */
  readonly overlayDrawCount: number;
}

export function createRenderScheduler(deps: RenderSchedulerDeps): RenderScheduler {
  const scheduleFrame = deps.scheduleFrame ?? ((cb: () => void): void => void requestAnimationFrame(cb));

  const pending = new Set<DirtyFlag>();
  let framePending = false;
  let baseDrawCount = 0;
  let overlayDrawCount = 0;

  const runFrame = (): void => {
    framePending = false;
    if (pending.size === 0) {
      return;
    }
    const baseNeeded = pending.has('geometry') || pending.has('cells') || pending.has('full');
    // overlay は base 再描画時も必ず上に描き直す。加えて selection/presence 単独でも描く。
    const overlayNeeded =
      baseNeeded || pending.has('selection') || pending.has('presence');
    pending.clear();

    if (baseNeeded) {
      baseDrawCount += 1;
      deps.drawBase();
    }
    if (overlayNeeded) {
      overlayDrawCount += 1;
      deps.drawOverlay();
    }
  };

  const scheduler: RenderScheduler = {
    invalidate(flag) {
      pending.add(flag);
      if (!framePending) {
        framePending = true;
        scheduleFrame(runFrame);
      }
    },
    flush() {
      if (framePending) {
        runFrame();
      }
    },
    isFramePending() {
      return framePending;
    },
    get baseDrawCount() {
      return baseDrawCount;
    },
    get overlayDrawCount() {
      return overlayDrawCount;
    },
  };
  return scheduler;
}
