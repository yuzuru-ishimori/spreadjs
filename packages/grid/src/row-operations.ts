// 行操作（Insert/Delete）公開層の純粋ロジック（DD-021-1）。DOM/backend 非依存で単体検証可能に保つ。
//
// ここに置くのは「キー裁定」「削除対象の解決」「削除後 activeCell 行の縮退先算出」の 3 純関数。
// mount-controller はこれらを使って公開 API（insertRows/deleteRows）・Excel 準拠ショートカットを配線する。
// IME 状態機械へは一切書き込まない（前段裁定＝decideUndoRedoKey と同型・Navigation 位相かつ非 composing のみ）。

import type { EditPhase } from '@nanairo-sheet/ime';

/** 行操作ショートカットの裁定結果。 */
export type RowStructureKeyDecision = 'insert' | 'delete' | 'none';

export interface RowStructureKeyInput {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  /** DOM の KeyboardEvent.isComposing。 */
  readonly eventComposing: boolean;
  /** 状態機械の内部 composing（I-2: DOM と内部の両方を見る）。 */
  readonly sessionComposing: boolean;
  readonly phase: EditPhase;
}

/**
 * Excel 準拠の行操作ショートカット裁定（Ctrl+Shift+'+'=挿入 / Ctrl+'-'=削除・親⑦）。
 * **Navigation 位相かつ非 composing のみ**グリッド裁定し、Editing/Composing・composing 中は必ず 'none'
 * （ブラウザ既定へ委譲＝IME 不変条件維持・I-3）。alt 併用・修飾なしも 'none'。
 * '+' は主要レイアウトで Shift+'=' により生成される（numpad は Shift 不要）ため shift 有無は問わない。
 */
export function decideRowStructureKey(input: RowStructureKeyInput): RowStructureKeyDecision {
  if (input.eventComposing || input.sessionComposing || input.phase !== 'Navigation' || input.altKey) {
    return 'none';
  }
  if (!(input.ctrlKey || input.metaKey)) {
    return 'none';
  }
  if (input.key === '+') {
    return 'insert';
  }
  if (input.key === '-') {
    return 'delete';
  }
  return 'none';
}

/**
 * 削除対象の解決（重複除去・生存行のみ）。requested のうち displayRowIds に現存する ID を requested 順で返す。
 * 全て非現存/空なら [] を返す（呼び出し側が実行前拒否＝row-delete-empty にする）。DeleteRows 自体は冪等 no-op だが、
 * 「削除対象なし」を公開エラーで返す契約（AC8）のため、submit 前にここで生存フィルタする。
 */
export function resolveDeleteTargets(displayRowIds: readonly string[], requested: readonly string[]): string[] {
  const live = new Set(displayRowIds);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of requested) {
    if (live.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

/**
 * ローカル削除後の activeCell 行の縮退先（親④・下優先→上）。oldOrder は削除前の表示行 ID 列・activeRow は
 * 削除前 index・deleted は削除された RowId 集合。戻り値:
 * - `'unchanged'`: active 行は生存（行 ID 不変。index シフトは呼び出し側が rowId で再解決する）
 * - `{ rowId }`: active 行が削除された → 最近傍の下（無ければ上）の生存行 ID へ移動する
 * - `null`: 生存行が 1 つも無い → 選択解除
 */
export function reduceActiveRowTarget(
  oldOrder: readonly string[],
  activeRow: number,
  deleted: ReadonlySet<string>,
): 'unchanged' | { readonly rowId: string } | null {
  const activeRowId = oldOrder[activeRow];
  if (activeRowId === undefined || !deleted.has(activeRowId)) {
    return 'unchanged';
  }
  for (let i = activeRow + 1; i < oldOrder.length; i += 1) {
    const id = oldOrder[i]!;
    if (!deleted.has(id)) {
      return { rowId: id };
    }
  }
  for (let i = activeRow - 1; i >= 0; i -= 1) {
    const id = oldOrder[i]!;
    if (!deleted.has(id)) {
      return { rowId: id };
    }
  }
  return null;
}
