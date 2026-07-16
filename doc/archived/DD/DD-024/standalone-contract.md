# DD-024 単独グリッドモード 公開契約（standalone-contract）

> Phase 1 成果物。決定事項①〜③（DD 本文）を前提に、公開型・イベント schema・fail-fast 条件・内部方式を確定する。
> 短縮ゲート（方向確定済み）につき、本文書は「実装の正解」として Phase 2 以降が参照する。

## 1. Options の形（決定① 案a=判別 union）

`GridMountOptions` を `mode` を判別子とする union にする。既存の共同編集 consumer（`{ serverUrl }`・mode 省略）を壊さないため、collaboration 変種の `mode` は省略可能（既定 collaboration）。

```ts
type GridMountOptions = GridCollaborationMountOptions | GridStandaloneMountOptions;

interface GridCollaborationMountOptions {
  mode?: 'collaboration';        // 省略時は collaboration（後方互換）
  serverUrl: string;             // 必須
  documentId?, columnOrder?, displayName?, clientId?
  // + 共通: columnWidths?, rowHeights?, wrapColumns?, onEvent?, onDiagnostic?
}

interface GridStandaloneMountOptions {
  mode: 'standalone';            // 判別子（必須）
  columnOrder: readonly string[];// 必須（/config が無いので利用側が与える）
  documentId?: string;
  initialData?: GridStandaloneData;  // mount 時の静的注入（決定③）
  // + 共通: columnWidths?, rowHeights?, wrapColumns?, onEvent?, onDiagnostic?
  // serverUrl / displayName / clientId は宣言しない（型で排他）
}
```

- **型での排他**: standalone 変種は `serverUrl` を宣言しない。オブジェクトリテラルで `{ mode:'standalone', serverUrl, columnOrder }` を渡すと、standalone 変種の余剰プロパティ検査と collaboration 変種の `mode` 不一致で **コンパイルエラー**になる（リテラル経路の静的排他）。
- **実行時 fail-fast**（JS 経路・非リテラル）: mount 時に検証し、違反は `error` イベント（phase='config'）で通知する（§4）。

## 2. 確定値イベント（決定② 通知のみ）

IME 確定・Delete 等で committed になった値変更を、新種別 `cell-commit` で通知する。1 確定操作 = 1 イベント = SetCells の batch 単位。

```ts
| { type: 'cell-commit'; changes: readonly GridCellCommitChange[] }

interface GridCellCommitChange {
  rowId: string;
  columnId: string;
  value: string;         // 確定後の表示文字列
  previousValue: string; // 確定前の表示文字列
}
```

- **値表現 = 表示文字列（string）**: 内部 `CellScalar`（判別 union）を露出しない（R7）。利用側は string を DB 等へ保存し、再 mount 時に `initialData` の string として戻す（`parseCellInput` で round-trip：数値 `"123"`・日付 `"2026-07-16"`・空 `""` は往復一致）。
- **保存失敗時 = 通知のみ**: grid は書き戻さない。利用側が保存失敗を検知したら `setData` 再注入で見た目を戻す（roadmap §6 の責務境界＝認証・保存は全面的に利用側）。grid 側 revert Command は持たない。
- **共同編集モードでは発火しない**（cell-commit は standalone 専用の確定通知）。共同編集の確定は既存の pending/connection/rejected 経路。

## 3. 初期注入・再注入（決定③ 両方）

```ts
interface GridStandaloneData {
  rows: readonly GridStandaloneRow[];   // 表示順の行
}
interface GridStandaloneRow {
  rowId: string;
  cells?: Readonly<Record<string /*columnId*/, string /*value*/>>;
}
```

- **mount 時**: `GridStandaloneMountOptions.initialData`。
- **mount 後**: `GridInstance.setData(data: GridStandaloneData)`。文書を丸ごと差し替え、Render を全再構築する（react-query 等の非同期取得を想定）。
- **collaboration モードで setData を呼ぶと**: no-op ＋ 診断 warn（`error` イベントではなく診断）。standalone 専用契約を明文化。
- 空 columnOrder / 不正データは §4 の fail-fast 対象。

## 4. off 時挙動・fail-fast（決定・検討 5/6）

| 事象 | 挙動 |
|------|------|
| standalone で `connection`/`pending`/`rejected`/`divergence` | **発火しない**（ClientSession/transport を生成しないため構造的に不可能） |
| `connectionState()` の返り値 | 新値 `'standalone'`（`GridConnectionState = 'online' | 'offline' | 'stopped' | 'standalone'`）。standalone は常に `'standalone'` を返す（`'offline'` は「一時切断」を含意し誤解を招くため専用値を追加） |
| standalone に server 系 options（serverUrl/displayName/clientId）混在（JS 経路） | `error`（phase='config'・code=`standalone-options-conflict`）を emit。配線しない |
| standalone で columnOrder 未指定/空 | `error`（phase='config'・code=`standalone-options-invalid`）。配線しない |
| collaboration で `initialData`/`mode:'standalone'` 無しに serverUrl 欠落 | 既存経路（config-unavailable）— 本 DD の変更対象外 |

公開エラーコード（`GRID_ERROR_CODES` 追加）: `standalone-options-conflict`・`standalone-options-invalid`。一覧は `doc/DD/DD-017/error-codes.md` を更新。

## 5. 内部方式 A/B の技術判断 → **案B（単独用 document ホルダー新設）を採用**

**採用: 案B**（`packages/grid/src/standalone-session.ts` に単独用の document 保持・確定通知を新設）。

判断理由（案A=ClientSession をローカル完結 transport で再利用、を退けた根拠）:

1. **AC6（connection 系イベント非発火）が構造的に保証される**: 案B は ClientSession/transport を一切生成しないため、connection/pending/rejected/divergence を「発火させない」のではなく「発火しようがない」。案A は no-op transport でも ClientSession が connection イベントを内部生成するため、能動的な抑止フック（漏れやすい）が必要。
2. **pending の無限累積が無い**: 案A の no-op/loopback transport は ACK を返さないため、楽観 pending が確定へ昇格せず単調増加する（長時間編集でメモリ増）。正しくするには ACK を返す in-process ミニサーバーが要り、**本 DD が避けたい protocol 結線を再導入**する。
3. **再注入（setData）が単純**: 案B は document 差し替え＋`markFullRebuild` のみ。案A は bootstrap メッセージを loopback へ流す protocol 結線が要る。
4. **描画・IME 資産は共有できる**: `DocumentView`（`getDocument: () => holder.document`）・`ime-editing-session`・base/overlay-layer は案B でもそのまま再利用する（分岐は mount-controller の backend 生成部のみ）。共同編集経路の回帰面は増えない。

**共有の仕方**: mount-controller が依存する「backend」を最小 interface `GridBackend`（`grid-backend.ts`）へ抽象化する。`SessionSync`（共同編集）は構造的に `GridBackend` を満たす（変更不要）。standalone は `createStandaloneSession` が `GridBackend` を実装する。mount-controller の rendering/IME 配線（baseLayer・docPort・editor・rAF）は両 backend で共有し、分岐は「どの backend を作るか」だけに閉じる。

standalone backend の session 面（GridBackend.session）は trivial 実装:
- `submitLocalOperation(op)`: `applyOperation` で document を更新し、setCells なら before/after 表示文字列を計算して `onCellCommit` へ渡す（→ mount-controller が `cell-commit` を emit）。revision は適用ごとに単調増加。
- `committedDocument` / view の `getDocument`: 同一 document（pending/committed の分離なし＝reject が無いので staleness も誤発火しない）。
- `knownPresences()` = []、`sendPresence`/`tick`/`sendHeartbeat` = no-op、`isOnline`=false・`isStopped`=false、`pendingCount`=0・`conflictQueue`=[]・`bootstrapRevision`=0・`appliedServerOpCount`=0。

## 6. DD-025（React Facade）を縛らないか

- Options union は props へ 1:1 で写せる（`mode` prop で分岐、standalone props に serverUrl を出さない）。cell-commit は `onCellCommit` コールバック props、setData は ref メソッド or `data` prop の再注入で表現できる。判別 union は React props 設計を狭めない。
</content>
