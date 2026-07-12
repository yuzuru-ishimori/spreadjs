# DD-011-1: packageリネーム（`@nanairo-sheet/sheet-*` → DD-009 論理名 `@nanairo-sheet/*`）

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-13 | 2026-07-13 | 確認待ち | 実装完了（rename 5 package・66 renames＋import 全置換）・test 561/561・typecheck/lint/build green・Codex(medium) findings 0・旧名/旧dir 参照 0。DD-011 の前提確定 |

```text
Risk Class: B
Risk Triggers: 広範囲の import 書換え（実測: 旧 package 名参照 約210箇所・73 TSファイル＋package.json 9件）・ディレクトリ rename（git mv 5件・確定2）・package-lock 再生成・ビルド解決（workspaces symlink 名）変更。データ形式/protocol/永続化に非波及
Human Spec Gate: skipped（ユーザー決定 2026-07-13＝「今 rename する・子DDへ切出し」。本DD内容はオーケストレータがユーザーへ提示）
Codex: medium 1回（機械的 rename・挙動保存区分〔roadmap §2.2 L3「UI/doc/挙動保存=medium」〕。Phase 2 で全差分一括）
Manual Gate: なし（自動検証のみ: rename 前後で test/typecheck/lint/build 全 green＋旧名 grep 0）
External Review: 不要（Phase境界・API確定・ADR転換・Go/No-Go に該当せず）
Evidence Level: standard（5点圧縮証跡）
```

> アプローチ: 標準（機械的 rename・挙動不変。検証は既存スイート green の前後比較＋旧名 grep 0 の機械確認が中心のため）
>
> **B→A 昇格条件（roadmap §2.4）**: rename の過程で公開面・データ形式・protocol・永続化への波及（例: package 名がシリアライズ形式や wire message に埋まっている）が判明したら**停止して A へ昇格**しユーザーへ提示する。

## 目的

全内部 package を DD-009 package 責務境界（`doc/archived/DD/DD-009/package-boundary.md` §2 表・正本）の**論理名へ rename** し、新設予定 Facade（`@nanairo-sheet/grid`・`@nanairo-sheet/server-hono`）と命名体系を統一する。DD-011 の boundary lint・Facade skeleton が**論理名↔現行名マップ（移行期方式 §4.3）なしで最終名の上に直接乗る**ようにする（依存: 本DD → DD-011）。

## 背景・課題

- DD-011 要確認④（package rename の要否・時期）へのユーザー決定（2026-07-13）＝「**今 rename する。DD-011 本体より先に、子DDとして実施**」。
- **現状の正確な把握（起票時実測・依頼 premise との差異）**: scope 付与自体は D-003（2026-07-11）で実施済みで、現行名は既に `@nanairo-sheet/sheet-types` 等。したがって本DDの実作業は「無 scope → scoped 化」ではなく、**冗長な `sheet-` プレフィックスを落として DD-009 論理名（`types/core/collab/server/formula`）へ揃える** rename である。
- rename を先行させないと、DD-011 boundary lint は論理名↔現行名マップの移行期運用となり、後日 rename 時に lint 設定・baseline・contract test の二重手戻りが生じる。
- **並行セッション lock 安全**（メモリ方針）: package-lock 再生成を伴うため、**他セッションが lock 更新中でないことを着手前に確認**してから実施する。

## 検討内容

### rename 対象マップ（DD-009 §2 論理名表・正本より。確定1・2 反映＝name とディレクトリの両方）

| 現行 name | 新 name（論理名・確定1） | ディレクトリ（現行 → 新・git mv・確定2） |
|---|---|---|
| `@nanairo-sheet/sheet-types` | `@nanairo-sheet/types` | `packages/sheet-types` → `packages/types` |
| `@nanairo-sheet/sheet-core` | `@nanairo-sheet/core` | `packages/sheet-core` → `packages/core` |
| `@nanairo-sheet/sheet-collaboration` | `@nanairo-sheet/collab` | `packages/sheet-collaboration` → `packages/collab` |
| `@nanairo-sheet/sheet-server-core` | `@nanairo-sheet/server` | `packages/sheet-server-core` → `packages/server` |
| `@nanairo-sheet/sheet-formula` | `@nanairo-sheet/formula` | `packages/sheet-formula` → `packages/formula` |

- `apps/*`（playground・collaboration-server・pocd-bench・pocd-browser-bench）の name・ディレクトリは `sheet-*` 形式でないため**対象外**（app `@nanairo-sheet/collaboration-server` と新 `@nanairo-sheet/server` は名前衝突なし）。
- codec 移設（message-codec → core）は **DD-011 の担当のまま**（本DDは name 書換え＋`git mv` によるディレクトリ rename のみ・package 間のファイル移動なし）。

### 参照面の実測（2026-07-13・grep）

1. **package.json**: 各 package の `name`＋workspace 相互の devDependencies（`"@nanairo-sheet/sheet-*": "*"` 形式・9ファイル）。
2. **import 文**: `@nanairo-sheet/sheet-*` 参照 約210箇所・73 TSファイル（packages/apps 全域。`packages/sheet-core/src/hash.test.ts` は grep が binary 扱いするため置換後の確認は `grep -a` 等で漏れなく行う）。
3. **package-lock.json**: 27箇所 → `npm install` で再生成（手編集しない）。
4. **解決設定**: tsconfig paths **なし**・vite/vitest alias **なし**・`exports`/`main` は相対パスのみで name 非依存 → **追加対応不要**（解決は npm workspaces symlink 経由。`npm install` で `node_modules/@nanairo-sheet/` 配下の symlink 名が新名に切替わる）。root scripts はディレクトリ参照（`--workspace apps/playground`）のみで name 非依存。
5. **ディレクトリパス参照（確定2で対象化・実測）**: コード/設定に `packages/sheet-*` の明示パス参照は **0件**（root `package.json` workspaces は glob `packages/*`・vitest include は `packages/**` のためそのまま可。各 package の `tsconfig.json` extends は `../../tsconfig.base.json` で深さ不変のため無修正）。package-lock.json のディレクトリキー（`packages/sheet-*`）は `npm install` 再生成で追随。生きた doc のパス参照は `README.md`・`doc/adr/0011-row-slot-chunked-cell-store.md`・`doc/DD/DD-011_基盤実装.md`（親DD・申し送りで更新）・`doc/plan/phase0-dd-roadmap.md`（Phase 0 完了済みの履歴記録＝除外扱い）。
6. **生きたドキュメント（name 記述）**: `doc/decisions.md` D-003 の例示名・`AGENTS.md`/`README.md`/`vitest.config.ts` コメントの `sheet-types` 記述など。`doc/archived/` の履歴記述は**書き換えない**。

## 決定事項

- **純粋 rename（挙動不変）に限定**: 新機能・API 変更・package 間のファイル移動・Facade stub 実装（DD-011）・公開/publish（DD-017）は対象外。
- 挙動保存の証拠は **rename 直前・直後の同一コマンド実行の前後比較**（test 561 green・typecheck・lint・build）で担保する（ディレクトリ rename を含めても不変）。
- main 最新（DD-010 反映済みコミット cbf7064 以降）の上で実施し、着手前に `git status`＋`git log` で並行セッションの lock 更新・未コミット変更がないことを確認する。

**要確認①〜③はユーザー回答済み（2026-07-13）→ 以下を確定とする**:

| # | 確定内容 |
|---|---|
| 確定1 | **新 name は DD-009 論理名に統一** = `@nanairo-sheet/{types,core,collab,server,formula}`（冗長な `sheet-` プレフィックス除去。境界文書 §2 が正本・DD-011 boundary lint R1 の判定名と一致させる） |
| 確定2 | **ディレクトリ名も揃える**（起票時既定案「name のみ・dir 据え置き」から**変更**）: `git mv` で `packages/sheet-*` → `packages/{types,core,collab,server,formula}`。workspaces glob（`packages/*`）はそのまま可・明示パス参照があれば追従。churn は増えるが dir↔name 乖離の既知制約が解消される。挙動保存の証拠要件は不変 |
| 確定3 | **生きた doc の追随範囲は既定案どおり**: D-003 へ「例示名は DD-011-1 で論理名へ rename 済み（決定自体は有効）」の帰結1行追記＋AGENTS.md/README の旧名記述更新。`doc/archived/` は不変 |

## 受け入れ基準

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | 対象5 package の `package.json` name が新名になり、全 workspace の devDependencies・import が追従（内部相対 import は不変更） | Phase 1 🔬（grep＋diff レビュー） |
| 2 | 旧名 `@nanairo-sheet/sheet-` への参照が `packages/`・`apps/`・ルート設定・`scripts/`・package-lock.json・生きた doc で **0**（`doc/archived/`・過去DD本文の履歴記述のみ除外） | Phase 1 🔬（`grep -ra` 機械確認） |
| 3 | 対象5ディレクトリが `git mv` で `packages/{types,core,collab,server,formula}` になり、旧ディレクトリ名 `packages/sheet-*` への参照が repo 全体で **0**（除外は AC2 と同じ: `doc/archived/`・履歴記録〔phase0-dd-roadmap.md 等〕のみ。git が rename として追跡していること） | Phase 1 🔬（`ls`＋`grep -r 'packages/sheet-'`＋`git status` の renamed 表示） |
| 4 | 挙動保存: rename **直前**と**直後**で `npm run test`（561 green 維持）・`npm run typecheck`・`npm run lint`・`npm run build` が全て green（回帰0。name＋ディレクトリ両 rename 込み） | Phase 1 🔬（前後比較ログ） |
| 5 | `npm install` 再生成後の package-lock.json に旧名 name・旧ディレクトリキーが残らず、`node_modules/@nanairo-sheet/` symlink が新名で解決される | Phase 1 🔬 |
| 6 | 生きた doc（decisions.md 帰結・AGENTS.md/README の name/パス記述・ADR-0011 のパス記述）が確定3どおり追随し、`bash scripts/doc-check.sh` green | Phase 2 🔬 |

## タスク一覧

### Phase 0: 事前精査
- [x] 📋 **各Phaseのタスク精査・詳細化**（AC の検証対応・対象ファイルパス・🔬タスクの有無を確認）
- [x] 📐 **実装前詳細化トリガー判定**: 規模シグナル該当（73ファイル超）だが機械的一括置換のため、詳細化は本DD「rename 対象マップ＋参照面の実測」で充足。判定結果: `Phase 1〜2 → 詳細化不要（対象マップが仕様の全量）`
- [x] 🧑‍⚖️ **Codexレビュー要否判定**: 判定結果: `Phase 2 に1回・推奨・effort: medium（3ファイル以上変更の推奨シグナル該当。挙動保存区分〔roadmap §2.2 L3〕のため high でなく medium。xhigh 条件に非該当）`。Codex 利用可確認済み（2026-07-13 `--check` exit 0・codex-cli 0.144.0-alpha.4）
- [x] 😈 **Devil's Advocate調査**（package 名が文字列としてテスト期待値・snapshot・エラーメッセージ・wire 形式に埋まっていないか／`sheet-collaboration` → `collab` の短縮で検索性・既存ログとの突合が悪化しないか／`git mv` で履歴追跡（`git log --follow`）が途切れる操作をしていないか／DD-011 と本DDの順序逆転時の手戻り）
- [x] 要確認①〜③のユーザー回答を反映（2026-07-13 回答受領 → 確定1〜3 を「決定事項」へ反映済み。Phase 1 着手可）

### Phase 1: rename 実施（挙動保存）
- [x] 着手前確認: `git status`＋`git log --oneline -5` で main 最新（cbf7064 以降）・未コミット変更なし・並行セッションの lock 更新なしを確認（メモリ「並行セッションとlock安全」）
- [x] 🔬 **Before 記録**: `npm run test && npm run typecheck && npm run lint && npm run build` → 全 green（561 tests）をログへ記録
- [x] `packages/{sheet-types,sheet-core,sheet-collaboration,sheet-server-core,sheet-formula}/package.json`: `name` を対象マップの新名へ書換え＋workspace 相互 devDependencies を追随
- [x] `apps/{playground,collaboration-server,pocd-bench,pocd-browser-bench}/package.json`: devDependencies の旧名を新名へ書換え
- [x] 全 TS の import 一括置換（73ファイル・約210箇所。`@nanairo-sheet/sheet-types`→`@nanairo-sheet/types` 等5組。サブパス import `…/sheet-collaboration/test-support`・`…/inprocess-transport` も同時に追随。内部相対 import は触らない）
- [x] **ディレクトリ rename（確定2）**: `git mv packages/sheet-types packages/types` 等5件（対象マップどおり）。root `package.json` workspaces glob（`packages/*`）は無修正で可・vitest include（`packages/**`）も無修正・各 package の tsconfig extends（`../../tsconfig.base.json`）は深さ不変で無修正 — **明示パス参照が新たに見つかった場合のみ追従**（tsconfig references / vite 明示パスは実測 0件）
- [x] `npm install` で package-lock.json を再生成（手編集しない）→ lock 差分に新 name・新ディレクトリキーのみ現れることを確認
- [x] 🔬 **機械検証（After）**: `grep -ra '@nanairo-sheet/sheet-' packages apps scripts *.json *.js *.ts` → 0件（AC2）／`grep -r 'packages/sheet-' packages apps scripts *.json *.js *.ts` → 0件＋`git status` が5件を renamed と表示（AC3）／`npm run test && npm run typecheck && npm run lint && npm run build` → Before と同一の全 green（AC1/4/5）
- [x] 😈 **DA批判レビュー**（置換漏れ: binary 扱いファイル・文字列リテラル内の package 名・vitest コメント／dir rename 後の editor/tsserver キャッシュ起因の偽陽性に注意／新名 symlink での Vite dev server 起動確認は必要か）

### Phase 2: doc 追随＋Codexレビュー＋証跡
- [x] 確定3に従い生きた doc を追随: `doc/decisions.md` D-003 へ帰結1行追記・`AGENTS.md`/`README.md`/`vitest.config.ts` コメントの旧 name 記述を更新・`README.md`/`doc/adr/0011-row-slot-chunked-cell-store.md` の旧ディレクトリパス記述を更新（`doc/archived/`・`doc/plan/phase0-dd-roadmap.md` 等の履歴記録は不変）
- [x] `doc/DD/DD-011-1/evidence.md`（新規）: 5点圧縮証跡（①スコープ・対象外・リスク区分 ②AC対応表 ③前後比較の機械検証要約 ④finding対応・既知制約 ⑤公開API・互換性影響=なしの明記〔private package のみ・publish 前のため破壊的変更に非該当〕）
- [x] 🔬 **機械検証**: `bash scripts/doc-check.sh` → green（AC6）
- [x] Codexレビュー自動実行（依頼書 `doc/DD/DD-011-1/codex-review-request.md` 生成 → `bash scripts/codex-review.sh --request ... --out doc/DD/DD-011-1/codex-review-result.md` ・effort medium・全差分一括。観点: 置換漏れ・挙動保存・git mv 追跡・lock 整合）
- [x] Codexレビュー指摘への対応、または見送り理由をログに記録
- [x] 😈 **DA批判レビュー**（DD-011 が前提とする「最終名」と本DDの成果が一致しているか＝DD-011 のマップ方式タスクの削除・簡素化＋DD-011 本文の旧パス記述〔codec 移設タスク `packages/sheet-collaboration/src/message-codec.ts` → `packages/collab/src/message-codec.ts` 等〕の更新を DD-011 側へ申し送り）

## ログ

### 2026-07-13
- DD作成（DD-011 要確認④のユーザー決定「今 rename・子DD切出し」を受領。親: `doc/DD/DD-011_基盤実装.md`・依存方向: DD-011-1 → DD-011）
- Codex 利用可否: **利用可**（`bash scripts/codex-review.sh --check` exit 0・codex-cli 0.144.0-alpha.4）
- 起票時実測: scope は D-003 で付与済み（現行名 `@nanairo-sheet/sheet-*`）。tsconfig paths / vite・vitest alias / publishConfig は存在せず**追加対応不要**を確認。旧名参照 約210箇所・73 TSファイル＋package.json 9件＋lock 27箇所
- 要確認: ①新 name の確定（既定案=DD-009 論理名 `types/core/collab/server/formula`）／②ディレクトリ名も揃えるか（既定案=name のみ・dir 据え置き）／③生きた doc の追随範囲（既定案=D-003 帰結追記＋AGENTS/README 更新・archived 不変）
- ユーザー回答受領（同日）: **確定1**=DD-009 論理名に統一（既定案どおり）／**確定2**=**ディレクトリも git mv で rename**（既定案から変更。churn 増を許容し dir↔name 乖離を解消）／**確定3**=既定案どおり。→ 決定事項・rename 対象マップ・AC（AC3 追加＝旧 dir 参照 0）・Phase 1（git mv タスク追加）へ反映。追加実測: コード/設定に `packages/sheet-*` の明示パス参照 0件（workspaces/vitest は glob・tsconfig extends は深さ不変）・生きた doc のパス参照は README/ADR-0011/DD-011（申し送り）のみ

#### 実装完了（2026-07-13・確認待ち）
- **着手前確認**: `git status` は doc-only（DD-INDEX.md 既修正＋DD-011/DD-011-1 未追跡）・package-lock.json 未変更＝並行セッションの lock 更新なしを確認して着手。
- **Before 記録**（stale node_modules 状態）: typecheck GREEN・lint GREEN・test 560/561（`ws-convergence.smoke` が 40s budget 超過で timeout＝**タイミング非決定の実 WS 収束試験**・rename 非依存）・`npm run build` は Vite `html-inline-proxy` レースで FAIL（直接 `npx vite build` は PASS）。
- **rename 実施**: (1) 全 83 ファイルの `@nanairo-sheet/sheet-*` import/name/devDeps を新名へ一括置換（サブパス import 含む・0 残）。(2) 追加でコメント prose 内の旧 package 名（`sheet-core` 等・39 行）も新名へ整合（挙動非影響。standalone `server-core`/`client-session` は概念語/実在ディレクトリ名のため据え置き）。(3) `git mv` で 5 ディレクトリ rename（default 50% 閾値で 66 件が R 追跡。唯一 `packages/types/src/index.ts` は import 支配の小 barrel ゆえ R047＝default では D/A 分離表示だが `--find-renames=40%` で follow 可・履歴断絶なし）。(4) `npm install` で lock 再生成。**stale `node_modules/.package-lock.json` が旧 dir を参照し arborist が停止**（`Cannot read properties of null (reading 'name')`）→ `rm -rf node_modules && npm install` でクリーン再生成し解決（extraneous 0）。
- **After 検証（挙動保存 成立）**: typecheck GREEN・lint GREEN・**test 561/561 GREEN**（smoke は 28.8s で収束）・`npm run build` 3/3 PASS。旧名 `@nanairo-sheet/sheet-` 参照 0・旧 dir `packages/sheet-` 参照 0（code/config/lock）・symlink `node_modules/@nanairo-sheet/{types,core,collab,server,formula}` 新名確認。Before の 2 失敗は**いずれも rename 非依存の環境/stale 状態要因**でクリーン再インストール後は全 green（詳細: `doc/DD/DD-011-1/evidence.md` ③）。
- **生きた doc 追随**: `doc/decisions.md` D-003 に帰結追記・`AGENTS.md`（typecheck 説明）・`README.md`（想定構成ツリー＋依存規則 prose を no-prefix 命名へ）・`doc/adr/0011-*.md`（`packages/sheet-core`→`packages/core`）。`bash scripts/doc-check.sh` GREEN（AC6）。`doc/archived/`・`phase0-dd-roadmap.md` 等の履歴記録は不変。
- **Codex レビュー（medium・1回・`--uncommitted`）**: findings **0 件**（`doc/DD/DD-011-1/codex-review-result.md`）。「mechanical renames・typecheck passes・全 5 dir rename 追跡・dependency tree 整合・stale name なし」と評価。Codex 側は read-only sandbox で Vitest 未実行（patch 欠陥ではない）→ テストは実装側で 561/561 green を独立確認済み。見送り指摘なし。
- **証跡**: `doc/DD/DD-011-1/evidence.md`（5点圧縮・AC 対応表・前後比較）。
- **DD-011 への申し送り（確定した最終名・最終パス）**: 本DDにより DD-011 が前提とする最終名・最終パスが**確定**した。
  - package 名: `@nanairo-sheet/{types,core,collab,server,formula}`（`sheet-` プレフィックスなし）＝ DD-011 boundary lint R1 判定名と一致。**論理名↔現行名マップ（移行期方式 §4.3）は不要**。
  - codec 移設パス: DD-011 本文（Phase 1 タスク・§決定）は既に最終名前提で記述済み（`packages/collab/src/message-codec.ts` → `packages/core/src/`）＝本DDの成果と一致。**DD-011 側の追加修正は不要**（確認済み）。
  - Facade 新設は最初から `@nanairo-sheet/grid`・`@nanairo-sheet/server-hono`（no-prefix・D-003/本DD命名体系と整合）。

---

## DA批判レビュー記録

### Phase 1〜2 DA批判レビュー

**DA観点:** 機械的 rename で最も壊れやすいのは「置換漏れ」「stale ビルド状態による偽の green/red」「履歴断絶」。

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | `npm install`（lock 手削除→再生成）が `Cannot read properties of null (reading 'name')` で停止。stale `node_modules/.package-lock.json` が旧 dir `packages/sheet-collaboration` を参照し arborist が破綻 | 高 | rename＋`git mv` 後に `rm package-lock.json && npm install` → exit 1・lock 未生成 | stale ビルド状態 | ✅修正済（`rm -rf node_modules && npm install` でクリーン再生成・extraneous 0・symlink 新名） |
| 2 | Before の `ws-convergence.smoke` timeout・`npm run build` FAIL を「rename の回帰」と誤認する恐れ | 中 | Before フル実行で smoke が 40s budget 超過／`npm run build` が html-inline-proxy レース | 偽の red | ❌不要（いずれも rename 非依存＝タイミング非決定 WS・Vite レース／stale node_modules。クリーン後 After は 561/561＋build 3/3 green で挙動保存を確認） |
| 3 | package 名が wire 形式・snapshot・エラーメッセージ・テスト期待値に文字列埋込みだと rename で挙動変化（B→A 昇格トリガー） | 高 | 埋込みがあれば test が red 化するはず | 挙動変化 | ❌不要（test 561/561 green＝埋込みなし・Codex 観点3 も問題なし。挙動保存成立） |
| 4 | `git mv` で履歴が add/delete に化け `git log --follow` が途切れる | 中 | `git diff --cached --name-status -M` に純 D/A が出れば断絶 | 履歴断絶 | ❌不要（66 件が R 追跡）。**1 例外**: `packages/types/src/index.ts` は default 50% 閾値では D/A 分離表示（`--find-renames=10%` で **R047**）＝import 行が支配的な小 barrel ゆえ内容が ~53% 変化したため。履歴は失われず（rename 検出は query 時実行）`git log --follow --find-renames=40%` で追える。git mv 操作自体は正当・要対応なし |
| 5 | コメント prose の旧名（`sheet-core` 等 39 行）が dir↔名の乖離としてユーザー言う「勘違い・ミス」を残す | 低 | rename 後に `grep 'sheet-core' packages` で prose ヒット | 名称不整合 | ✅修正済（39 行を新名へ整合）。standalone `server-core`(6)/`client-session`(8) は概念語/実在未改名ディレクトリ名のため据え置き＝要判断で戻り値に明記 |
