# DD-020-3: Undo/Redo

| 作成日 | 更新日 | ステータス | 補足 |
|--------|--------|-----------|------|
| 2026-07-16 | 2026-07-16 | 検討中 | 親=DD-020（3分割の第3子）。前提=DD-020-1/-2 完了（確定単位 chokepoint・range-ops・語彙） |

```text
Risk Class: A
Risk Triggers: 補償 SetCells が他者更新を上書きする可能性（計画書 R-07。条件付き拒否=OCC で防止するが、逆値・revision 捕捉の誤りは「黙って過去値へ戻す」サイレント上書きになる）／新規状態所有者（undo/redo スタック）の追加／OCC・rejected 経路への依存拡大／利用者の直前入力を失う可能性（誤 Undo）
Human Spec Gate: 解決済（親 DD-020 要確認③⑥確定=2026-07-16 フル委譲モード。テストシナリオ合意はオーケストレータ確認で代替）
Codex: high（必須・TDD 対象ゆえ原則必須。protocol 変更なし=親③〔補償 SetCells 方式〕・永続化/状態機械の実質変更なし=xhigh 非該当。protocol 変更が生じたら停止して xhigh へ昇格=親ヘッダ条項）
Manual Gate: なし（本子DDは synthetic E2E まで。実機は親 Phase 4 に集約）
External Review: なし（クライアント主導 Undo の方式判断は ADR ドラフトとして記録し Codex high で代替=Phase 2 タスク）
Evidence Level: full（A区分=L5。Undo 条件マトリクス・再現コマンド・既知の未保証境界を省略しない）
```

> アプローチ: TDD（Undo 条件ロジック=正解が明確）＋E2E（キーバインド・standalone 契約）
> 親=**DD-020**。依存: **DD-020-1／DD-020-2 完了**（確定単位 chokepoint・`range-ops`・公開語彙を利用）。完了後は親 Phase 4（統合検証・Manual Gate）へ。

## 目的

確定単位（1 利用者操作=1 SetCells）の Undo/Redo を、**クライアント主導・補償 SetCells**（親③・protocol 変更なし）で提供する。対象=セル確定・貼り付け・cut/範囲クリア。既存 OCC（stale-cell-revision）が「対象セルがその後変更されていない」条件（計画書 §15.4）を検証し、条件不成立は拒否通知（強制 Undo なし=R-07 対策）。

## 背景・課題（親 DD-020 §背景の該当分）

- Undo/Redo は全パッケージ未実装（grep 0件）。`core/apply.ts` の `InverseSeed` は `collab/session.ts` が `emptyInverseSeed()` で破棄しており、逆操作材料の保持機構が無い。
- 計画書 §15.2 はサーバー主導 undoRequest プロトコルだが、**親③でクライアント主導・補償 SetCells 方式に確定**（単独グリッドモード〔サーバー無し・Stage 2 主 consumer〕で同一機構が動く・protocol/server/永続化 変更ゼロ。undoRequest は将来課題へ境界化）。
- 補償 SetCells は `GridBackendSession.submitLocalOperation`（単独/共同の共通契約・DD-024）へ流すだけで両モードが同一経路になる。reject 通知（rejected イベント・Conflict Queue）も既存資産。

## 検討内容

- **スタック所有**: `packages/grid/src/undo-stack.ts` 新設（純ロジック=エントリ管理・補償生成。DOM/backend 非依存で unit 可能）＋grid 層で配線。
- **逆値の捕捉点**: DD-020-2 が整備する**確定単位 chokepoint**（単一 commit・paste・cut/クリアが通る共通 submit 記録点）で、submit 直前に committed から前値＋`lastChangedRevision` を読む（`captureEditStartRevision` 規約）。`InverseSeed`（apply 戻り値）を使う案は、collab（楽観適用）と standalone（即適用）で経路が異なるため不採用＝**submit 前の committed 読み取りへ統一**（両モード同一・単純）。
- **undo-able 化のタイミング（親⑥: pending 中は ACK まで Undo 不可）**: エントリは submit 時に記録し、**ACK 受領（standalone は即時）で undo-able 化**。ACK 時に対象セルの `lastChangedRevision`（=元操作が付与した revision）を確定記録し、補償 SetCells の beforeRevision に使う。reject された元操作のエントリはスタックへ残さない（破棄）。
- **Undo 実行**: 補償 SetCells（前値・beforeRevision=元操作確定時 revision）を submit。他者がその後同セルを変更していれば stale-cell-revision で**全体 reject**（原子・部分 Undo なし=計画書 §15.4）→ 通知。
- **Undo 拒否時のエントリ処理（既定案 (a)）**: スタックから**除去＋通知**（同一条件の再試行は同結果。将来「他者が値を戻したら再試行可」が要件化したら保持へ変更）。
- **Redo（計画書 §15.5）**: Undo 成功時に redo スタックへ積む（元値の再適用・同じ条件検査=beforeRevision は補償操作の確定 revision）。**新規通常操作で redo スタック破棄**。対象セルがさらに変更されていれば拒否。
- **キーバインド（既定案 (b)）**: Ctrl+Z=Undo／Ctrl+Y・Ctrl+Shift+Z=Redo。**Navigation 位相のみ**グリッド Undo として裁定。Editing/Composing 中の Ctrl+Z は**ブラウザ既定**（textarea 内テキストの undo）へ任せ、グリッド Undo を発火しない（I-3 維持・状態機械へ遷移追加なし）。
- **通知語彙**: Undo/Redo 拒否は既存 rejected（GridConflict）経路に **undo-blocked 系の公開コード**を追加（`GRID_CONFLICT_CODES`・R7 写像維持。命名は Phase 0 📐 で確定）。
- **対象外**: 行操作の Undo（DD-021 以降=計画書 §15.3 MVP後）・他クライアント操作の Undo・強制 Undo・reload を跨ぐ永続 Undo 履歴。

## 決定事項（親 要確認①〜⑥の確定〔2026-07-16〕の継承＋本子DD分）

- **親③**: クライアント主導・補償 SetCells・**protocol 変更なし**。方式判断は **ADR ドラフトとして実装時に記録**（Phase 2 タスク・オーケストレータ指示）。
- **親⑥**: 深さ **100**（超過は古い順に破棄）・**自分の操作のみ**・**セッション内**（reload で消える）・**pending 中は ACK まで Undo 不可**・対象=セル確定/貼り付け/範囲クリア（cut 含む）。
- 本子DD: 逆値は chokepoint の submit 前 committed 読み取りで捕捉・Undo 拒否エントリは除去＋通知（既定案 (a)）・Editing/Composing 中の Ctrl+Z はブラウザ既定（既定案 (b)）。（(a)(b) は親へ報告済み・オーケストレータ確定対象）

## 受け入れ基準

| # | 基準（操作 → 期待結果） | 検証方法 |
|---|------------------------|---------|
| 1 | セル確定 → Ctrl+Z → 前値へ戻る（補償 SetCells 1 op・型も復元） | Phase 1 unit＋Phase 2 E2E |
| 2 | 貼り付け／cut／範囲クリア → Ctrl+Z → 範囲全体が前値へ（原子・全成功/全失敗） | Phase 1 unit＋Phase 2 E2E |
| 3 | 他者が対象範囲内セルを後続変更 → Ctrl+Z → 全体拒否・undo-blocked 通知・文書無変更（強制 Undo なし） | Phase 1 unit＋2クライアントテスト |
| 4 | Undo 成功 → Ctrl+Y → 元値再適用。新規通常操作後は Redo 不可（スタック破棄） | Phase 1 unit＋Phase 2 E2E |
| 5 | pending 中（ACK 前）の操作は Undo 対象外・ACK 後に Undo 可能。reject された操作はスタックに入らない | Phase 1 unit（collab） |
| 6 | 深さ 100 超は古い順に破棄。reload で履歴が消える（=永続化しない） | Phase 1 unit |
| 7 | standalone モードで undo/redo → cell-commit（batch）通知が発火し利用側保存契約（DD-024）と整合 | Phase 2 standalone E2E |
| 8 | Editing/Composing 中の Ctrl+Z はグリッド Undo を発火しない（textarea 既定・composition 非破壊） | Phase 2 synthetic＋不変条件 |

## タスク一覧

### Phase 0: 事前精査
- [ ] 📋 **各Phaseのタスク精査・詳細化**（AC⇔検証対応・対象パス・変更内容の具体性・🔬の有無）
- [ ] 🧪 **テスト設計（Red）**: Undo 条件マトリクス（単独/共同 × 確定種別〔commit/paste/cut/clear〕× 競合有無 × pending/ACK × Undo/Redo）を `doc/DD/DD-020-3/scenarios.md` へ自然言語で作成。👀 シナリオ確認（フル委譲モード=オーケストレータ確認・結果をログへ記録）
- [ ] 📐 **実装前詳細化トリガー判定**（判定結果: Phase 1 → 要〔新規モジュール・並行処理=ACK 追跡〕／Phase 2 → 要〔3ファイル超・公開語彙〕）
- [ ] 🧑‍⚖️ **Codexレビュー要否判定**（判定結果: 必須・effort: high。最終Phaseで本子DD全差分に対し1回。理由=Risk Class ヘッダ）
- [ ] 😈 **Devil's Advocate調査**（楽観適用中に他 op が挟まった場合の逆値/revision ずれ→OCC が安全側〔拒否〕に倒れることの証明／rollback/replay・reconnect 中の ACK 追跡漏れ／Undo 連打・Undo 中 Undo／cut の Undo=クリアの補償と copy 内容の関係）

### Phase 1: undo-stack ロジック（TDD）
- [ ] **Red**: 合意済み scenarios から `packages/grid/src/undo-stack.test.ts` 作成 → 全件失敗確認
- [ ] **Green**: `packages/grid/src/undo-stack.ts` 新設（エントリ記録〔transactionId・逆値・revision〕・ACK 追跡で undo-able 化・補償 SetCells 生成・redo・深さ100・新規操作で redo 破棄・拒否時除去）
- [ ] **Refactor**: 2クライアント競合テスト（既存 collab ハーネスで AC3/AC5）
- [ ] 🔬 **機械検証**: `npm run test` → 全 green（新規 unit 含む）
- [ ] 😈 **DA批判レビュー（基準: da-method.md §3.4）**

### Phase 2: 配線・E2E・ADR＋Codex
- [ ] chokepoint hook 配線: DD-020-2 の確定単位記録点へ逆値捕捉を挿入（`packages/grid/src/clipboard-controller.ts`・`packages/grid/src/range-ops.ts`・`packages/grid/src/ime-editing-session.ts` の確定経路）
- [ ] キーバインド裁定: Ctrl+Z／Ctrl+Y／Ctrl+Shift+Z を Navigation 位相のみ Undo/Redo 化（`packages/grid/src/mount-controller.ts` keydown 前段・Editing/Composing はブラウザ既定）
- [ ] `packages/grid/src/error-codes.ts` へ undo-blocked 系語彙追加＋`doc/DD/DD-017/error-codes.md` へ登録
- [ ] ADR ドラフト起票: `doc/adr/` へ「クライアント主導 Undo（補償 SetCells・undoRequest プロトコル不採用の根拠・将来の再検討条件）」（親③の記録・オーケストレータ指示）
- [ ] `apps/playground/e2e/undo-redo.spec.ts` 新設（基本 undo/redo・redo 破棄・standalone cell-commit 整合・IME 干渉）
- [ ] `tests/invariants` へ「composition 中 Ctrl+Z 非干渉」ケース追加
- [ ] 🔬 **機械検証**: `npx playwright test`＋`npm run test:invariants`＋`npm run typecheck && npm run lint` → 全 green
- [ ] 😈 **DA批判レビュー（基準: da-method.md §3.4）**
- [ ] Codexレビュー自動実行（本子DD全差分・effort high。依頼書 `doc/DD/DD-020-3/codex-review-request.md`〔Undo 条件マトリクス網羅性・revision 捕捉の正しさ・サイレント上書き経路の有無を明記〕→ `bash scripts/codex-review.sh` → `doc/DD/DD-020-3/codex-review-result.md`）
- [ ] Codexレビュー指摘への対応、または見送り理由をログに記録

## 引き継ぎ物（→ 親 DD-020 Phase 4）

- 全対象操作（commit/paste/cut/clear）の Undo/Redo 成立＝親の既知制約「範囲クリア・貼り付けの Undo なし」を解消
- 親 Phase 4 の統合検証（性能計測・features.json 更新・Manual Gate M1〜M3 受付）へ移行可能な状態

## ログ

### 2026-07-16
- DD作成（親 DD-020 の Phase 3 を自己完結の子DDとして切り出し。親 要確認①〜⑥はオーケストレータ確定済み=フル委譲モード。③=クライアント主導・補償 SetCells・ADR 記録は実装時〔Phase 2 タスク化済み〕）。
- 逆値捕捉の設計: InverseSeed 再利用ではなく chokepoint での submit 前 committed 読み取りへ統一（両モード同一経路・楽観適用との整合は OCC が安全側に倒す）。
- 本子DD追加の既定案: (a) Undo 拒否エントリ=除去＋通知／(b) Editing/Composing 中 Ctrl+Z=ブラウザ既定（親へ報告済み・オーケストレータ確定対象）。

---

## DA批判レビュー記録

### Phase N DA批判レビュー

**DA観点:** （このPhaseで最も壊れやすいポイントは何か？）

| # | 発見した問題/改善点 | 重要度 | 再現手順（高/中は必須） | DA観点 | 対応 |
|---|-------------------|--------|----------------------|--------|------|
| 1 | (具体的に記述) | 高/中/低 | (高/中: 操作→結果) | (どのDA観点で発見したか) | ✅修正済/⏭️別DD/❌不要 |
