# DD-005 初期 snapshot 経路の計測（#6・記録用）

> 合否条件ではなく**記録**（アドバイス #6・DD-007 の既知制約と Phase 1 初期ロード設計へ引き継ぐ）。
> データセット: 50,000行 × 200列・非空 100,000 セル（決定論シード `seed-dataset.ts`・seed=20260712）。

## 計測対象の経路（Phase 2 の実装）

**単一正本の原則**により、統合ページの初期文書は **ClientSession が WS の operations replay で構築**する
（`/snapshot` HTTP は描画に使わない＝第二の正本を作らない・#2）。join 時にサーバーは
`operationsSince(0)`＝全 seed Operation（InsertRows 1件＋SetCells 10件＝計 11件）を単一 operations メッセージで返し、
ClientSession が `applyOperation` で committed を構築する。DocumentView はこの committed/view を読むだけ。

```
join(lastAppliedRevision=0)
  → welcome(currentRevision=11)
  → operations[ InsertRows(50,000行), SetCells×10(計100,000セル) ]   ← 初期転送（≈18.3MB JSON）
  → ClientSession が 11 Operation を適用（11回 applyOperation＝11回 clone）→ committed 完成（唯一の正本）
  → DocumentView.flush（rowAxis を displayRowOrder=50,000 から構築）
  → base-layer が可視範囲のみ描画
```

## 計測ハーネス（実装済み）

- `browser-transport.ts` の `onServerFrame({ chars, parseMillis })`: 受信フレームの文字数と JSON.parse 時間を集計。
- `session-sync.ts` の `onConnected`/`onOperations`: `wsConnected`/`firstSync` マイルストーン。
- `initial-load-metrics.ts`: `pageStart / wsConnected / firstSync / axisBuilt / firstDraw / firstOperable` を記録し、
  スパン（wsConnect / clientSessionInit / axisBuild / firstDraw / toFirstOperable）を導出。統合ページ右下 readout に表示。

## 計測値

### サーバー側（実測・throwaway 計測スクリプトで取得）

| 項目 | 実測値 |
|------|--------|
| seed 生成時間（InsertRows＋SetCells×10 を Sequencer.submit・11回 applyOperation clone） | **472.9 ms** |
| serializeSnapshot（Map→配列） | 25.1 ms |
| JSON.stringify（snapshot 全体） | 212.7 ms |
| snapshot JSON サイズ（document＋operationLog＝`/snapshot`） | **32.28 MB** |
| **operations 転送サイズ（join 時に client が受け取る operationLog 相当）** | **18.29 MB** |
| 非空セル | 100,000 |

### 実 WS 経路（node ClientSession での実測・de-risk 確認）

node の ClientSession（`WsClientTransport`）を integration サーバーへ join させた実測（`_verify-join` throwaway）:

| 項目 | 実測値 |
|------|--------|
| join → 収束（revision 11 到達）まで | **897 ms**（18.3MB 転送＋JSON parse＋11回 applyOperation 込み） |
| committed revision | 11 |
| displayRows | 50,000 |
| nonEmptyCells | 100,000 |
| client committed hash == server hash | ✅ 一致（`613165c94ea46b6b`） |
| pending | 0 |

→ **Phase 2 の文書ブリッジ（seed → WS operations replay → ClientSession=唯一の正本）が実 WS で成立**。
DocumentView はこの committed を読むため、描画は必ずサーバー確定値と一致する。

### ブラウザー側（headed smoke で記入）

ブラウザーの performance.now は headed 実行でしか取れないため、統合ページの readout / エクスポートで採取して追記する。

| スパン | 意味 | 値（headed smoke 実測・2026-07-12・Alice） |
|--------|------|--------|
| wsConnect | pageStart → WebSocket open | **19.2 ms** |
| clientSessionInit | wsConnected → firstSync（operations 適用開始） | **833.1 ms** |
| axisBuild | firstSync → axisBuilt（rowAxis 50,000 構築） | **198.8 ms** |
| firstDraw | axisBuilt → 初回 Canvas 描画 | **2.4 ms** |
| toFirstOperable | pageStart → 初回操作可能 | **1053.5 ms** |
| transfer(chars) | operations 受信文字数（≒18.3M） | 36,834 KB(chars) |
| parseMillis | JSON.parse 累計 | 172.2 ms |

> 環境: Chrome（主セッション Playwright MCP・#6 は合否でなく記録なので参考値で足りる）・`localhost:5250`(Vite) → `127.0.0.1:8790`(WS)。2タブ smoke（Alice/Bob）成立。Bob 側: wsConnect 106.9ms / clientSessionInit 1144.3ms / axisBuild 293.8ms / firstDraw 12.0ms / toFirstOperable 1557.5ms。**join→初回操作可能まで ~1.0〜1.6s**（100,000 セル・約18.3MB 転送）。証跡: `dd005-alice-loaded.png`・`dd005-alice-edit.png`・`dd005-bob-reflected.png`。

採取手順: 統合ページを開き、readout（右下）に表示される「初期ロード」行を記録する（`browser-transport.onServerFrame`＋
`initial-load-metrics` が自動集計）。

## DD-007 引き継ぎ（既知制約・改善候補）

- **初期転送 18.3MB / join**: seed を Operation ログとして持ち replay する現方式は、非空 100,000 セルで operations が約 18.3MB。
  接続ごとにこの全 replay が走る（applyOperation を 11 回＝clone 11 回）。node 実測で join→収束 897ms。
- **snapshot ベース初期化の候補**: `/snapshot` の document 部（≈14MB＝32.3MB − 18.3MB）だけを送り、ClientSession を
  snapshot から初期化できれば replay の clone を省ける。ただし ClientSession への snapshot 初期化 API 追加が必要（Phase 2 では
  sheet-collaboration を改変しないため未実施）。**DD-007 の既知制約＋Phase 1 初期ロード設計へ**。
- **operations 圧縮/分割**: SetCells バッチ数・per-frame 適用・ストリーミング適用（初回描画を待たせない）も候補。
- 密度・メモリの密検証は DD-004/DD-006 の担当（本 PoC は機能成立の検証）。
