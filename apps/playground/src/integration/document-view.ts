// DocumentView（DD-005 Phase 2・最重要 #1/#2）。ClientSession の committed＋pending 文書（SheetDocument）を
// Canvas 描画層（pocb base/overlay-layer）が読むための **派生 Adapter**。
//
// 【最重要原則】ClientSession だけが Document State の唯一の正本。DocumentView は**セル状態を一切保持しない**
// 純粋な読み取りアダプター（第二の CellStore にしない・#2）。描画に必要なとき ClientSession の文書を
// RowId/ColumnId キーで直接読む（getCell）。書き込み（store.set/bulkLoad）は throw で禁止し、編集は必ず
// ClientSession.submitLocalOperation へ流す（三重管理＝ClientSession文書/Canvas独自文書/IME旧cell-store を構造的に排除）。
//
// 保持するのは Render State のみ:
//   - rowAxis（RowId 列・displayRowOrder から構築）／colAxis（ColumnId 列・列は固定）
//   - dirty flag（cell / row-structure / viewport の 3 種別）
// これらは **いつでも ClientSession 文書から再構築可能**（rowAxis は flush で displayRowOrder から作り直す）。
//
// 更新コスト分離（#5）:
//   - SetCells 受信 → `cell` dirty のみ。rowAxis/colAxis は不変。次フレームで**可視範囲のみ**文書を読み直す
//     （50,000行 Axis・10万セルの全再構築をしない）。
//   - InsertRows/DeleteRows → `row-structure` dirty。flush で rowAxis を displayRowOrder から再構築
//     （構造Op時の Axis 全再構築は PoC 許容）。scroll anchor 補正は DOM を持つ呼び出し側（main）が行う。

import { displayRowOrder, getCell, slotOf } from '@nanairo-sheet/core';
import type { CellScalar, DocumentOperation, SheetDocument } from '@nanairo-sheet/core';
import type { ColumnId, RowId } from '@nanairo-sheet/types';

import { createAxis, type Axis } from '../pocb/axis';
import type { ChunkStore, RangeVisitor } from '../pocb/chunk-store';

/** dirty の種別（#5 更新コスト分離のための分類）。 */
export type DirtyKind = 'cell' | 'row-structure' | 'viewport';

export interface DocumentViewConfig {
  /** ClientSession の描画対象文書（committed＋pending view）を返す。唯一の正本への参照。 */
  getDocument: () => SheetDocument;
  rowHeight: number;
  colWidth: number;
}

export interface FlushResult {
  /** 再描画が必要か（いずれかの dirty が立っていた）。 */
  needsRedraw: boolean;
  /** rowAxis を再構築したか（構造Op）。scroll anchor 補正の要否判定に使う。 */
  structuralRebuilt: boolean;
  /** 立っていた dirty 種別（消費前のスナップショット）。 */
  dirty: Record<DirtyKind, boolean>;
}

/** CellScalar を描画文字列へ変換する（blank=''・number は文字列化して数値右寄せ判定に載せる）。 */
export function cellScalarToDisplay(value: CellScalar): string {
  switch (value.kind) {
    case 'blank':
      return '';
    case 'string':
      return value.value;
    case 'number':
      return String(value.value);
  }
}

/** Operation を描画更新の dirty 種別へ分類する（setCells=cell / insertRows・deleteRows=row-structure）。 */
export function operationDirtyKind(op: DocumentOperation): 'cell' | 'row-structure' {
  return op.type === 'setCells' ? 'cell' : 'row-structure';
}

export class DocumentView {
  private readonly getDocument: () => SheetDocument;
  private readonly rowHeight: number;
  private readonly colWidth: number;
  private currentRowAxis: Axis<RowId>;
  private currentColAxis: Axis<ColumnId>;
  /** base/overlay-layer が束縛する read-through ストア（安定参照・内部で最新 Axis と文書を読む）。 */
  readonly store: ChunkStore;

  private dirtyCell = false;
  private dirtyStructure = false;
  private dirtyViewport = false;
  private structuralRebuilds = 0;

  constructor(config: DocumentViewConfig) {
    this.getDocument = config.getDocument;
    this.rowHeight = config.rowHeight;
    this.colWidth = config.colWidth;
    this.currentColAxis = createAxis({
      ids: this.getDocument().columnOrder,
      defaultSize: this.colWidth,
    });
    this.currentRowAxis = createAxis({
      ids: displayRowOrder(this.getDocument()),
      defaultSize: this.rowHeight,
    });
    this.store = this.createReadThroughStore();
  }

  /** 現在の行 Axis（RowId 列。構造Op で再構築される。呼び出し側は毎フレーム getter で取得すること）。 */
  get rowAxis(): Axis<RowId> {
    return this.currentRowAxis;
  }

  /** 現在の列 Axis（ColumnId 列・固定）。 */
  get colAxis(): Axis<ColumnId> {
    return this.currentColAxis;
  }

  /** rowAxis を再構築した回数（#5 検証: SetCells で増えない／構造Op で増える）。 */
  get structuralRebuildCount(): number {
    return this.structuralRebuilds;
  }

  /** RowId → 現在の表示 index（tombstone/未知は -1）。表示直前に解決する（#4 RowId 安定）。 */
  rowIndexOf(rowId: RowId): number {
    return this.currentRowAxis.getIndex(rowId);
  }

  /** ColumnId → 表示 index（未知は -1）。 */
  colIndexOf(columnId: ColumnId): number {
    return this.currentColAxis.getIndex(columnId);
  }

  /** RowId が現在表示に存在するか（削除＝tombstone/displayRowOrder 消失の判定に使う・#4）。 */
  hasRow(rowId: RowId): boolean {
    return this.currentRowAxis.hasId(rowId);
  }

  /** RowId/ColumnId のセル表示文字列（ClientSession 文書を直接読む。無ければ ''）。 */
  cellDisplay(rowId: RowId, columnId: ColumnId): string {
    const record = getCell(this.getDocument(), rowId, columnId);
    return record === undefined ? '' : cellScalarToDisplay(record.value);
  }

  /** SetCells 受信 → 可視セルのみ読み直す（Axis 不変）。 */
  markCellDirty(): void {
    this.dirtyCell = true;
  }

  /** 構造Op 受信 → 次 flush で rowAxis を再構築する。 */
  markStructureDirty(): void {
    this.dirtyStructure = true;
  }

  /** スクロール・リサイズ → viewport 再計算・可視再描画（Axis/文書は不変）。 */
  markViewportDirty(): void {
    this.dirtyViewport = true;
  }

  /** 再接続後の全再構築（Render State を Document State から作り直す・#10 再接続経路）。 */
  markFullRebuild(): void {
    this.dirtyStructure = true;
    this.dirtyCell = true;
  }

  /** Operation の種別に応じて dirty を立てる（observer が operations 受信ごとに呼ぶ）。 */
  noteOperation(op: DocumentOperation): void {
    if (operationDirtyKind(op) === 'row-structure') {
      this.markStructureDirty();
    } else {
      this.markCellDirty();
    }
  }

  /** 構造 dirty が立っているか（scroll anchor 補正を bracket する main が flush 前に覗く）。 */
  hasStructuralDirty(): boolean {
    return this.dirtyStructure;
  }

  /** いずれかの dirty が立っているか。 */
  isDirty(): boolean {
    return this.dirtyCell || this.dirtyStructure || this.dirtyViewport;
  }

  /**
   * dirty を消費して Render State を Document State に整合させる（構造Op なら rowAxis 再構築）。
   * SetCells だけのときは Axis を触らない（#5・全再構築しない）。描画自体は呼び出し側が行う。
   */
  flush(): FlushResult {
    const dirty: Record<DirtyKind, boolean> = {
      cell: this.dirtyCell,
      'row-structure': this.dirtyStructure,
      viewport: this.dirtyViewport,
    };
    let structuralRebuilt = false;
    if (this.dirtyStructure) {
      const doc = this.getDocument();
      this.currentRowAxis = createAxis({
        ids: displayRowOrder(doc),
        defaultSize: this.rowHeight,
      });
      if (doc.columnOrder.length !== this.currentColAxis.count()) {
        // 列 Operation は PoC に無いが、列数変化があれば防御的に再構築（通常は通らない）。
        this.currentColAxis = createAxis({ ids: doc.columnOrder, defaultSize: this.colWidth });
      }
      this.structuralRebuilds += 1;
      structuralRebuilt = true;
    }
    const needsRedraw = this.dirtyCell || this.dirtyStructure || this.dirtyViewport;
    this.dirtyCell = false;
    this.dirtyStructure = false;
    this.dirtyViewport = false;
    return { needsRedraw, structuralRebuilt, dirty };
  }

  /** 表示 index → RowId（範囲外は undefined）。Phase 3 の editingTarget 解決に使う（#4）。 */
  rowIdAt(index: number): RowId | undefined {
    if (index < 0 || index >= this.currentRowAxis.count()) {
      return undefined;
    }
    return this.currentRowAxis.getId(index);
  }

  /** 表示 index → ColumnId（範囲外は undefined）。 */
  columnIdAt(index: number): ColumnId | undefined {
    if (index < 0 || index >= this.currentColAxis.count()) {
      return undefined;
    }
    return this.currentColAxis.getId(index);
  }

  /** 可視 display-index 範囲の非空セルだけを ClientSession 文書から読んで visit する（O(可視セル)）。 */
  private queryRange(
    rowStart: number,
    rowEnd: number,
    colStart: number,
    colEnd: number,
    visit: RangeVisitor,
  ): number {
    const doc = this.getDocument();
    const rowAxis = this.currentRowAxis;
    const colAxis = this.currentColAxis;
    const rStart = Math.max(rowStart, 0);
    const rEnd = Math.min(rowEnd, rowAxis.count());
    const cStart = Math.max(colStart, 0);
    const cEnd = Math.min(colEnd, colAxis.count());
    let visited = 0;
    for (let ri = rStart; ri < rEnd; ri += 1) {
      const rowId = rowAxis.getId(ri);
      // 空行は列走査前にスキップ（疎な業務表で O(行×列) 回帰を避ける・DD-010 Codex[P2]）。
      const slot = slotOf(doc, rowId);
      if (slot === undefined || !doc.cells.hasRow(slot)) {
        continue;
      }
      for (let ci = cStart; ci < cEnd; ci += 1) {
        const record = getCell(doc, rowId, colAxis.getId(ci));
        if (record === undefined) {
          continue;
        }
        const text = cellScalarToDisplay(record.value);
        if (text === '') {
          continue; // blank は描画しない（chunk-store と同挙動）
        }
        visit(ri, ci, text);
        visited += 1;
      }
    }
    return visited;
  }

  /** ClientSession 文書を読むだけの ChunkStore（書き込みは禁止＝第二 CellStore を作らない・#2）。 */
  private createReadThroughStore(): ChunkStore {
    const readOnly = (): never => {
      throw new Error(
        'DocumentView.store は読み取り専用アダプター。編集は ClientSession.submitLocalOperation へ流すこと（第二の CellStore を作らない・DD-005 #2）。',
      );
    };
    return {
      get: (row, col) => {
        const rowId = this.rowIdAt(row);
        const columnId = this.columnIdAt(col);
        if (rowId === undefined || columnId === undefined) {
          return '';
        }
        return this.cellDisplay(rowId, columnId);
      },
      set: readOnly,
      bulkLoad: readOnly,
      queryRange: (rowStart, rowEnd, colStart, colEnd, visit) =>
        this.queryRange(rowStart, rowEnd, colStart, colEnd, visit),
      nonEmptyCount: () => this.getDocument().cells.nonEmptyCount(),
      approxMemoryBytes: () => 0, // アダプターは文書を複製しない（メモリは ClientSession 側が保持）
    };
  }
}
