# Codex レビュー依頼: DD-011-1 packageリネーム

## 目的・スコープ

内部 5 package を DD-009 論理名へ **機械的 rename**（挙動不変）。冗長な `sheet-` プレフィックスを除去し、
package name の suffix ＝ ディレクトリ名 で完全統一する。新機能・API 変更・ファイル移動は一切なし。

| git mv（ディレクトリ） | package.json name |
|---|---|
| `packages/sheet-types` → `packages/types` | `@nanairo-sheet/sheet-types` → `@nanairo-sheet/types` |
| `packages/sheet-core` → `packages/core` | `@nanairo-sheet/sheet-core` → `@nanairo-sheet/core` |
| `packages/sheet-server-core` → `packages/server` | `@nanairo-sheet/sheet-server-core` → `@nanairo-sheet/server` |
| `packages/sheet-collaboration` → `packages/collab` | `@nanairo-sheet/sheet-collaboration` → `@nanairo-sheet/collab` |
| `packages/sheet-formula` → `packages/formula` | `@nanairo-sheet/sheet-formula` → `@nanairo-sheet/formula` |

## 対象差分（--uncommitted）

- 121 files changed（66 rename + 51 modified + DD 追加）。
- package.json name＋workspace 相互 devDependencies を新名へ。
- 全 TS import（サブパス import `.../collab/test-support`・`.../inprocess-transport` 含む）を新名へ。
- ディレクトリ 5 件を `git mv`（git は R として追跡）。
- コメント prose 内の旧 package 名（`sheet-core` 等）も新名へ整合（挙動非影響）。
- package-lock.json は `rm` 後 `npm install` でクリーン再生成（stale/extraneous 0）。
- 生きた doc 追随: `doc/decisions.md`（D-003 帰結）・`AGENTS.md`・`README.md`・`doc/adr/0011-*.md`。

## 設計意図・制約

- **挙動保存が最優先**。rename 前後で test/typecheck/lint/build を同一コマンドで比較。
- 解決は npm workspaces symlink 経由（tsconfig paths / vite・vitest alias なし）。
- root `package.json` workspaces は glob `packages/*`・vitest include は `packages/**` のため無修正で追随。

## 重点確認観点（findings 優先）

1. **旧名すり抜け**: `@nanairo-sheet/sheet-*` や `packages/sheet-*` の参照が置換漏れしていないか
   （binary 扱いされうる `hash.test.ts`・文字列リテラル・サブパス import・tsconfig references を含む）。
2. **git mv 追跡**: 5 ディレクトリが rename として追跡され、`git log --follow` で履歴が途切れない操作か
   （純 add/delete による履歴断絶がないか）。
3. **挙動保存**: name 短縮（例 `collab`）や package 名が wire 形式・シリアライズ・snapshot・エラーメッセージ・
   テスト期待値へ文字列として埋まっていないか（埋まっていれば挙動変化＝要指摘）。
4. **lock 整合**: 再生成された package-lock.json に旧 name・旧ディレクトリキー・extraneous が残っていないか。
5. **バリデーション/回帰/テスト不足**: rename により参照が壊れる箇所、逆に置換すべきでない箇所を誤置換していないか。
6. **tsserver キャッシュ偽陽性**の可能性（editor 側キャッシュに起因する見かけのエラーと真のエラーの切り分け観点）。
