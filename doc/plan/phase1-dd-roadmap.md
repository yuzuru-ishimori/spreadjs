# Stage 1 SDK Alpha DDロードマップ（Delivery Phase A・旧「Phase 1 DDロードマップ」）＝**正式版**

> **本ファイルは正式版**（2026-07-12・DD-007 条件付きGo判定＋ChatGPTレビュー〔要修正〕反映で草案から昇格）。採択記録＝`doc/DD/DD-007/phase1-backlog.md`。
>
> **用語（ChatGPTレビュー §3.3 の指摘）**: 「**計画書Phase**」（`nanairo_realtime_spreadsheet_development_plan_v1.md` §19 の Phase 1/2/3＝**何を作るかの技術コンテンツの区切り**）と、「**Delivery Phase A**」（＝本ロードマップ＝**Stage 1 社内SDK Alpha までのデリバリー単位**）は別軸。本文では常に修飾して書く。Stage 1 Alpha は計画書 §19 Phase 1 の中核＋Phase 2 の最小部分を Alpha 品質で含む（＝技術フェーズ Phase 1 の完了とは別）。
>
> **番号（レビュー §7.1-10）**: 候補DD番号（DD-009〜）と枝番（DD-011P 等）は**暫定**。DD-INDEX・生成スクリプトは数値IDを前提とするため、**正式採番は各DD起票時に連番で行う**（枝番を恒久化しない）。
>
> 正典との関係: 技術方式は計画書、製品目的・提供形態・成熟段階は製品憲章 `doc/product/nanairo_sheet_product_charter_v1.md`、DD作業管理の上位は `phase0-dd-roadmap.md`（3層構造を引き継ぐ）。DDの現在状態は `doc/DD/DD-INDEX.md` と各DDヘッダを正とする。

## 0. 位置づけ・前提

- **Phase 0（技術PoC）＝製品成熟 Stage 0**。DD-001〜007 で成立性を確認し、DD-007 で **条件付きGo** を判定（2026-07-12）。
- **Delivery Phase A ＝製品成熟 Stage 1「社内SDK Alpha」（憲章 §15・Goal 1）を到達目標**とする。単なる機能開発ではなく、**別の社内プロジェクトから npm パッケージとして利用可能な SDK** を作る段階（DD-007 `phase1-sdk-alpha-conditions.md` と整合）。
- **適用条件**: DD-007 が **Go または条件付きGo**（成立）。条件付きGoの解除条件 CG-1〜6 は下表のとおり本ロードマップのマイルストーン制約とする。

### Stage 1 社内SDK Alpha の移行条件（憲章 §15・§26.2）

| # | Stage 1 移行条件 | 担保先（DD） |
|---|---|---|
| S1-1 | PoCコードが `packages/*` へ抽出されている（**判定だけでなく実抽出**） | 基盤判断DD（資産台帳）＋各縦切りDDが採用資産を取り込む時に実抽出。DD-018で「Adopt/Harden対象が `apps/playground` 等に残っていないこと」を機械確認 |
| S1-2 | 利用者向け Facade パッケージがある | 基盤判断DD（境界）→ Facade/consumer統合DD |
| S1-3 | **1つの社内アプリが直接内部importなしで統合できる**（fixtureだけでは不合格・§7） | Facade/consumer統合DD＋各縦切りDDの完了条件 |
| S1-4 | Quick Start・型定義・最小サンプルがある | Facade/consumer統合DD＋Alpha配布・診断DD |
| S1-5 | API は `0.x` で変更可能だが変更履歴を残す | 基盤判断DD（成熟度方針＝Internal→Experimental・CHANGELOG運用） |
| S1-6 | **配布・運用成果物**（private registry配布・再現build/publish・alpha dist-tag・Tier 1 compatibility matrix・最小error code/debug hook・CHANGELOG） | Alpha配布・診断DD＋DD-018でゲート化。※複数チャネル運用・汎用診断基盤は Stage 2 |

### 条件付きGo 解除ゲート（CG-1〜6）＝本ロードマップのマイルストーン制約（ChatGPTレビュー §7.1-1 で正本化）

> CG は参考資料ではなく**本体のハードゲート**。未解除のCGを理由なく次DDへ繰り越さない。**未解除CGは「変更トリガー方式」の例外**＝該当コードを触っていなくても、抽出・Facade化・consumer統合・DOM親変更・bundling で挙動が変わりうるため、解除証拠が出るまでゲートを発火させる（§2.4）。

| CG | 主担当DD | 解除証拠 | 期限 | 未解除時 |
|---|---|---|---|---|
| CG-1 実機IME | 単一利用者IME DD＋**最終consumer統合後のTier 1実機スモーク** | 実機trace・確定Enter順序A/B・先頭欠落0（Win Chrome/Edge両方） | Facade公開前 | **Alpha不可** |
| CG-2 安定ID（index→RowId） | 安定ID・CellStore移行DD | RowId serialization・replay整合試験 | **共同編集永続化DD（旧DD-011P）より前** | **Alpha不可** |
| CG-3 snapshot正式形式 | 永続化・snapshot復元DD | versioned snapshot・snapshot+tail replay一致・100k で log全replay非依存・O(N²)回避測定 | reconnect DD前 | **Alpha不可** |
| CG-4 Tier 1環境 | 基盤判断＋全DD共通 | Tier 1 compatibility matrix | Phase開始時に確定・exitで実証 | 対象外環境を明示（境界化で可） |
| CG-5 reconnect境界（D27/D34） | reconnect/catch-up/idempotency DD | fault injection・再送・収束（障害種別ごと保証/非保証を分ける） | Alpha exit前 | **Alpha不可** |
| CG-6 精密メモリ | 単一利用者性能DD（統合性能・メモリゲート） | 精密メモリ計測（`performance.memory` 封鎖を回避） | Alpha exit前 | データ上限を明示 or Alpha不可 |

## 1. 基本方針: 縦切りDD ＋ 計画書フェーズ境界の整合

### 1.1 なぜ縦切りか

計画書Phase 0 は技術リスク別（IME・Canvas・共同編集…）に分けた。以降は技術モジュール別に分け続けると「各モジュールは完成しているがユーザー操作としてつながらない」状態に陥るため、**利用者が一連の操作を完了できる単位（縦切り）** でDDを分ける。各縦切りDDは Canvas・IME・共同編集・（必要なら）数式・Undo を縦に貫く。

### 1.2 計画書 §19 フェーズ境界との整合

計画書 §19 では Phase 1＝単一利用者コア・Phase 2＝共同編集Alpha/永続化。一方 Stage 1 Alpha の縦切りは両者にまたがる。整合のさせ方:

1. **計画書 §19 は「技術コンテンツの参照」として維持**（何を作るか）。フェーズ番号は開発計画の区切りで、Delivery Phase の区切りとは別軸。
2. **提供の区切りは縦切りDD**。各DDが計画書のどのPhaseのコンテンツをどれだけAlpha品質で取り込むかを §4「§19対応」列で明示。
3. **到達目標 Stage 1 Alpha ＝ §19 Phase 1 の中核（単一利用者の入力・描画・IME・選択・ローカルCommand）＋ Phase 2 の最小共同編集・最小永続化・reconnect** を Alpha 品質で含む。§19 Phase 1 の全項目を必須化するわけではない。**§23 Phase 1完了条件の「5万行の基本 scroll/selection」は単一利用者IME DD の統合性能回帰ゲートとして必須化**。Phase 2 の堅牢化（全障害復旧・大規模負荷・OCC全ケース）は Stage 1 では**必要最小限**（データ損失経路＝CG-5 は必須、それ以外は Stage 2）。

### 1.3 「最初のAlpha縦切りマイルストーン」（レビュー §3.4 で表現修正）

> 「1 DD」と「最初のマイルストーン」を混同しない。**最初のAlpha縦切りマイルストーンは、日本語でセルを連続入力し、確定値が共同編集で永続化され、独立consumerから利用できる状態**とする。これを複数DD（単一利用者IME → 共同編集同期 → 永続化 → reconnect → Facade/consumer統合）へ分割して達成する。§19 の Phase 1/Phase 2 技術境界は「単一利用者IME DD」と「共同編集同期DD」の境界としてDDレベルで保存する。

## 2. 密度レジーム

> 「Phase 1以降を一律に薄く」ではなく「**通常DDは薄く・不可逆/データ損失/外部契約に関わるDDだけ高密度へ戻す**」。密度は波形（Phase 0:高 → Delivery Phase A:中〈但し高リスクDDは高〉 → …）。出典: `doc/DD/DD-007/chatgpt-review-20260712-3.md`（密度相談）。

### 2.1 各DDに Risk Class を必須付与（DDヘッダ項目）

```text
Risk Class: A / B / C
Risk Triggers: （下記トリガーのどれに該当するか）
Human Spec Gate: required / skipped（承認済みバックログ範囲なら B/C は skipped）
Codex: xhigh / high / medium / none
Manual Gate: （実機/headed が必要な変更トリガーの有無）
External Review: （原則 Phase境界・API・ADR・Go のみ）
Evidence Level: full / standard / minimal
```

**A区分（高リスク＝高密度）条件**（いずれか該当）: IME状態機械/textarea/focus/selection を変更／sequencer/protocol/rollback-replay/OCC を変更／永続化/snapshot/migration を変更／データ消失やサイレント上書きの可能性／Stable な公開APIを変更・外部依存追加／受け入れ基準・操作仕様を変更・自動試験で判定不能な受け入れ条件。
**B区分（通常）**: 承認済みバックログ範囲内なら人間の事前仕様確認なしで開始してよい。DA＋Codex(high/medium 1回)。
**C区分（機械的・低リスク）**: 自動開始・まとめてレビュー。UI/CSS/メニュー/ラベル/サンプル更新など。

### 2.2 密度レバーごとの標準（Delivery Phase A）

| レバー | 標準 |
|---|---|
| L1 DD粒度 | 「一つの利用者成果＋一つの支配的リスク」。分割シグナル: Codex2回必要／人間設計ゲート2回以上／主要な状態所有者が複数変わる／1DDで公開APIと永続化方式を同時確定／ACの一部を独立検証・リリース可能。UI・ラベル・サンプルは束ねる |
| L2 レビュー層 | 通常DD=DA＋Codex。A区分=DA＋Codex＋対象別の実機/障害試験。外部レビューは Phase境界・API確定・ADR転換・Go/No-Go に限定 |
| L3 Codex effort/回数 | A区分=xhigh 1回だが**「Aラベル」だけで自動決定せず、状態機械・protocol・永続化アルゴリズムを実質変更した場合に限定**（レビュー §6.4）。通常=high/medium 1回。UI/doc/挙動保存=medium orまとめて。2回目は「差分の性質が変わったか」を条件 |
| L4 作り込み度 | 現在の Phase exit に必要な製品品質まで。将来Phase の抽象化（完全Plugin API・Formula Worker・全関数）を先回りしない |
| L5 証跡 | 通常DDは5点に圧縮（①スコープ・対象外・リスク区分 ②AC対応表 ③機械検証要約＋生ログ参照 ④finding対応・既知制約 ⑤ADR・公開API・互換性影響）。**A区分では圧縮＝「証拠を減らす」でなく「格納場所を集約する」意味**で運用し、fault matrix・seed/再現コマンド・event trace・実機環境・durability/ACK条件・既知の未保証境界 を省略しない（レビュー §6.3） |
| L6 ゲート頻度 | 人間ゲートを例外ベースへ。B/C は承認済みバックログ範囲なら自動開始。実機ゲートは変更トリガー方式。**ただし未解除CGは例外**（§0・§2.4） |
| L7 モデル使い分け | リスク・作業種別ルーティング。別モデルであること自体を品質証拠にしない（品質は不変条件・実行結果・障害注入・実機で担保） |

### 2.3 削ってはいけないガードレール（DD横断の常設スイート・基盤実装DDで設置）

- **IME不変条件**: composition中にtextarea.valueを書き換えない／selectionを破壊しない／textarea instanceとDOM親を置換しない／順序A・B両方／remote update・rollback/replay中もdraft不変／syntheticと実IMEを混同しない
- **共同編集不変条件**: サーバー全順序とクライアント最終hash一致／rollback/replay後の収束／beforeRevision不一致でサイレント上書きしない／reject時に利用者入力を保持／idempotency／reconnect・catch-up／RowId・ColumnIdの安定／snapshot＋logからの復旧
- **公開API不変条件**: Stable/Experimental/Internal 区分／API contract test／protocol・schema version／破壊的変更検出／移行ガイド要否判定
- **性能回帰予算**: 通常DDは軽量スモーク。初期ロード経路／Document State表現／Axis再構築条件／Canvas描画キャッシュ／operation replay方式／Formula依存グラフ／大量paste・sort・filter・行移動 を変えたDDだけフル再計測を発動

### 2.4 密度の精緻化（ChatGPTレビュー §6 反映）

- **A/B/C再配分**（実質全DD=Aを避ける・危険なDDは分割で対処）: アーキ判断=A／承認済み判断に沿う package skeleton・lint=B／docs・sample・release設定=B or C／IME・protocol・永続化・reconnect=A／Presence overlay=B。
- **未解除CGは変更トリガーの例外**: コード変更がなくても manual/measurement gate を必須にする（§0）。特に CG-1 は「IMEコードを触っていないので実機省略」不可。
- **B/C→A 昇格ルール**: B/Cで開始後、受け入れ基準変更／データ形式・protocol変更／永続化境界へ波及／利用者入力を失う可能性／Internal予定APIをconsumerへ公開／1DDで複数の状態所有者を変更 が判明したら停止してAへ昇格。
- **密度計測を標準に**（専用DD不要）: 各DDで 人間確認時間・Codex effort/回数・ゲート待ち・review finding数・merge後手戻り・DD開始〜完了・実行したmanual gate を記録。最初は A/B/C が混ざる5件で評価し密度を再調整。

## 3. 基盤DD群（旧DD-009 を3分割・ChatGPTレビュー §4.1）

> 設計判断と機械的な基盤整備を別レビューサイクルへ。**すべて Delivery Phase A の前提**（縦切りの前に確定）。

- **基盤判断DD（Risk Class A・External Review対象）**: PoC資産台帳（DD-002〜006 を Adopt/Harden/Rewrite/Discard＋`採用方針/抽出先package/担当DD/完了条件`）・package責務境界（内部 `@nanairo-sheet/{core,selection,…}` と Facade `grid/element/react/server-hono`）・公開面の最小方針・**CG解除台帳**・Tier 1 対象確定・公開API成熟度方針（Internal→Experimental・0.x CHANGELOG）。
- **基盤実装DD（Risk Class B）**: package skeleton・**package boundary lint**（`apps/*` 間・内部相対import恒久禁止）・contract test骨格・**常設不変条件スイート runner**（§2.3）・**independent consumer harness**（§7）・Phase 1用DD差分テンプレ改修（Risk Class ヘッダ＋製品化6観点。実ファイル改修可否は DD-007 要確認3＝別DD管理系との整合に従う）。
- **安定ID・CellStore移行DD（Risk Class A・CG-2）**: chunk-store の **index→RowId キー**移行・serialization・replay整合。**共同編集永続化DDより前**（snapshot形式・共同編集 InsertRows/DeleteRows の前提）。

## 4. 縦切りDD一覧（Stage 1 SDK Alpha）

> 「最初のマイルストーン＋候補リスト」まで（全順序は進行中に見直す）。番号は暫定・正式採番は起票時。**Stage 1 = 必須／Alpha後拡張／Stage 2** を明示（ChatGPTレビュー §5 全面採用）。

| 縦切り（利用者成果） | 支配的リスク | Risk Class | §19対応 | Stage 1区分 | CG |
|---|---|---|---|---|---|
| **基盤判断DD**（資産台帳・境界・API方針・CG台帳・Tier 1） | 公開API境界・アーキ責務 | A | 前提 | **必須** | CG-4 |
| **安定ID・CellStore移行DD**（index→RowId・serialization・replay整合） | データ表現の安定ID | A | §19 P1/P2 前提 | **必須** | **CG-2** |
| **基盤実装DD**（skeleton・boundary lint・不変条件スイート・consumer harness・テンプレ） | 基盤整備（機械的） | B | 前提 | **必須** | — |
| **単一利用者IME縦切りDD**（日本語連続入力・文字列/数値/日付・selection/navigation・ローカルOperation・**5万行 scroll/selection 統合性能回帰ゲート**） | IME状態機械・focus/selection | A | §19 Phase 1 | **必須** | **CG-1・CG-6** |
| **共同編集同期・OCC DD**（サーバー受理・全順序・cell-level OCC・他クライアント反映） | sequencer/protocol・サイレント上書き | A | §19 Phase 2（最小） | **必須** | — |
| **永続化・snapshot復元DD**（durable ACK・versioned snapshot＋log・再読込復元） | 永続化・データ損失 | A | §19 Phase 2（最小） | **必須** | **CG-3** |
| **reconnect/catch-up/idempotency DD**（pending queue・再送・fault injection＝DD-005既知制約回収） | reconnect/データ損失 | A | §19 Phase 2 | **必須** | **CG-5** |
| **Facade/実consumer統合DD**（主要Facade export・mount/destroy・Command/Event/Options・型定義・**独立consumerからpack済み成果物を利用**・Experimental APIレビュー） | 公開API固定・DX | A | 公開面 | **必須** | — |
| **Alpha配布・診断DD**（private registry publish・dist-tag・CHANGELOG・Quick Start・compatibility matrix・error code/debug logging・release automation） | 配布・運用 | B | 公開面 | **必須（S1-6）** | — |
| **Stage 1移行判定DD**（S1-1〜S1-6＋CG-1〜6＋既知制約の**合否判定のみ**・Stage 2バックログ） | マイルストーン判定 | A | §23 Phase境界 | **必須** | 全CG |
| Presence DD（activeCell/selection/editingCell・overlay・TTL） | Presence（状態複製・TTL） | B | §19 P2（最小） | **Alpha後拡張** | — |
| Clipboard DD（範囲選択・parser・型変換・原子SetCells・OCC・Undo） | Clipboard原子性・競合 | A | §19 P2/3 | **Alpha後拡張/Stage 2先頭** | — |
| 行操作DD（RowId・Insert/Delete・tombstone・Canvas座標・共同編集収束・reconnect後収束。**数式参照維持は数式導入後**） | 行操作×共同編集×参照 | A | §19 P2 | **Stage 2（3分割）** | — |
| 数式DD（四則・参照・SUM・固定ID参照・依存グラフ・replay決定性） | 数式評価・replay決定性 | A | §19 P2 | **Stage 2** | — |

**主要DDの契約（レビュー §4.3/4.4/7.1-4 反映）**:
- **共同編集同期DD 完了条件**: 2実ブラウザーconsumerで相互反映／randomized test 3クライアント以上／server order と client hash 一致／duplicate operation の二重適用なし／beforeRevision不一致でサイレント上書きなし／reject後も編集中draft保持／IME composition中のremote updateでdraft不変。
- **永続化・snapshot復元DD 完了条件（CG-3）**: **durable ACK の定義**（ACKを返す時点・operation log書込みとACKの順序）・versioned snapshot format・snapshot＋tail log からの復元一致・100k相当で log全replay非依存・O(N²)回避測定・**corrupt/unsupported version時の fail-fast**・snapshot は正本か最適化物かの定義・サーバー再起動時の復旧手順。「保存」を「同期」と混同しない（同期＝共同編集同期DD／durable＝本DD）。

## 5. 順序・依存とAlpha必須ライン（ChatGPTレビュー §8 反映）

**Alpha必須ライン（確定・reconnect必須／Presence等は外す）**:

```text
基盤判断DD（CG-4）
  → 安定ID・CellStore移行DD（CG-2）
  → 基盤実装DD（skeleton/lint/invariant suite/consumer harness）
  → 単一利用者IME縦切りDD（CG-1・CG-6）
  → 共同編集同期・OCC DD
  → 永続化・snapshot復元DD（CG-3）
  → reconnect/catch-up/idempotency DD（CG-5）   ← Alpha必須（データ損失経路を塞ぐ）
  → Facade/実consumer統合DD
  → Alpha配布・診断DD（S1-6）
  → Stage 1移行判定DD（事前条件の合否判定のみ）
```

並行 or Alpha後: 共同編集同期DD → **Presence DD**／**Clipboard DD**（Alpha後拡張）。Stage 1完了後: **行操作DD**・**数式DD**（Stage 2）。

- **DD-018（移行判定）はスコープ決定の場ではなく、事前に決めた条件を証拠で判定する場**（レビュー §4.11）。Alpha必須範囲を判定DDで初めて決めない。
- 共同編集同期DD・永続化DD・reconnect DD は計画書 Phase 2 相当で**すべて Risk Class A**。fault injection・randomized/property test・復旧試験を必須にし、データ整合の生ログと障害マトリクスは軽量証跡でも削らない（§2.3/§2.4）。

## 6. Alpha 製品境界（ChatGPTレビュー §9・§7.1-8 で新設・明示）

> 「組み込めるが入力を失う」最悪のAlphaを避けるため、保証範囲を明示する。

- **対応環境**: Tier 1（Windows Chrome/Edge）のみ（CG-4）。macOS・Firefox は対象外。
- **信頼境界**: trusted internal environment 限定／tenant isolation 非保証／caller が identity を与える／untrusted input・public internet 公開は対象外／persistence は本番バックアップを意味しない。本番認証認可・HA・バックアップ運用・24時間接続は Stage 1 対象外。
- **reconnect で保証する**: タブ生存中の一時切断／未ACK operation のメモリ保持／再接続後の再送／idempotency／catch-up／server再起動後の snapshot＋log 復旧／pending・rejected 状態の可視化またはイベント通知。
- **reconnect で保証しない**: ACK前のブラウザークラッシュ／OSクラッシュ／ローカル永続キュー／長時間offline編集／複数端末offline merge。
- **API**: Experimental `0.x`（変更履歴・version検出・破壊的変更の明示。長期後方互換は非保証）。
- **version mismatch**: 古い snapshot/protocol を誤読しない。自動migrationを実装しなくても **version不一致を検出して fail-fast**。
- **範囲外/拡張扱い**: 行操作・数式・Clipboard・Presence は Alpha 必須範囲外。

## 7. consumer 実証要件・lifecycle 契約（ChatGPTレビュー §2.2/§7.1-6/7 で新設）

- **S1-3 実証はfixtureだけで済ませない**: 実在する社内アプリへ private registry 経由で組み込む、または（実アプリ未定なら）**別workspaceでなく独立consumerプロジェクトへ pack済み成果物 or private registry からインストール**。次は**不合格**: monorepo workspace link のみ／source path 直接参照／`@nanairo-sheet/*` の Internal package 直接import／unpublished assets・開発サーバーの暗黙設定に依存。
- **consumer lifecycle 公開契約（最低限）**: create/mount・destroy/disconnect・event unsubscribe・document/room 指定・connection state・error notification。これがないと別アプリで画面遷移・再mountで resource leak を起こす。
- **React 薄ラッパー**は最初のconsumerがReactの場合だけ必須。そうでなければ Stage 2。Stage 1 で `grid`/`element`/`react`/`server-hono` の全Facadeを同時に整える必要はない（最初のconsumerに必要な最小経路へ絞る）。

## 8. 既知制約の回収計画（DD-005 引き継ぎ）

各制約に影響・**放置期限**・解消予定・未解消時の製品制約を付ける。放置期限を過ぎた制約は担当DDの起票者が **Stage 1移行判定DD で解消済/延期/製品境界化 を判定**する。

| 既知制約（DD-005） | 影響 | 放置期限 | 解消予定 | 未解消時の製品制約 |
|---|---|---|---|---|
| client→server 欠落時の完全再整列（D27/D34） | データ損失リスク | **Alpha exit前（CG-5）** | **reconnect DD** | **Alpha必須ゆえ未解消はAlpha不可** |
| 行挿入後のローカル選択・Enter移動先の再ベース | 操作の一貫性 | Stage 2 開始前 | 行操作DD | 行操作は Alpha 範囲外表示 |
| snapshotベース初期化 | 大規模文書の初期ロード | Alpha exit前 | 永続化DD/reconnect DD | 初期ロードが log全replay依存 |
| 実IME変換中に対象行が削除された場合の挙動 | IME×行削除の競合 | Stage 2 開始前 | 行操作DD | 該当操作を Alpha で非推奨 |
| 新 integration-editor アダプタ×実IME候補ウィンドウ・順序A/B の実機記録 | IME正しさの実機担保（CG-1） | 単一利用者IME DD 実機ゲート＋最終consumer統合後スモーク | 単一利用者IME DD | **CG-1 未解除はAlpha不可** |

## 9. 未確定事項・要確認

1. ~~Alpha 最小到達ライン~~ → **確定（2026-07-12・ユーザー）: reconnect を Alpha 必須。Presence/Clipboard/行操作/数式は Alpha 必須から除外**（Presence/Clipboardは Alpha後拡張・行操作/数式は Stage 2）。
2. ~~DD-016/017 の帰属~~ → **確定: 行操作・数式は Stage 2**。
3. **公開API成熟度の刻み**: Delivery Phase A 後半で Experimental 公開する範囲（早すぎる固定を避けつつ consumer が使える最小契約）。基盤判断DDで方針、Facade統合DDで確定。
4. **密度計測の運用**: §2.4 のとおり各DDで記録（専用DD不要）。最初の A/B/C混在5DDで再調整。
5. **見積の目安**: 計画書 **§25.4「単独開発＝社内MVP 18〜30か月」**を基準（単独＋AIエージェント）。Stage 1 Alpha は §19 Phase 1（8〜10週）＋Phase 2 の最小部分に相当。**固定週数は置かず、密度計測で実測後に確定**。

## 10. レビュー反映ログ

### Codexレビュー第1回（2026-07-12・effort=high）

依頼書・結果: `doc/DD/DD-007/phase1-roadmap-review-20260712/codex-review-request.md`・`codex-review-result.md`。9指摘（P1×5・P2×4）全件を反映または明示的に論点化（S1-6 新設・S1-1実抽出・§19境界明記・データ損失二択・DD-011分割・DD-014依存/Risk Class・既知制約放置期限・見積§25.4）。

### ChatGPTレビュー（2026-07-12・判定=要修正）

依頼書・結果: `doc/DD/DD-007/phase1-roadmap-review-20260712/`（`01_プロンプト.md`・`chatgpt_review_result.md`）。方向転換不要だが昇格前に修正必須の5系統。**ユーザー判断（2026-07-12）= Alpha必須ラインはレビュー案を全面採用**。反映（草案→正式版へ昇格）:

| ChatGPT指摘 | 対応 |
|---|---|
| 条件付きGo(CG-1〜6)が参考資料止まり→AI が通常制約扱いしAlpha誤通過 | **CG-1〜6ハードゲート表を §0 本体へ昇格** |
| Alpha必須ラインが遅い・reconnect必須/Presence優先順位逆 | **全面採用**: reconnectをAlpha必須・Presence/Clipboard/行操作/数式を除外（§4・§5） |
| DD-009/012/016 過積載（DD-005再発） | DD-009→3分割（§3）・DD-012→2分割（§4）・DD-016→Stage 2＋3分割（§4） |
| S1-3をfixtureだけで満たすのは不可 | private registry/pack経由の独立consumer実証を必須（§7） |
| 「保存」の意味・durability境界が曖昧 | DD-011を「サーバー受理・同期」へ改称・永続化DDで durable ACK/versioned snapshot 定義（§4） |
| CG-2をDD-016(任意)へ・CG-6に担当DDなし | CG-2を安定ID移行DD（永続化前）・CG-6を単一利用者性能DDへ（§0・§4） |
| 密度が実質全DD=A | A/B/C再配分・未解除CG例外・A区分証跡要件・Codex xhigh限定・B→A昇格・密度計測標準化（§2.4） |
| 製品境界（Tier1/信頼境界/version mismatch/consumer lifecycle）未明記 | §6 Alpha製品境界・§7 consumer実証＋lifecycle契約を新設 |
| DD-018で初めてAlpha範囲を決めるな | DD-018は事前条件の合否判定のみ（§4・§5） |
| 枝番は数値ID前提スクリプトで壊れやすい | 候補番号は暫定・正式採番時に連番化（ヘッダ） |

---

> 次アクション: 本正式版に沿って Stage 1 の最初の基盤DD（基盤判断DD）から起票する。各DDは Risk Class ヘッダ・CG解除ゲート・§6 製品境界・§7 consumer契約を満たす。
