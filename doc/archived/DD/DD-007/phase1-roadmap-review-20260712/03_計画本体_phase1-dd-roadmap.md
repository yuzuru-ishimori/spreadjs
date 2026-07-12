# Phase 1 DDロードマップ（Stage 1 社内SDK Alpha までの縦切り計画）＝**草案**

> **本ファイルは草案（レビュー前）である。** Phase 0 の Go 判定（DD-007）が確定していない段階で、DD-007 Phase 3（`phase1-backlog.md` 確定）に先行して Phase 1 の到達目標・DD分割・順序・密度方針を組み立てた設計案。ChatGPT／Codex のレビューを受けてから、Go 判定後に正式な Phase 1 バックログへ昇格する。
>
> 正典との関係: 技術方式は計画書 `doc/plan/nanairo_realtime_spreadsheet_development_plan_v1.md`、製品目的・提供形態・成熟段階は製品憲章 `doc/product/nanairo_sheet_product_charter_v1.md`、DD作業管理の下位ロードマップは本ファイル。上位は Phase 0 と同様に `phase0-dd-roadmap.md` の3層構造を引き継ぐ。DDの現在状態は `doc/DD/DD-INDEX.md` と各DDヘッダを正とする。
>
> 番号付与の注意: 下表の **候補DD番号（DD-009〜）は暫定**。Phase 1 は「最初のDD＋候補リスト」までを確定し、全順序は進行中に見直す（DD-007 要確認2 の回答）。正式採番は各DD起票時に行う。

## 0. このロードマップの位置づけと前提

- **Phase 0（技術PoC）= 製品成熟 Stage 0**。DD-001〜007 で IME／Canvas／共同編集／データ・数式の成立性を確認し、Go/No-Go を DD-007 で判定する。
- **Phase 1 = 製品成熟 Stage 1「社内SDK Alpha」（憲章 §15・Goal 1）を到達目標とする**。すなわち Phase 1 は単なる機能開発ではなく、**別の社内プロジェクトから npm パッケージとして利用可能な SDK を作る段階**である（DD-007 `phase1-sdk-alpha-conditions.md` と整合）。
- **本ロードマップの適用条件**: DD-007 が **Go または条件付きGo** であること。No-Go の場合、本ロードマップは破棄し再設計DDへ切り替える。条件付きGoの場合、確定した条件（ブラウザー限定・データ密度/列数制約等）を下表の対象範囲・SLO・受け入れ基準へ反映する。

### 到達目標: Stage 1 社内SDK Alpha の移行条件（憲章 §15）

Phase 1 完了＝下記すべてを満たすこと。各縦切りDDはこの移行条件のいずれかを前進させる。

| # | Stage 1 移行条件（憲章 §15・§26.2） | Phase 1 での担保先（候補DD） |
|---|---|---|
| S1-1 | PoCコードが `packages/*` へ抽出されている | DD-009（Adopt/Harden 判定＋境界確定）＋**採用資産の実抽出・ビルド・検証**（DD-009 および各縦切りDDで採用資産を取り込む時に実施。判定だけでは §15 を満たさない） |
| S1-2 | 利用者向け Facade パッケージがある | DD-009（境界確定）→ DD-012（Facade 公開export・型定義） |
| S1-3 | 1つの社内アプリが直接内部importなしで統合できる | DD-012（consumer fixture）＋各縦切りDDの完了条件 |
| S1-4 | Quick Start・型定義・最小サンプルがある | DD-012（Quick Start／サンプル）＋以降のDDで更新 |
| S1-5 | API は `0.x` で変更可能だが変更履歴を残す | DD-009（公開API成熟度方針＝Internal→Experimental・CHANGELOG運用） |
| S1-6 | **配布・運用成果物（憲章 §26.2「社内Alphaまで」）**: private registry配布・release automation・canary/betaチャネル・compatibility matrix・error code/debug mode | DD-012（配布・release automation・error code/debug mode）＋DD-018（移行判定で S1-6 の充足をゲート化） |

> Stage 1 Alpha は「本番完成」ではない。API は `0.x`（Experimental中心）で、Stable 化は Stage 3 pilot 後（憲章 §12.4・第3回レビュー §5.5）。**Phase 1 で全APIを Stable に固定しない**。
>
> **§26.2 の配布・運用成果物（S1-6）を担当DDへ割り付ける**（Codexレビュー指摘・高）。これがないと「別プロジェクトへ継続配布・診断できないのに Stage 1 到達」と誤判定しうる。DD-018 の移行判定ゲートに S1-6 を含める。

## 1. 基本方針: 縦切りDD ＋ 計画書フェーズ境界の整合

### 1.1 なぜ縦切りか（Phase 0 との違い）

Phase 0 は技術リスク別（IME・Canvas・共同編集…）に分けた。Phase 1 以降は技術モジュール別に分け続けると「各モジュールは完成しているがユーザー操作としてつながらない」状態に陥るため、**利用者が一連の操作を完了できる単位（縦切り）** でDDを分ける（`phase0-dd-roadmap.md`「Phase 1以降」）。各縦切りDDは Canvas・IME・共同編集・（必要なら）数式・Undo を縦に貫く。

### 1.2 計画書 §19 フェーズ境界との整合（第3回レビュー §1.4・§5.1 の指摘への回答）

第3回外部レビューが指摘したとおり、**ロードマップの「最初の縦切り」（日本語入力→共同編集保存→Undo）は、計画書 §19 では Phase 1（単一利用者コア）と Phase 2（共同編集Alpha・永続化）にまたがる**。この不整合を残したまま進めると「本来 Phase 2 のリスクを Phase 1 の軽量プロセスで扱う」危険がある。本ロードマップは次のとおり明示的に整合させる:

1. **計画書 §19 は「技術コンテンツの参照」として維持**する（何を作るかの正典）。フェーズ番号（§19 Phase 1/2/3）は**開発計画の区切り**であり、本ロードマップの縦切りDDの区切りとは別軸である。
2. **提供の区切りは縦切りDD**で行い、各DDが計画書のどのPhaseのコンテンツをどれだけAlpha品質で取り込むかを下表の「§19対応」列で明示する。
3. **到達目標は Stage 1 SDK Alpha**（憲章 §15）であり、これは計画書 **§19 Phase 1 の中核（単一利用者の入力・描画・IME・選択・ローカルCommand）＋ Phase 2 の最小共同編集・最小永続化**を Alpha 品質で含む。**§19 Phase 1 の全項目を必須化するわけではない**（＝「Phase 1 の一部」であり技術フェーズ Phase 1 の完了とは区別する。Codexレビュー指摘・高）。具体的には: 基本Clipboard は DD-014・数式parser骨格は DD-017 として**後半/任意**に置く。ただし **§23 Phase 1 完了条件の「5万行の基本 scroll・selection」は DD-010 の受け入れ基準として必須化**する（DD-004 の Canvas 成果を単一利用者フローで再確認）。Phase 2 の**堅牢化（全障害復旧・大規模負荷・OCC全ケース）は Stage 1 では最小限**にとどめ、残りは Stage 2 へ送る（§6「既知制約の回収計画」で明示）。
4. **確定済みの「最初の縦切り」は、単一利用者コア（DD-010）と 共同編集保存（DD-011）に分割**する。これにより「一つのDD＝一つの利用者成果＋一つの支配的リスク」（第3回レビュー L1）を満たしつつ、縦切りの目標（保存まで通る）は DD-010〜012 の連結で達成する。**§19 の Phase 1/Phase 2 の技術境界は DD-010（単一利用者・保存なし）と DD-011（共同編集保存）の境界としてDDレベルで保存される**。

> **確定事項（`phase0-dd-roadmap.md`・2026-07-12 ユーザー確定）**: 「最初のDDは『日本語でセルを連続入力し、確定値が共同編集で保存される』を製品パッケージとして完成させる」。本ロードマップはこの縦切り目標を DD-010〜012 の連結で実現し、単体DDへの過積載（DD-005化）を避ける。

## 2. 密度レジーム（第3回外部レビューの推奨を織り込み）

> 出典: `doc/DD/DD-007/chatgpt-review-20260712-3.md`（密度相談の結論）。**「Phase 1以降を一律に薄くする」のではなく、「通常DDは薄く・不可逆／データ損失／外部契約に関わるDDだけ高密度へ戻す」**を Phase 1 のプロセス標準とする。密度は Phase 進行で単調に下げるのではなく波形（Phase 0:高 → Phase 1:中 → Phase 2:高 → …）にする。

### 2.1 各DDに Risk Class を必須付与（DDヘッダ項目）

各縦切りDDのヘッダに次を必須とする（第3回レビュー §4.2）。密度が担当モデルの気分で変わることを防ぐ。

```text
Risk Class: A / B / C
Risk Triggers: （下記トリガーのどれに該当するか）
Human Spec Gate: required / skipped（承認済みバックログ範囲なら B/C は skipped）
Codex: xhigh / high / medium / none
Manual Gate: （実機/headed が必要な変更トリガーの有無）
External Review: （原則 Phase境界・API・ADR・Go のみ）
Evidence Level: full / standard / minimal
```

**A区分（高リスク＝高密度を維持）にする条件**（いずれか該当で A）:
- IME状態機械・textarea・focus・selection を変更する
- sequencer・protocol・rollback/replay・OCC を変更する
- 永続化・snapshot・migration を変更する
- データ消失やサイレント上書きの可能性がある
- Stable な公開APIを変更する／外部依存を追加する
- 受け入れ基準・操作仕様を変更する／自動試験で判定不能な受け入れ条件がある

**B区分（通常）**: 承認済みバックログ範囲内なら人間の事前仕様確認なしで開始してよい。DA＋Codex(high/medium 1回)。
**C区分（機械的・低リスク）**: 自動開始。複数DDをまとめてレビュー・確認。UI/CSS/メニュー/ラベル/サンプル更新など。

### 2.2 密度レバーごとの Phase 1 標準（第3回レビュー §2 を写像）

| レバー | Phase 1 標準 |
|---|---|
| L1 DD粒度 | 「一つの利用者成果＋一つの支配的リスク」。分割シグナル: 差分にCodex2回必要／人間設計ゲート2回以上／主要な状態所有者が複数変わる／1DDで公開APIと永続化方式を同時確定／ACの一部を独立検証・リリース可能。逆にUI・ラベル・サンプルは束ねる |
| L2 レビュー層 | 通常DD=DA＋Codex。A区分=DA＋Codex＋対象別の実機/障害試験。**外部レビューは Phase境界・API確定・ADR転換・Go/No-Go に限定** |
| L3 Codex effort/回数 | A区分(IME/protocol/rollback/永続化/公開API/migration)=xhigh 1回。通常=high/medium 1回。UI/doc/挙動保存リファクタ=medium またはまとめて。**2回目は「差分の性質が変わったか」を条件**（抽出と統合が混在等） |
| L4 作り込み度 | 現在の Phase exit に必要な製品品質まで。将来Phase(3〜5)の抽象化(完全Plugin API・Formula Worker・全関数)を先回りしない |
| L5 証跡 | 通常DDの完了成果物は5点に圧縮: ①スコープ・対象外・リスク区分 ②AC対応表 ③機械検証の要約＋生ログ参照 ④finding対応・既知制約 ⑤ADR・公開API・互換性影響。**単一正本**（テスト数・コミット・AC結果・既知制約は一箇所を正とし他は参照）。スクショは実IME/Canvas見た目/競合表示/Presence/実行時のみ再現する問題に限定 |
| L6 ゲート頻度 | **人間ゲートを例外ベースへ**（最も効くレバー）。B/C は承認済みバックログ範囲なら自動開始。実機ゲートは**変更トリガー方式**（IME関連変更あり→実機必須／なし→Phase境界か数DDまとめて回帰） |
| L7 モデル使い分け | 役割固定からリスク・作業種別ルーティングへ。テンプレ起票・機械的リファクタ=軽量／状態遷移・並行・IME・永続化=高性能／高リスクレビュー=Codex xhigh／Phase計画・Go・API設計=高推論または外部レビュー。**別モデルであること自体を品質証拠にしない**（品質は不変条件・実行結果・障害注入・実機で担保） |

### 2.3 削ってはいけないガードレール（第3回レビュー §4）

密度を下げても、下記は **DDとは独立した常設スイート**として維持する（DD-009 で設置）。

- **IME不変条件**: composition中にtextarea.valueを書き換えない／selectionを破壊しない／textarea instanceとDOM親を置換しない／順序A・B両方／remote update・rollback/replay中もdraft不変／syntheticと実IMEを混同しない
- **共同編集不変条件**: サーバー全順序とクライアント最終hash一致／rollback/replay後の収束／beforeRevision不一致でサイレント上書きしない／reject時に利用者入力を保持／idempotency／reconnect・catch-up／RowId・ColumnIdの安定／snapshot＋logからの復旧
- **公開API不変条件**: Stable/Experimental/Internal の区分／API contract test／protocol・schema version／破壊的変更検出／移行ガイド要否判定
- **性能回帰予算**: 通常DDは軽量スモーク。初期ロード経路／Document State表現／Axis再構築条件／Canvas描画キャッシュ／operation replay方式／Formula依存グラフ／大量paste・sort・filter・行移動 を変えたDDだけフル再計測を発動
- **Phase 3 の実業務pilotはレビューで代替しない**（Stage 1 の範囲外だが方針として明記）

## 3. Phase 1 着手前の確定DD（基盤）

### DD-009: Phase 1 基盤確定 — PoC資産の去就・パッケージ境界・公開API方針・不変条件スイート

> **これは縦切りDDではなく、Phase 1 全体の前提を確定する基盤DD**。第3回レビュー §5.2（PoC成果物の Adopt/Harden/Rewrite/Discard 判定）・§5.5（API成熟度）・§4（常設スイート設置）を Phase 1 の最初に一括で片付ける。External Review 対象（Phase境界）。**Risk Class: A**。

含める確定事項:

1. **PoC資産の去就判定表**（DD-002〜006 の成果物ごとに Adopt/Harden/Rewrite/Discard）。「PoCだから作り直す」と「かなり作ったので流用する」がDDごとに揺れるのを防ぐ。
   - 例（判定は本DDで確定）: IME状態機械=Adopt／`sheet-collaboration` 抽出=Harden／統合ページ土台=Rewrite候補／PoCの簡易状態管理=Discard
   - **判定に加えて「実抽出」を割り付ける（S1-1・Codexレビュー指摘・高）**: Adopt/Harden とした資産を `apps/playground/src` 等から `packages/*` へ実際に抽出・ビルド・検証する作業を、DD-009（基盤資産）と各縦切りDD（その縦切りが初めて使う資産）に明示的に割り当てる。判定だけでは §15「PoCコードが抽出されている」を満たさない。
2. **パッケージ境界の確定**（憲章 §10・§26.1・P-04）。内部パッケージ（`@nanairo-sheet/{core,selection,…}`）と利用者向け Facade（`grid`／`element`／`react`／`server-hono` 等）の範囲。package boundary lint の設置（`apps/*` 間・内部相対importの恒久禁止）。
3. **公開API成熟度方針**（第3回レビュー §5.5）: Phase 1前半=Internal中心／Phase 1後半=Experimental公開／Phase 2=protocol・server adapterをExperimental／Phase 3 pilot後=主要APIをStable。`0.x` CHANGELOG運用の開始。
4. **常設不変条件スイート**（§2.3）を DD横断の恒久スイートとして設置（IME・共同編集・公開API・性能回帰予算）。
5. **Phase 1 用 DD差分テンプレート**へ Risk Class ヘッダ（§2.1）と製品化6観点の高速チェック（第3回レビュー §5 の短縮形）を反映（実ファイル改修の実施可否は DD-007 要確認3 の方針＝別DD管理系との整合確認に従う）。

## 4. 縦切りDD一覧（候補・Stage 1 SDK Alpha まで）

> 「最初のDD＋候補リスト」まで（全順序は進行中に見直す）。**候補DD番号は暫定**。§19対応＝計画書のどのPhaseのコンテンツをAlpha品質で取り込むか。

| 候補DD | 縦切り（利用者成果） | 支配的リスク | Risk Class | §19対応 | Stage 1 移行条件 | 主なSDK Alpha完了条件 |
|---|---|---|---|---|---|---|
| DD-009 | （基盤）PoC去就・境界・API方針・不変条件スイート | 公開API境界・アーキ責務 | **A** | 前提 | S1-1/S1-2/S1-5 | 内部import禁止lint・成熟度方針 |
| DD-010 | ①-a **単一利用者で日本語セルを連続入力できる**（保存なし。選択・常駐textarea・IME・Enter/Tab移動・ローカルCommand/Operation・文字列/数値/日付・**ローカルUndo登録**・**5万行 基本scroll/selection〔§23 Phase 1完了条件〕**） | IME状態機械・focus/selection | **A** | §19 Phase 1 | S1-1 | 内部露出なし・型定義 |
| DD-011 | ①-b **確定値が共同編集で保存され他クライアントへ反映される**（同期・競合経路: 最小サーバー・SetCells・sequencer/protocol・cell-level OCC・他クライアント反映） | sequencer/protocol・サイレント上書き | **A** | §19 Phase 2（最小） | S1-3 | 公開Command/Event/Options経由 |
| DD-011P | ①-b2 **保存が永続化され再読込で復元される**（最小永続化 snapshot+log・保存確定・復元経路）※DD-011 から分割（Codexレビュー指摘・高: 同期経路と永続化経路は独立検証可能な別リスク） | 永続化・データ損失 | **A** | §19 Phase 2（最小） | S1-3 | 保存の確定・復元を公開契約で |
| DD-012 | ①-c **別の社内アプリから SDK として組み込める**（Facade公開export・consumer fixture・Quick Start・型定義・最小サンプル・React薄ラッパー・**§26.2 配布/運用: private registry配布・release automation・canary/betaチャネル・compatibility matrix・error code/debug mode**） | 公開API固定・DX・配布 | **A**（公開API） | §19 Phase 1/2 の公開面 | S1-2/S1-3/S1-4/S1-5/**S1-6** | §2/§3 の SDK Alpha完了条件＋§26.2 配布成果物を**正式に充足** |
| DD-013 | ② **他ユーザーの位置を確認できる**（activeCell/selectionRanges/editingCell・displayName・colorKey・connection単位管理・Presence TTL・幽霊カーソル除去・Canvas overlay） | Presence（状態複製・TTL） | **B** | §19 Phase 2（最小） | S1-3 | Presence を公開Event/Optionsで |
| DD-014 | ③ **複数セルをコピー＆ペーストできる**（範囲選択・clipboard解析・型変換・SetCells原子的適用・競合判定・Undo・再描画）※DD-011 完了が前提（共同編集経路・cell-level OCC を使うため） | Clipboard原子性・競合・サイレント上書き | **A**（Codexレビュー指摘・OCC/データ消失トリガー該当） | §19 Phase 2/3（基本） | S1-3 | 公開Command経由の一括操作 |
| DD-015 | ④ **切断・再接続しても入力が失われない**（reconnect・catch-up・idempotency の製品化＝DD-005既知制約の回収・snapshotベース初期化） | reconnect/永続化・データ損失 | **A** | §19 Phase 2 | S1-3 | 障害注入テストで担保 |
| DD-016 | ⑤（後半・任意）**行を追加・削除できる**（RowId・InsertRows/DeleteRows・tombstone・Canvas座標更新・数式参照維持・共同編集・Undo・再接続後の収束） | 行操作×共同編集×参照維持 | **A** | §19 Phase 2 | S1-3 | — |
| DD-017 | ⑥（後半・任意）**最小数式が全クライアントで一致する**（四則・参照・SUM・固定ID参照・依存グラフ・replay決定性） | 数式評価・replay決定性 | **A** | §19 Phase 2 | S1-3 | — |
| DD-018 | **Stage 1 SDK Alpha 移行判定**（consumer統合の実証・移行条件 **S1-1〜S1-6** チェック・**データ損失境界の確認**〔DD-015 未実施なら online限定/未送信入力非保証を明示製品境界として記録〕・残存技術負債の Stage 2 送り・Stage 2 バックログ起こし） | マイルストーン判定 | **A** | §23 Phase境界 | S1-1〜S1-6 | External Review（Phase境界） |

**Stage 1 Alpha の最小到達ライン**（→ §7 論点1 で確定）: DD-009〜013（基盤＋最初の縦切り＋Presence）で「別アプリから組み込め、日本語入力が共同編集で保存され、他ユーザー位置が見える」Alpha が技術的に成立する。ただし **DD-015（reconnect堅牢化）を実施しない場合、DD-005 の既知制約「client→server 欠落時に入力が失われる」が残る**（§6）。したがって最小ラインは次の二択で、DD-018 前に確定する（Codexレビュー指摘・高）:

- **(a) DD-015 を Alpha 必須にする**（データ損失経路を Alpha までに塞ぐ）。データ整合ガードレールに忠実。
- **(b) DD-015 を Stage 2 送りにするなら**、Alpha を **「オンライン接続前提・未送信入力は非保証」** と**明示の製品境界**として Quick Start／README／DD-018 判定 AC に記録する（黙ってデータ損失経路を残さない）。

DD-014（Clipboard）は Alpha 品質に強く推奨。DD-016（行操作）・DD-017（数式）は **Stage 1 後半 or Stage 2 境界**の任意で、DD-018 の判定時にどちらへ置くか確定する。

## 5. 順序・依存とマイルストーンゲート

- **DD-009 が Phase 1 全DDの前提**（境界・API方針・不変条件スイートが未確定だと各縦切りが揺れる）。
- 最初の縦切り: **DD-010 →（DD-011 → DD-011P）→ DD-012**（単一利用者コア → 共同編集の同期・競合 → 永続化・復元 → SDKパッケージング）。§19 の Phase 1/Phase 2 技術境界は DD-010/DD-011 の境界。**DD-011P は DD-011 完了後**（同期経路の上に永続化・復元を載せる）。
- **DD-013（Presence）は DD-011 完了後**（共同編集の接続・room が前提）。**DD-014（Clipboard）は DD-011 完了が前提**（SetCells 原子的適用・競合判定が cell-level OCC＝DD-011 の経路を使うため。Codexレビュー指摘・中: DD-010 だけを前提に並行すると統合検証できない）。
- **DD-015（reconnect堅牢化）は DD-011P（最小永続化）の後**。DD-005 既知制約（client→server欠落の完全再整列・snapshotベース初期化）の正式回収先。
- **DD-016/017 は後半任意**。DD-018 判定で Stage 1 に含めるか Stage 2 へ送るかを決める。
- **マイルストーンゲート DD-018**: S1-1〜S1-6 を実証で満たしたら Stage 1 SDK Alpha 到達。ここで External Review（Phase境界）＋人間判定を行い、Stage 2 バックログを起こす（`phase0-dd-roadmap.md`→本ファイル→`phase2-...` の連鎖）。

## 6. 既知制約の回収計画（DD-005 引き継ぎ・第3回レビュー §4.3）

「今回は対象外」で終わらせず、各制約に影響・**放置期限（いつまでに解消または再判定するか）**・解消予定・未解消時の製品制約を付ける（第3回レビュー §4.3・Codexレビュー指摘・中）。放置期限を過ぎた制約は、担当DDの起票者が **DD-018（Stage 1 移行判定）で解消済／延期／製品境界化のいずれかを判定**する（延期の判定責任は DD-018 が負う）。DD-005 からの主な引き継ぎ:

| 既知制約（DD-005） | 影響 | 放置期限 | 解消予定 | 未解消時の製品制約 |
|---|---|---|---|---|
| client→server 欠落時の完全再整列 | データ損失リスク | **DD-018（Stage 1判定）前** | **DD-015** | 切断時に入力欠落しうる → §7論点1(b)なら online限定を明示 |
| 行挿入後のローカル選択・Enter移動先の再ベース | 操作の一貫性 | **Stage 2 開始前** | **DD-016** | 行操作は Alpha 範囲外表示 |
| snapshotベース初期化 | 大規模文書の初期ロード | **DD-018 前** | **DD-011P/DD-015** | 初期ロードが log全replay依存 |
| 実IME変換中に対象行が削除された場合の挙動 | IME×行削除の競合 | **Stage 2 開始前** | **DD-016** | 該当操作を Alpha で非推奨 |
| 新 integration-editor アダプタ×実IME候補ウィンドウ・順序A/B の実機記録 | IME正しさの実機担保 | **DD-010 実機ゲート時** | **DD-010 実機ゲート** | 実機ゲートで回収 |

## 7. 未確定事項・要確認（レビューで論点化）

1. **Stage 1 Alpha の最小到達ライン**（§5 の二択を確定する）: **(a) DD-015 まで Alpha 必須**（データ損失経路を塞ぐ）か、**(b) DD-015 を Stage 2 送り＋「オンライン前提・未送信入力非保証」を明示製品境界にする**か。**黙ってデータ損失経路を残す選択は不可**（Codexレビュー指摘・高）。
2. **DD-016（行操作）・DD-017（数式）の帰属**: Stage 1 後半に入れるか Stage 2 へ送るか。憲章 Goal 1「別プロジェクトから利用可能」の実用性にどこまで必要か。
3. **公開API成熟度の刻み**（第3回レビュー §5.5）: Phase 1後半で Experimental 公開する範囲。早すぎる固定を避けつつ、consumer が使える最小契約をどう定めるか。
4. **密度計測**（第3回レビュー §5.6）: Phase 1 最初の5DD（DD-009〜013）で壁時計・人間確認時間・ゲート待ち・Codex消費・レビュー層別finding数・見逃し・手戻り率を記録し、外部レビュー/Codex effort を再調整する運用を入れるか。
5. **見積の目安**: 計画書 **§25.4「単独開発の場合」は「社内MVP：18〜30か月」**を計画上の基準とする。本プロジェクトは単独＋AIエージェント。Stage 1 Alpha は計画書 §19 Phase 1（8〜10週）＋ Phase 2 の最小部分に相当。**期間は密度計測（論点4）で実測してから確定**し、本ロードマップに固定週数は置かない。

## 8. レビュー反映ログ

### Codexレビュー第1回（2026-07-12・effort=high）

依頼書・結果: `doc/DD/DD-007/phase1-roadmap-review-20260712/codex-review-request.md`・`codex-review-result.md`。9指摘（P1×5・P2×4）。**全件を反映または明示的に論点化**した。

| Codex指摘 | 重要度 | 対応 |
|---|---|---|
| Alpha必須の配布・運用成果物（憲章§26.2）が担当DDに無い | 高 | 反映: S1-6 を新設し DD-012＋DD-018 ゲートへ割付（§0・§4） |
| S1-1 の実抽出作業に担当DDが無い（DD-009は判定のみ） | 高 | 反映: S1-1 に実抽出を明記、DD-009 含める確定事項に実抽出割付を追加（§0・§3） |
| 「§19 Phase 1 を含む」主張と必須範囲の不一致 | 高 | 反映: 「§19 Phase 1 の中核＋Phase 2最小」＝「Phase 1の一部」と明記。5万行scroll/selectionを DD-010 必須ACへ（§1.2・§4） |
| データ損失を残した状態を Alpha 成立にしうる | 高 | 反映: 最小ラインを (a)DD-015必須 / (b)online限定を明示製品境界 の二択に。黙って残すのは不可（§5・§7論点1・DD-018ゲート） |
| DD-011 が支配的リスク複数（同期/OCC/永続化/Undo） | 高 | 反映: DD-011（同期・競合）と DD-011P（永続化・復元）へ分割。Undo は DD-010（単一利用者）へ移動（§4・§5） |
| DD-014 を DD-011 完了後へ依存させる | 中 | 反映: DD-014 の前提を DD-011 完了に修正（§4・§5） |
| 競合を扱う DD-014 を Risk Class A に | 中 | 反映: DD-014 を B→A（OCC/データ消失トリガー該当）（§4） |
| 既知制約表に放置期限が無い | 中 | 反映: §6 に放置期限列＋延期時判定責任（DD-018）を追加 |
| 単独見積の参照は §25.4「社内MVP」（§1.3ではない） | 中 | 反映: §7論点5 の引用を §25.4・「社内MVP」へ修正 |

---

> 次アクション: 本草案（Codex反映済み）を ChatGPT（Phase計画の妥当性）でもレビューし、指摘を本ファイルと DD-007 へ還流。DD-007 が Go/条件付きGo を出したら、Phase 3 で本草案を `phase1-backlog.md`（正式バックログ）へ昇格する。
