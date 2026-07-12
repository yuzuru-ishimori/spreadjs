// 計画書 §6.1「識別子」のブランド型。
//
// ブランド型（nominal typing）は `string` に型レベルのタグ（__brand）を付けて、
// DocumentId と RowId のような「実行時はどちらも文字列」の値をコンパイル時に
// 取り違えられないようにする仕組み。構造的型付けの TypeScript でこれを表現する
// 唯一の手段が、生成時の `as` による構築的アサーションである（実行時の変換は無い）。
//
// ここでは「既存の文字列を対応するブランド型へ持ち上げる」ファクトリだけを提供する。
// ID の採番ロジック（`crypto.randomUUID()` 等。計画書 §6.1）は後続 PoC の DD で扱う。

export type DocumentId = string & { readonly __brand: 'DocumentId' };
export type SheetId = string & { readonly __brand: 'SheetId' };
export type RowId = string & { readonly __brand: 'RowId' };
export type ColumnId = string & { readonly __brand: 'ColumnId' };
export type OperationId = string & { readonly __brand: 'OperationId' };
export type TransactionId = string & { readonly __brand: 'TransactionId' };

// 各ファクトリは入力文字列を対応するブランド型へ持ち上げるだけ（値は不変）。
// `as` は上記のとおりブランド構築に不可欠なアサーションであり、外部データの
// 危険なダウンキャストではない（安全性は呼び出し側が渡す文字列で担保する）。
export const createDocumentId = (value: string): DocumentId => value as DocumentId;
export const createSheetId = (value: string): SheetId => value as SheetId;
export const createRowId = (value: string): RowId => value as RowId;
export const createColumnId = (value: string): ColumnId => value as ColumnId;
export const createOperationId = (value: string): OperationId => value as OperationId;
export const createTransactionId = (value: string): TransactionId => value as TransactionId;
