# Codex ドキュメント証拠監査 依頼書（DD-007 go-nogo-package）

> これは通常のコードレビューではなく、**ドキュメントの証拠監査**です。対象は `doc/DD/DD-007/go-nogo-package.md`（Phase 0 Go/No-Go 判定材料一式）の未コミット変更（空テンプレートに判定材料を記入した差分）。

## あなたの役割

Phase 0 Go/No-Go の判定材料が、**出典どおりに正確に転記されているか／原文の限定・条件を落としていないか**を監査してください。**Go/No-Goの判定はしないでください**（判定はユーザーが行う）。あなたの仕事は「材料の忠実性」の検査です。

## 監査の観点（この順で）

1. **数値・成立状況と出典の突合**: `go-nogo-package.md` §1〜§7 の各数値・判定・成立状況が、引用元ファイルの記述と一致するか。主な出典:
   - `doc/archived/DD/DD-002_PoC-A日本語IME.md` ＋ `doc/archived/DD/DD-002/`（特に `traces/phase6-acceptance/` が空=実機トレース未採取か）
   - `doc/archived/DD/DD-003_PoC-C共同編集Operation.md` ＋ ADR `doc/adr/0005-*.md`・`doc/adr/0008-*.md`
   - `doc/archived/DD/DD-004/measurement-report.md` ＋ `pocb-measurement-realrun-20260712.json`
   - `doc/archived/DD/DD-005/integration-evidence.md` ＋ `initial-load-metrics.md`
   - `doc/DD/DD-006/measurement-report.md` ＋ `doc/DD/DD-006/measurements/*.json` ＋ ADR `doc/adr/0011-*.md`・`doc/adr/0022-*.md`
   - 計画書 `doc/plan/nanairo_realtime_spreadsheet_development_plan_v1.md` §18.1〜18.4（合格条件）・§21（SLO）・§22（リスク）・§18.6（Go/No-Go）

2. **要約が原文の限定・条件を落としていないか**: 「達成」「成立」「pass」と書かれた項目が、出典では条件付き・未計測・synthetic限定・申告のみ だった場合、その限定が package に明記されているか。特に:
   - IME（§1 PoC-A・§7）: 実機受入が「申告のみ(D)」・実IMEトレース未採取(E)・synthetic/ASCIIで実IME非担保、という限定が保たれているか。
   - DD-004 B-4: 「10分連続soakは厳密には未実施」の限定が残っているか。
   - DD-003: 「client→server方向の再整列は未実装」「実RTT/実IME下UXは代理観察」の限定が残っているか。
   - DD-005 §2: 実機(C)未到達・Phase 5クローズ・#9/#10 の証拠レベルが正しいか。
   - DD-006 メモリ: 「精密ブラウザヒープは performance.memory 封鎖で未取得」の限定が残っているか。

3. **証拠レベル(A〜E)の妥当性**: 各根拠に付した A〜E が、出典が示す証拠の強さと整合するか。**Hard Gate を D または E だけで「合格」にしていないか**（ルール上、残存リスク/条件付きGoにすべき）。

4. **n/a と 未実施(E) の区別**、**出典間で数値が食い違う箇所の注記漏れ**（例: ops/sec・heap概算）。

5. **判定主体の分離**: §7 の判定欄が空欄（ユーザー記入）のままか、エージェントがGo/No-Goを先取りしていないか。

## 出力

- 指摘は severity（P1=判定を誤らせる転記誤り／P2=軽微な不正確・注記漏れ／P3=改善提案）付きで。
- 各指摘に「package の該当箇所」「出典の該当箇所」「食い違いの内容」「推奨修正」を明記。
- 転記が正確な項目は個別列挙不要。**問題のある箇所に集中**してください。
- 繰り返し: **Go/No-Go の結論は書かない**。材料の忠実性のみ。
