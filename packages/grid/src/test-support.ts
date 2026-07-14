// @nanairo-sheet/grid/test-support — E2E / 検査専用の introspection 面（公開 API ではない）。
//
// 公開 GridInstance は最小面に留め、E2E が必要とする深い状態（committedHash・pendingCount・editingTarget・
// 行操作 submit・断線注入 等）は本モジュール経由でのみ取得する。boundary lint の TEST_INFRA_FILES で検査除外。
// 独立 consumer（DD-016-2）はこれを import しない（S1-3 不合格条件の対象外＝test-support は公開契約でない）。

import { debugRegistry } from './internal';
import type { GridInstance } from './index';

export type {
  GridDebugApi,
  GridDebugCellRect,
  GridDebugCellAddress,
  GridDebugSelectionRange,
  GridDebugPresenceView,
} from './internal';

/** mount() が返した GridInstance の深い introspection API を取得する（未登録なら undefined）。 */
export function getDebugApi(instance: GridInstance) {
  return debugRegistry.get(instance);
}
