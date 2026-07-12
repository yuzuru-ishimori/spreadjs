# DD-011-1 証跡（Evidence: standard・5点圧縮）

## ① スコープ・対象外・リスク区分

- **スコープ**: 内部 5 package を DD-009 論理名へ機械的 rename（挙動不変）。package name suffix ＝ ディレクトリ名で完全統一。
  - `@nanairo-sheet/sheet-types`→`types` / `sheet-core`→`core` / `sheet-collaboration`→`collab` / `sheet-server-core`→`server` / `sheet-formula`→`formula`
  - ディレクトリ `packages/sheet-*` → `packages/{types,core,collab,server,formula}`（`git mv`）
- **対象外**: 新機能・API 変更・package 間ファイル移動（codec 移設は DD-011 担当）・Facade 実装（DD-011）・publish（DD-017）。
- **リスク区分**: Risk Class B（機械的 rename・挙動保存）。B→A 昇格トリガー（package 名が wire/シリアライズ/永続化に埋込み）は**該当なし**を確認（下記③・Codex 観点3）。

## ② AC 対応表

| AC | 内容 | 結果 | 証拠 |
|---|---|---|---|
| 1 | 5 package name＋devDependencies＋import 追従（内部相対 import 不変） | ✅ | name/devDeps ノード検証 OK・import 全置換・後述 typecheck green |
| 2 | 旧名 `@nanairo-sheet/sheet-` 参照が code/config/lock/生きた doc で 0 | ✅ | `grep -ra '@nanairo-sheet/sheet-' packages apps scripts *.json *.js *.ts` → **0**。doc も archived/履歴以外 0 |
| 3 | 5 dir が `git mv` で rename・旧 dir `packages/sheet-` 参照 0・git が rename 追跡 | ✅ | `grep -r 'packages/sheet-'` → **0**。`git diff --cached --name-status -M` で 66 件 R（純 D/A なし） |
| 4 | 挙動保存: 前後で test 561 green・typecheck・lint・build 全 green | ✅ | 下記③（After 全 green・561/561） |
| 5 | lock 再生成後に旧 name/旧 dir キー・extraneous が残らない・symlink 新名 | ✅ | `grep -c '@nanairo-sheet/sheet-\|packages/sheet-\|"extraneous"'` → **0**・`node_modules/@nanairo-sheet/{types,core,collab,server,formula}` symlink 確認 |
| 6 | 生きた doc 追随（decisions.md/AGENTS/README/ADR-0011）・doc-check green | ✅ | 4 doc 更新済み・`bash scripts/doc-check.sh` exit 0 |

## ③ 前後比較（機械検証要約）

| 検証 | Before（rename 前） | After（rename 後） |
|---|---|---|
| typecheck | GREEN | GREEN |
| lint | GREEN | GREEN |
| test | 560/561（※） | **561/561 GREEN**（57 files） |
| build | ※（下記） | GREEN（`npm run build` 3/3・直接 vite build も PASS） |

（※）Before の 1 test 失敗（`ws-convergence.smoke.test.ts`）と `npm run build` 失敗は、いずれも **rename 非依存の環境要因**:
- smoke test は**タイミング非決定の実 WS 収束試験**（40s budget・ファイル冒頭コメント L3 明記）。After 実行では 28.8s で収束し 561/561。
- build 失敗は Vite `html-inline-proxy` レース＋**削除前の stale node_modules 状態**に起因（lock 再生成で `node_modules/.package-lock.json` が旧 dir を参照し arborist が停止したのと同根）。クリーン再インストール後は `npm run build` 3/3 PASS。
- **package 名/パスの rename が上記に影響しうる構造的経路はない**（HTML/CSS proxy レース・WS タイミングであり module 解決ではない）。挙動保存は成立（むしろ After は全 green）。

追加確認: `git diff --cached --name-status -M`（default 50%）で 66 件が R 追跡。唯一 `packages/types/src/index.ts` のみ default 閾値では D/A 分離表示だが `--find-renames=10%` で **R047**（import 行支配の小 barrel ゆえ ~53% 変化）＝rename 検出は query 時実行のため履歴は失われず `git log --follow --find-renames=40%` で追える。純粋な意図せぬ D/A（履歴断絶）はなし。

## ④ finding 対応・既知制約

- **Codex レビュー（medium・1回・`--uncommitted`）**: findings **0 件**（`doc/DD/DD-011-1/codex-review-result.md`）。
  「mechanical renames・typecheck passes・全 5 dir rename 追跡・dependency tree 整合・stale name なし」と評価。
  Codex 側は read-only sandbox で Vitest 一時設定を書けずテスト未実行（patch 欠陥ではない）→ **テストは実装側で 561/561 green を独立確認済み**。
- **既知制約（軽微・rename スコープ外）**: source コメント内の informal な役割語 standalone `server-core`（6 箇所）・`client-session`（8 箇所）は据え置き。
  `client-session` は実在する未改名ディレクトリ `apps/collaboration-server/src/client-session/` の名であり改名対象外。standalone `server-core` は package 識別子ではない概念語。挙動非影響。

## ⑤ 公開 API・互換性影響

- **なし**。全 package は private（未 publish・DD-017 で初公開予定）。scope `@nanairo-sheet/*` 統一（D-003）は有効、suffix のみ変更。
- wire protocol・シリアライズ形式・永続化スナップショットに package 名文字列は埋め込まれていない（挙動保存が成立している＝Codex 観点3 で問題なし）。破壊的変更に非該当。
