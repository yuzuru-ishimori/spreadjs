# Stage 2 consumer 候補調査記録（DD-023 添付）

> 調査日: 2026-07-16。Stage 2 移行条件 S2「2つ以上の異なる社内アプリで利用」（憲章 §15）の実弾候補を記録する。

## 候補1: housing-e-kintai-next（ユーザー表明・2026-07-16）

- **場所**: `C:\repo\housing-e-kintai-next`
- **正体**: 不動産業務の勤怠管理・営業活動統合管理 Web アプリ「Housing E-Kintai」（現行 Streamlit 1.49 / Python / PostgreSQL・59画面）を React + FastAPI へ**高信頼リエンジニアリング**する次期版プロジェクト。
- **技術スタック（frontend/package.json 実測）**:
  - React **19.2** + React DOM 19.2 / TypeScript 5.9 / **Vite 8**（＝TS 透過コンパイル環境。現行 pack tarball TS ソース配布と互換・dist 切替は前提にならない）
  - Tailwind 4 + shadcn/radix-ui / TanStack **react-query 5** + **react-table 8** / react-hook-form + zod / zustand / **exceljs**（Excel I/O 需要の傍証）
  - テスト: Vitest 4 + Testing Library + **Playwright 1.58**
- **バックエンド**: FastAPI（Python 3.12・starlette/uvicorn）+ PostgreSQL。**Node ランタイムはフロントのビルドのみ**＝共同編集を使うなら collaboration-server（Hono/Node）の別プロセス同居が必要。
- **移行計画**（`doc/リエンジニアリング手法/01_計画/03_移行計画書.md`）: Phase 0 で **PoC 対象候補=「歩合計算 または 勤怠入力」**。DD-Know-How 導入予定あり（開発プロセスが本プロジェクトと同族）。
- **スプレッドシート組み込みの適合点**: 勤怠管理12画面・歩合管理7画面など大量明細の一括入力画面群。現行は Streamlit の表 UI ＋ Excel（openpyxl）インポート/エクスポート運用＝憲章 §6.1「Excel 管理表の業務 Web アプリ化」の典型。
- **Stage 2 計画への含意**:
  1. **React Facade（`@nanairo-sheet/react`）が必須化**（roadmap §7 昇格条件: 最初の consumer が React）。React 19 対応要確認。
  2. 認証・権限は FastAPI 側にあり、共同編集サーバーを立てる場合は認証 Adapter（caller が identity を与える・§6 信頼境界）の実配線が最初の実案件検証になる。
  3. 共同編集不要なら**単独グリッドモード**（憲章 §11.1・collaboration: false）が最短だが Stage 1 で未実証＝専用DDが要る。

## 候補2: ReadyCrew 案件DB（相談ベース・2026-07-15）

- **出典**: `stage2-backlog.md` §3.6。商談進捗パイプライン画面への組み込み検討。
- **派生要件**: 列タイプ体系（選択式入力列・ハイパーリンク列・背景色/バッジ）＝新アーキテクチャ概念。Human Spec Gate 必要規模と判定済み。
- **状態**: 組み込み自体まだ検討段階。技術スタック未調査。

## S2 条件への当てはめ（現時点）

| S2 条件の要素 | 現状 |
|---|---|
| 1つ目のアプリ | housing-e-kintai-next（ユーザー表明・組み込み対象画面は要確認①） |
| 2つ目のアプリ | 未確定（ReadyCrew が候補。要確認②） |
| Plugin/Adapter 境界の実案件検証 | housing-e-kintai-next の認証/永続化 Adapter 配線が最初の機会 |
