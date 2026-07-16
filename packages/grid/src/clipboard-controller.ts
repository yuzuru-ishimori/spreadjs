// clipboard-controller（DD-020-2 Phase 2）: copy/cut/paste の純ロジック（位相裁定・直列化・paste 生成）。
//
// 【責務境界】DOM（ClipboardEvent）配線は integration-editor/mount-controller が担い、本モジュールは
// 「選択レンジ＋文書ポート」から TSV 直列化（copy）と原子的 SetCells 生成（paste）を行う純関数だけを持つ
// （DOM 非依存＝unit 可能）。型変換の正本は core `parseCellInput`（偽陽性防止・DD-012-1）へ委譲する。
//
// 【経路（親 D5・案X 継承）】Navigation 位相のみ Command 化する。Editing/Composing 位相の copy/cut/paste は
// ブラウザ既定（textarea 内テキスト編集）へ任せ、composition 中の value/selection に介入しない（I-3）。
// 裁定は shouldInterceptClipboard（純関数）に集約し、composing 中は必ず不消費＝IME 経路を一切変えない。
//
// 【paste フロー】parser（core clipboard-text）が返す文字列 matrix を:
//   1. 敷き詰め判定: matrix 1×1 かつ複数セル選択 → 選択範囲全体へ単一値を敷き詰め（AC7）。それ以外は
//      選択左上アンカーから matrix サイズ（Excel 準拠）。
//   2. 上限（親①=100,000）: 貼り付け矩形の面積で**実行前**に弾く（走査しない）。
//   3. はみ出し（親②）: 貼り付け矩形が表示 Axis の端を越える → 切り捨てず**全体拒否**（サイレント部分適用の排除）。
//   4. 各セル parseCellInput で型変換・beforeRevision=**実行時点の committed lastChangedRevision**（未書込=0・
//      captureEditStartRevision 規約）→ 1 つの原子的 SetCells（reject-overlap・I-5）。OCC はサーバー
//      validateSetCells がセル単位で照合し、1 セルでも stale なら全件 reject する（AC5）。
//   5. 列数不整合（jagged）の欠けセル（行が短い）は**変更対象に含めない**（skip・空文字上書きしない＝決定(d)）。
//      present な空セル（parseCellInput('')=blank）は blank 上書きする（欠けとは区別）。

import { SETCELLS_MAX_CELLS, parseCellInput } from '@nanairo-sheet/core';
import type { SetCellsChange, SetCellsOperation } from '@nanairo-sheet/core';
import type { CellRange } from '@nanairo-sheet/selection';
import type { EditPhase } from '@nanairo-sheet/ime';

import { serializeMatrix } from '@nanairo-sheet/core';
import { captureEditStartRevision } from './commit-bridge';
import type { RangeDocumentPort } from './range-ops';

/**
 * clipboard 演算が読む文書ポート（range-ops の RangeDocumentPort＋表示 Axis の寸法）。
 * mount-controller が backend（session/view）から構築して渡す。
 */
export interface ClipboardDocumentPort extends RangeDocumentPort {
  /** 表示 Axis の行数（貼り付けはみ出し判定の上端境界）。 */
  rowCount(): number;
  /** 表示 Axis の列数（貼り付けはみ出し判定の右端境界）。 */
  colCount(): number;
}

/**
 * copy/cut/paste をグリッド Command として消費するか（親 D5）。Navigation 位相かつ非 composing のみ true。
 * それ以外（編集中・変換中）はブラウザ既定（textarea 内テキスト編集）へ委譲する（I-3・純関数で固定）。
 */
export function shouldInterceptClipboard(phase: EditPhase, sessionComposing: boolean): boolean {
  return phase === 'Navigation' && !sessionComposing;
}

/**
 * 選択範囲（半開区間）の表示文字列を TSV へ直列化する（copy・cut の書き出し）。
 * 表示 Axis から外れた index（削除済み等）は空セルとして書く（防御）。
 */
export function serializeSelectionToTsv(port: ClipboardDocumentPort, range: CellRange): string {
  const matrix: string[][] = [];
  for (let rowIndex = range.rowStart; rowIndex < range.rowEnd; rowIndex += 1) {
    const rowId = port.rowIdAt(rowIndex);
    const row: string[] = [];
    for (let colIndex = range.colStart; colIndex < range.colEnd; colIndex += 1) {
      const columnId = port.colIdAt(colIndex);
      row.push(rowId === undefined || columnId === undefined ? '' : port.displayText(rowId, columnId));
    }
    matrix.push(row);
  }
  return serializeMatrix(matrix);
}

export type PasteOutcome =
  /** 1 つの原子的 SetCells として submit する（changes=型変換済み・beforeRevision 付き）。 */
  | { readonly kind: 'submit'; readonly operation: SetCellsOperation; readonly cellCount: number }
  /** 貼り付け矩形のセル数が上限超過 → 実行前拒否（走査もしない）。呼び出し側が公開コードで通知する。 */
  | { readonly kind: 'too-large'; readonly cellCount: number; readonly limit: number }
  /** 貼り付け矩形が表示 Axis の端を越える → 全体拒否（切り捨て・部分適用しない）。 */
  | { readonly kind: 'out-of-bounds'; readonly rows: number; readonly cols: number }
  /** 貼り付け対象が空（matrix 空 or 全セル欠け）→ 変更なし。 */
  | { readonly kind: 'noop' };

/** matrix の最大列数（jagged の bounding box 幅）。 */
function maxColumns(matrix: readonly (readonly string[])[]): number {
  let cols = 0;
  for (const row of matrix) {
    if (row.length > cols) {
      cols = row.length;
    }
  }
  return cols;
}

/**
 * 文字列 matrix を貼り付け先の原子的 SetCells へ変換する（DD-020-2 AC1/AC3/AC4/AC6/AC7・決定(d)）。
 * 生成のみで submit はしない（呼び出し側が共有 submit 経路＝確定単位 chokepoint へ流す）。
 */
export function buildPaste(
  port: ClipboardDocumentPort,
  matrix: readonly (readonly string[])[],
  range: CellRange,
): PasteOutcome {
  const matrixRows = matrix.length;
  if (matrixRows === 0) {
    return { kind: 'noop' };
  }
  const matrixCols = maxColumns(matrix);
  if (matrixCols === 0) {
    return { kind: 'noop' };
  }

  const anchorRow = range.rowStart;
  const anchorCol = range.colStart;
  const selRows = Math.max(0, range.rowEnd - range.rowStart);
  const selCols = Math.max(0, range.colEnd - range.colStart);

  // 敷き詰め: matrix 1×1 かつ複数セル選択 → 選択範囲全体へ単一値を敷き詰める（AC7）。
  const tile = matrixRows === 1 && matrixCols === 1 && (selRows > 1 || selCols > 1);
  const targetRows = tile ? selRows : matrixRows;
  const targetCols = tile ? selCols : matrixCols;

  const cellCount = targetRows * targetCols;
  // 上限（親①）: 走査せず面積で実行前拒否（はみ出し判定より先＝巨大 matrix で bounds を読まない）。
  if (cellCount > SETCELLS_MAX_CELLS) {
    return { kind: 'too-large', cellCount, limit: SETCELLS_MAX_CELLS };
  }
  // はみ出し（親②）: 貼り付け矩形が表示 Axis の端を越える → 切り捨てず全体拒否。
  if (anchorRow + targetRows > port.rowCount() || anchorCol + targetCols > port.colCount()) {
    return { kind: 'out-of-bounds', rows: targetRows, cols: targetCols };
  }

  const committed = port.getCommittedDocument();
  // 敷き詰めの単一値（tile 時のみ）。matrix[0][0] は matrixRows>=1・matrixCols>=1 で存在するが型安全に取得する。
  const single = tile ? (matrix[0]?.[0] ?? '') : '';
  const changes: SetCellsChange[] = [];
  for (let r = 0; r < targetRows; r += 1) {
    const rowId = port.rowIdAt(anchorRow + r);
    if (rowId === undefined) {
      continue; // はみ出し判定後だが、Axis 変化に備えて無効 index はスキップ（無効 RowId へ書かない）
    }
    const srcRow = tile ? undefined : matrix[r];
    for (let c = 0; c < targetCols; c += 1) {
      const columnId = port.colIdAt(anchorCol + c);
      if (columnId === undefined) {
        continue;
      }
      let text: string;
      if (tile) {
        text = single;
      } else if (srcRow === undefined || c >= srcRow.length) {
        continue; // jagged の欠けセル（行が短い）は skip（決定(d)・空文字上書きしない）
      } else {
        text = srcRow[c] ?? '';
      }
      changes.push({
        rowId,
        columnId,
        beforeRevision: captureEditStartRevision(committed, rowId, columnId),
        value: parseCellInput(text),
      });
    }
  }
  if (changes.length === 0) {
    return { kind: 'noop' }; // 全て欠け or 無効 index（present 空セルは blank として含まれるため通常は非空）
  }
  return {
    kind: 'submit',
    operation: { type: 'setCells', conflictPolicy: 'reject-overlap', changes },
    cellCount,
  };
}
