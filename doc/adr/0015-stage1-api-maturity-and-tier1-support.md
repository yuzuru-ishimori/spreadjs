# ADR-0015: Stage 1 Alpha の公開API成熟度方針と Tier 1 対応環境

- **Status**: Draft（DD-009 基盤判断DDで起票。External Review 対象＝Phase境界・API確定・ADR転換。Accepted 化は DD-016 Facade/consumer統合DD〔Experimental 公開範囲の確定時〕・CG-4 実証は DD-017/018）
- **関連**: ロードマップ `doc/plan/phase1-dd-roadmap.md` §0（CG-4）・§6（Alpha 製品境界）・§7（consumer 契約）・Stage 1 移行条件 S1-5/S1-6／
  製品憲章 `doc/product/nanairo_sheet_product_charter_v1.md` §15（Stage 1 社内SDK Alpha・Goal 1）・§10.3（公開範囲）・§26.2（成熟段階）／
  `doc/adr/0022-zero-runtime-dependency-core.md`（依存境界）／DD-009 `package-boundary.md`（Facade 公開面）・`cg-ledger.md`（CG-4）

## 背景・課題

Stage 1 は「別の社内プロジェクトから npm パッケージとして利用できる **社内SDK Alpha**」を作る段階（憲章 §15・S1-3）。
ここで**公開APIの成熟度（安定性の約束）**と**対応環境の範囲**を事前に確定しないと、次の失敗が起きる:

1. **早すぎる固定**: consumer に見せた API を「Stable」と誤認させ、`0.x` 段階で必要な破壊的変更ができなくなる。
2. **遅すぎる/無契約**: 変更履歴も version 検出もないまま consumer が組み込み、更新時にサイレント破壊が起きる。
3. **環境の暗黙前提**: 「動くはず」で macOS/Firefox を暗黙対象にし、CG-1（実機IME）や描画差異を検証しないまま Alpha を通す。

Stage 1 は trusted internal 限定・`0.x`・Tier 1 のみという**明示された狭い保証**で、上記を避ける必要がある（§6）。

## 決定（Draft）

### D1. 公開API成熟度は Internal → Experimental の2段階（Stable は Stage 1 で出さない）

| 成熟度 | 対象 | 約束 | 変更 |
|---|---|---|---|
| **Internal** | 内部パッケージ `@nanairo-sheet/{types,core,collab,server,selection,render,ime,formula}` | consumer へ公開しない。boundary lint で直接 import 禁止（`package-boundary.md` §4） | 無制限（consumer 契約外） |
| **Experimental** | Facade `@nanairo-sheet/{grid,server-hono}`（Stage 1 公開面） | consumer が使える最小契約。**長期後方互換は非保証** | `0.x` で破壊的変更可。ただし **CHANGELOG に必ず記録**＋version で検出可能に |
| ~~Stable~~ | — | **Stage 1 では出さない** | Stage 2 以降で昇格判断 |

- **`0.x` 運用（S1-5）**: version は `0.x`。破壊的変更を許すが、**変更履歴（CHANGELOG）を残す**ことを必須とする。
- **version mismatch は fail-fast（§6・ロードマップ）**: 古い snapshot / protocol を**誤読しない**。自動 migration を実装しなくても、
  **version 不一致を検出して fail-fast**する（サイレント誤読を禁止）。protocol/schema version は `core` protocol が持つ。
- **公開面の最小化**: Facade は内部パッケージの型/実装を**素通し再エクスポートしない**（`package-boundary.md` R7）。
  Experimental として見せるのは Facade の自前公開型のみ（内部 API 漏洩＝将来の互換負債を防ぐ）。
- **Experimental 公開範囲の確定は DD-016**: 本ADRは方針（刻み・運用ルール）を固定する。どの Command/Event/Options を
  Experimental として公開するかの**具体的 API 面は DD-016（Facade/実consumer統合DD）で確定**しレビューする。

### D2. Tier 1 対応環境は Windows Chrome / Edge のみ（CG-4）

- **Tier 1（対応・検証する）**: Windows Chrome（Chromium）・Windows Edge（Chromium）。
- **対象外（明示・検証しない）**: macOS 全ブラウザ・Firefox・モバイル。§6 信頼境界（trusted internal・public internet 非対象）が前提。
- **未解除時の扱い（CG-4）**: 対象外環境は「対象外」と明示すれば境界化で可（他CGと異なり Alpha 不可条件ではない）。
  ただし CG-1（実機IME）は Tier 1（Win Chrome/Edge 両方）で実証必須。

#### compatibility matrix の枠（記載項目・更新責務・更新タイミング）

| OS | ブラウザ | 判定 | 最終検証日 | 検証DD | 備考 |
|---|---|---|---|---|---|
| Windows | Chrome (Chromium) | Tier 1 | （DD-017 実測記入） | DD-012 / DD-017 | CG-1 実機IME・CG-4・CG-6 |
| Windows | Edge (Chromium) | Tier 1 | （DD-017 実測記入） | DD-012 / DD-017 | CG-1 実機IME・CG-4 |
| macOS | 全ブラウザ | 対象外 | — | — | Stage 1 非対象 |
| Windows/macOS | Firefox | 対象外 | — | — | Stage 1 非対象 |

- **記載項目**: OS・ブラウザ・判定（Tier 1/対象外）・最終検証日・検証DD・備考（関連CG）。
- **更新責務**: 枠の定義＝本ADR／実測記入＝DD-017（Alpha配布・診断DD）／最終合否判定＝DD-018（Stage 1移行判定DD）。
- **更新タイミング**: Phase 開始時に枠確定（本DD）→ Facade 公開前に CG-1 スモーク → Alpha exit 前に CG-4/CG-6 実証。

## 選択肢（D1 の主要トレードオフ）

| 選択肢 | 概要 | 長所 | 短所 |
|--------|------|------|------|
| **(A) Internal→Experimental・Stable なし（本決定）** | Stage 1 は Experimental `0.x`＋CHANGELOG＋fail-fast のみ | 破壊的変更の自由を保ちつつ consumer に変更を伝達／早すぎる固定を回避 | consumer は後方互換を当てにできない（社内 Alpha なので許容） |
| (B) 最初から Stable を出す | 公開面を Stable と約束 | consumer が安心して長期依存 | `0.x` の設計変更が封じられ、PoC 由来の API を固定化＝負債化 |
| (C) 成熟度区分を付けず公開 | ラベルなしで export | 実装が速い | consumer が安定性を誤認・サイレント破壊・version 契約なし |

## 結果・影響

- `package-boundary.md`: Facade（`grid`/`server-hono`）＝Experimental・内部＝Internal と一致。R7（素通し再エクスポート禁止）が本方針の担保。
- `cg-ledger.md`: CG-4 の解除証拠＝本ADRの compatibility matrix 枠＋DD-017/018 実測。
- DD-016: Experimental の具体的 API 面（Command/Event/Options）を確定・レビュー（Accepted 化のトリガー）。
- DD-017: private registry publish・dist-tag（alpha）・CHANGELOG 運用・compatibility matrix 実測（S1-6）。

## 再検討条件

- 最初の consumer が確定し React 経路が必須化 → Facade `react` を Stage 1 公開面へ追加（`package-boundary.md` §5 昇格条件）。
- Stage 2 移行時に一部 Facade API を Stable へ昇格する判断が必要になったら、本ADRを更新し Stable 区分を新設。
- Tier 1 に他ブラウザ/OS を追加する要求 → compatibility matrix と CG-4 の再判定（DD-018 以降）。
</content>
