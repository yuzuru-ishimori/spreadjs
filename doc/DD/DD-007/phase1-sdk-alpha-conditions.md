# DD-007 Phase 1 SDK Alpha 完了条件（案）

> Phase 1（Go後）の**最初の縦切りDD「日本語でセルを連続入力し、確定値が共同編集で保存される」に付す SDK Alpha 完了条件の案**。DD-005待ち時間に外部レビュー助言を反映して先行作成。DD-007 の Go 判定後、Phase 3（`phase1-backlog.md` 確定）でこの案を正式な完了条件へ昇格する。**現時点は案であり確定ではない**。
>
> 根拠: 製品憲章 §15 Stage 1（社内SDK Alpha 移行条件）・§25（Phase 0でも守る原則）・§26.1（Phase 1最優先）・§12（公開API原則）・§30（Goal 1）。正典は `doc/product/nanairo_sheet_product_charter_v1.md` と `doc/DD/DD-007_Phase0GoNoGo判定.md`。

## 1. 位置づけ

- **Go は技術成立性判断であって本番完成ではない**: DD-007 における Go とは「本番利用可能」ではなく「Phase 1 の製品化開発へ投資を継続してよいという技術成立性判断」である（DD-007本体「Goの定義」）。PoC合格と製品完成を混同しない。
- **Phase 1 は「単なる機能開発」ではない**: Phase 1 は、機能を作るだけでなく **社内の別プロジェクトから npm パッケージとして利用できる SDK Alpha を作る段階**である（製品憲章 §15 Stage 1「社内SDK Alpha」／§30 Goal 1「社内の別プロジェクトから利用可能」）。したがって最初の縦切りDDは、機能の実現に加えて下記 §2 の SDK 化条件を満たして初めて「完了」とする。
- **本条件案の対象DD**: Phase 1 最初の縦切りDD＝「日本語でセルを連続入力し、確定値が共同編集で保存される」（DD-007 で確定済み）。2件目以降のDDは `phase1-backlog.md` で個別に条件を定める。

## 2. 最初の縦切りDDに、機能に加えて含める完了条件（案）

> 外部レビュー助言のリストを、製品憲章の各条項に対応づけた。**「機能が動く」だけでなく「別プロジェクトから公開境界越しに使える」ことを完了条件にする**のが趣旨（憲章 §15 Stage 1／§26.1 最優先）。検証方法は案であり、Phase 3 で確定する。

| # | 完了条件（案） | 対応する憲章条項 | 検証方法（案） |
|---|---|---|---|
| 1 | `apps/` の内部ソースを直接 import しない | §25（`apps/*` 間の内部ファイル直接importを恒久化しない） | package boundary lint（§26.1） |
| 2 | 利用側は公開 package export だけを使う | §12.1（公開する契約: Options/Command/Event/…）／§10.3（Facadeを安定APIとする） | consumer fixture が公開 export のみを import（§3） |
| 3 | 別の consumer アプリからインストール・起動できる | §15 Stage 1（1つの社内アプリが直接内部importなしで統合できる）／§30 Goal 1 | consumer fixture のインストール→起動が通る（§3） |
| 4 | ビルド済み成果物（ESM build・型定義・exports）から利用できる | §26.1（ESM build、型定義、exports、tree shaking） | ビルド出力を consumer から import・型解決できる |
| 5 | Command / Event / Options で操作できる | §12.1（公開する契約） | 公開 Command/Event/Options 経由の操作テスト |
| 6 | 内部 CellStore や Canvas 実装を利用側へ露出しない | §12.2（公開しない内部: 具体的なCellStore実装・Canvasタイル等） | 公開型スナップショットに内部型が出ないことを検査 |
| 7 | 最小導入手順（Quick Start）が文書化される | §15 Stage 1（Quick Start）／§17（Quick Start 30分目標・最小サンプル） | Quick Start 手順どおりに consumer が起動できる |
| 8 | React なしでも利用可能 | §9.1（React以外からも利用できる標準境界）／§11.1（単独グリッド） | Vanilla consumer fixture が React 非依存で起動 |
| 9 | React ラッパーは薄い Adapter として検証する | §11.2（Reactラッパーはprops/event変換のみ・内部状態を複製しない） | React consumer fixture でラッパー経由の操作を検証 |

## 3. consumer fixture 要件（案）

> **monorepo 内部では動くが外部で動かない**問題（内部相対 import に暗黙依存してしまう退行）を防ぐため、**公開 package export だけを import して起動する consumer fixture** を用意し、その起動を Phase 1 完了条件にする。

- 次のいずれかを用意する（Phase 3 で確定）:
  - `tests/consumer-vanilla/` と `tests/consumer-react/`、または
  - `apps/demo-sdk-consumer/`
- fixture は **公開 package export だけ**（例: `@nanairo-sheet/grid`・`@nanairo-sheet/react`）を import して起動できることを Phase 1 完了条件とする。
- **内部パッケージの直接 import が無いことを検査**する（package boundary lint。憲章 §26.1）。

ディレクトリ構成案:

```text
tests/
  consumer-vanilla/          # 公開 export だけを使う最小 Vanilla consumer
    package.json             #   dependencies は公開 Facade のみ（例: @nanairo-sheet/grid）
    index.html
    src/
      main.ts                #   import { NanairoSheet } from '@nanairo-sheet/grid'
  consumer-react/            # React ラッパー経由の最小 consumer
    package.json             #   dependencies に @nanairo-sheet/react
    src/
      App.tsx                #   import { NanairoSheetView } from '@nanairo-sheet/react'

# または（monorepo 内アプリとして 1 本にまとめる案）
apps/
  demo-sdk-consumer/         # 内部ソース直接 import を禁止し、公開 export のみ使用
    package.json             #   dependencies は公開 Facade のみ
    src/
      main.ts
```

> 検査観点（案）: consumer fixture の import 文が `@nanairo-sheet/*` の公開 export に限られること／`apps/*` や内部パッケージの相対パス・`src/` 直接参照が無いこと／ビルド済み成果物（ESM・型定義）から解決できること。

## 4. Go判定と Phase 1開始条件の分離（外部レビュー助言）

> 外部レビュー助言に基づき、**「技術Go」と「Phase 1開始時の前提条件」を別物として DD-007 が別々に記録する**。両者を混ぜると、Go の勢いで前提条件（採用方式・残存リスク）が未記録のまま Phase 1 に流れ込む。

- **技術Go（DD-007 §7・決定事項に記録）**: 製品化開発を継続してよいか、という成立性判断のみ。
- **Phase 1開始時の前提条件（DD-007 が別途記録・値は Go 後に記入）**: 下記は箇条書きの空欄リスト。Go 判定後に DD-007 が埋める。

  - 採用 CellStore: （DD-007 が Go 後に記入）
  - 対応ブラウザー（Tier 1 の確定範囲）: （DD-007 が Go 後に記入）
  - 残存する IME リスク: （DD-007 が Go 後に記入）
  - 共同編集の既知制約（引き継ぐもの）: （DD-007 が Go 後に記入）
  - SDK Alpha の公開境界（Facade/公開 export の範囲）: （DD-007 が Go 後に記入）
  - Accepted 化する ADR（ADR-005/008/011/022 の帰結）: （DD-007 が Go 後に記入）
  - Phase 1 で最初に解消する技術負債: （DD-007 が Go 後に記入。例: `go-nogo-package.md` §5 の既知制約）

> これらの前提条件は「機能の完了条件」ではなく「Phase 1 を始めてよい前提」である。§2 の完了条件（DDのゴール）とは別レイヤーとして扱う。

## 5. 未確定事項へのポインタ（製品憲章 §27）

> 本条件案に関わる憲章 §27 の未決定事項。決定は各期限で行う（本ファイルでは確定しない）。

- **P-02 公開クラス名**（初期候補 `NanairoSheet`・決定期限=**Phase 1 最初の Facade DD**）: §2 条件5・§3 fixture の `NanairoSheet` 参照に直結。
- **P-03 標準UI境界**（命令型API＋Custom Element・決定期限=Stage 1 Alpha前）: §2 条件8（React なしでの利用境界）に関わる。
- **P-04 利用者向けパッケージ構成**（grid／element／react／server-hono・決定期限=Phase 1 パッケージ設計DD）: §2 条件2・§3 の公開 export 範囲に直結。
- **P-08 支持ブラウザーTier**（Win Chrome／Edge Tier 1・決定期限=Stage 1 Alpha前）: §4 前提条件「対応ブラウザー」に対応。

---

> 本ファイルは**案**である。DD-007 の Go 判定後、Phase 3（`phase1-backlog.md` 確定）で §2 の完了条件・§3 の fixture 要件を正式な完了条件へ昇格し、最初の縦切りDDのテンプレートへ反映する。
