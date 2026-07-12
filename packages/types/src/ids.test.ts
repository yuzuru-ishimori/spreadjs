import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  createColumnId,
  createDocumentId,
  createOperationId,
  createRowId,
  createSheetId,
  createTransactionId,
  type ColumnId,
  type DocumentId,
  type RowId,
} from './ids';

describe('ID ファクトリ（計画書 §6.1）', () => {
  it('入力文字列をそのまま保持する（実行時は素の文字列）', () => {
    expect(createDocumentId('doc-42')).toBe('doc-42');
    expect(createSheetId('sheet-1')).toBe('sheet-1');
    expect(createRowId('row-7')).toBe('row-7');
    expect(createColumnId('col-3')).toBe('col-3');
    expect(createOperationId('op-100')).toBe('op-100');
    expect(createTransactionId('tx-9')).toBe('tx-9');
  });

  it('異なる入力からは異なる値を返す', () => {
    expect(createRowId('row-1')).not.toBe(createRowId('row-2'));
  });

  it('戻り値は対応するブランド型として扱える', () => {
    const documentId: DocumentId = createDocumentId('doc-42');
    const rowId: RowId = createRowId('row-7');
    const columnId: ColumnId = createColumnId('col-3');
    expect([documentId, rowId, columnId]).toEqual(['doc-42', 'row-7', 'col-3']);
  });

  // 型レベルの負テスト（実行時は no-op。`npm run typecheck` の tsc が検証する）。
  // ブランドが素の string へ退化したり、別ブランドと同一化したりすると、以下の
  // いずれかの表明が偽になり typecheck が失敗する。§6.1 の「識別子を取り違えない」
  // という不変条件を、区別が壊れたときに機械検出できる形で固定する。
  it('各ブランドは素の string へ退化せず、相互に区別される（型レベル）', () => {
    // (1) 6種すべてが素の string と同一ではない（＝ブランドが付いている）
    expectTypeOf(createDocumentId('x')).not.toEqualTypeOf<string>();
    expectTypeOf(createSheetId('x')).not.toEqualTypeOf<string>();
    expectTypeOf(createRowId('x')).not.toEqualTypeOf<string>();
    expectTypeOf(createColumnId('x')).not.toEqualTypeOf<string>();
    expectTypeOf(createOperationId('x')).not.toEqualTypeOf<string>();
    expectTypeOf(createTransactionId('x')).not.toEqualTypeOf<string>();

    // (2) 異なるブランドは相互に区別される（同一化したら typecheck が落ちる）
    expectTypeOf(createDocumentId('x')).not.toEqualTypeOf(createSheetId('x'));
    expectTypeOf(createSheetId('x')).not.toEqualTypeOf(createRowId('x'));
    expectTypeOf(createRowId('x')).not.toEqualTypeOf(createColumnId('x'));
    expectTypeOf(createColumnId('x')).not.toEqualTypeOf(createOperationId('x'));
    expectTypeOf(createOperationId('x')).not.toEqualTypeOf(createTransactionId('x'));
    expectTypeOf(createTransactionId('x')).not.toEqualTypeOf(createDocumentId('x'));

    // 実行時にも 1 表明を残し、テストとして pass 判定させる。
    expect(createDocumentId('x')).toBe('x');
  });
});
