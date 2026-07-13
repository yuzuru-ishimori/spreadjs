# DD Risk Class ヘッダ雛形＋製品化6観点（Delivery Phase A 用）

> **置き場所の理由**: `doc/templates/` は `scripts/dd-update.sh`（dd-know-how からの Pull 更新）の**上書き対象**のため、
> DD 差分テンプレは templates を直接改修せず、dd-update 非管理の本ファイル（`doc/plan/`）へ置く
> （DD-011 要確認①確定・2026-07-13。DD-008 要確認(b) の先例と整合）。
> DD-012 以降の各DDは、ここから Risk Class ヘッダをコピーし、製品化6観点を確認する。
>
> 正本: Risk Class の定義・密度レバーは `doc/plan/phase1-dd-roadmap.md` §2.1〜§2.4。製品化6観点は
> `doc/plan/phase0-dd-roadmap.md`（DD-008 追加・製品憲章 §26/§29）。本ファイルは**運用コピー元**であり定義の二重管理はしない。

## 1. Risk Class ヘッダ雛形（各DDの冒頭・ステータス表の直後に置く）

DD 本文の先頭（タイトル＋ステータス表の直後）に、次の fenced block をコピーして埋める（roadmap §2.1）。

```text
Risk Class: A / B / C
Risk Triggers: （下記トリガーのどれに該当するか。該当なしなら「なし」）
Human Spec Gate: required / skipped（承認済みバックログ範囲なら B/C は skipped）
Codex: xhigh / high / medium / none
Manual Gate: （実機/headed が必要な変更トリガーの有無。未解除CGは例外＝§2.4）
External Review: （原則 Phase境界・API確定・ADR転換・Go/No-Go のみ）
Evidence Level: full / standard / minimal
```

### Risk Class 判定（roadmap §2.1・§2.4）

- **A（高リスク＝高密度）** いずれか該当:
  IME状態機械/textarea/focus/selection を変更／sequencer/protocol/rollback-replay/OCC を変更／
  永続化/snapshot/migration を変更／データ消失やサイレント上書きの可能性／Stable な公開APIを変更・外部依存追加／
  受け入れ基準・操作仕様を変更・自動試験で判定不能な受け入れ条件。
  - Codex は原則 **xhigh 1回**。ただし「Aラベル」だけで自動決定せず、**状態機械・protocol・永続化アルゴリズムを
    実質変更した場合に限定**（§2.2 L3）。証跡は圧縮しても fault matrix・seed/再現コマンド・event trace・実機環境・
    durability/ACK条件・既知の未保証境界を省略しない（§2.2 L5）。
- **B（通常）**: 承認済みバックログ範囲内なら人間の事前仕様確認なしで開始してよい。**DA＋Codex(high/medium 1回)**。
- **C（機械的・低リスク）**: 自動開始・まとめてレビュー。UI/CSS/メニュー/ラベル/サンプル更新など。

### B/C → A 昇格ルール（§2.4・実装中に判明したら停止して昇格）

受け入れ基準変更／データ形式・protocol変更／永続化境界へ波及／利用者入力を失う可能性／
**Internal予定APIをconsumerへ確定露出（Facade skeleton が stub を超えて実 API を固定し始めた場合を含む）**／
1DDで複数の状態所有者を変更 — いずれか判明したら作業を停止し A へ昇格してユーザーへ提示する。

### 密度計測（各DDで記録・専用DD不要・§2.4）

人間確認時間・Codex effort/回数・ゲート待ち・review finding数・merge後手戻り・DD開始〜完了・実行した manual gate。

## 2. 製品化6観点チェック（Phase 1 以降の各DDで確認・phase0-roadmap 由来）

DD の設計・レビュー時に次の6観点を確認する（製品憲章 §26・§29 整合。Phase 0 の残り PoC DD には遡及しない）。

1. **公開APIへの影響**（Command／Event／Options／Capabilities／Adapter／Plugin 契約に変更・追加があるか。憲章 §12）
2. **内部パッケージとFacadeパッケージの境界**（`@nanairo-sheet/{core,selection,…}` 等の内部を、利用者向け Facade
   （`grid`／`react`／`server-hono` 等）越しに漏らしていないか。憲章 §10。機械ガード＝boundary lint R1〜R7・`npm run lint:boundary`）
3. **他プロジェクトからの再利用性**（特定案件・特定UI/DBへ結合せず、複数プロジェクトで再利用できるか。憲章 §16.1）
4. **Adapter・Pluginでの拡張性**（案件固有要件をコアへ混入させず、設定・Command・Event・Adapter・Plugin で実現できるか。憲章 §13・§29-3）
5. **Developer Experience成果物**（Quick Start／サンプル／型定義／エラーコード／Testkit 等、導入・診断のための成果物を同時に更新したか。憲章 §17）
6. **API互換性への影響**（Stable/Experimental/Internal 区分・破壊的変更・移行ガイド・schema/protocol version への影響。憲章 §12.4・§18）

## 3. 参照

- 密度レジーム・Risk Class 定義・昇格ルール: `doc/plan/phase1-dd-roadmap.md` §2
- 製品化6観点の出典: `doc/plan/phase0-dd-roadmap.md`（DD-008 追加）
- package 境界（6観点-2 の機械ガード仕様）: `doc/archived/DD/DD-009/package-boundary.md` §4／実装 `scripts/boundary/`
- 常設不変条件スイート: `tests/invariants/README.md`（§2.3）
