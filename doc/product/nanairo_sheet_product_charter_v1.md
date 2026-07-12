# Nanairo Sheet（仮称）製品憲章・SDK戦略

- 文書種別：製品憲章／SDK戦略
- 版：v1.0
- 作成日：2026-07-11
- ステータス：Accepted（DD-008の仕様確認ゲートでユーザー承認。ただし製品名・一般公開・OSS化・商用化等の未決定事項は §27 のとおり未決のまま保持）
- 製品仮称：Nanairo Sheet
- npmスコープ：`@nanairo-sheet/*`
- 公開クラス候補：`NanairoSheet`
- 想定利用者：株式会社ナナイロの企画・開発・営業・運用担当者、将来のSDK利用者
- 上位文書：なし。本書を製品戦略上の最上位正典とする（DD-008の仕様確認ゲートで確定）
- 下位文書：構想・意思決定記録、開発計画・基本設計、DDロードマップ、ADR、仕様書、公開API仕様、リリース方針

> 本文書は正式な製品名、一般公開、OSS化、商用ライセンスを確定するものではない。現時点では、再利用可能な社内SDKを第一到達点とし、外部提供可能性を失わない設計・運営方針を定める。

---

## 1. 文書の目的と位置付け

本書は、Excelライクな業務入力基盤の開発を、単一Webアプリの画面実装ではなく、複数プロジェクトへ組み込める技術製品として定義するための最上位文書である。

本書が定める対象は次のとおりである。

- 何を製品として作るのか
- 誰に提供するのか
- どのような成果物として配布するのか
- どの段階まで育てるのか
- 技術PoC、社内SDK、顧客向けSDK、一般公開製品をどう区別するのか
- 公開API、パッケージ、拡張性、互換性、ライセンス、サポートをどう考えるのか
- 製品化を理由に、現在のPhase 0を無制限に膨らませないための境界

本書は技術実装の詳細を直接規定しない。技術アーキテクチャ、データモデル、プロトコル、IME、Canvas、数式、共同編集の詳細は「開発計画・基本設計」とADR・仕様書が担当する。作業順序、DD間の依存、Go／No-GoはDDロードマップが担当する。

文書間で矛盾が生じた場合、次の原則を適用する。

1. 製品の目的、利用者、提供形態、非目標は本書を優先する。
2. 技術方式は承認済みADRと開発計画・基本設計を優先する。
3. 現在の進行状況はDD-INDEXと各DDを優先する。
4. 過去の判断理由は構想・意思決定記録を参照する。

---

## 2. 製品ビジョン

### 2.1 ビジョン

日本語を中心とする業務入力において、Excel利用者が違和感なく操作でき、Webアプリ開発者が任意の業務システムへ安全に組み込めるスプレッドシートSDKを確立する。

### 2.2 ミッション

案件ごとに繰り返されてきた「Excel風入力画面」の個別実装を、再利用可能な基盤へ変える。

その基盤は、次を同時に満たす。

- 日本語IMEを壊さない
- 数万行を実用速度で扱える
- 範囲単位の高速な入力操作を提供する
- リアルタイム共同編集でも入力内容を黙って失わない
- React、Hono、特定DBへ中核依存しない
- 案件固有機能をコアへ混入させず、設定・Adapter・Pluginで拡張できる
- 長期的に自社で修正、検証、提供できる

### 2.3 製品の一文定義

> Nanairo Sheet（仮称）は、日本語業務入力、Canvas大規模描画、リアルタイム共同編集を中核とする、組み込み型TypeScriptスプレッドシートSDKである。

---

## 3. 解決する問題

### 3.1 エンドユーザーの問題

一般的なWebフォームは、Excelと比べて大量・連続入力に弱い。

- セル選択直後に日本語入力できない
- IME確定Enterがセル移動として誤処理される
- コピー＆ペーストや範囲入力が遅い
- キーボードだけで連続入力しにくい
- 大量行でスクロールや選択が重い
- 共同編集中に誰がどこを操作しているか分からない
- 同時更新や通信断で入力が失われる不安がある

### 3.2 アプリケーション開発者の問題

- 案件ごとにExcel風グリッドを再実装している
- IME、Canvas、コピー＆ペースト、Undo、共同編集の組み合わせが複雑である
- 一般的なデータグリッドでは業務入力の操作感が不足する
- 高機能商用製品へ依存すると、価格、ライセンス、提供元方針の影響を受ける
- 業務固有のセル型や入力補助を追加すると、既存ライブラリの内部制約にぶつかる
- 複数案件間で修正や知見を共有しにくい

### 3.3 組織の問題

- 類似機能の重複投資
- 品質基準のばらつき
- 特定案件だけに知識が閉じる
- 外部製品のロードマップへ依存する
- 長期保守に必要なテスト資産、互換性知識、障害解析手段が蓄積しない

---

## 4. 製品定義

本製品は、標準では独立した表計算アプリケーションやSaaSとして提供するものではない。業務Webアプリへ組み込むSDKを中心成果物とする。

製品は次の三群で構成する。

### 4.1 ブラウザーSDK

- ドキュメント・行列・セルの実行時モデル
- Canvasレンダラー
- 選択・キーボード操作
- 常駐textareaと日本語IME制御
- データ型と入力変換
- 数式エンジン
- Command、Event、Undo／Redo
- 共同編集クライアント
- Presence表示
- Web Componentまたは命令型API
- Reactラッパー

### 4.2 共同編集サーバーSDK

- Operation検証・全順序付与
- Room・Session管理
- Presence中継
- 再接続・catch-up
- Snapshot・Operationログ境界
- 永続化Adapter
- 認証・認可Adapter
- Hono HTTP／WebSocket Adapter

### 4.3 開発・運用ツール

- Playground
- React／Honoサンプル
- Testkit
- Operation fuzzer
- Event trace viewer
- Snapshot／Operation replay tool
- 性能ベンチマーク
- APIリファレンス
- 導入ガイド、レシピ、移行ガイド

---

## 5. 対象利用者

### 5.1 業務利用者

- Excelに慣れた日本語利用者
- 受発注、見積、予算、在庫、工程、実績、マスタ等を入力する担当者
- 複数人で同じ表を分担編集する利用者

### 5.2 社内アプリケーション開発者

- Hono、React、TypeScriptで業務Webアプリを構築する開発者
- Excel業務をWeb化するプロジェクト
- AIエージェントや業務ロジックから表を操作するアプリケーション開発者

### 5.3 顧客・協力会社の開発者

Goal 3以降では、次を対象候補とする。

- 顧客内製チーム
- 協力会社・SIer
- 自社業務製品へ表形式入力を組み込みたい開発チーム

### 5.4 運用・プラットフォーム担当者

- 共同編集サーバーの運用担当者
- 認証、監査、バックアップ、障害復旧、セキュリティを担当するチーム

---

## 6. 想定ユースケース

### 6.1 主要ユースケース

- 受発注明細の高速入力
- 見積・予算・実績管理
- 在庫・工程・生産計画
- 表形式マスタ編集
- 大量明細の確認・修正
- 複数担当者による分担入力
- Excel管理表の業務Webアプリ化
- AIエージェントによる入力補助、候補生成、セル更新
- 監査可能な共同編集

### 6.2 適合しにくいユースケース

- Excelファイルの完全互換ビューア／エディター
- 印刷レイアウト中心の帳票デザイナー
- ピボット・BI分析を主目的とする製品
- VBAやマクロ実行環境
- 長時間オフライン編集と自動マージ
- モバイル端末中心の編集
- 文字単位の共同文書編集

---

## 7. 顧客・利用プロジェクトが得る価値

### 7.1 利用者価値

- Excelに近い入力速度
- 日本語IMEでの違和感の低減
- 大量データでも滑らかな操作
- 共同編集者の位置と状態の可視化
- 競合時の入力保全

### 7.2 開発者価値

- 数週間から数か月かかる基盤機能を再利用できる
- 業務固有部分へ集中できる
- 型安全なCommand／Event APIを利用できる
- ReactやHonoへ薄いAdapterで統合できる
- Testkitと診断ツールを利用できる

### 7.3 組織価値

- 案件間での重複開発削減
- IME、Canvas、共同編集の専門知識を集約
- 品質基準とテスト資産の共有
- 外部スプレッドシート製品への中核依存削減
- 将来的な顧客向けSDK・技術製品化の選択肢

---

## 8. 競争上の差別化

本製品は「Excel機能数の多さ」で競争しない。次を差別化の中核とする。

1. **日本語IMEファースト**  
   セル選択直後、移動直後、変換確定Enter、リモート更新、スクロールを含む実IME品質を製品要件として扱う。

2. **業務入力ファースト**  
   汎用表計算よりも、文字列、数値、日付、プルダウン、コピー＆ペースト、入力補助、業務API連携を優先する。

3. **入力を失わない共同編集**  
   Presence、セル単位OCC、Conflict Queue、固定ID、Operationログにより、競合を黙って上書きしない。

4. **大規模データの操作性**  
   Canvas仮想描画と可視範囲処理を前提とし、数万行を標準ユースケースとする。

5. **組み込みやすさ**  
   特定UIフレームワーク、サーバーフレームワーク、DBへコアを依存させない。

6. **所有可能な中核技術**  
   日本語IME、描画、Operation、競合、数式の中核を自社で理解・修正・検証する。

7. **証拠に基づく品質**  
   DD、DA、Codexレビュー、実IMEトレース、収束試験、性能ベンチを成果物として残す。

---

## 9. 目指すもの／目指さないもの

### 9.1 目指すもの

- 複数プロジェクトで再利用できる社内SDK
- 案件固有コードをコアへ混入させない拡張モデル
- TypeScriptで自然に利用できる公開API
- React以外からも利用できる標準境界
- Hono以外のサーバーAdapterを将来追加できる構造
- 実IME、Canvas、共同編集を含む回帰試験資産
- 将来の外部提供に耐えられるパッケージ・互換性設計

### 9.2 明確に目指さないもの

- Excel完全互換
- Excel I/Oを製品価値の中心に置くこと
- Phase 0中の公開SDK完成
- 初期段階からの全ブラウザー・全OS保証
- 初期段階からの一般公開・OSS化
- 利用案件ごとの要望を無条件にコアへ追加すること
- 内部実装をそのまま公開APIにすること

---

## 10. 最終成果物の構成

### 10.1 内部パッケージ候補

内部パッケージは責務分離とテスト容易性のために使用する。すべてを外部利用者へ直接公開する必要はない。

| パッケージ候補 | 責務 | 公開安定性 |
|---|---|---|
| `@nanairo-sheet/types` | ブランド型、公開契約の基礎型 | 高候補 |
| `@nanairo-sheet/core` | Document、Axis、CellStore、Command、Operation | 内部中心 |
| `@nanairo-sheet/selection` | 選択、移動、範囲演算 | 内部中心 |
| `@nanairo-sheet/renderer-canvas` | Canvas描画、座標、ヒットテスト | 内部中心 |
| `@nanairo-sheet/editor-ime` | 常駐textarea、IME、keyboard、clipboard | 内部中心 |
| `@nanairo-sheet/formula` | parser、AST、依存関係、評価 | 上級利用候補 |
| `@nanairo-sheet/collaboration` | pending queue、protocol、presence、reconnect | 上級利用候補 |
| `@nanairo-sheet/server` | sequencer、room、validator、snapshot | 上級利用候補 |
| `@nanairo-sheet/testkit` | fixture、fuzzer、trace、SDKテスト支援 | 公開候補 |

### 10.2 利用者向け統合パッケージ候補

通常の利用者には、少数のFacadeパッケージを提供する。

| パッケージ候補 | 用途 |
|---|---|
| `@nanairo-sheet/grid` | 命令型APIを提供するブラウザーSDK本体 |
| `@nanairo-sheet/element` | Custom Elementラッパー |
| `@nanairo-sheet/react` | Reactラッパー |
| `@nanairo-sheet/server-hono` | Hono用HTTP／WebSocket Adapter |

### 10.3 公開範囲の原則

- Facadeパッケージを安定APIとする。
- 内部パッケージは必要な場合だけ公開し、互換性保証範囲を明示する。
- 直接公開する型は、内部CellStore、Canvasキャッシュ、pending実装等を含めない。
- パッケージ数は内部都合で増やしても、利用者のインストール手順は増やしすぎない。

---

## 11. 利用形態

### 11.1 単独グリッド

共同編集を使わず、アプリケーション独自のREST APIや保存処理へ接続する。

```ts
import { NanairoSheet } from '@nanairo-sheet/grid'

const sheet = new NanairoSheet(container, {
  locale: 'ja-JP',
  columns,
  capabilities: {
    collaboration: false,
    formulas: true,
  },
})

sheet.on('cell-commit', handleCellCommit)
sheet.setDocument(document)
```

### 11.2 React組み込み

```tsx
import { NanairoSheetView } from '@nanairo-sheet/react'

export function OrderEntryPage() {
  return (
    <NanairoSheetView
      documentId="order-2026-001"
      columns={columns}
      onCellCommit={handleCellCommit}
    />
  )
}
```

Reactラッパーはライフサイクルとprops／event変換を担当し、グリッド内部状態をReact stateへ複製しない。

### 11.3 独自バックエンド利用

利用者は`@nanairo-sheet/grid`だけを使い、保存、認証、共同編集を独自実装できる。共同編集プロトコルを利用する場合は、Transport／Repository Adapter契約を実装する。

### 11.4 Hono共同編集サーバー利用

```ts
import { Hono } from 'hono'
import { createNanairoSheetRoutes } from '@nanairo-sheet/server-hono'

const app = new Hono()

app.route('/api/sheets', createNanairoSheetRoutes({
  authenticate,
  authorize,
  operationStore,
  snapshotStore,
}))
```

Honoは推奨Adapterであり、ブラウザーSDKやserverの必須依存にはしない。

---

## 12. 公開APIの基本原則

### 12.1 公開する契約

- `Options`
- `Capabilities`
- `Command`
- `Event`
- `ErrorCode`
- `Plugin`
- `Adapter`
- Serialized Document／Operation／Protocolのバージョン付き契約

### 12.2 公開しない内部

- 具体的なCellStore実装
- Axisのキャッシュ構造
- Canvasタイル・文字測定キャッシュ
- textarea内部状態
- rollback／replay内部アルゴリズム
- Room内部Map
- 未承認の実験API

### 12.3 API原則

1. 内部オブジェクトへの可変参照を返さない。
2. 状態変更はCommandまたは明示API経由とする。
3. 重要な状態変化はEventとして通知する。
4. 非同期操作はPromiseまたは結果イベントを明示する。
5. エラーは安定したコードと診断情報を持つ。
6. 機能有無はCapabilitiesで問い合わせ可能にする。
7. 実験APIと安定APIを区別する。
8. 破壊的変更は移行ガイドと非推奨期間を伴う。
9. Document schema、Protocol、Formula engineのバージョンをnpmバージョンと分離する。
10. 公開API例は実テストとして継続検証する。

### 12.4 API安定性レベル

- **Stable**：SemVer互換対象
- **Experimental**：変更可能。明示的opt-in
- **Internal**：利用禁止。外部exportしない

---

## 13. Plugin／Extension方針

案件固有要件をコアへ直接追加せず、拡張点として提供する。

### 13.1 Plugin候補

- Cell type plugin
- Value parser／formatter
- Validator
- Canvas renderer／overlay
- Cell editor
- Command
- Context action／menu item
- Formula function
- Clipboard transformer
- Data source Adapter
- Collaboration Transport
- Persistence Adapter
- Telemetry Adapter

### 13.2 Plugin設計原則

- Pluginは明示的に登録する。
- Capabilityと必要バージョンを宣言する。
- Document Stateを直接書き換えず、Command／Operationを使用する。
- 描画Pluginはフレーム予算を破らない契約を持つ。
- Plugin障害を本体障害と区別できる診断情報を持つ。
- Plugin API v1は、複数実案件の共通要求が確認されるまで確定しない。
- Pluginコードは信頼済みコードとして実行し、初期段階ではサンドボックスを提供しない。

---

## 14. データソース・永続化の抽象化

製品本体を特定DBやAPI設計へ固定しない。

### 14.1 Adapter候補

```ts
interface DocumentRepository {
  load(documentId: string): Promise<DocumentSnapshot>
  saveSnapshot(snapshot: DocumentSnapshot): Promise<void>
}

interface OperationStore {
  append(operation: ServerOperationEnvelope): Promise<void>
  listAfter(documentId: string, revision: number): Promise<ServerOperationEnvelope[]>
}

interface CollaborationTransport {
  connect(options: ConnectOptions): Promise<CollaborationConnection>
}
```

### 14.2 方針

- PostgreSQLは推奨実装候補であり、コア契約ではない。
- Honoは推奨Adapterであり、server契約ではない。
- Snapshot、Operation、認証、認可、監査、Telemetryを分離する。
- 単独グリッド利用では共同編集サーバーを不要にする。
- 利用者独自のデータモデルを、内部CellStoreへ直接結合しない。

---

## 15. 製品成熟段階

開発Phaseと製品成熟段階は別物として管理する。技術機能が実装されても、SDKとして提供可能とは限らない。

### Stage 0：技術PoC

**目的**：IME、Canvas、共同編集、データ表現、数式の成立性を確認する。

**成果物**：PoCコード、イベントトレース、性能レポート、収束試験、ADRドラフト。

**移行条件**：Phase 0 Go／条件付きGo。

### Stage 1：社内SDK Alpha（Goal 1）

**目的**：別の社内プロジェクトからnpmパッケージとして利用可能にする。

**移行条件**：

- PoCコードが`packages/*`へ抽出されている
- 利用者向けFacadeパッケージがある
- 1つの社内アプリが直接内部importなしで統合できる
- Quick Start、型定義、最小サンプルがある
- APIは`0.x`で変更可能だが、変更履歴を残す

### Stage 2：社内SDK Beta

**目的**：複数案件で再利用し、公開APIと拡張点を安定させる。

**移行条件**：

- 2つ以上の異なる社内アプリで利用
- 内部パッケージの直接importがない
- API差分監視と移行ガイドがある
- 主要ブラウザー／IME回帰が継続実行される
- Testkit、診断ログ、サンプルが整備される
- 主要Plugin／Adapter境界が実案件で検証される

### Stage 3：実案件採用（Goal 2）

**目的**：3件以上の実案件で、コアを案件ごとにforkせず利用する。

**移行条件**：

- 3件以上で本番または限定本番利用
- 案件固有要件の大半が設定、Command、Event、Adapter、Pluginで実現
- 重大なコアforkがない
- SLO、障害対応、アップグレード手順が運用できる
- 利用者フィードバックに基づくAPI見直しが完了する

### Stage 4：顧客・協力会社向けSDK（Goal 3）

**目的**：社外開発者へ提供可能にする。

**移行条件**：

- 配布契約、ライセンス、サポート範囲が確定
- 外部向けドキュメントとサンプルがある
- セキュリティ窓口と脆弱性対応手順がある
- SemVer、非推奨、互換性ポリシーが運用される
- Package registryとアクセス管理が整備される
- 外部開発者だけで導入試験を完了できる

### Stage 5：一般公開／商用ライブラリ（Goal 4）

**目的**：公開npm、OSS、商用SDK等の形で広く提供する。

**移行条件**：

- OSS／商用／デュアルライセンスの方針確定
- 商標・製品名・パッケージ名の確認
- 公開ロードマップ、Issue運営、サポートモデルの確立
- 安定版`1.0.0`の公開契約
- 長期保守に必要な体制と予算

---

## 16. 成功指標

### 16.1 社内SDKとしての成功指標候補

- 別プロジェクトで、コアを直接変更せず初期導入できる
- 3件以上の案件でコアforkが発生しない
- 案件固有要件の80%以上を設定・Adapter・Pluginで処理できる
- 新規プロジェクトの初回グリッド表示まで30分以内を目標とする
- 基本業務入力画面の初期統合を2開発日以内に行えることを目標とする
- minor version更新を1開発日以内で適用できることを目標とする
- 実IME、Canvas、Operation収束の重大回帰がリリース前に検出される
- 同種機能の案件別再実装工数が減少する

数値はStage 1で計測を開始し、Stage 2で正式KPIとする。

### 16.2 外部SDKとしての成功指標候補

- 外部開発者がサポートなしでQuick Startを完了できる
- 公開API利用例が自動テストされている
- 互換性ポリシーに反する破壊的変更がない
- セキュリティ問い合わせと重大障害へ定めた時間内に対応できる
- ドキュメント、サンプル、移行ガイドがリリースと同期する
- サポート対象環境の合格状況を公開できる

---

## 17. Developer Experience要件

SDKの価値は内部実装だけでなく、導入・理解・診断の容易さで決まる。

最低限必要な成果物は次のとおりである。

- 5分で概要を理解できるREADME
- 30分以内を目標とするQuick Start
- Vanilla／Web Component例
- React例
- Hono共同編集例
- 独自バックエンドAdapter例
- TypeScript APIリファレンス
- 機能別レシピ
- エラーコード一覧
- IME・ブラウザー互換表
- 性能チューニングガイド
- Testkit
- Operation／Snapshot検査ツール
- Event trace viewer
- Migration guide
- Changelog
- サポート・既知制約一覧

### 17.1 診断性

- Grid、Editor、Collaboration、Formulaの状態を診断できるdebug mode
- 機密セル値を出さない構造化ログ
- Event traceのエクスポート
- Operation ID、revision、client sessionの追跡
- 性能計測フック

---

## 18. SemVerと後方互換性

### 18.1 初期推奨

- Stage 1までは`0.x`を使用する。
- Stage 2ではFacadeパッケージを互換性管理対象にする。
- 初期は公開パッケージをlockstep versioningとし、組み合わせ爆発を避ける。
- 内部パッケージは同一monorepo内で同期更新する。
- 一般公開前に独立versioningの必要性を再評価する。

### 18.2 別管理するバージョン

- npm package version
- Document schema version
- WebSocket protocol version
- Formula engine version
- Snapshot format version

### 18.3 互換性原則

- Stable APIの削除はmajor versionで行う。
- 非推奨APIには代替手段と移行期間を示す。
- Protocol／Schema変更にはmigrationまたは明示的拒否を用意する。
- 挙動変更も変更履歴へ記載する。
- 公開型スナップショット、API example test、protocol contract testをCIに含める。

具体的な非推奨期間はStage 2までに決定する。

---

## 19. リリースチャネル

候補は次のとおりである。

- `canary`：main相当。検証用
- `beta`：社内導入候補
- `latest`：安定版
- `lts`：顧客向け提供後に検討

Stage 1ではprivate registryまたはGitHub Packages等を使用する候補とし、正式な配布先は別途決定する。

各リリースは次を伴う。

- Changelog
- Migration note
- Compatibility matrix
- Bundle／package size
- Test result
- 既知制約
- Protocol／Schema version

---

## 20. サポート対象環境

### 20.1 Tierの考え方

- **Tier 1**：リリースゲートとして実機試験する
- **Tier 2**：主要機能を検証するが、同日修正を保証しない
- **Experimental**：利用可能性はあるが保証しない

### 20.2 初期候補

- Tier 1：Windows 11、Chrome、Edge、Microsoft IME、Google日本語入力
- Tier 2候補：macOS Chrome／Safari、日本語入力、Windows Firefox
- モバイル／タッチ：初期対象外

最低バージョンはリリースごとのCompatibility Matrixで管理し、本書へ固定しない。

---

## 21. セキュリティと脆弱性対応

- 数式で`eval`や任意コード実行を使用しない
- Operation、Snapshot、WebSocket messageを入力検証する
- payload size、セル数、文字列長、式長、AST深さへ上限を設ける
- WebSocket upgrade時に認証、権限、Originを検査する
- 操作ごとにdocument bindingと権限を検証する
- 機密セル値を通常ログへ出さない
- OperationログとSnapshotの暗号化・保持方針を利用案件で定義する
- 依存ライセンスと脆弱性をCIで検査する
- 顧客向けSDK前に脆弱性報告窓口と対応手順を定める
- セキュリティ修正のbackport方針をStage 4までに決める

---

## 22. ライセンス・提供形態の選択肢

現時点で一般公開やOSS化を確定しない。Goal 2達成後に、実績、差別化、サポートコスト、営業戦略から判断する。

| 選択肢 | 長所 | 短所 | 適する段階 |
|---|---|---|---|
| 社内非公開SDK | 制御しやすい。差別化を保持 | 社外採用・コミュニティ効果がない | Stage 1〜3 |
| 顧客向け商用SDK | 収益化、契約・サポートを定義可能 | 営業、契約、サポート負担 | Stage 4 |
| OSS core＋商用server／support | 採用促進と差別化の両立候補 | 境界設計、コミュニティ運営が必要 | Stage 4〜5 |
| 全面OSS | 採用・貢献を得やすい | 差別化、収益、運営負担の課題 | Stage 5 |
| デュアルライセンス | OSS採用と商用利用の選択肢 | ライセンス管理が複雑 | Stage 5 |

初期推奨は社内非公開SDKである。ただし、外部提供へ移行できるよう著作権、依存ライセンス、第三者コード、商標、Contributor管理を整理しておく。

---

## 23. 製品運営に必要な体制

最低限、次の責務が必要である。兼務は可能だが、責任者を曖昧にしない。

- Product Owner：対象利用者、優先順位、非目標、採用判断
- Product／Software Architect：パッケージ境界、公開API、互換性
- Grid／IME Maintainer：入力品質、ブラウザー互換
- Collaboration／Server Maintainer：protocol、運用、復旧
- QA／Compatibility Owner：実IME、E2E、性能、収束試験
- Developer Experience Owner：ドキュメント、サンプル、Testkit
- Release／Security Owner：SemVer、配布、脆弱性、依存管理
- Support Triage：利用案件からの問い合わせと再現情報の整理

Stage 1では兼務可能だが、Stage 4以降はサポートとリリース責務を開発者個人へ依存させない。

---

## 24. 技術負債と再検討条件

次の場合は、製品戦略または基本アーキテクチャを再検討する。

- 3案件中2件以上でコアforkが必要になる
- Plugin／Adapterで実現できない案件固有変更が増える
- パッケージ数が利用者の導入障壁になる
- Canvas方式がアクセシビリティ要件を満たせない
- Tier 1環境でIME回帰を安定防止できない
- 共同編集サーバーのsingle-owner構成が必要スケールを満たさない
- rollback／replayが実利用で恒常的な入力遅延を生む
- protocol／schema更新が複数利用案件の更新を阻害する
- ゼロランタイム依存方針が品質または開発速度を著しく損なう
- 外部提供のサポートコストが製品価値を上回る
- 既存商用製品の利用が総保有コストで明確に優位になる

再検討は失敗ではなく、計測と利用実績に基づく製品判断としてADRまたは製品憲章改定で行う。

---

## 25. 現在のPhase 0との関係

Phase 0の目的は中核技術の成立性を証明することであり、SDK製品化を完成させることではない。

Phase 0で確認するもの：

- 日本語IME
- Canvas大規模描画
- Operation収束
- 入力競合の保全
- データ表現
- 簡易数式
- 最小統合シナリオ

Phase 0で完成させないもの：

- 安定した外部公開API
- 一般利用者向けパッケージ構成の最終確定
- Plugin API v1
- ドキュメントサイト
- 商用ライセンス
- 外部サポート体制
- npm一般公開

ただし、Phase 0でも次の原則は守る。

- `apps/*`間でコードをコピーしない
- 再利用ロジックは`packages/*`へ抽出可能にする
- アプリ間の内部ファイル直接importを恒久化しない
- コアへReact、Hono、案件固有ロジックを持ち込まない
- 実装と試験証跡をPhase 1へ引き継ぐ

---

## 26. Phase 1以降で必要な製品化作業

Phase 0 Go後、ユーザー操作単位の縦切りDDに加えて、各DDで製品化観点を確認する。

### 26.1 最優先

- PoCコードを製品パッケージへ抽出
- `@nanairo-sheet/grid`相当のFacade API
- `NanairoSheet`候補クラスのライフサイクル
- BrowserとNodeのTransport Adapter分離
- package boundary lint
- ESM build、型定義、exports、tree shaking
- API型スナップショット
- Reactラッパー
- Hono Adapter
- Quick Startとサンプル
- Testkit

### 26.2 社内Alphaまで

- private registry配布
- release automation
- canary／betaチャネル
- changelog
- compatibility matrix
- error codeとdebug mode
- 1つ目の社内アプリ統合

### 26.3 社内Betaまで

- 複数案件でのAdapter／Plugin検証
- migration guide
- deprecation policy
- bundle size budget
- docs site
- 公開API差分監視
- 利用状況と統合工数の計測

### 26.4 顧客向けSDKまで

- 外部利用契約
- ライセンス
- security policy
- vulnerability reporting
- support policy
- external registry
- 外部開発者によるclean-room導入試験

---

## 27. 未決定事項と決定期限

| ID | 未決定事項 | 初期候補 | 決定期限 |
|---|---|---|---|
| P-01 | 正式製品名 | Nanairo Sheet（仮称） | Stage 1リリース前 |
| P-02 | 公開クラス名 | `NanairoSheet` | Phase 1最初のFacade DD |
| P-03 | 標準UI境界 | 命令型API＋Custom Element | Stage 1 Alpha前 |
| P-04 | 利用者向けパッケージ構成 | grid／element／react／server-hono | Phase 1パッケージ設計DD |
| P-05 | private package registry | GitHub Packages等 | Stage 1リリース前 |
| P-06 | versioning方式 | Facade lockstep | Stage 2前 |
| P-07 | Plugin API v1範囲 | Cell type／Adapter中心 | 2案件目開始前 |
| P-08 | 支持ブラウザーTier | Win Chrome／Edge Tier 1 | Stage 1 Alpha前 |
| P-09 | ライセンス・外部提供形態 | 社内非公開から開始 | Goal 2達成後 |
| P-10 | 非推奨期間 | 未定 | Stage 2前 |
| P-11 | Hono以外のserver adapter | 必要性発生時 | Goal 3検討時 |
| P-12 | Telemetry標準 | opt-in Adapter候補 | Stage 2前 |
| P-13 | サポートSLA | 未定 | Stage 4前 |
| P-14 | Repository名称変更 | `spreadjs`からの変更候補 | Stage 1 Alpha前 |
| P-15 | OSS化判断 | 未定 | Goal 2達成後 |

---

## 28. 既存文書との関係

| 文書 | 担当する正典領域 | 本書との関係 |
|---|---|---|
| 構想・意思決定記録 | 背景、問題意識、判断理由、壁打ち履歴 | 本書の根拠。歴史的記録として保持 |
| 開発計画・基本設計 | 技術アーキテクチャ、仕様境界、性能、リスク、開発Phase | 本書の製品方針を技術へ展開 |
| DDロードマップ | DDの順序、依存、Go／No-Go、作業管理 | 本書と技術計画を実行単位へ展開 |
| ADR | 重要な技術判断 | 本書の制約内で方式を決定 |
| 仕様書 | 操作、Protocol、Formula、IME等の正式挙動 | 実装と受入の正典 |
| 公開API仕様 | 利用者向け契約 | Stage 1以降に整備 |
| リリース方針 | version、channel、互換性、support | Stage 1以降に整備 |
| 利用者向けドキュメント | 導入、レシピ、移行、診断 | SDK成果物 |

---

## 29. 製品憲章に反する変更を防ぐ判断原則

新機能、依存追加、API変更、案件固有要望を評価するときは、次を順に確認する。

1. 日本語業務入力の価値を高めるか。
2. 複数プロジェクトで再利用できるか。
3. コア変更ではなく設定・Command・Event・Adapter・Pluginで実現できないか。
4. 公開APIへ内部実装を漏らさないか。
5. React、Hono、特定DBへの中核依存を増やさないか。
6. Tier 1のIME・Canvas・共同編集品質を悪化させないか。
7. 互換性と移行コストを説明できるか。
8. テスト・証跡・診断方法を追加できるか。
9. Excel完全互換という無制限な期待を作らないか。
10. Phase 0、社内SDK、外部SDKのどの成熟段階の要求か明確か。
11. 1案件だけの特殊要件なら、コアへ入れず拡張点で扱えるか。
12. 採用しない場合の代替手段と影響を説明できるか。

上記を満たさない変更は、製品憲章改定または明示的な例外判断を必要とする。

---

## 30. 暫定ゴール

当面の正式な製品ゴール候補は次とする。

> ナナイロ社内の複数Webアプリからnpmパッケージとして利用でき、案件固有コードを本体へ混入させず、設定、Command、Event、Adapter、Pluginによって拡張できる、日本語業務入力に強いスプレッドシートSDKを確立する。

段階的には次を目指す。

- Goal 1：社内の別プロジェクトから利用可能
- Goal 2：3件以上の実案件でコア変更なしに利用可能
- Goal 3：顧客・協力会社へSDK提供可能
- Goal 4：一般公開または商用ライブラリ化可能

Goal 3およびGoal 4への移行は自動ではない。Goal 2までの実績、サポートコスト、営業価値、差別化、ライセンス、体制を確認して判断する。

---

## 31. 承認と変更管理

本書の承認後、次の変更は製品判断として記録する。

- 製品定義または対象利用者の変更
- Goalの追加・削除
- 一般公開、OSS、商用化の決定
- 公開パッケージ構成の大幅変更
- React／Hono非依存等の中核原則の変更
- 外部スプレッドシート製品への中核依存
- サポート対象環境の大幅縮小
- 製品名・npm scope・公開クラス名の確定

技術実装の変更はADR、挙動変更は仕様書、作業順序はDDロードマップで管理する。
