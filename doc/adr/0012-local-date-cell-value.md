# ADR-0012: セル日付値を LocalDate（YYYY-MM-DD 文字列）で保持する

- **Status**: **Accepted**（2026-07-13・DD-012-1）。**Codex レビュー（xhigh・1回）承認で Accepted**
  （ChatGPT 外部レビュー不要＝ユーザー確定 2026-07-13・DD-010/ADR-0011 先例）。Codex は LocalDate 表現・hash 決定性・
  偽陽性防止の**中核設計に異議なし**。指摘 5 件（すべて P2・波及完全性/テスト強化）は全対応済み（下記）:
  snapshot version 3 化＋date round-trip テスト／組み込みデモ demo.html の date 変換追随／IME 不変条件を実セッション+fake port で DOM 実駆動／
  全角スラッシュ ／(U+FF0F) 正規化＋テスト／date のメモリ概算 char 計上。結果は `doc/DD/DD-012-1/codex-review-result.md`。
- **関連**: 計画書 D-08（値モデル・LocalDate）／DD-012-1（入力縦切り・型変換 標準セット）／
  ADR-0022（core ゼロ依存・環境非依存 hash）／DD-006/DD-010（documentHash の cross-platform 決定性）／
  CellScalar 定義 `packages/core/src/operations.ts`。

## 背景・課題

DD-012-1 で「日本語で文字列/**数値/日付**をセルへ連続入力できる」を製品品質にするにあたり、日付値の内部表現を確定する必要がある。
CellScalar は従来 `blank | string | number` のみ（`packages/core/src/operations.ts`）で、日付を保持する型がない。
日付を追加する際、次を満たさねばならない:

- **cross-platform hash 決定性の維持**（ADR-0022・DD-006/DD-010）: documentHash は Node/ブラウザーで同一でなければならない。
  時刻・タイムゾーン・ロケールに依存する値表現を core に持ち込むと、環境差で hash が割れて収束判定が壊れる。
- **string との区別**: `2026-07-13` という文字列そのものと、日付値 `2026-07-13` は別値として扱えること（正準性）。

## 選択肢

| 選択肢 | 概要 | 長所 | 短所 |
|--------|------|------|------|
| **(A) LocalDate 文字列 `{ kind:'date'; value:'YYYY-MM-DD' }`（本決定）** | 暦日のみを正準文字列で保持。時刻・TZ を持たない | 環境非依存で hash 決定的／JSON 往復で無損失／string と kind で区別／core ゼロ依存を維持 | 時刻・タイムゾーン・日時演算は表現できない（Stage 1 の範囲外） |
| (B) JS `Date`（エポック ms・`{ kind:'date'; value:number }`） | Date オブジェクト or epoch を保持 | 日時演算が容易 | TZ/DST でローカル暦日がずれる／シリアライズが環境依存になりうる／core に時刻概念が漏れる（ADR-0022 抵触） |
| (C) 数値シリアル（Excel 風・1900 起点の連番） | 日付を数値で保持 | Excel 互換・数式に載せやすい | number と型が衝突し区別不能／基準日・閏バグの互換問題／可読性が低い |

## 決定（Draft）

**(A) LocalDate 文字列**を採用する。CellScalar に `{ kind: 'date'; value: string /* YYYY-MM-DD（正準化済み） */ }` を追加する。

- **正準形**: 4桁年 `-` 2桁月 `-` 2桁日（0埋め）。`value` は必ず**実在する暦日**（月 1-12・日は月末・閏年考慮）。
  生成は入力パーサー `parseCellInput`（`packages/core/src/cell-input.ts`）が保証し、非正準・非実在日は日付にしない（string へ落とす）。
- **受理書式（標準セット・DD-012-1）**: `YYYY-MM-DD` / `YYYY/MM/DD`（月日は1〜2桁可・区切りは `-`/`/`）→ 正準 `YYYY-MM-DD` へ。
  全角数字・全角区切りは正規化してから判定。実在しない日付・電話番号・郵便番号・型番は日付にしない（偽陽性防止）。
- **hash 決定性**: `canonicalSerialize`（`hash.ts`）は `field(kind)`（'date' vs 'string'）で区別し、`value.value` をそのまま長さ前置連結する。
  文字列も日付も同じ `YYYY-MM-DD` テキストだが **kind フィールドが hash を分岐**させるため、正準性を保ちつつ cross-platform 決定的。
- **波及（DD-012-1 で実装）**: `operations.ts`（型追加）・`document.ts` `cloneCellScalar`・`cell-store.ts` `cloneScalar`（clone に date 分岐）・
  `apply.ts`（cloneCellScalar 経由で自動対応）・`validate.ts`（CellScalar を不透明に扱うため変更不要）・
  `message-codec.ts`（セル値詳細は信頼境界のため深い検査なし＝変更不要）・`document-view.ts`（表示は canonical 文字列）。
- **JS `Date` を正規値にしない**（計画書 D-08）。時刻・タイムゾーン・日時演算は Stage 1 の範囲外。

## 結果（DD-012-1 の実装・検証）

- CellScalar に `date` を追加。clone 分岐（document.ts / cell-store.ts）を網羅（`as` 不使用・switch 網羅）。
- `parseCellInput` の受理書式表を否定ケース込みで unit テスト（`cell-input.test.ts`）。
- ローカル Operation + documentHash 決定性テスト（`local-operation.test.ts`）: 同一入力列→同一 hash・date≠string・JSON 往復一致。
- 既存 hash/apply/cell-store/document テスト green（回帰なし）。

## Accept 手続き（ユーザー確定 2026-07-13）

本 ADR の Accepted 化は **Codex レビュー（xhigh・1回）の承認**をもって行う（ChatGPT 外部レビュー不要）。
Codex が本表現（LocalDate・hash 決定性・偽陽性防止）に findings を出さない／出た findings を反映したうえで、
DD-012-1 ログに「Codex 承認で Accepted」と明記し、本 Status を **Accepted** へ更新する。
