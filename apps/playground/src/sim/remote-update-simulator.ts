// リモート更新シミュレーター（DD-002 Phase 4・計画書 §11.7）。
//
// 実サーバー同期（PoC-C）を待たず、ローカルで「他ユーザーのリモート更新」を再現して
// §11.7 の挙動を検証・デモするための開発ツール。書込は必ず editor.applyRemoteUpdate 経由で
// 行うため、cell-store（Canvas の正）は更新されるが textarea/draft は不変・編集中セルは
// 競合マークのみ（MarkConflictOnly）という §11.7 の契約がそのまま効く。
//
// 操作:
// - 編集中（アクティブ）セルへ書込 → 競合インジケーター（draft は保持・受け入れ #5）
// - 他セルへ書込           → Canvas 再描画・draft 消失なし（受け入れ #5）
// - インターバル連続書込   → 再描画ストーム下でも Composing draft は不変（受け入れ #4）
//
// セル選択ロジック（pickDistinctCell）は DOM 非依存の純粋関数として切り出し、単体テストする。

import type { CellPosition, GridLayout } from '../grid/geometry';

/**
 * `avoid` と異なる有効セルを `index` から決める（連続書込の対象を分散させる）。
 * グリッドを行優先で線形化し、`index` 番目から最初に `avoid` と異なるセルを返す。
 */
export function pickDistinctCell(
  layout: GridLayout,
  avoid: CellPosition,
  index: number,
): CellPosition {
  const total = layout.rowCount * layout.columnCount;
  const start = ((index % total) + total) % total;
  for (let step = 0; step < total; step += 1) {
    const linear = (start + step) % total;
    const row = Math.floor(linear / layout.columnCount);
    const col = linear % layout.columnCount;
    if (row !== avoid.row || col !== avoid.col) {
      return { row, col };
    }
  }
  // 1×1 グリッド等の縮退（PoC の 20×10 では起きない）。
  return { row: avoid.row, col: avoid.col };
}

/** シミュレーターの書込先（editor が実装する。§11.7 準拠の反映は editor が担う）。 */
export interface RemoteUpdateSink {
  /** リモート更新を投入する（value === null は削除）。 */
  applyRemoteUpdate(cell: CellPosition, value: string | null): void;
  /** 現在のアクティブセル（＝編集中セル）。 */
  getActiveCell(): CellPosition;
}

/** タイマー抽象（テストで差し替え可能にするため注入）。 */
export interface Scheduler {
  setInterval(callback: () => void, ms: number): number;
  clearInterval(id: number): void;
}

export interface RemoteUpdateSimulatorOptions {
  readonly layout: GridLayout;
  readonly sink: RemoteUpdateSink;
  /** 連続書込の間隔（ms・既定 300）。 */
  readonly burstIntervalMs?: number;
  /** タイマー実装（既定は window の setInterval/clearInterval）。 */
  readonly scheduler?: Scheduler;
}

export interface RemoteUpdateSimulator {
  /** 編集中（アクティブ）セルへリモート書込 → 競合（§11.7）。 */
  writeActiveCell(value?: string): void;
  /** アクティブでない別セルへリモート書込 → Canvas 再描画（draft 不変）。 */
  writeOtherCell(value?: string): void;
  /** 一定間隔で他セルへ連続書込を開始する（再描画ストーム）。 */
  startBurst(): void;
  /** 連続書込を停止する。 */
  stopBurst(): void;
  isBursting(): boolean;
  /** タイマー解除。 */
  destroy(): void;
}

const DEFAULT_BURST_INTERVAL_MS = 300;

/** リモート更新シミュレーターを生成する。 */
export function createRemoteUpdateSimulator(
  options: RemoteUpdateSimulatorOptions,
): RemoteUpdateSimulator {
  const { layout, sink } = options;
  const intervalMs = options.burstIntervalMs ?? DEFAULT_BURST_INTERVAL_MS;
  const scheduler: Scheduler =
    options.scheduler ?? {
      setInterval: (callback, ms) => window.setInterval(callback, ms),
      clearInterval: (id) => window.clearInterval(id),
    };

  let burstTimer: number | null = null;
  let counter = 0;

  const nextValue = (label: string): string => {
    counter += 1;
    return `${label}#${counter}`;
  };

  const writeOther = (value?: string): void => {
    const cell = pickDistinctCell(layout, sink.getActiveCell(), counter);
    sink.applyRemoteUpdate(cell, value ?? nextValue('他'));
  };

  return {
    writeActiveCell(value) {
      sink.applyRemoteUpdate(sink.getActiveCell(), value ?? nextValue('競合'));
    },
    writeOtherCell(value) {
      writeOther(value);
    },
    startBurst() {
      if (burstTimer !== null) {
        return;
      }
      burstTimer = scheduler.setInterval(() => writeOther(), intervalMs);
    },
    stopBurst() {
      if (burstTimer === null) {
        return;
      }
      scheduler.clearInterval(burstTimer);
      burstTimer = null;
    },
    isBursting() {
      return burstTimer !== null;
    },
    destroy() {
      if (burstTimer !== null) {
        scheduler.clearInterval(burstTimer);
        burstTimer = null;
      }
    },
  };
}
