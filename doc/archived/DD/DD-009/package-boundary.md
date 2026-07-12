# package責務境界・公開面の最小方針（Stage 1 SDK Alpha）

> **正本**: DD-009（基盤判断DD）Phase 2 の成果物。内部パッケージ群と Facade パッケージの**責務・依存方向・
> 許可/禁止 import**を、**DD-011 が boundary lint として機械実装できる粒度**で定義する。
> 公開面は最初の consumer 前提で**最小経路に絞る**（ロードマップ §7）。
> **本DDは境界の定義のみ**。lint 実装・skeleton・rename 実行は DD-011（基盤実装DD）。

## 0. 用語と前提

- **内部パッケージ（Internal）**: consumer から**直接 import させない**。API 成熟度は Internal（`0.x`・破壊的変更可）。
- **Facade パッケージ**: consumer が import してよい**唯一の公開面**。API 成熟度は Experimental（`0.x`・CHANGELOG 運用。ADR-0015）。
- **consumer**: SDK 利用者（社内アプリ・`apps/*` の統合デモ・独立 consumer harness）。
- 依存フロー: `consumer → Facade → 内部パッケージ → types`（一方向 DAG・逆流禁止・循環禁止）。

## 1. 決定（決定事項サマリ）

1. **公開面の最小経路（決定2）**: Stage 1 Alpha で整備する Facade は **`grid`（Canvas描画）＋ `server-hono`（同期）の2つに絞る**。
   `element`・`react` 薄ラッパーは **Stage 2 送り**（§7: 最初の consumer に必要な最小経路へ絞る。React 薄ラッパーは
   「最初の consumer が React の場合のみ必須」だが**最初の consumer 未定**のため Stage 1 では作らない）。
2. **論理名は目標・rename は DD-011（決定1）**: 内部/Facade の論理名（`@nanairo-sheet/*`）を**目標名として定義**する。
   現行 `packages/sheet-*` からの実 rename は DD-011 で判断・実行し、**本DDでは強制しない**（判断と実装を分離）。
3. **boundary lint 粒度**: 「consumer は Facade のみ import 可・内部直接 import 禁止」「`apps/*` 間 import 禁止」
   「package 境界を越える相対 import 禁止」を**機械判定可能なルール**（§4）として記述する。

## 2. パッケージ構成と論理名 ↔ 現行 `sheet-*` 対応

### 2.1 内部パッケージ（Internal・consumer 直接 import 禁止）

| 論理名（目標） | 責務 | 現行 `sheet-*` / 抽出元 | rename/新設 時期 | DOM/Node |
|---|---|---|---|---|
| `@nanairo-sheet/types` | ブランド型・ID（RowId/ColumnId）・共通イベント・公開型 | `packages/sheet-types` | DD-011（rename） | 非依存 |
| `@nanairo-sheet/core` | 文書モデル・Operation・決定論的適用・正準ハッシュ・validate・protocol・**JSON境界 codec（protocol wire decode/encode）** | `packages/sheet-core`＋`packages/sheet-collaboration/src/message-codec.ts` を core へ移設（下記 codec 注記） | DD-011（rename＋codec移設） | 非依存 |
| `@nanairo-sheet/collab` | 共同編集クライアント（ClientSession・楽観適用/rollback/replay・Conflict Queue・transport 抽象） | `packages/sheet-collaboration` | DD-011（rename） | 非依存 |
| `@nanairo-sheet/server` | 全順序シーケンサー・権威Room・Presence・snapshot | `packages/sheet-server-core` | DD-011（rename） | 非依存 |
| `@nanairo-sheet/selection` | 選択・ナビゲーション・座標幾何 | `apps/playground` `grid/navigation`・`pocb/selection`・`grid/geometry` | 抽出（DD-012） | 非依存 |
| `@nanairo-sheet/render` | Canvas 2レイヤー描画・viewport・scroll anchor・DPI・text cache・render scheduler・axis | `apps/playground/src/pocb/*` | 抽出（DD-012） | **DOM 可** |
| `@nanairo-sheet/ime` | IME 状態機械・常駐 textarea 結線・event recorder | `apps/playground/src/ime/*`・`integration/ime-editing-session` | 抽出（DD-012） | **DOM 可**（adapter 部） |
| `@nanairo-sheet/formula` | 数式エンジン（Stage 2 で起動） | `packages/sheet-formula` | DD-011（rename）／起動 DD-022 | 非依存 |

### 2.2 Facade パッケージ（consumer が import してよい唯一の面）

| 論理名 | 責務 | Stage | 束ねる内部パッケージ | 現行 / 抽出元 | DOM/Node |
|---|---|---|---|---|---|
| `@nanairo-sheet/grid` | Canvas 描画グリッド。mount/destroy・Command/Event/Options・型定義。IME×共同編集×描画を1つの consumer 面に統合 | **Stage 1（最小経路）** | `core`・`types`・`collab`・`render`・`selection`・`ime` | `apps/playground/src/integration/*` を昇華 | **DOM 可** |
| `@nanairo-sheet/server-hono` | Hono + `@hono/node-server` + `ws` サーバー Facade。Room/Sequencer/Presence を実トランスポートへ配線 | **Stage 1（最小経路）** | `server`・`core`・`types` | `apps/collaboration-server` を昇華 | **Node 可** |
| `@nanairo-sheet/element` | Custom Element 薄ラッパー | **Stage 2** | `grid` | 未実装 | DOM 可 |
| `@nanairo-sheet/react` | React 薄ラッパー | **Stage 2**（最初の consumer が React なら昇格） | `grid` | 未実装 | DOM 可 |

> **rename 注記**: 上表の論理名は目標。DD-011 の rename 完了までは現行 `packages/sheet-*` 名が有効。
> `grid`・`server-hono` は新設 Facade（現行に同名 package なし。統合資産・`collaboration-server` を昇華）。

## 3. 責務境界（各パッケージの持ち分・持たない物）

- **types**: 型と ID ファクトリのみ。ロジック・DOM/Node を持たない。他パッケージに依存しない（DAG の葉）。
- **core**: Document State の**唯一の表現と決定論的適用**＋protocol と **JSON境界 codec**。ネットワーク・DOM・時刻/乱数を持たない（注入抽象）。
  - **codec 所有権の注記（Codex P1 反映）**: メッセージ型は core protocol が持ち、`decode/encode` も core が所有する。
    理由: `server-hono`（サーバー側フレーム復号）と `collab`（クライアント側）の**双方が codec を使う**ため、collab に置くと
    `server-hono → collab`（=サーバーがクライアント session package に依存）という逆方向結合（R3 違反）になる。
    現行 `packages/sheet-collaboration/src/message-codec.ts`（`decodeClientMessage` 等）は **DD-011 の rename と同時に core へ移設**する
    （現行 `apps/collaboration-server/src/server.ts` は `sheet-collaboration` から import しているため移設対象）。
- **collab**: クライアント側の**唯一の正本＝ClientSession**。描画・DOM を持たない。transport は抽象（注入）。
- **server**: サーバー側の**全順序と権威状態**。実トランスポート（ws/hono）を持たない（server-hono が配線）。
- **selection**: 選択範囲・アクティブセル・ナビゲーション・座標。文書状態を保持しない（core を読むだけ）。
- **render**: Canvas 描画のみ。文書状態を保持しない（**第二 CellStore を作らない**・DocumentView 経由で core を読む）。
- **ime**: IME 状態機械（DOM 非依存部）＋ textarea DOM adapter。**活性セルの所有権は状態機械**。文書は core/collab が正本。
- **grid（Facade）**: consumer 向けの**唯一の統合面**。内部（core/collab/render/selection/ime）を束ね、mount/destroy・
  Command/Event/Options・型定義を公開。内部 API を**再エクスポートしない**（内部型の漏洩禁止）。
- **server-hono（Facade）**: サーバー起動/停止・接続 lifecycle・heartbeat/TTL を公開。`server` の内部型を漏らさない。

## 4. boundary ルール（DD-011 boundary lint 実装仕様）

> 以下は**機械判定可能**な形で記述する。DD-011 が ESLint（`no-restricted-imports` / import path 正規表現）または
> 専用スクリプトで実装する。**規約の出所は本節を正本**とする。

### 4.1 許可 import 方向（DAG・循環禁止）

```text
consumer / apps/*      → grid, element, react, server-hono            （Facade のみ）
grid                   → core, types, collab, render, selection, ime  （内部を束ねる）
element, react         → grid                                         （grid のみ・内部禁止）
server-hono            → server, core, types
render                 → core, types, selection
ime                    → core, types
selection              → core, types
collab                 → core, types
server                 → core, types
formula                → core, types
core                   → types
types                  → （依存なし・葉）
```

### 4.2 禁止パターン（lint が ERROR にする）

| # | 禁止 | 判定方法（機械） | 理由 |
|---|---|---|---|
| R1 | consumer/`apps/*` が内部パッケージを直接 import | import 元が Facade allowlist 外 かつ import 先が `@nanairo-sheet/(types\|core\|collab\|server\|selection\|render\|ime\|formula)` → ERROR | S1-3（内部 import なしで統合） |
| R2 | Facade 同士の import（例: `server-hono` → `grid`、`react` → `element`） | import 元が Facade かつ import 先が別 Facade（`element`/`react` → `grid` は§4.1で例外許可）→ ERROR | Facade は独立した公開面 |
| R3 | 依存方向の逆流（例: `core` → `collab`、`types` → `core`、`render` → `grid`） | §4.1 の許可表に無い方向 → ERROR | 循環・逆流禁止 |
| R4 | package 境界を越える相対 import（`../` で隣接 package dir へ侵入） | 相対 path が自 package root を脱出 → ERROR。package 参照は必ず package 名で | 抽出時の暗黙結合を防ぐ |
| R5 | `apps/*` 間の相互 import（例: `playground` → `collaboration-server`） | import 先が別 `apps/*` package → ERROR | consumer 実証の独立性（§7） |
| R6 | 内部 core 系（types/core/collab/server/selection/formula）が DOM/Node API を参照 | `tsconfig.core.json`＋`typecheck:core`（`types:[]`）で型検査（ADR-0022 既設） | 環境非依存・cross-platform hash |
| R7 | Facade が内部パッケージの型/実装を素通し再エクスポート／内部型を公開シグネチャへ漏洩 | Facade `index` の内部 re-export を検出（**`export *` だけでなく `export { X } from '@nanairo-sheet/内部'`・`export type { X } from ...` も対象**）。加えて Facade 公開関数の**引数・戻り値の型が内部パッケージ由来**でないかを型情報（AST/tsc）で検査（Codex P2 反映） | 内部 API 漏洩・API 契約の固定 |

> R6 は既存 `typecheck:core`（ADR-0022）を流用。render/ime/grid/element/react/server-hono は DOM/Node 可のため R6 対象外。
> R2 の例外: `element`・`react` は `grid` のみ import 可（Stage 2 で有効化）。それ以外の Facade→Facade は禁止。
> R7 は単純な import path 正規表現では named export/型漏洩を取りこぼすため、**AST または型情報ベースの検査**を DD-011 で用いる（正規表現のみの実装は不可）。

### 4.3 lint 適用範囲・段階的導入（DD-011 実装時・Codex P1 反映）

- **対象**: `packages/*/src`・`apps/*/src`。テストファイル（`*.test.ts`）は test-support 経由の例外を明示。
- **移行期（rename 前）**: 現行 `sheet-*` 名でも同ルールを適用できるよう、論理名↔現行名のマップを lint 設定に持たせる（DD-011）。
- **段階的導入（重要）**: DD-011 時点では抽出（DD-012〜016）が未完で、現行 `apps/playground`・`apps/collaboration-server` は
  内部パッケージを多数直接 import している。R1（consumer→内部禁止）を **`apps/*` 全体へ即時 full-error 適用すると green を維持できない**。
  そのため DD-011 は次の段階適用を実装する:
  1. **consumer harness（独立 consumer プロジェクト）には R1 を full-error で先行適用**（S1-3 実証の本丸はここ）。
  2. **既存 `apps/playground`・`apps/collaboration-server` の現行違反は期限付き baseline（既知例外リスト）として許容**し、
     新規違反のみ ERROR にする（baseline は抽出DDが縮小し、DD-018 で baseline ゼロを確認）。
  3. R3（逆流）・R4（境界越え相対 import）・R5（apps 間）・R6（DOM/Node 混入）は**最初から全体 full-error**（新規結合を防ぐ）。
- **baseline の縮退責務**: 各抽出DD（DD-012〜016）は自分が抽出した資産を baseline から除去し、DD-018 が baseline 空を機械確認（S1-1）。

## 5. 公開面の最小方針（AC3・ロードマップ §7 整合）

- **Stage 1 Alpha で整備する Facade**: `@nanairo-sheet/grid`・`@nanairo-sheet/server-hono` の**2つのみ**（決定2）。
  これで「日本語連続入力→共同編集で永続化→独立 consumer から利用」の最小経路（§1.3 最初の Alpha 縦切りマイルストーン）を満たす。
- **Stage 1 で公開しない（後送り）Facade**: `@nanairo-sheet/element`・`@nanairo-sheet/react`。
  - 理由: 最初の consumer が未定（React か否か未確定）。React 薄ラッパーは「最初の consumer が React の場合のみ必須」（§7）。
  - **昇格条件**: 最初の consumer が React と確定したら `react` を Stage 1 へ前倒し（DD-016 で再判定）。それ以外は Stage 2。
- **consumer lifecycle 公開契約（`grid` Facade が最低限公開・§7）**: create/mount・destroy/disconnect・event unsubscribe・
  document/room 指定・connection state・error notification。これがないと別アプリで画面遷移・再mountで resource leak（DD-016 で確定）。
- **矛盾チェック**: 本方針は §7「全 Facade を同時に整える必要はない・最小経路へ絞る」と一致。§6 の対応環境（Tier 1）・
  Experimental `0.x` とも整合（詳細は ADR-0015）。

## 6. Tier 1 対象環境（CG-4・AC5）

> 詳細な判断根拠と compatibility matrix の枠・更新責務は **ADR-0015** を正本とする。本節は境界文書からの参照要約。

- **Tier 1（対応）**: Windows Chrome / Windows Edge（Chromium）。
- **対象外（明示）**: macOS（全ブラウザ）・Firefox・モバイル。§6 の信頼境界（trusted internal・public internet 非対象）を前提。
- **compatibility matrix の枠**（実測記入は DD-017/018）:

  | OS | ブラウザ | 判定 | 最終検証日 | 検証DD | 備考 |
  |---|---|---|---|---|---|
  | Windows | Chrome (Chromium) | Tier 1 | （DD-017 実測） | DD-012/017 | CG-1 実機IME・CG-4 |
  | Windows | Edge (Chromium) | Tier 1 | （DD-017 実測） | DD-012/017 | CG-1 実機IME・CG-4 |
  | macOS | 全ブラウザ | 対象外 | — | — | Stage 1 非対象 |
  | Windows/macOS | Firefox | 対象外 | — | — | Stage 1 非対象 |

  - **更新責務**: matrix の実測記入は DD-017（Alpha配布・診断DD）／合否は DD-018（移行判定DD）。
  - **更新タイミング**: Facade 公開前（CG-1 スモーク）・Alpha exit 前（CG-4/CG-6 実証）。

## 7. 参照

- ロードマップ `doc/plan/phase1-dd-roadmap.md` §0（CG）・§2.3（不変条件）・§4（DD一覧）・§6（製品境界）・§7（consumer 最小経路）
- PoC資産の抽出方針: `doc/DD/DD-009/poc-asset-ledger.md`
- CG 追跡: `doc/plan/cg-ledger.md`（CG-4 は本境界と ADR-0015）
- API 成熟度・Tier 1 判断: `doc/adr/0015-stage1-api-maturity-and-tier1-support.md`
- ゼロ依存原則（R6 の出所）: `doc/adr/0022-zero-runtime-dependency-core.md`
</content>
