# Codex レビュー依頼: DD-028 継続回帰CI・API差分監視

## DD の目的

SDK 機能DD群（DD-020/021/027）の前に回帰防御を常設する。4本柱:
① CI 常設（GitHub Actions・test/invariants/E2E の継続実行=S2-4）
② API 型スナップショット差分検出の常設（S2-3・公開型シグネチャの破壊的変更検出）
③ migration guide 運用の確立と dry-run 検証（S2-3）
④ deprecation policy 決定（P-10・成熟度3層）
＋ Tier 1 実機 IME 実行記録の運用規定常設（S2-4 後半）。

## スコープ（対象差分）

コミット `818bcca` 以降の 4 コミット（Phase 1〜4）:
- `.github/workflows/ci.yml` 新設（2 job 並列: checks=lint/typecheck/test・e2e=playground+showcase chromium。push(main)/PR/schedule 週1/workflow_dispatch・concurrency ref 単位 cancel-in-progress・Node 22・npm ci・permissions contents:read）
- `tests/contract/facade-surface.test.ts` 拡張: 公開 .d.ts snapshot 3件（grid/server-hono/react）。**公開宣言 closure 方式**＝エントリ .d.ts から相対 specifier（`from './x'`・`import("./x")`）を再帰的に辿った連結テキストを snapshot（エントリ単独では `GridConflictCode` 等の再エクスポート型変更を検出できないため）。react を value surface・R7 検査へ追加。R7 を closure 全体へ強化。3 エントリを 1 program に束ねて emit 共有。`newLine: LineFeed` 固定＋`\r\n→\n` 正規化（Windows/Linux 決定性）
- `tests/contract/migration-dryrun.test.ts` 新設: doc/migration/ の全ガイドから ```ts before / ```ts after ブロックを抽出し、in-memory CompilerHost で仮想ファイルとして型検査（before=≥1 diagnostic 必須・after=0 diagnostics 必須・1 program 束ね）
- `doc/migration/README.md`（運用規定）・`doc/migration/0001-grid-conflict-code.md`（実績破壊的変更 GridConflict.code の移行ガイド）
- `doc/product/deprecation-policy.md`（3層: 0.x/Beta/Stable）＋憲章 §27 P-10 決定済み化＋roadmap §5＋decisions.md D-006
- `doc/plan/ime-manual-gate-ledger.md`（トリガー T1/T2/T3・Tier 1 シナリオ5点・synthetic/実IME 区別列・遡及初期行4件）
- `doc/DOC-MAP.md`・`apps/showcase/src/features.json`（quality エントリ更新）・DD 本文更新

## 設計意図・制約

- コア実装・IME 状態機械・protocol・永続化は**無変更**（テスト・CI・文書のみ）。packages/ 配下の変更はゼロのはず — もしあれば指摘してほしい。
- CI: E2E は synthetic composition（実IMEではない）。実IME は ime-manual-gate-ledger.md の変更トリガー方式で別建て（synthetic と実IME を混同しない＝S2-4 の要求）。headed 性能フル再計測は CI 化しない（共有ランナーの計時ノイズによる false red 回避・意図的）。
- 既知 flaky 候補 `ws-convergence.smoke` は「まず観察」方針（run#1〜3 で flake 0）。flake 時の quarantine 手順は決定済み（exclude＋continue-on-error）。
- closure snapshot の over-capture（再エクスポート元モジュールの非公開シンボル `GridBootError`/`toGridConflictCode`/`DiagnosticSink` 等も snapshot に入る）は安全側として意図的に許容。
- dry-run は**型検査レベル**（実行はしない）。挙動変更の移行は「型 dry-run の対象外」マーカー＋手動手順で README §3 が規定。
- リポジトリ規約: `doc/templates/coding-standards.md`（any 禁止・as 制限・非null assertion 禁止など）。

## 確認してほしい観点（findings 優先）

1. **仕様一致**: AC1〜7（DD 本文の受け入れ基準表）と実装の対応。特に AC2「export 名不変の型変更も検出」を closure 方式が本当に充足するか（閉包に漏れるケース: 例えば動的 re-export・パッケージ間参照・`export *` などで検出できない公開型変更が残っていないか）
2. **CI workflow の正しさ**: トリガー・concurrency・timeout・permissions・cache の落とし穴（例: schedule と push の相互 cancel・PR からの fork 実行・npm cache の破損パターン・playwright browser 未インストール経路）
3. **回帰**: facade-surface.test.ts の書き換えが既存の検出力（value surface・R7）を弱めていないか
4. **contract test の頑健性**: closure 探索（正規表現ベースの相対 specifier 抽出）の false negative／migration-dryrun の CompilerHost 差し替えの穴（仮想ファイルが実ファイルと衝突・モジュール解決の失敗が「before の型 error」として誤カウントされる等）
5. **テスト不足**: この回帰防御線自体の盲点（「防御線が壊れても気付けない」箇所）
6. **文書整合**: deprecation policy／migration README／IME 台帳の相互参照・憲章/roadmap との矛盾

## レビュー対象外（既知・意図的）

- 一時デモ変更（GridConflictCode への 'dd028-demo-only' 追加）は revert 済み＝最終差分に含まれない
- doc/DD/DD-024/・DD-025/ の untracked フォルダは本DD対象外（先行DDの残置物）
- リポジトリ名 spreadjs→nanairo-sheet のリネームは DD-031 スコープ
