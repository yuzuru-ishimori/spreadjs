# ADR-0022: コアはゼロランタイム依存を原則とする

- **Status**: Draft（DD-006/PoC-D で `formula` が外部ランタイム依存ゼロを実証して起票。Accepted 化は DD-007〔Phase 0 期限〕）
- **関連**: 製品憲章 `doc/product/nanairo_sheet_product_charter_v1.md` §9.1（React以外からも利用）・§10.3（公開範囲）・§21（セキュリティ: 依存ライセンス/脆弱性をCIで検査）・§24（再検討条件）／計画書 §17.2（coreにDOM型を持ち込まない）／DD-005（`collab` 依存ゼロ）・DD-006（`formula` 依存ゼロ）

## 背景・課題

コア（文書モデル・数式・共同編集クライアント・座標/描画ロジック）を、ブラウザーと Node の双方で同一挙動で動かし（収束 hash の cross-platform 一致・§AC1/AC5）、依存ライセンス・脆弱性・供給網リスクを最小化したい（憲章 §21）。外部ランタイム依存を無制限に許すと、DOM/Node 固有 API がコアへ染み出し、環境非依存性・テスト容易性・長期保守性が損なわれる。

## 選択肢

| 選択肢 | 概要 | 長所 | 短所 |
|--------|------|------|------|
| **(A) ゼロランタイム依存（本決定案）** | `packages/*` の `dependencies` を空にし、内部型（types）のみに依存。DOM/Node は持ち込まず、時刻・ID・トランスポート・セル値アクセス・Axis は**注入抽象**（Clock/IdGenerator/Transport/CellReader/AxisView）で外から供給 | 環境非依存・cross-platform 同一 hash・脆弱性/ライセンス面が最小・テスト容易 | 便利ライブラリを使わず自作範囲が増える（R-17） |
| (B) 便利ライブラリを許容 | lodash/date-fns 等を使う | 実装が速い | 依存増・環境依存混入・バンドル肥大 |
| (C) 一部低レベル依存を ADR で個別許可 | 原則ゼロ＋例外を明示 | 現実的な折衷 | 例外管理コスト |

## 決定（Draft）

**(A) `packages/*` は外部ランタイム依存ゼロを原則**とする。

- `dependencies` は空（内部 `@nanairo-sheet/*` は devDependencies で型参照のみ）。
- DOM/Node API をコアで参照しない（`tsconfig` は `lib:["ES2022"]`・`types:[]`）。
- 環境固有の関心事（時刻・乱数ID・ネットワーク・セル値ストア・Axis）は**注入インターフェイス**で抽象化する（`CellReader`・`AxisView`・`ClientTransport`・`Clock`・`IdGenerator`）。
- **env-free 回帰ゲート**: 実装ファイル（テスト除外）を `tsconfig.core.json`＋`typecheck:core` で `types:[]` 型検査し、Node/DOM API の誤混入を CI で検出する（DD-005 [P2] を機に導入）。

## 結果（実証・DD-005/DD-006）

- `types`・`core`: ランタイム依存ゼロ（既存）。
- `collab`（DD-005）: `dependencies:{}`・`typecheck:core` で env-free 回帰検証（probe で実効性確認）。
- `formula`（DD-006）: `dependencies:{}`・`typecheck:core` green。tokenizer/parser/AST/limits/bind/dep-graph/evaluator/recalc を **DOM/Node 非参照**で実装し、セル値アクセスは `CellReader`、Axis は `AxisView` で注入。深いネスト（10万）・大量式・range 集計もゼロ依存で成立。
- 計測ツール（`apps/pocd-bench`）は Node API（process/v8/performance）を使うが、**製品パッケージではない**（`packages/*` の原則の対象外）。

## 再検討条件

- ゼロ依存方針が品質または開発速度を著しく損なう（憲章 §24・R-17）→ 低レベル依存（例: decimal・高精度日付）を **ADR で個別許可**へ。
- cross-platform hash 一致に自作実装（FNV-1a・UTF-8 バイト列）で不足が出る → 標準化された最小依存を検討。
- ブラウザー/Node で挙動差が出る API を避けきれない → Adapter 層（`apps/*` 側）へ隔離して core は不変を維持。
