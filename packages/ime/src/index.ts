// @nanairo-sheet/ime — 日本語IME編集状態機械＋グリッドジオメトリ/ナビゲーション＋IMEトレース採取（内部 package）。
// consumer は直接 import せず Facade（grid）経由で使う（R1）。grid が DOM 反映（常駐 textarea）を配線する。

export * from './geometry';
export * from './navigation';
export * from './editor-state-machine';
export * from './event-recorder';
