// CellStore 候補レジストリ（4実装・3カテゴリ）。ベンチ・等価性テスト共通の入口。

import type { CellStoreFactory } from '../cell-store';
import { createMapStore } from './map-store';
import { createChunkedColumnStore } from './chunked-column-store';
import { createChunkedRowslotStore } from './chunked-rowslot-store';
import { createColumnarStore } from './columnar-store';

export type StoreCategory = 'map' | 'chunked' | 'columnar';

export interface StoreCandidate {
  readonly label: string;
  readonly category: StoreCategory;
  readonly create: CellStoreFactory;
}

/** 4実装・3カテゴリ（§6.4・ADR-011）。 */
export const STORE_CANDIDATES: readonly StoreCandidate[] = [
  { label: 'map', category: 'map', create: createMapStore },
  { label: 'chunked-column', category: 'chunked', create: createChunkedColumnStore },
  { label: 'chunked-rowslot', category: 'chunked', create: createChunkedRowslotStore },
  { label: 'columnar', category: 'columnar', create: createColumnarStore },
];

export {
  createMapStore,
  createChunkedColumnStore,
  createChunkedRowslotStore,
  createColumnarStore,
};
