# 0001: grid `GridConflict.code` — 内部 RejectCode 素通しから公開語彙 `GridConflictCode` へ（任意→必須）

## 対象版

| 項目 | 値 |
|---|---|
| package 版 | `@nanairo-sheet/grid` `0.1.0-alpha.0`（DD-017） |
| API 版 | `GRID_API_VERSION` = `0.1.0-experimental` |
| CHANGELOG | `[0.1.0-alpha.0]` の「Changed（破壊的変更・Experimental 0.x）」節 |

## 影響 API

- `GridConflict.code`（`GridEvent` の `rejected` イベントに載る競合サマリ）:
  - 型: `string`（内部 `RejectCode` の素通し）→ **公開語彙 `GridConflictCode`**（安定コードの literal union）
  - 必須性: **任意（`code?`）→ 必須（`code`）**。未知/未写像の内部コードは `'unknown'` へフォールバックされる（前方互換）。
- 公開語彙の実体: `GRID_CONFLICT_CODES`（`@nanairo-sheet/grid` から export・実行時定数）。
  内部 RejectCode → 公開コードの写像表は `doc/archived/DD/DD-017/error-codes.md`。

## Before（移行前のコード — 現行 API では型 error になる）

旧 API（`code?: string`）前提のコード。生の内部コード文字列（例 `'stale-cell-revision'`）との比較と、
`code` 省略の `GridConflict` 構築は、現行 API では型 error になる:

```ts before
import type { GridConflict } from '@nanairo-sheet/grid';

/** 競合をユーザー向けメッセージへ整形する（旧: 生の内部 RejectCode に依存していた）。 */
export function describeConflict(conflict: GridConflict): string {
  // 現行 API では error: 'stale-cell-revision' は内部コード。公開語彙 GridConflictCode と重なりが無い（TS2367）。
  if (conflict.code === 'stale-cell-revision') {
    return '他のユーザーが同じセルを編集しました。';
  }
  return `競合が発生しました（${conflict.reason}）`;
}

/** テスト用の競合サマリ（旧: code は任意だったため省略できた）。 */
export function conflictFixture(): GridConflict {
  // 現行 API では error: code は必須（TS2741）。
  return {
    operationId: 'op-1',
    reason: 'rejected',
  };
}
```

## After（移行後のコード — 現行 API で型検査 green）

公開語彙 `GridConflictCode` で分岐し、構築時は `code` を必ず与える:

```ts after
import type { GridConflict } from '@nanairo-sheet/grid';

/** 競合をユーザー向けメッセージへ整形する（公開語彙 GridConflictCode で分岐する）。 */
export function describeConflict(conflict: GridConflict): string {
  // 'stale-cell-revision'（内部）は公開語彙では 'cell-conflict' へ写像される（error-codes.md）。
  if (conflict.code === 'cell-conflict') {
    return '他のユーザーが同じセルを編集しました。';
  }
  if (conflict.code === 'unknown') {
    // 未知/未写像コードの前方互換フォールバック（内部コードの追加で consumer 分岐は壊れない）。
    return `競合が発生しました（${conflict.reason}）`;
  }
  return `競合が発生しました（${conflict.code}）`;
}

/** テスト用の競合サマリ（code は必須・公開語彙から選ぶ）。 */
export function conflictFixture(): GridConflict {
  return {
    operationId: 'op-1',
    reason: 'rejected',
    code: 'cell-conflict',
  };
}
```

## 機械的手順

1. `GridConflict` の `code` を参照している箇所を検索する（例: `grep -rn "conflict.code" src/`）。
2. 生の内部コード文字列との比較を、写像表（`doc/archived/DD/DD-017/error-codes.md`）で公開語彙へ置換する:
   `'stale-cell-revision'` → `'cell-conflict'`／`'target-row-deleted'`・`'unknown-row'`・`'unknown-anchor'` → `'row-unavailable'`／
   `'unknown-column'` → `'column-unavailable'`／`'invalid-base-revision'` → `'revision-stale'`／
   `'client-sequence-violation'` → `'sequence-violation'`（`'duplicate-row'` は同名）。
3. `code === undefined` のガードは不要になったため削除する（必須化）。未知コードの分岐は `'unknown'` で受ける。
4. `GridConflict` を構築しているコード（テスト fixture 等）に `code` を追加する。有効値は実行時定数
   `GRID_CONFLICT_CODES`（`@nanairo-sheet/grid`）から選ぶ。
5. 型検査（`tsc --noEmit`）が green になることを確認する。
