# 常設不変条件スイート（invariant suite runner）

> 設置: DD-011（基盤実装DD）。正本: `doc/plan/phase1-dd-roadmap.md` §2.3「削ってはいけないガードレール」。

DD 横断で**削ってはいけない**不変条件を、4カテゴリの常設スイートとして固定する。
`npm run test:invariants`（= `vitest run tests/invariants`）で一括実行する。`npm run test`（全体）にも含まれる。

**本DD（DD-011）の担当範囲**: runner の設置と**各カテゴリ最小ケース1本以上**まで。
各不変条件の**実充足**は担当縦切りDD（下表）。最小ケースは「動くだけの形骸」ではなく、
実コードパス上で成立する最小の invariant を1つ検証する（DA 指摘への回答）。

## カテゴリと充足責務DD（§2.3）

| カテゴリ | ディレクトリ | 守る不変条件（§2.3 抜粋） | 実充足の担当DD |
|---|---|---|---|
| IME | `ime/` | composition中にtextarea.valueを書き換えない／selectionを破壊しない／textarea instanceとDOM親を置換しない／順序A・B／remote update・rollback/replay中もdraft不変／syntheticと実IMEを混同しない | DD-012 |
| 共同編集 | `collab/` | サーバー全順序とクライアント最終hash一致／rollback/replay後の収束／beforeRevision不一致でサイレント上書きしない／reject時に利用者入力を保持／idempotency／reconnect・catch-up／RowId・ColumnIdの安定／snapshot＋logからの復旧 | DD-013・DD-014・DD-015 |
| 公開API | `api/` | Stable/Experimental/Internal 区分／API contract test／protocol・schema version／破壊的変更検出／移行ガイド要否判定 | DD-016・DD-017 |
| 性能予算 | `perf/` | 初期ロード経路／Document State表現／Axis再構築条件／Canvas描画キャッシュ／operation replay方式／Formula依存グラフ／大量paste・sort・filter・行移動を変えたDDだけフル再計測 | DD-012（統合性能回帰ゲート）ほか |

## 最小ケースの現状（DD-011 設置時点）

- **ime**: IME composition 中のリモート更新で編集 draft が不変（§2.3「remote update中もdraft不変」／S-F2 ★）。素材＝`apps/playground/src/ime/editor-state-machine`（DOM 非依存の状態機械。DD-012 で `@nanairo-sheet/ime` へ抽出時に import 先を差し替える）。
- **collab**: サーバー全順序ログを2つの独立ドキュメントへ replay すると canonical hash が一致（§2.3「全順序→hash一致」＋決定論）。素材＝`@nanairo-sheet/core` の apply/hash・`@nanairo-sheet/collab/test-support` のビルダー。
- **api**: Facade（grid・server-hono）の公開 value surface が最小 allowlist に一致し、内部シンボル（`createDocument` 等）が漏れていない（§2.3「Internal 区分／破壊的変更検出」）。contract test（`tests/contract/`）と対。
- **perf**: Document State（core cell-store 経由）への bulk setCells が機能的に成立し、緩い予算内で完了する軽量スモーク（§2.3「Document State表現」）。閾値は暫定（フル再計測の発動条件・実予算は DD-012）。

## 実行

```bash
npm run test:invariants      # 4カテゴリ一括
npx vitest run tests/invariants/ime   # カテゴリ単体
```
