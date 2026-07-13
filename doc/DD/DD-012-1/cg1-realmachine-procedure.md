# CG-1 実機 IME ゲート 実施手順（DD-012-1 Phase 4・人手必須）

> Phase 4 は **人間（ユーザー）の実機セッションが必要**（実 IME 候補ウィンドウ・確定 Enter の実挙動は自動化不可）。
> Phase 3 までに採取フロー・機械判定スクリプトを用意済み（本書）。実機セッションで下記を実行する。既定=DD-002 実機手順の踏襲（要確認⑥）。

## 対象環境（Tier 1・両方必須）

- Windows + Chrome (Chromium) + 実 IME（例: Microsoft IME / Google 日本語入力）
- Windows + Edge (Chromium) + 実 IME
- （macOS/Firefox/モバイルは Stage 1 対象外・ADR-0015）

## 準備（Phase 3 で完了済み）

- 採取 UI: `apps/playground/src/ui/trace-panel.ts`（生 IME イベントを記録・JSON エクスポート）。
- 記録器: `apps/playground/src/ime/event-recorder.ts`（`ImeEventTrace` 形式・DOM 非依存）。
- 機械判定: `scripts/cg1/judge-ime-trace.mjs`（順序A/B の両採取・先頭欠落0 を判定・synthetic フィクスチャで検証済み）。

## 手順

1. **起動**: `bash scripts/dev-start.sh`（playground :5885）。trace-panel を含むページ（PoC-A/統合ページ）を対象ブラウザーで開く。
   trace-panel が未接続なら main へ `createTracePanel({ root, recorder, userAgent })` を配線（Q6・dev tool 硬化。製品には載せない）。
2. **環境記入**: trace-panel の「IME」欄に実 IME 名（例: Microsoft IME）を入力（browser/os は UA 自動推定）。
3. **採取（順序A・順序B の両方を必ず含める）**: 空セルへ日本語を連続入力し確定・移動する。
   - **順序A**: 変換候補が出ている状態（変換中）で **Enter で確定**→さらに Enter で移動。
   - **順序B**: 変換確定後（候補ウィンドウが閉じた状態）に **Enter で確定/移動**。
   - 各セルで「あいう」「日本」等・**先頭文字が落ちないこと**を目視でも確認しつつ、複数セルへ連続入力。
   - Chrome と Edge の**両方**で実施する。
4. **エクスポート**: trace-panel の「JSON エクスポート」で trace を保存し、`doc/DD/DD-012-1/` へ格納する。
   命名例: `cg1-chrome-msime.json` / `cg1-edge-msime.json`（実機環境が分かる名前）。
5. **機械判定**: 採取 JSON を判定にかける。
   ```bash
   node scripts/cg1/judge-ime-trace.mjs doc/DD/DD-012-1/cg1-chrome-msime.json doc/DD/DD-012-1/cg1-edge-msime.json
   ```
   - **PASS 条件（AC8）**: `orderAPresent=true` かつ `orderBPresent=true` かつ `headDropSessions=0` かつ `sessionTotal>0`。
   - 判定出力（JSON）を `doc/DD/DD-012-1/cg1-judge-result.json` として保存し evidence.md へ引用する。
6. **台帳更新**: `doc/plan/cg-ledger.md` の CG-1 を「解除済」へ更新し、実機環境（OS/ブラウザー/IME バージョン）を evidence.md へ追記する。
7. **DA 批判レビュー**: synthetic と実機の差分が残っていないか・候補ウィンドウ経由の確定で trace 欠落がないかを確認しログへ。

## 判定スクリプトの検証状況（Phase 3 で完了）

- `scripts/cg1/fixtures/synthetic-orderA.json`＋`synthetic-orderB.json` → PASS（両順序・先頭欠落0）。
- `scripts/cg1/fixtures/synthetic-headdrop.json` → FAIL（先頭欠落を正しく検出・exit 1）。

## 未解決（実機セッションで人間が実施）

- 実機 trace の採取（Chrome/Edge 両方・順序A/B 両方）。自動化不可。
- trace-panel の統合ページへの配線（未配線なら main へ dev tool として追加）。
- CG 台帳 CG-1 の解除記録・実機環境バージョンの追記。
