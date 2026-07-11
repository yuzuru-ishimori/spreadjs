# spreadjs — 業務入力向けリアルタイム共同編集スプレッドシート

業務Webアプリへ組み込むための、**TypeScript製リアルタイム共同編集スプレッドシート型入力基盤**です。
Excel完全互換ではなく、日本語での高速な連続入力・範囲編集・数万行の表示・安全な共同編集を優先します。外部スプレッドシート製品へ中核依存せず、長期的に自社で保守できる構造を目指します。

> **ステータス: Phase 0 進行中（開発基盤を構築済み）**
> 開発基盤（monorepo）は構築済みで、ルートで `npm install` 後に `npm run dev`（playground）/ `test` / `typecheck` / `lint` が動きます。製品機能の全面実装の前に、IME・Canvas・共同編集・データ表現の4点をPoCで検証し、Go／No-Goを判定します。

---

## この製品が同時に成立させる5つの要件

1. Excelに近いセル選択・キーボード操作
2. 日本語IMEを壊さない常駐エディター
3. Canvas 2Dによる数万行描画
4. サーバー主導のリアルタイム共同編集
5. 固定ID・操作ログ・数式参照・Undoを統合する一貫した状態モデル

## 基本方針

- グリッドコアは **TypeScriptのみ**で実装し、React・Hono・DOM描画方式から分離する。
- 描画は **Canvas 2D**、入力はグリッド全体で **1個の常駐 `textarea`** を使用する。
- Reactは業務アプリ外周、HonoはHTTP API・WebSocket・認証・永続化を担当する。
- 共同編集はCRDTではなく、**オンライン前提のサーバー主導型シーケンサー**を採用する。
- 行・列は **固定ID**で管理し、画面上の番号は順序配列から算出する。
- 利用者操作は **Command**、同期可能な状態遷移は **Operation**、カーソル情報は **Presence** として分離する。
- セル値競合は「Presenceによるソフトロック＋セル単位の楽観的競合検知（OCC）」を第一候補とし、入力内容を黙って上書きしない。
- コアパッケージは原則ゼロ依存とし、Hono・`@hono/node-server`・`ws`・Reactはアダプター層に閉じ込める。

## 非目標（対象外）

Excelインポート／エクスポート、ピボットテーブル、印刷、ズーム、Excel完全互換、VBA／マクロ、長時間オフライン編集、文字単位の共同編集、初期段階のモバイル・タッチ編集、Excelの全関数・財務関数・配列数式など。

---

## アーキテクチャ概要

```text
┌──────────────────── Browser ────────────────────┐
│ React Application（業務UI / アダプター）         │
│  └─ Grid Runtime（Document Model / Command /     │
│      Selection / Undo / Formula Coordinator）    │
│      ├─ Canvas Renderer                          │
│      ├─ Persistent Textarea / IME Controller     │
│      └─ Collaboration Client                     │
└──────────┬──────────────────────┬────────────────┘
           │ HTTP                 │ WebSocket
┌──────────▼──────────────────────▼────────────────┐
│ Hono Application Server                          │
│  認証 / Snapshot・Operation API / WS Session /   │
│  Room Coordinator / Sequencer / Presence Hub     │
└──────────┬──────────────────────┬────────────────┘
      ┌────▼─────┐          ┌──────▼───────┐
      │PostgreSQL│          │Object Storage│ (optional)
      └──────────┘          └──────────────┘
```

- **文書Operation** はサーバーが単調増加する `revision` を付与し、全クライアントが同一順序で適用する。
- クライアントは応答性のため **楽観的にローカル適用**し、サーバーOperation受信時に rollback → 適用 → replay する。
- **数式** は入力値と式を正とし、計算結果はキャッシュ扱い。参照は固定Row/Column IDへバインドする。
- **Presence** は非永続。IME変換中の文字列はDocument StateにもPresenceにもPresence共有にも入れない。

詳細は [開発計画・基本設計書](doc/plan/nanairo_realtime_spreadsheet_development_plan_v1.md) を参照してください（ADR一覧・データモデル・プロトコル・IME仕様・性能目標を含む）。

## 想定モジュール構成（monorepo）

コアは原則ランタイム依存ゼロ。フレームワーク依存はアダプター層に隔離します。以下は**目標構成**で、現状は `packages/sheet-types` と `apps/playground` のみ実在します（DD-001 で骨格を構築）。残りは各 PoC / Phase で追加します。

```text
packages/
  sheet-types/               ブランド型・共通イベント・公開型
  sheet-core/                文書モデル・Axis・CellStore・Command・Operation
  sheet-selection/           選択・移動・範囲演算
  sheet-formula/             parser・AST・依存グラフ・計算（client/server共有）
  sheet-renderer-canvas/     Canvas描画・座標・ヒットテスト
  sheet-editor-ime/          常駐textarea・IME・clipboard・keyboard
  sheet-collaboration/       client queue・protocol・presence・reconnect
  sheet-element/             Custom Element
  sheet-react/               React wrapper（Reactはpeer dependency）
  sheet-server-core/         sequencer・validator・room・snapshot
  sheet-server-hono/         Hono HTTP／WebSocket adapter
  sheet-testkit/             fixture・operation fuzzer・event recorder
```

依存規則の要点: `sheet-core` は Canvas/DOM/React/Hono を import しない。`sheet-formula` は UI を import しない。サーバーとクライアントは同じOperation型と適用関数を共有する。

## 技術スタック

| 領域 | 採用（確定・第一候補） |
|------|------|
| 言語 | TypeScript（strict） |
| グリッドコア | 依存ゼロの独自実装（Canvas 2D 描画） |
| 業務UI外周 | React |
| API/ WebSocketサーバー | Hono + `@hono/node-server` + `ws`（Node.js） |
| 永続化 | PostgreSQL（第一候補） |
| 大容量スナップショット | Object Storage（optional） |

---

## 開発ロードマップ

| Phase | 内容 | 目安 |
|------|------|------|
| **Phase 0** | 技術成立性のPoC（IME/Canvas/共同編集/データ表現）とADR確定 | 6〜8週 |
| Phase 1 | 単一利用者コア・Canvas描画・IME基盤 | 8〜10週 |
| Phase 2 | 共同編集Alpha・永続化（WebSocket/sequencer/snapshot） | 8〜10週 |
| **Phase 3** | 業務利用MVP（copy/paste・Undo/Redo・書式・数式・競合UI） | 8〜10週 |
| Phase 4 | Excelライク操作拡張（複数範囲・fill・sort/filter 等） | 8〜12週 |
| Phase 5 | 表示・シート・数式拡張（結合・複数シート・IF/丸め・Worker） | 8〜12週 |
| Phase 6 | 品質・運用強化（回帰マトリクス・負荷/障害試験・セキュリティ） | 6〜10週 |

- **Phase 3 終了を社内業務MVPの基準**とする。
- 概算工数: MVP（Phase 0〜3）で **24〜36人月**、現行スコープ全体で **40〜62人月**。

### Phase 0 のGo判定基準

1. 日本語IMEが実環境で自然に連続入力でき、先頭文字欠落・確定Enter誤移動がない。
2. 50,000行で描画・メモリが実用速度で成立する。
3. Operation列が切断・競合後も収束する（全クライアントhash一致）。
4. 入力内容を無言で失わない。

---

## ドキュメント

| ドキュメント | 内容 |
|------|------|
| [doc/plan/…_development_plan_v1.md](doc/plan/nanairo_realtime_spreadsheet_development_plan_v1.md) | 開発計画・基本設計（正典。アーキテクチャ・ADR・プロトコル・IME・数式・性能・リスク） |
| [doc/plan/…_concept_record_v1.md](doc/plan/nanairo_realtime_spreadsheet_concept_record_v1.md) | 構想記録（計画書の入力資料） |
| [doc/DOC-MAP.md](doc/DOC-MAP.md) | doc/ 内の全ドキュメントの場所と目的 |
| [AGENTS.md](AGENTS.md) | 開発フロー・コマンド・規約（AIエージェント／開発者共通の正本） |

## 開発の進め方

本プロジェクトは **DD（設計文書）駆動** で進めます。いきなりコードを書かず、次のフローに従います。

```
DD作成 → 仕様確認 → 実装 → 検証 → 完了
```

DDスキル・コーディング規約・ドキュメント更新義務など運用ルールの詳細は [AGENTS.md](AGENTS.md) を参照してください。
