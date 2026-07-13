# DD-012-2 エビデンス（Evidence Level: full）

> Risk A・CG-6 解除証拠。計測環境・再現コマンド・生ログ参照を省略しない。
> **状態: Phase 0/1 完了・Phase 2/3 の計測足場完了・headed 実測値は人手セッションで追記待ち**（本書の「実測」節は TBD）。

## 1. AC 対応表

| # | 基準 | 状態 | 証跡 |
|---|------|------|------|
| 1 | `@nanairo-sheet/render` 抽出後、回帰なし | **抽出は DD-016 委譲**（下記 §2 render 抽出判断）。回帰確認は `test/typecheck/lint/build` green＝現位置維持で担保 | §2・機械検証ログ |
| 2 | 5万行×200列 headed 実測が予算内 | **指標計測 完了**（Playwright MCP Chrome150・§8）。scroll p95 16.8ms・選択 17.0ms・メモリ **pass**／再描画 0.845ms=**over-budget（計測環境アーティファクト・render 無変更ゆえ回帰不能）**。**定義的 clean run（redraw 予算内）は DD-016 統合後実機スモークで確定** | `perf-realrun-playwright-chrome150.json`・`perf-judge-result.json`・§8 |
| 3 | 性能予算が `tests/invariants/perf` に常設化・`test:invariants` green | **完了** | `perf-budget.json`・`perf-judge.test.ts`・`perf.invariant.test.ts` |
| 4 | CG-6 精密メモリ 300MB 内・レポート格納・CG 台帳更新 | **指標計測 完了・指標 pass**（peak 24.2MB ≪ 300MB・リークなし）。ただし `--enable-precise-memory-info` は MCP Chrome に無く**精密計測ではない**（12倍ヘッドルームゆえ結論不変）。**精密確定は DD-016** | `perf-judge-result.json`・§8・`cg6-memory-procedure.md` |
| 5 | 担当 R1 entries（pocb 由来）縮退・新規違反0 | **縮退は DD-016 委譲**（render 抽出前提）。new=0 は維持 | §2・boundary ログ |

## 2. render 抽出の判断（Phase 1・要判断）

**判断: `@nanairo-sheet/render` への物理抽出は DD-016（grid Facade 配線）へ委譲。DD-012-1（ime/selection 抽出の DD-016 委譲）と一貫。**

### 根拠（baseline 増減見込み）

対象 8 資産 `pocb/{base-layer,overlay-layer,viewport,scroll-anchor,dpi,axis,text-cache,render-scheduler}.ts` を今 `packages/render/` へ抽出すると:

- **解消される R1（−2）**: `pocb/scroll-anchor.ts`・`pocb/viewport.ts` の `@nanairo-sheet/types` 直 import は render→types が許可方向のため合法化。
- **新規 R1（+5 前後）**: 統合ページ `apps/playground/src/integration/{document-view,main,editor-placement,ime-editing-session,integration-editor}.ts` が現在 pocb を相対 import しており、抽出後は `apps/playground → @nanairo-sheet/render` ＝ **R1（grid Facade 未配線）** に化ける。
- **解決不能な cross-package 依存**: `base-layer` は `type ChunkStore`（`pocb/chunk-store` = 非 harden・playground 残置）、`overlay-layer` は `type PresenceUser`（`pocb/presence-sim`）・`type CellRange`（`pocb/selection`＝DD-016 委譲で未抽出）を import。render の許可依存は `core/types/selection` のみで、chunk-store/presence-sim は package 化されていない。→ render→apps の **R4（境界越え）** となり、chunk-store を core へ、selection を package 化（DD-016）しない限り**クリーンに抽出できない**。

**正味: baseline は −2＋5＝+3 で肥大**（AC5「縮退」と逆行）。かつ render→apps の R4 は grid Facade 配線＋selection package 化（DD-016 の責務・ロードマップ §4.3）が前提。よって DD-012-1 の壁（apps→internal R1 肥大・Facade 未配線）と同型で、**DD-016 へ委譲が一貫かつ規約準拠**（部分 Facade 新設・DAG 拡張＝規約の新規発明はしない）。

### 委譲時の申し送り（DD-016）

- `packages/render/` へ 8 資産を挙動保存で移設（grid Facade 経由で apps/playground が import）。
- `chunk-store` の帰属（core か render 内 interface か）と `selection` package 化を同時に行う（overlay-layer の型依存解消）。
- boundary baseline の pocb 由来 R1（`pocb/main.ts`・`scroll-anchor.ts`・`viewport.ts` → types）を縮退。
- 挙動保存＝CG-1（DD-012-1 実機証拠）を無効化しない（描画キャッシュ・DPI・scroll anchor 不変）。

## 3. 性能回帰ゲートの常設化（Phase 2 足場）

- 正典予算: `scripts/cg-perf/perf-budget.json`（scroll p95 16.8 / 選択 16.9 / 再描画 0.33ms / メモリ 300MB・計測条件・ノイズマージン）。
- 判定器: `scripts/cg-perf/perf-judge-core.mjs`（+ `judge-perf-report.mjs` CLI）。3 値判定（pass / over-budget / fail）＋ 負荷条件（可視セル帯）ゲート。**pass は 3 メトリクス全標本＋`frame.count>0` 必須**（未計測を pass にしない）。scroll/selection の §18.2 上限は strict（33/50ms ちょうども fail）。
- 常設テスト: `tests/invariants/perf/perf-judge.test.ts`（9 tests・fixtures 6 種で判定器を機械検証 ＋ 受け入れ条件全体の tripwire＝budget/hardCeiling/noiseMargin/可視セル帯/leakTrend ピン留め）・`perf.invariant.test.ts`（node Document-State スモーク）。
- 予算表（DD 本文にも記載）は「予算を緩める変更＝spec 変更＝再ゲート」。tripwire テストが値変更を検出。

### 再現コマンド

```bash
# 判定器の機械検証＋予算ピン（node）
npm run test:invariants
# fixtures 単体判定（pass=exit0 / over-budget・fail・条件未達=exit1）
node scripts/cg-perf/judge-perf-report.mjs scripts/cg-perf/fixtures/perf-report-pass.json
```

## 4. CG-6 精密メモリ（Phase 3 足場）

- `performance.memory` 封鎖回避: `--enable-precise-memory-info`（第一候補）／`measureUserAgentSpecificMemory()`（相互チェック）／CDP（監査）。詳細 `cg6-memory-procedure.md`。
- 判定: `judgeMemoryReport`（ピーク ≤ 300MB AND slope<64KB/s AND growthRatio<1.25）。リーク判定は**標本 ≥8・計測時間 ≥90 秒・slope/growthRatio 両方有限**が必須（10 秒平坦標本での誤解除を防止・DD-004 実測=約100秒/11標本に整合）。

## 5. 環境表（Playwright MCP 実測・2026-07-13）

| 項目 | 値 |
|---|---|
| OS / ブラウザー / バージョン | Windows / Chrome 150（Playwright MCP 駆動） |
| DPR | 1.0 |
| CPU / RAM | hardwareConcurrency 16 / deviceMemory 32GB |
| window | 1740×980 |
| 負荷状態 | **dev サーバー等 並行負荷下**（計測環境アーティファクトの要因） |
| 起動フラグ（CG-6） | `--enable-precise-memory-info` **なし**（MCP Chrome に無し＝精密計測ではない・§8） |

## 6. 実測結果（Playwright MCP・2026-07-13）

証拠: `perf-realrun-playwright-chrome150.json`（生レポート）・`perf-judge-result.json`（判定）。判定コマンド=`node scripts/cg-perf/judge-perf-report.mjs doc/DD/DD-012-2/perf-realrun-playwright-chrome150.json`。

| メトリクス | 実測 | 予算 | verdict |
|---|---|---|---|
| scroll frame p95 | **16.8ms** | ≤16.8 | **pass** |
| 選択応答 worst | **17.0ms** | ≤16.9（+20%=20.28） | **pass**（マージン内） |
| 停止中 full 再描画 mean | **0.845ms** | ≤0.33（機能上限12ms） | **over-budget**（fail ではない） |
| メモリ peak | **24.2MB** | ≤300 | **pass** |
| メモリ リーク | slope 9.6KB/s・growth 0.978 | <64KB/s・<1.25 | **pass** |
| perf.overall | **over-budget** | — | — |
| memory.overall | **pass** | — | — |

- 条件: 5万行×200列・非空50万・seed 20260712 uniform-sparse・56×22px・**可視セル 3,034（帯内）**・スクロール中 4,463 フレーム。

## 7. 既知の未保証境界

- 計測ページは現状 poc-b（pocb ハーネス）。統合ページへの計測ドライバー配線は未実施（描画資産は同一・挙動保存前提）。
- ノイズマージン 20%（timing）は暫定＝DD-016 実機で確定。
- `--enable-precise-memory-info` 無し＝メモリは指標値（精密確定は DD-016）。

## 8. Phase 2/3 計測の解釈（アーティファクト明記・ユーザー決定 2026-07-13）

- **over-budget は redraw 1 点のみ。DD-012-2 は render コードを一切変更していない**（render 抽出は DD-016 委譲・pocb は DD-004 とバイト同一）→ **回帰は原理的に不能**。redraw 0.845ms（DD-004 実機 0.33ms）は **Playwright 自動運転＋並行負荷の計測環境アーティファクト**（0.3ms 級の極小処理は CPU 競合に敏感）。主リスクの scroll は予算ちょうど pass・メモリは 300MB の 1/12。
- **選択遅延の採取方法（caveat）**: Canvas ゆえ synthetic PointerEvent で駆動（`setPointerCapture` を一時 no-op 化）。計測経路〔pointerdown→overlay 描画〕は DD-004 と同一。
- **CG-6 メモリ**: 24MB ≪ 300MB・リークなし＝**指標的 pass**。ただし `--enable-precise-memory-info` フラグが MCP Chrome に無く精密計測ではない（12 倍ヘッドルームゆえ結論は不変）。
- **定義的確定は DD-016**: clean run（redraw 予算内＋flag 精密メモリ）＋render 物理抽出＋baseline 縮退は **DD-016（統合後実機スモーク・CG-1 の DD-016 残スモークと同型）** で確定する。
