# Phase 0 DDロードマップ

> 正典 `nanairo_realtime_spreadsheet_development_plan_v1.md`（以下「計画書」）の Phase 0（§18 PoC計画・§26 直近の実行計画）を、DD運用（1 DD = 1レビューサイクル）へ写像したもの。
> DD番号は起票時に採番されるため仮番号（①〜⑥）で管理し、起票したら「実DD」列へ実番号を記入する。

## DD化の原則

1. **1 DD = 1レビューサイクル**（`doc/templates/guides.md` §6）。PoCは「計測結果・イベントトレースを見てユーザーが合格/不合格を判断できる」単位で1本とする。
2. **受け入れ基準は計画書 §18 の合格条件を流用する**（既に「操作 → 期待結果」の形で検証可能に書かれている）。
3. **PoC DDの成果物にADRドラフトを含める**。ADRは `doc/adr/` に置き、追加時は DOC-MAP を更新する（計画書は `docs/adr/` 表記だが、本リポジトリのドキュメントは `doc/` 配下に統一する）。
4. **Phase 1以降のDDはPhase 0のGo/No-Go判定後に起票する**。計画書 §19 のとおり、正式なMVPバックログと性能SLOはPhase 0の結果で確定するため、先回りして起票しない。
5. 実行は dd-auto（起票=Fable →〔仕様確認〕→ 実装=Opus → Codexレビュー）を **1 DDにつき1回、原則直列**で回す。コミットは各DDのユーザー確認後に `DD-{番号}: 概要` 形式で行う。

## Phase 0 DD一覧

| # | 実DD | 仮題 | 内容（計画書対応） | 主な成果物・レビュー対象 |
|---|------|------|-------------------|------------------------|
| ① | DD-001 | 開発基盤（monorepo）構築 | npm workspaces、TS strict共通設定、`sheet-types`骨格、`apps/playground`土台、test/typecheck/lint整備、AGENTS.mdコマンド表更新、暫定仮定A-01/A-02/D-01の確定記録（§17・§26-1・§1.2） | `npm run dev`/`test`/`typecheck`/`lint` が動く骨格 |
| ② | DD-002 | PoC-A 日本語IME | 20行×10列Canvas＋常駐textarea＋composition event recorder＋リモート更新シミュレーター＋スクロール追従（§18.1・§11） | イベントトレース、合格条件判定（**実IME手動試験＝ユーザー実機作業を含む**） |
| ③ | - | PoC-B Canvas・仮想スクロール | 50,000行×200列、可変行高・列幅、固定行列、Presence overlay 20人、高DPI（§18.2・§12・§13） | fps・メモリ計測、scroll anchor検証 |
| ④ | DD-003 | PoC-C 共同編集・Operation | `sheet-core`最小（固定ID/Axis/CellStore）＋in-memoryシーケンサー＋WS同期＋楽観適用rollback/replay＋再接続・冪等性（§18.3・§7・§8） | ランダムOperation収束試験（全クライアントhash一致）、ADR-005/008ドラフト |
| ⑤ | - | PoC-D データ表現・数式 | CellStore方式比較（Map/チャンク/配列）、500k非空セル計測、formula parser最小＋固定ID参照＋依存グラフ、replay計測（§18.4・§6・§14） | 計測レポート、ADR-011/022ドラフト |
| ⑥ | - | Phase 0判定 | 主要ADR確定（005/008/011/022ほか）、性能SLO確定（§21）、Go/No-Go判定資料、Phase 1正式バックログ（§18.6・§23） | Go／条件付きGo／No-Go の判断材料一式 |

## 順序と依存

- ①が全PoCの前提（開発コマンドが未整備のため最初に必ず行う）。
- ②を最優先する。IME（リスクR-01: 致命的×高）はNo-Go条件の筆頭であり、最も早く成立性を確かめる価値がある。
- 実装開始順は **②→④→③→⑤**（2026-07-11 ユーザー合意）。③は②と同じ `apps/playground`・グリッド描画コードを触るため②の後。⑤は④とCellStore／sheet-core・Operation replayが重なるため④の後。②と④は領域が分離しており競合しない（playground vs packages/サーバー。計画書§19「Canvas/IMEとserver coreは並行可能」のとおり）。
- 実装は直列で行い、人間工程とパイプライン化する: ②のコードをコミットした後、ユーザーが実機IME受入試験を行っている間に④を実装する。同一ツリーでの同時実装はしない（`package-lock.json` の同時更新、Codexレビュー差分（`--uncommitted`）の混線、DD単位コミットの崩れを避けるため）。worktree分離による真の並列実装は、さらに短縮が必要になった場合のみ検討する。
- 途中で発生したバグ修正・ツール整備は別DDとして随時割り込んでよい（DD番号は前後しうる。本表の「実DD」列で対応を追跡する）。
