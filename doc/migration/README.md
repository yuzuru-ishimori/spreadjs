# Migration Guide 運用規定（S2-3・DD-028）

> **正本**: 公開 Facade API の破壊的変更に対する**移行手順（migration guide）の運用規定＋ガイド実体**の置き場。
> 憲章 §15 S2-3「API 差分監視と移行ガイドがある」・§18.3「非推奨APIには代替手段と移行期間を示す」の担保。
> 破壊的変更の**検出**は `tests/contract/facade-surface.test.ts`（型スナップショット）、**記録**は `CHANGELOG.md`、
> **移行手順**が本フォルダ、**非推奨・共存期間の判定**は `doc/product/deprecation-policy.md`（4本柱・DD-028）。

## 1. 書く条件（必須判定）

- **CHANGELOG の破壊的変更節に載る変更 = ガイド必須**（`Changed（破壊的変更）` / `Removed` で既存 consumer コードの追随が要る項目）。
- 追加のみ（`Added`・後方互換なフィールド追加等）はガイド不要。CHANGELOG の記録だけでよい。
- 判定タイミングは contract test（`tests/contract/facade-surface.test.ts` ヘッダ）の**意図的な surface 変更の手順**の step 4。
  snapshot 更新（`-u`）したら CHANGELOG 記録 → **本規定でガイド要否を判定** → deprecation policy 適用判定、の順。

## 2. 書式

- ファイル名: `NNNN-短い名前.md`（4桁連番。例: `0001-grid-conflict-code.md`）。
- 必須節:
  1. **対象版**: 変更が入った package 版・API 版（CHANGELOG の版対応表と一致させる）
  2. **影響 API**: 変更された公開シンボル・型（Facade 名込み）
  3. **Before / After**: consumer 視点の移行前後コード（下記 dry-run 契約の fenced block）
  4. **機械的手順**: consumer が追随する具体手順（検索パターン・置換方針・参照すべき写像表など）
- Before / After コードは info string 付き fenced block で書く（dry-run 検証の抽出対象）:
  - <code>```ts before</code> … **現行 API で型 error になる**移行前コード
  - <code>```ts after</code> … **現行 API で型検査 green になる**移行後コード
- before ブロックには `expect=TS2367,TS2741` 形式で**期待する型 error コード集合**を付ける
  （**1 ブロックに独立した複数の移行点を書く場合は必須**・単一移行点でも推奨）。指定すると dry-run は
  観測コード集合との完全一致を要求し、移行点の**一部だけ**が将来の API 変化で陳腐化しても検出できる
  （`expect` なしの before は「≥1 型 error」の判定のみ）。

## 3. dry-run 検証義務

- `tests/contract/migration-dryrun.test.ts` が本フォルダの全ガイド（`NNNN-*.md`）を走査し、
  **before ブロック=現行 API で型 error（≥1 diagnostic）／after ブロック=型検査 green（0 diagnostics）** を機械検証する。
  CI（`.github/workflows/ci.yml` の checks job・DD-028）で継続実行される＝ガイドの手順が現行 API で通る証拠を常時保つ。
- dry-run は**型検査レベル**の検証である。型シグネチャに現れない挙動変更の移行は、ガイドに手動確認手順を明記し、
  「型 dry-run の対象外」であることをガイド内に記す（before/after ブロックが書けない場合は理由を明記する）。
- ガイドの before が将来の API 変化で「型 error でなくなる」／after が「型 error になる」場合、この test が fail する。
  その時点でガイドを現行 API に合わせて更新する（連鎖する移行はガイドを版ごとに分けてよい）。

## 4. CHANGELOG・型スナップショットとの対応関係

| 役割 | 場所 | 内容 |
|---|---|---|
| 変更の**検出** | `tests/contract/facade-surface.test.ts`（公開宣言 closure snapshot） | 公開型シグネチャの意図しない変更を fail で検出 |
| 変更の**記録** | `CHANGELOG.md` | 何が・どの版で変わったか（破壊的変更は必記＝サイレント破壊禁止） |
| 変更への**追随手順** | 本フォルダ（`NNNN-*.md`） | consumer がどうコードを直すか（dry-run 検証済み） |
| 非推奨・共存期間の**判定** | `doc/product/deprecation-policy.md` | 成熟度3層（0.x / Beta / Stable）の適用ルール |

## ガイド一覧

| # | ガイド | 対象版 | 影響 API |
|---|---|---|---|
| 0001 | [`0001-grid-conflict-code.md`](0001-grid-conflict-code.md) | `0.1.0-alpha.0` | grid `GridConflict.code`（型変更・任意→必須） |
