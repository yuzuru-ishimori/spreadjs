# DD-024 単独グリッドモード — Codex レビュー依頼

## 背景・目的

`@nanairo-sheet/grid` Facade を **collaboration: false（単独グリッドモード）** で成立させる DD。共同編集サーバー（Node）無しで mount でき、確定値の保存を利用側アプリの API へ接続する公開契約（cell-commit イベント）経由で行う。Stage 1（DD-016）で Facade は共同編集経路のみ実証済みで、`mount()` は serverUrl 必須・SessionSync（ClientSession）依存が支配的だった。本 DD はその依存を剥がし単独経路を新設する。

## ユーザー合意済みの決定（変更不可）

- **決定① Options = 案a（判別 union）**: `GridMountOptions` を共同編集用（serverUrl 系）と単独用（`mode:'standalone'`）の判別 union にし、排他を型で担保。混在は fail-fast（公開エラーコード）。
- **決定② 保存失敗時 = 通知のみ**: cell-commit は通知のみ。grid は書き戻さない（利用側が再注入で戻す）。revert Command は作らない。
- **決定③ 初期データ注入 = mount 時＋mount 後再注入の両方**: options.initialData ＋ GridInstance.setData。

## 内部方式の技術判断（レビュー対象）

**案B（単独用 document ホルダー新設）を採用**（`standalone-session.ts`）。案A（ClientSession をローカル完結 transport で再利用）を退けた理由は `doc/DD/DD-024/standalone-contract.md` §5 を参照（AC6 の connection 系イベント非発火が構造的に保証／pending 無限累積の回避／再注入の単純さ／描画・IME 資産は共有）。mount-controller が依存する backend を最小 interface `GridBackend`（`grid-backend.ts`）へ抽象化し、SessionSync（共同編集）は構造的に満たす（無変更）。standalone は `createStandaloneSession` が実装する。

## 最重要レビュー観点（優先順）

1. **共同編集経路の回帰**（最重要）: mount-controller から boot 内の描画/IME 配線を `attachBackendRendering()` へ抽出し、`sync` の型を `SessionSync` から `GridBackend` へ変えた。共同編集の boot・イベント写像・destroy・rAF/interval・IME 提出経路に**挙動差が無いか**（等価リファクタか）。
2. **公開契約の一貫性**: 判別 union の型排他（リテラル/JS 経路）、cell-commit の value 表現（表示文字列・R7 で内部 CellScalar を露出しないこと）、GridConnectionState への `'standalone'` 追加が既存 consumer を壊さないか、setData の collaboration モードでの扱い。
3. **fail-fast 網羅**: `validateStandaloneOptions`（serverUrl/displayName/clientId 混在→conflict、columnOrder 未指定/空→invalid）に漏れ・順序の問題がないか。
4. **standalone-session の正しさ**: revision 単調増加・applyOperation 適用・cell-commit の before/after 計算・setData の markFullRebuild・view.noteOperation による dirty 追従・未知列スキップ/rowId dedupe の防御が妥当か。合成中 destroy・注入と編集の競合など edge case の取りこぼし。
5. **テスト不足**: unit（standalone-session/standalone-options）と E2E（standalone/lifecycle）で AC1〜6 を十分カバーしているか。

## 変更ファイル

- `packages/grid/src/index.ts`: GridMountOptions 判別 union・GridEvent に cell-commit・GridConnectionState 'standalone'・GridInstance.setData・公開データ型（GridStandaloneData/GridCellCommitChange）
- `packages/grid/src/grid-backend.ts`（新規）: GridBackend/GridBackendSession 抽象
- `packages/grid/src/standalone-session.ts`（新規）: 単独モード backend（案B）
- `packages/grid/src/standalone-options.ts`（新規）: options 検証（fail-fast）
- `packages/grid/src/mount-controller.ts`: モード分岐・attachBackendRendering 抽出・bootStandalone・setData・connectionState
- `packages/grid/src/error-codes.ts`: 公開エラーコード 2 種追加
- `packages/grid/src/internal.ts`: debug connectionState に 'standalone'
- テスト: `standalone-session.test.ts`・`standalone-options.test.ts`・`error-codes.test.ts`（更新）
- E2E: `apps/playground/{standalone.html, src/integration/standalone-main.ts, e2e/standalone*.ts}`

## 機械検証状況

typecheck / lint / lint:boundary（新規境界違反 0）green・`npm test` 813 pass（既存 797＋新規 16）・playground E2E 16 pass（共同編集 12＋単独 4）。

## 責務境界（roadmap §6）

単独グリッドモードでは認証・保存の責務は**全面的に利用側アプリ**。SDK は cell-commit（通知）と setData（再注入）契約のみ提供する。
