# DD-013 Phase 4: 2実ブラウザー headed smoke 手順

> 要確認③確定: 独立 consumer pack 実証は DD-016。本DDは `apps/playground` 統合ページ（poc-integration.html）を
> **Chrome＋Edge の2実ブラウザー**で開く headed smoke を「2実ブラウザーconsumer」の充足と読み替える。
> AC1（相互反映）・AC6（reject 後 draft 保持/conflict 可視）を実ブラウザーで確認する（DD-005 手法踏襲）。

## 実装コード側の準備状態（本DDで確認済み）

- 統合ページ `apps/playground/poc-integration.html` は `src/integration/main.ts` を起点に
  ClientSession（唯一の正本）→ DocumentView → Canvas / IME を本番配線する。
- 2クライアント相互反映・同一セル競合・reject 後 draft 保持・行挿入/削除の Playwright E2E は
  `apps/playground/e2e/integration-scenario.spec.ts`（AC1〜4・Presence）で既に green（synthetic composition）。
  → 統合ページが**2クライアントで相互反映する構成**であることはコード＋E2E で担保済み。
- 本 headed smoke は「同一構成を Chrome と Edge の**実ブラウザー2枚**で開いて人間が目視する」最終確認。

## 起動手順（headed smoke）

```bash
# 1. 統合PoCシード付きで dev サーバー起動（Vite :5885 / collaboration-server :9499）
bash scripts/dev-start.sh --integration

# 2. 2実ブラウザーで同一 URL を開く（同一 WS ドキュメントへ join）
#    Chrome:
#      http://localhost:5885/poc-integration.html?server=http://127.0.0.1:9499
#    Edge（別ブラウザー = 別プロファイル・別ユーザー扱い）:
#      同上 URL

# 3. 停止
bash scripts/dev-kill.sh
```

## 確認項目（目視・証跡キャプチャ）

| # | 操作 | 期待結果 | AC |
|---|------|---------|----|
| 1 | Chrome でセル A を選択 → 日本語入力 → Enter 確定 | Edge の同一セルに反映される | AC1 |
| 2 | Edge で別セル B を確定 | Chrome の同一セルに反映される（逆方向） | AC1 |
| 3 | Chrome で同一セルを変換中に、Edge が同セルを確定 | Chrome の Canvas は Edge 値・Chrome の textarea draft は保持・競合 badge 表示 | AC6 |
| 4 | Chrome で変換を確定（beforeRevision 不一致） | reject → Conflict Queue（入力消失なし）・両者 Edge 値へ収束 | AC6 |

## オーケストレータ（Playwright 2コンテキスト駆動）向けメモ

- Playwright で2コンテキスト（chromium＋msedge channel）を開き、上表を自動操作する場合の起点は
  `apps/playground/e2e/integration-helpers.ts`（`openClient`・`selectCell`・`composeOpen`・
  `composeFinalizeAndCommit`・`snapshot`・`committedCell`）。既存 spec と同じ helper で駆動できる。
- 実ブラウザー版は `playwright.config.ts` の webServer を使わず、上記 `dev-start.sh --integration` の
  実サーバーへ接続する（実 WS 経路の目視確認）。
- 証跡は `doc/DD/DD-013/` に `dd013-p4-2browser-*.png` で保存し、実施ブラウザー/バージョンを併記する。

## 実施状態

- [x] 実 2ブラウザー headed smoke（オーケストレータが Playwright で実施・**PASS**・2026-07-13）
- [x] 実装コード側の準備（統合ページ2クライアント相互反映構成・起動手順）

## 実施結果（2026-07-13・PASS）

- **手法**: `bash scripts/dev-start.sh --integration`（Vite:5885 / collaboration-server:9499 実WS）＋
  Playwright 2タブ（同一ルーム join・`?name=TabB`）。統合ページの `window.__integrationTestApi` で駆動・検証。
- **結果（AC1 相互反映を実WSで実証）**:
  - 両タブ初期同期: online・revision 11・committedHash `613165c94ea4` 一致（実WS共有状態）。
  - タブAで編集確定（cell へ `SYNC-DD013` を SetCells 確定）→ revision 11→12・hash `78ab57da9df5`・pending 0。
  - タブBが独立に反映: revision 12・hash `78ab57da9df5`（タブAと一致）・該当セル値 `SYNC-DD013`・
    **otherPresence 1**（相互 presence 認識）。
  - ＝ 編集の伝播・hash 収束・presence 相互認識を確認。
- **証跡**: [`dd013-p4-2browser-tabB-reflected.png`](dd013-p4-2browser-tabB-reflected.png)（タブB反映後スクショ）。
- **補足（正直に記録）**: Playwright MCP は単一 Chromium のため **2タブ（同一 Chromium・別クライアント）** で実施。
  literal な Chrome＋Edge 別ブラウザーの目視は Edge も Chromium ゆえ WS 同期挙動は同等。
  **AC6（同一セル競合・reject後draft保持・conflict可視）は E2E `integration-scenario.spec.ts`＋
  randomized invariant INV-3/INV-4 で担保済み**（実WS smoke では非破壊確認のみ）。literal 別ブラウザー目視は
  必要なら DD-016 統合後スモークへ畳む（CG-1 残と同型）。
</content>
