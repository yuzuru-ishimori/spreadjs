# Phase 1 DDロードマップ レビュー結果

- 対象: `03_計画本体_phase1-dd-roadmap.md`
- レビュー基準: `01_プロンプト.md`、`02_レビュー観点と論点.md`
- 参照: `04_参考_Phase0成果と憲章Stage1.md`、`05_参考_計画書フェーズ構成.md`、`06_参考_密度レビュー結論.md`
- レビュー日: 2026-07-12

---

## 1. 総合判定

### 判定: **要修正**

「組み直すべき」ではない。ロードマップの中核方針は採用可能であり、特に次の判断は妥当である。

- 製品成熟 Stage 1「社内SDK Alpha」を到達目標に置いたこと
- 単一利用者コアと共同編集・永続化を、一つの巨大DDへ詰め込まず分割したこと
- 計画書の技術フェーズと、製品成熟段階を別軸として扱ったこと
- PoC資産の Adopt／Harden／Rewrite／Discard を最初に確定すること
- 高リスク領域だけ密度を戻す Risk Class 制を採用したこと
- 既知制約に放置期限と未解消時の製品境界を付けたこと

一方、正式バックログへ昇格する前に、少なくとも次の5点を修正する必要がある。

1. **条件付きGoが確定済みである事実を計画本体へ反映すること**  
   現在の冒頭は「Go判定前」の文面のままであり、`04` §2.5 と矛盾している。CG-1〜6を参考資料に置いたままにせず、ロードマップ本体のマイルストーン制約へ昇格させる必要がある。

2. **Alpha必須ラインを今決めること**  
   DD-018直前まで「DD-015を必須にするか」を未確定にするのは遅い。後述のとおり、DD-015相当の reconnect／catch-up／idempotency は Alpha 必須とすべきである。

3. **DD-009、DD-012、DD-016の過積載を解消すること**  
   特に DD-012 は、公開API、consumer統合、ドキュメント、Reactラッパー、配布、release automation、compatibility matrix、診断機能を同時に扱っており、支配的リスクが一つではない。

4. **Stage 1の実証対象を consumer fixture だけで済ませないこと**  
   「1つの社内アプリが利用できる」という憲章条件に対し、同一monorepo内のfixtureだけでは証拠が弱い。実アプリ、または少なくとも独立consumerからprivate registry経由でインストールする実証が必要である。

5. **条件付きGoの担当割付を修正すること**  
   CG-2が任意DDであるDD-016へ寄っており、CG-6には縦切り一覧上の明確な担当DDがない。CG-1とCG-5も、Alpha配布を停止するハードゲートとしては記述が弱い。

したがって、**骨格を維持したまま、Alpha必須ライン、CG解除ゲート、過積載DD、依存順序を修正して進める**のが適切である。

---

## 2. 到達目標（Stage 1 SDK Alpha）の妥当性

### 2.1 Stage 1を「別の社内アプリから使えるSDK」とした判断

妥当である。

Phase 0で技術成立性を確認した次の段階として、単にPoCコードを整理するだけでは不十分である。次の利用者が内部構造を知らずに組み込める状態まで進めることで、初めて以下を検証できる。

- パッケージ境界が実用的か
- 公開Facadeが過不足なく設計されているか
- ライフサイクル、イベント、エラー、型定義が利用側から理解できるか
- PoC固有の内部importや暗黙の初期化順序が残っていないか
- 配布物だけで実行可能か

APIを `0.x`／Experimental中心とする判断も適切である。Stage 1でStable化すると、Stage 2以降の実利用で得られる知見を反映しにくくなる。

### 2.2 S1-1〜S1-6の割付

概ね妥当だが、次の修正が必要である。

#### S1-1: PoCコードの抽出

Adopt/Harden判定だけでなく実抽出を求めた点は正しい。ただし「DD-009と各縦切りDDで随時抽出する」だけでは、完了責任が分散する。

**修正案**

- DD-009で「資産台帳」を作る
- 各資産に `採用方針／抽出先package／担当DD／完了条件` を持たせる
- DD-018で「Adopt/Harden対象が `apps/playground` 等に残っていないこと」を機械確認する

#### S1-3: 1つの社内アプリから利用可能

consumer fixtureは開発中の回帰試験として有効だが、憲章の「社内アプリ」と同義ではない。

**Alpha移行条件は次のいずれかにするべきである。**

- 実在する社内アプリへprivate registry経由で組み込む
- 実アプリがまだ選べない場合、別workspaceではなく、独立consumerプロジェクトへpack済み成果物またはprivate registryからインストールする

次は不合格扱いとする。

- monorepo workspace linkだけで動作
- source pathを直接参照
- `@nanairo-sheet/*` のInternal packageを直接import
- unpublished assetsや開発サーバーの暗黙設定に依存

#### S1-6: 配布・運用成果物

追加自体は妥当だが、DD-012へ詰め込みすぎている。

Alpha必須は以下まででよい。

- private registryまたは同等の社内配布経路
- 再現可能なbuild／publish
- `alpha` または `next` 相当のdist-tag
- Tier 1 compatibility matrix
- 最小のerror code／debug logging hook
- CHANGELOG

本格的な複数チャネル運用、互換性自動検証の完全整備、汎用診断基盤はStage 2へ送れる。

### 2.3 Stage 1に最小共同編集を含める判断

**妥当であり、維持すべきである。**

この製品の主要な差別化要素は、単一利用者向けCanvasグリッドではなく、日本語IMEとサーバー主導共同編集が両立する点にある。Stage 1を単一利用者だけで終了すると、SDK化の成否は確認できても、製品の中核アーキテクチャがconsumer境界を越えて成立するか確認できない。

ただし、「最小共同編集」の定義は絞るべきである。

**Stage 1必須**

- 2クライアント以上でセル確定値が同期する
- サーバー全順序に収束する
- OCC reject時に利用者ドラフトを失わない
- snapshot＋logから復元する
- 一時切断後にcatch-upし、ACK済み入力と送信待ち入力を失わない
- protocol／schema version不一致をサイレントに受け入れない

**Stage 1必須ではない**

- 高機能Presence
- 行列追加削除
- 最小数式
- 大量paste
- 本番認証認可
- 長時間負荷、HA、バックアップ運用

---

## 3. フェーズ境界の整合

### 3.1 DD-010／DD-011／DD-011Pへの分割

分割の方向は健全である。

- DD-010: 単一利用者の入力・選択・IME・ローカルOperation
- DD-011: サーバー受理・全順序・OCC・他クライアント反映
- DD-011P: 永続化・再読込・snapshot＋log復元

これは、計画書 §19 の技術境界をDDレベルで保持しつつ、Stage 1の製品到達目標へつなぐ現実的な方法である。

### 3.2 残る危険

分割しただけでは、Phase 2相当リスクをPhase 1の軽量プロセスで扱う危険は消えない。次を明記する必要がある。

- DD-011、DD-011P、DD-015は計画書 Phase 2相当であり、すべてRisk Class A
- fault injection、randomized/property test、復旧試験を必須にする
- 未解決のCGを理由なく次DDへ繰り越さない
- Phase 1の通常DD向け軽量証跡を適用しても、データ整合の生ログと障害マトリクスは削らない

### 3.3 用語上の問題

現在の文書は、次の2種類を同じ「Phase 1」と呼んでいる。

- 開発計画書 §19 の Phase 1
- Stage 1 SDK Alphaまでを進める今回のデリバリーフェーズ

これは進捗報告、スコープ判定、AIエージェントへの指示で混乱を生む。

**推奨**

文書名を次のいずれかへ変更する。

- `Stage 1 SDK Alpha DDロードマップ`
- `Delivery Phase A: Stage 1 SDK Alpha`
- `Phase 1A/1B Roadmap`  
  - 1A: 単一利用者コア
  - 1B: 最小共同編集・永続化

少なくとも本文では「計画書Phase」と「Delivery Phase」を常に修飾して書くべきである。

### 3.4 「最初のDD」の矛盾

文書は「最初のDDは日本語入力から共同編集保存まで」と記しながら、実際にはDD-010〜012へ分割している。

分割自体は正しいため、確定事項の表現を次へ変更するべきである。

> 最初のAlpha縦切りマイルストーンは、日本語でセルを連続入力し、確定値が共同編集で永続化され、独立consumerから利用できる状態とする。これを複数DDへ分割する。

「1 DD」と「最初のマイルストーン」を混同しないこと。

### 3.5 「保存」の意味

DD-011には永続化がないため、「共同編集で保存される」という名称は不正確である。

- DD-011: **サーバーに受理され、全クライアントへ同期される**
- DD-011P: **durable ACK後に永続化され、再起動・再読込後に復元される**

さらに、DD-011Pでは次を定義する必要がある。

- ACKを返す時点
- operation log書込みとACKの順序
- snapshotは正本か最適化物か
- サーバー再起動時の復旧手順
- schema version不一致時の挙動
- Alpha期間中のデータ互換方針  
  例: 旧形式を自動移行しない場合でも、誤読せず明示的に拒否する

---

## 4. 縦切りDDの切り方・順序・依存

### 4.1 DD-009: 過積載

DD-009には以下が同居している。

- PoC資産の去就判断
- package境界
- 公開API成熟度
- 不変条件スイート
- package boundary lint
- DDテンプレート
- 一部資産の実抽出
- 外部レビュー

これは一つの支配的リスクではない。

**分割案**

1. **基盤判断DD（A）**
   - Adopt/Harden/Rewrite/Discard
   - package責務
   - 公開面の最小方針
   - CG解除台帳
   - Tier 1対象
   - 人間ゲート＋必要なら外部レビュー

2. **基盤実装DD（B）**
   - package skeleton
   - boundary lint
   - contract test骨格
   - invariant suite runner
   - independent consumer harness
   - DDテンプレート改修

3. **CellStore／安定ID移行DD（A）**
   - index→RowId移行
   - serialization
   - replayとの整合
   - CG-2解除

これにより、設計判断と機械的な基盤整備を別レビューサイクルにできる。

### 4.2 DD-010: 条件付きで妥当

単一利用者の日本語入力という利用者成果は明確である。ただし、現在は次を含みすぎている。

- IME
- 選択
- Keyboard navigation
- 型変換
- Command/Operation
- local Undo
- 5万行性能
- PoC資産抽出
- 実機ゲート

**修正案**

- local Undoの完成を外す。Operation登録と逆操作可能性の前提までに留める
- 5万行scroll/selectionは維持する。ただし新機能ではなく統合性能回帰ゲートとして扱う
- CG-6の精密メモリ計測をこのDDの完了条件へ置く
- CG-1実機IMEを必須にする
- Windows Chrome／Edgeの双方で確定Enter順序A/Bを記録する
- synthetic試験合格だけでは完了不可とする

### 4.3 DD-011: 概ね妥当

同期、sequencer、OCC、他クライアント反映は同一の支配的リスクにまとまっている。PoC資産をHardenするDDとして成立する。

完了条件には最低限、以下を明記するべきである。

- 2つの実ブラウザーconsumerで相互反映
- randomized testでは3クライアント以上
- server orderとclient hashの一致
- duplicate operationの二重適用なし
- beforeRevision不一致時にサイレント上書きなし
- reject後も編集中draftを保持
- IME composition中のremote updateでdraft不変

### 4.4 DD-011P: 妥当だがCG-3を明示する

同期経路から永続化を分離した判断は正しい。

ただし「最小snapshot＋log」だけではCG-3解除を証明できない。次を受け入れ基準に入れる。

- versioned snapshot format
- snapshot＋tail logからの復元一致
- 100k相当でlog全replayに依存しない
- replay O(N²)を回避した測定結果
- corrupt／unsupported version時のfail-fast
- durable ACKの定義

### 4.5 DD-012: 明確に過積載

現在のDD-012は、前回DD-005と同じ過積載パターンに近い。

**分割案**

1. **Facade／consumer統合DD（AまたはB）**
   - 主要Facade export
   - mount／destroy
   - Command／Event／Options
   - 型定義
   - independent consumerからpack済み成果物を利用
   - Experimental APIレビュー

2. **Alpha配布・診断DD（B）**
   - private registry publish
   - dist-tag
   - CHANGELOG
   - Quick Start
   - compatibility matrix
   - error code／debug logging
   - release automation

React薄ラッパーは、最初のconsumerがReactの場合だけ必須にする。そうでなければStage 2へ送る。Stage 1で `grid`、`element`、`react`、`server-hono` の全Facadeを同時に整える必要はない。

### 4.6 DD-013: 機能として妥当、Alpha必須ではない

PresenceはRisk Class Bでよい。利用者成果も明確である。

ただし、現在のAlpha最小ラインがDD-013までを必須とし、DD-015を任意にしているのは優先順位が逆である。

- Presenceがなくても共同編集データは成立する
- reconnectがないと、一時的なネットワーク断で入力を失う

したがって、Presenceは「Alpha拡張」または最初のconsumer要求に応じた任意DDへ下げるべきである。

### 4.7 DD-014: 一つの成果だが大きい

コピー＆ペーストは一つの利用者成果として切れている。ただし以下を同時に扱うため、実装差分は大きい。

- range selection
- clipboard parser
- 型変換
- 原子的SetCells
- OCC
- Undo
- 再描画

Stage 1必須にはしない。Stage 1後半またはStage 2の先頭候補とする。実施時は、必要なら次へ分ける。

- ローカルpaste＋原子Operation
- 共同編集OCC＋Undo＋replay

### 4.8 DD-015: Alpha必須へ変更する

DD-015は強く推奨ではなく、**Stage 1 Alpha必須**とするべきである。

「オンライン前提・未送信入力非保証」と書くだけでは、通常発生する一時切断時のデータ損失を利用者が回避できない。社内Alphaであっても、SDK利用側が「保存されたように見えた入力」を失う境界は許容しにくい。

Alphaで保証する範囲は限定してよい。

**保証する**

- タブが生存している一時切断
- 未ACK operationのメモリ保持
- 再接続後の再送
- idempotency
- catch-up
- server再起動後のsnapshot＋log復旧
- pending／rejected状態の可視化またはイベント通知

**保証しなくてよい**

- ACK前のブラウザークラッシュ
- OSクラッシュ
- ローカル永続キュー
- 長時間offline編集
- 複数端末offline merge

この境界を明示すれば、Stage 1として過剰ではない。

### 4.9 DD-016: 現状のままでは過積載かつ依存矛盾

行追加・削除に次が同居している。

- RowId
- Insert/Delete
- tombstone
- Canvas座標
- 数式参照維持
- 共同編集
- Undo
- reconnect後収束

さらに、数式参照維持を要求する一方、数式DDはDD-017で後続である。依存順序が不自然である。

**推奨**

DD-016はStage 2へ送り、次へ分割する。

1. 行構造Operation＋Canvas＋local selection rebase
2. 共同編集収束＋tombstone＋reconnect
3. 数式導入後の固定ID参照維持

### 4.10 DD-017: Stage 2へ送る

最小数式は製品として重要だが、SDK Alphaの成立条件ではない。Phase 0で成立性は確認済みであり、Stage 1で再度広げるより、consumer境界とデータ損失境界を先に閉じるべきである。

### 4.11 DD-018: 判定DDとして妥当

ただし、DD-018で初めてAlpha必須範囲を決めてはならない。DD-018は「決定する場」ではなく、「事前に決めた条件を証拠で判定する場」にする。

---

## 5. Stage 1 Alpha の最小到達ライン

### 推奨する必須ライン

以下をすべて完了した時点をStage 1 SDK Alphaとする。

1. **基盤判断**
   - PoC資産台帳
   - package責務
   - Experimental API方針
   - CG解除台帳
   - Tier 1環境

2. **安定ID・package/test基盤**
   - CellStore index→RowId
   - package skeleton
   - boundary lint
   - invariant suite
   - independent consumer harness

3. **単一利用者コア**
   - 日本語連続入力
   - 文字列／数値／日付
   - selection／navigation
   - local Operation
   - 5万行scroll／selection回帰
   - 実機IME
   - 精密メモリ計測

4. **共同編集同期**
   - sequencer
   - protocol
   - SetCells
   - OCC
   - draft保持
   - 他client反映

5. **永続化・復元**
   - versioned snapshot
   - operation log
   - durable ACK
   - snapshot＋tail replay
   - CG-3性能条件

6. **reconnect堅牢化**
   - pending queue
   - catch-up
   - idempotency
   - fault injection
   - CG-5解除

7. **SDK consumer実証**
   - private registryまたはpack済み配布物
   - Internal package直接importなし
   - 実社内アプリまたは独立consumer
   - Quick Start／型定義／CHANGELOG
   - Tier 1 compatibility matrix
   - 最小診断機能

8. **移行判定**
   - S1-1〜S1-6
   - CG-1〜6
   - 既知制約
   - Stage 2バックログ

### Stage 1必須から外すもの

- Presence
- Clipboard
- 行追加・削除
- 最小数式

PresenceとClipboardは、Alpha成立後の最初の拡張候補としてよい。行操作と数式はStage 2へ送る。

### トレードオフ

この変更により、見た目上の機能数とデモ映えは減る。一方で、次を得られる。

- 「組み込めるが入力を失う」という最悪のAlphaを避ける
- APIと永続化の境界を先に確定できる
- Stage 2で行操作・数式を追加した際の手戻りを減らせる
- consumerから得る設計フィードバックを早期に使える

---

## 6. 密度レジームの妥当性

### 6.1 方針自体は妥当

Risk Class A/B/C、例外ベースの人間ゲート、証跡5点、変更トリガー型実機ゲートは、単独＋AIエージェント体制に適している。

特に有効なのは次の2点である。

- B/Cを承認済みバックログ内で自動開始する
- 外部レビューをPhase境界・API・ADR転換・Go/No-Goへ限定する

希少資源である人間確認時間を、高リスク判断へ集中できる。

### 6.2 現状は実質的に軽量化できていない

縦切り一覧では、DD-009〜018の大半がAであり、BはPresenceだけである。これでは「Phase 1は中密度」というより、ほぼ全DDが高密度になる。

ただし、危険なDDを無理にBへ下げるべきではない。対処はDD分割である。

- アーキテクチャ判断: A
- 承認済み判断に沿うpackage skeleton／lint: B
- docs／sample／release設定: BまたはC
- IME／protocol／永続化／reconnect: A
- Presence overlay: B

これにより、本当に高リスクな差分だけAとして扱える。

### 6.3 軽量化しすぎて危険な箇所

#### 未解除CGは変更トリガー方式の例外

CG-1はPhase 0から未検証である。IMEコード変更がなくても、抽出、Facade化、consumer統合、DOM親変更、bundlingによって挙動が変わり得る。

したがって以下は必須である。

- DD-010相当で実機IME
- 最終consumer統合後にもTier 1実機スモーク
- 「IMEコードを触っていないので実機省略」は不可

同様に、CG-3、CG-5、CG-6も、該当コード変更の有無に関係なく解除証拠が得られるまでゲートを発火させる。

#### A区分の証跡

証跡を5点へ圧縮してよいが、5点は「証拠を減らす」のではなく「格納場所を集約する」意味で運用する。

A区分では次を省略しない。

- fault matrix
- seed／再現コマンド
- event trace
- 実機環境
- durability／ACK条件
- 既知の未保証境界

### 6.4 逆に重い箇所

- Experimental APIの全変更へ外部レビューを要求する必要はない
- Quick Start、sample、label変更を個別DDにしない
- React wrapperが最初のconsumerに不要なら実装しない
- canary／betaの複雑なチャネル設計をStage 1で完成させない
- Codex xhighは「Aというラベル」だけで自動決定せず、状態機械・protocol・永続化アルゴリズムを実質変更した場合に限定する

### 6.5 Risk Classの昇格ルール

B/Cで開始したDDでも、途中で次が判明した場合は停止してAへ昇格する。

- 受け入れ基準を変更する必要がある
- データ形式やprotocolを変える
- 永続化境界へ波及する
- 利用者入力を失う可能性がある
- Internal予定だったAPIをconsumerへ公開する
- 一つのDDで複数の状態所有者を変更する

### 6.6 密度計測

密度計測は未確定事項ではなく、Phase 1標準に入れるべきである。ただし専用DDは不要である。

各DDで次だけ記録する。

- 人間確認時間
- Codex effort／回数
- ゲート待ち
- review finding数
- merge後の手戻り
- DD開始から完了まで
- 実行したmanual gate

最初の5件はAだけに偏らず、A／B／Cが混ざる5件で評価する。

---

## 7. 見落とし・過剰懸念

### 7.1 見落とし

#### 1. 条件付きGoの正本化

計画本体がGo判定前のままであり、CG-1〜6がロードマップ本体にない。参考資料だけに条件を置くと、AIエージェントが通常の既知制約として扱い、Alphaを誤って通過させる。

ロードマップ本体へ次の表を追加するべきである。

| CG | 主担当 | 解除証拠 | 期限 | 未解除時 |
|---|---|---|---|---|
| CG-1 | 単一利用者IME DD＋最終consumerスモーク | 実機trace、順序A/B、先頭欠落0 | Facade公開前 | Alpha不可 |
| CG-2 | 安定ID移行DD | RowId serialization／replay試験 | 共同編集永続化前 | Alpha不可 |
| CG-3 | 永続化DD | versioned snapshot、100k測定 | reconnect DD前 | Alpha不可 |
| CG-4 | 基盤判断＋全DD | Tier 1 matrix | Phase開始時に確定、exitで実証 | 対象外環境を明示 |
| CG-5 | reconnect DD | fault injection、再送、収束 | Alpha exit前 | Alpha不可 |
| CG-6 | 単一利用者性能DD | 精密メモリ計測 | Alpha exit前 | データ上限を明示またはAlpha不可 |

#### 2. CG-2の担当

DD-016を任意にするなら、CG-2をDD-016へ置けない。RowId移行は共同編集・snapshot形式の前提として、DD-011Pより前に終えるべきである。

#### 3. CG-6の担当

「DD-009／データ表現DD」とされているが、縦切り一覧にデータ表現DDがない。DD-010の統合性能ゲート、または専用の安定ID／データ基盤DDへ明示的に割り当てる必要がある。

#### 4. durability境界

「保存」の定義、ACKタイミング、サーバー再起動時の保証が未定義である。これはDD-011Pの中心契約にする。

#### 5. reconnectの保証範囲

切断、タブrefresh、ブラウザークラッシュ、サーバー再起動を一括して「入力を失わない」と書くと、受け入れ基準が曖昧になる。障害種別ごとに保証／非保証を分ける。

#### 6. 実consumerの独立性

fixtureがworkspace linkや内部assetへ依存していないことを検証する必要がある。`npm pack`、private registry、別consumer repoなど、配布物だけで動く経路を使う。

#### 7. consumer lifecycle

最低限、次の公開契約が必要である。

- create／mount
- destroy／disconnect
- event unsubscribe
- document／room指定
- connection state
- error notification

これがないと、別アプリへ組み込めても画面遷移や再mountでresource leakを起こしやすい。

#### 8. Alphaの信頼境界

本番認証認可をStage 1へ入れる必要はないが、以下は明示する。

- trusted internal environment限定
- tenant isolation非保証
- callerがidentityを与える
- untrusted input／public internet公開は対象外
- persistenceは本番バックアップを意味しない

#### 9. version mismatch

APIが0.xでも、古いsnapshotやprotocolを誤読してはならない。自動migrationを実装しなくても、version mismatchを検出して明示的に停止する必要がある。

#### 10. DD-011Pの採番

`DD-011P`は、人間には分かりやすいが、DD-INDEX、正規表現、生成スクリプトが数値IDを前提としている場合に壊れやすい。候補番号が暫定なら、正式化時に連番へ直す。

### 7.2 過剰に心配している点

#### 行操作と数式

Stage 1で実用的な表計算機能を揃えようとしすぎている。Stage 1の目的は、完成度の高い表計算アプリではなく、別consumerからSDKとして使えることの実証である。

#### Presenceの必須化

Presenceは共同編集らしさを示すが、データ整合やSDK成立より優先する理由は弱い。

#### 広いFacade群

Stage 1でWeb Component、React、複数client facade、汎用server adapterをすべて揃える必要はない。最初のconsumerに必要な最小経路へ絞る。

#### 完全な互換運用

0.xのAlphaで長期後方互換を保証する必要はない。必要なのは、変更履歴、version検出、破壊的変更の明示である。

#### 本番運用品質

認証、HA、バックアップ演習、24時間接続、広範なブラウザー対応は後段でよい。Stage 1では対象外境界を明記する。

---

## 8. 推奨する改訂後の順序

番号は正式採番時に調整する。

```text
基盤判断DD
  ├─ PoC資産台帳
  ├─ package責務
  ├─ API成熟度
  ├─ CG解除台帳
  └─ Tier 1確定
        ↓
安定ID／CellStore移行DD（CG-2）
        ↓
package・test基盤DD
  ├─ package skeleton
  ├─ boundary lint
  ├─ invariant suite
  └─ independent consumer harness
        ↓
単一利用者IME縦切りDD（CG-1・CG-6）
        ↓
共同編集同期／OCC DD
        ↓
永続化・snapshot復元DD（CG-3）
        ↓
reconnect／catch-up／idempotency DD（CG-5）
        ↓
Facade／実consumer統合DD
        ↓
Alpha配布・診断DD
        ↓
Stage 1移行判定DD
```

並行またはAlpha後の候補:

```text
共同編集同期DD ─→ Presence DD
共同編集同期DD ─→ Clipboard DD
Stage 1完了後   ─→ 行操作DD
Stage 1完了後   ─→ 数式DD
```

---

## 9. 草案へ直接反映する修正提案

### 必須修正

- 冒頭の「Go判定前」を削除し、**2026-07-12に条件付きGo確定**と更新する
- `04` §2.5のCG-1〜6をロードマップ本体へ転載し、担当DD、解除証拠、期限、未解除時の扱いを記載する
- CG-1、CG-2、CG-3、CG-5、CG-6をStage 1移行のハードゲートにする
- CG-4のTier 1環境を全DDの共通対象範囲として固定する
- CG-2を任意のDD-016から外し、DD-011Pより前の必須DDへ移す
- CG-6をDD-010相当の統合性能・メモリゲートへ明示的に割り付ける
- Alpha必須ラインをDD-018まで未確定にせず、**reconnectを必須**として事前確定する
- Alpha必須ラインからPresenceを外す
- DD-011の名称を「保存」から「サーバー受理・同期」へ変更する
- DD-011Pでdurable ACK、versioned snapshot、snapshot＋tail log復元、CG-3測定を定義する
- DD-009を「判断DD」「基盤実装DD」「安定ID移行DD」へ分割する
- DD-012を「Facade／consumer統合DD」と「配布・診断DD」へ分割する
- S1-3はfixtureだけでなく、実社内アプリまたは独立consumerから配布物をインストールして実証する
- DD-016とDD-017をStage 2へ送る
- DD-016を将来実施する際は、行構造、共同編集収束、数式参照維持へ分割する
- 「最初のDD」という確定事項を「最初のAlpha縦切りマイルストーン」へ修正する
- DD-018はスコープ決定DDではなく、事前条件の合否判定DDへ変更する

### 密度調整

- 未解除CGは変更トリガー方式の例外とし、コード変更がなくてもmanual／measurement gateを必須にする
- A区分の5点証跡には、fault matrix、seed、実機環境、event traceへの参照を必須化する
- B/Cで開始後にprotocol、永続化、入力保持、公開契約へ波及した場合のA昇格ルールを追加する
- package skeleton、lint、docs、sample、release設定はB/Cへ分離する
- Codex xhighをAラベル一律ではなく、状態機械・protocol・永続化ロジックの実質変更時に限定する
- 最初のA/B/C混在5DDで人間時間、Codex消費、finding、手戻りを計測し、密度を再調整する

### 明示すべきAlpha製品境界

- 対応環境はTier 1のみ
- trusted internal environment限定
- 本番認証認可、tenant isolation、HA、バックアップ運用は対象外
- タブ生存中の一時切断は復旧対象
- ACK前ブラウザークラッシュ、長時間offline編集は非保証
- APIはExperimental `0.x`
- snapshot／protocol version mismatchはfail-fast
- 行操作、数式、Clipboard、Presenceは必須範囲外または拡張扱い

---

## 10. 最終結論

このロードマップは、方向性を変える必要はない。特に、Stage 1をSDK Alphaとし、単一利用者コア・共同編集同期・永続化を分割して縦につなぐ設計は正しい。

ただし、現状のまま正式バックログへ昇格すると、次の誤判定が起こり得る。

- 条件付きGoの未解除条件を残したままAlpha配布する
- Presenceはあるが、一時切断で入力を失う
- fixtureでは動くが、配布物を別アプリへ組み込めない
- 「同期」を「保存」と扱い、durability境界が曖昧になる
- DD-009／DD-012／DD-016が再び巨大化する

したがって、**判定は「要修正」**である。  
修正の中心は、機能追加ではなく、**CG解除の正本化、reconnect必須化、DD分割、実consumer証明、保存契約の明確化**である。これらを反映すれば、Phase 1の正式バックログとして進めてよい。
