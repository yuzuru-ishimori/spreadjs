// @nanairo-sheet/selection — 選択範囲（矩形）ユーティリティ（内部 package）。
// consumer は直接 import せず Facade（grid）経由で使う（R1）。render/grid が共有する。

export { rangeFromAnchorFocus, rangeContains, singleCell } from './selection';
export type { CellRange, CellPos } from './selection';
