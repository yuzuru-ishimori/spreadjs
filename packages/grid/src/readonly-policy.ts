// readonly-policy（DD-033-1）: 表示専用モード（readOnly）の keydown 前段裁定（純粋関数・DOM 非依存）。
//
// readOnly では「文書を変更する編集入口」を UX 層で開かせない。keydown で編集を開始/セルをクリアするキー
// （F2＝既存値編集開始・Delete＝クリア・Backspace＝クリア開始）だけを消費（suppress）し、閲覧系のキー
// （矢印・Shift+矢印＝範囲選択・Ctrl+C＝コピー・Escape・PageUp/Down・Enter/Tab＝移動）は素通し（pass）する。
// 印字文字は keydown では編集を起こさない（BeginEdit は input 経路・§11.9）ため pass し、integration-editor 側の
// readOnly 分岐（textarea readOnly 属性＋input/composition dispatch 抑止）が編集開始を物理/論理に遮断する（2層抑止）。
//
// composition 中（DOM/内部いずれか）と非 Navigation 位相では必ず pass する（IME・編集中のキー処理は状態機械へ
// 委ねる＝editor-state-machine 無改変・I-3）。readOnly ではこれらの位相へ到達しないのが設計だが、防御的に不消費とする。

import type { EditPhase } from '@nanairo-sheet/ime';

/** readOnly keydown 裁定へ渡す素の値（DOM 非依存・integration-editor の KeydownInterceptInput と同項目）。 */
export interface ReadonlyPolicyInput {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  /** DOM の KeyboardEvent.isComposing。 */
  readonly eventComposing: boolean;
  /** 状態機械の内部 composing フラグ（I-2: DOM と内部の両方を見る）。 */
  readonly sessionComposing: boolean;
  readonly phase: EditPhase;
}

/** readOnly で編集開始/セルクリアを起こす単独キー（Navigation 位相・修飾なしのときだけ抑止する）。 */
const EDIT_ENTRY_KEYS: ReadonlySet<string> = new Set(['F2', 'Delete', 'Backspace']);

/**
 * readOnly 時の keydown 前段裁定。true=抑止（消費し状態機械の編集開始/クリアを起こさない）。false=素通し。
 * composition 中・非 Navigation・修飾キー付きは常に false（閲覧系・IME 経路は変えない）。
 */
export function shouldSuppressReadonlyKey(input: ReadonlyPolicyInput): boolean {
  if (input.eventComposing || input.sessionComposing || input.phase !== 'Navigation') {
    return false;
  }
  // 修飾キー付き（Ctrl+C コピー・Ctrl+Z 等）は編集開始キーではない＝pass（保証層は chokepoint が担う）。
  if (input.ctrlKey || input.metaKey || input.altKey) {
    return false;
  }
  return EDIT_ENTRY_KEYS.has(input.key);
}
