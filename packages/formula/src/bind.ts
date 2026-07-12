// A1 ↔ BoundCellReference の双方向バインド（§14.3・scenarios.md §4・AC3/4）。
// 解析時に A1Ref を固定 RowId/ColumnId へ束縛し、行列挿入・移動後も同一論理セルを指す。
// 参照先が削除されていれば #REF!。DOM/Node 非依存（AxisView 経由で index↔ID を解決）。

import type { ColumnId, RowId, SheetId } from '@nanairo-sheet/types';
import type { A1Ref, BinaryOp, Expr, FunctionName, UnaryOp } from './ast';
import { refToA1 } from './ast';

/** RowId/ColumnId ⇄ 表示 index の読み取りビュー（core Axis の抽象）。 */
export interface AxisView {
  rowIdAt(index: number): RowId | undefined;
  /** 見つからなければ -1。 */
  indexOfRow(id: RowId): number;
  columnIdAt(index: number): ColumnId | undefined;
  indexOfColumn(id: ColumnId): number;
}

export type RefMode = 'relative' | 'absolute';

/** 固定 ID 参照（§14.3）。表示・入力は A1、保存 AST は固定 ID。 */
export interface BoundCellReference {
  readonly sheetId: SheetId;
  readonly rowId: RowId;
  readonly columnId: ColumnId;
  readonly rowMode: RefMode;
  readonly columnMode: RefMode;
}

export interface BoundRange {
  readonly start: BoundCellReference;
  readonly end: BoundCellReference;
}

/** 配列（表示順の ID 列）から読み取りビューを作る。挿入・削除は配列を作り直して再構築する。 */
export function createArrayAxisView(rowIds: readonly RowId[], columnIds: readonly ColumnId[]): AxisView {
  const rowIndex = new Map<RowId, number>();
  rowIds.forEach((id, i) => rowIndex.set(id, i));
  const colIndex = new Map<ColumnId, number>();
  columnIds.forEach((id, i) => colIndex.set(id, i));
  return {
    rowIdAt: (index) => rowIds[index],
    indexOfRow: (id) => rowIndex.get(id) ?? -1,
    columnIdAt: (index) => columnIds[index],
    indexOfColumn: (id) => colIndex.get(id) ?? -1,
  };
}

/** A1Ref を BoundCellReference へ束縛。範囲外（index に ID が無い）→ '#REF!'。 */
export function bindCellRef(ref: A1Ref, axis: AxisView, sheetId: SheetId): BoundCellReference | '#REF!' {
  const rowId = axis.rowIdAt(ref.row);
  const columnId = axis.columnIdAt(ref.col);
  if (rowId === undefined || columnId === undefined) return '#REF!';
  return {
    sheetId,
    rowId,
    columnId,
    rowMode: ref.rowAbs ? 'absolute' : 'relative',
    columnMode: ref.colAbs ? 'absolute' : 'relative',
  };
}

/** 範囲参照を束縛。両端のいずれかが範囲外→ '#REF!'。 */
export function bindRange(
  start: A1Ref,
  end: A1Ref,
  axis: AxisView,
  sheetId: SheetId,
): BoundRange | '#REF!' {
  const s = bindCellRef(start, axis, sheetId);
  if (s === '#REF!') return '#REF!';
  const e = bindCellRef(end, axis, sheetId);
  if (e === '#REF!') return '#REF!';
  return { start: s, end: e };
}

/** BoundCellReference を現在の Axis 上の A1Ref へ解決。ID が消えていれば '#REF!'。 */
export function resolveBoundToRef(bound: BoundCellReference, axis: AxisView): A1Ref | '#REF!' {
  const row = axis.indexOfRow(bound.rowId);
  const col = axis.indexOfColumn(bound.columnId);
  if (row < 0 || col < 0) return '#REF!';
  return {
    col,
    row,
    colAbs: bound.columnMode === 'absolute',
    rowAbs: bound.rowMode === 'absolute',
  };
}

/** BoundCellReference を A1 文字列へ（削除済みなら '#REF!'）。 */
export function boundToA1String(bound: BoundCellReference, axis: AxisView): string {
  const ref = resolveBoundToRef(bound, axis);
  return ref === '#REF!' ? '#REF!' : refToA1(ref);
}

// ---- 数式ASTの固定IDバインド（AC3/4 の評価統合・Codex P1）----
// 解析時 AST（A1Ref index）を固定ID化した BoundExpr へ束縛し、構造変更後は現在の Axis で
// index-AST へ解決し直して評価する。参照先が削除されていれば式全体を '#REF!'（エラー伝播）。

export type BoundExpr =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'cell'; readonly ref: BoundCellReference }
  | { readonly kind: 'range'; readonly range: BoundRange }
  | { readonly kind: 'unary'; readonly op: UnaryOp; readonly operand: BoundExpr }
  | { readonly kind: 'binary'; readonly op: BinaryOp; readonly left: BoundExpr; readonly right: BoundExpr }
  | { readonly kind: 'func'; readonly name: FunctionName; readonly args: readonly BoundExpr[] };

/** 解析時 AST を固定ID BoundExpr へ束縛する。参照が範囲外なら '#REF!'。 */
export function bindExpr(ast: Expr, axis: AxisView, sheetId: SheetId): BoundExpr | '#REF!' {
  switch (ast.kind) {
    case 'number':
      return { kind: 'number', value: ast.value };
    case 'string':
      return { kind: 'string', value: ast.value };
    case 'cell': {
      const ref = bindCellRef(ast.ref, axis, sheetId);
      return ref === '#REF!' ? '#REF!' : { kind: 'cell', ref };
    }
    case 'range': {
      const range = bindRange(ast.start, ast.end, axis, sheetId);
      return range === '#REF!' ? '#REF!' : { kind: 'range', range };
    }
    case 'unary': {
      const operand = bindExpr(ast.operand, axis, sheetId);
      return operand === '#REF!' ? '#REF!' : { kind: 'unary', op: ast.op, operand };
    }
    case 'binary': {
      const left = bindExpr(ast.left, axis, sheetId);
      if (left === '#REF!') return '#REF!';
      const right = bindExpr(ast.right, axis, sheetId);
      return right === '#REF!' ? '#REF!' : { kind: 'binary', op: ast.op, left, right };
    }
    case 'func': {
      const args: BoundExpr[] = [];
      for (const a of ast.args) {
        const b = bindExpr(a, axis, sheetId);
        if (b === '#REF!') return '#REF!';
        args.push(b);
      }
      return { kind: 'func', name: ast.name, args };
    }
  }
}

/**
 * BoundExpr を現在の Axis 上の index-AST へ解決する。参照先が削除されていれば式全体を '#REF!'
 * （どこか1つでも削除参照があれば式は #REF! に伝播する＝Excel と同旨）。
 */
export function resolveExpr(be: BoundExpr, axis: AxisView): Expr | '#REF!' {
  switch (be.kind) {
    case 'number':
      return { kind: 'number', value: be.value };
    case 'string':
      return { kind: 'string', value: be.value };
    case 'cell': {
      const ref = resolveBoundToRef(be.ref, axis);
      return ref === '#REF!' ? '#REF!' : { kind: 'cell', ref };
    }
    case 'range': {
      const start = resolveBoundToRef(be.range.start, axis);
      if (start === '#REF!') return '#REF!';
      const end = resolveBoundToRef(be.range.end, axis);
      return end === '#REF!' ? '#REF!' : { kind: 'range', start, end };
    }
    case 'unary': {
      const operand = resolveExpr(be.operand, axis);
      return operand === '#REF!' ? '#REF!' : { kind: 'unary', op: be.op, operand };
    }
    case 'binary': {
      const left = resolveExpr(be.left, axis);
      if (left === '#REF!') return '#REF!';
      const right = resolveExpr(be.right, axis);
      return right === '#REF!' ? '#REF!' : { kind: 'binary', op: be.op, left, right };
    }
    case 'func': {
      const args: Expr[] = [];
      for (const a of be.args) {
        const r = resolveExpr(a, axis);
        if (r === '#REF!') return '#REF!';
        args.push(r);
      }
      return { kind: 'func', name: be.name, args };
    }
  }
}
