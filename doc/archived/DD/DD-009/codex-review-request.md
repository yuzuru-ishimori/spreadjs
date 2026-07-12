# Codexレビュー依頼書 — DD-009 基盤判断DD（effort=high）

## 目的

Stage 1 SDK Alpha（Delivery Phase A）の全縦切りDD（DD-010〜022）の前提となる**設計判断**を確定する判断DD。
プロダクションコードは無し。成果物は台帳・境界定義・CG台帳・ADR（ドキュメント）。
DD-011 が boundary lint を、各縦切りDDが実抽出を行える**判断の粒度・整合性**を検証してほしい。

## スコープ（本DDでやること）

- PoC資産台帳: DD-002〜006 の全資産を Adopt/Harden/Rewrite/Discard に分類（方針のみ・実抽出は各担当DD）
- package責務境界・公開面の最小方針（内部/Facade・許可import方向・禁止パターン）
- CG解除台帳（CG-1〜6）
- Tier 1 対象環境・公開API成熟度方針の ADR

## スコープ外（別DD）

- 実コード（skeleton・boundary lint・contract test・不変条件スイート runner）＝DD-011
- 各資産の実抽出＝各縦切りDD
- index→RowId 実装＝DD-010
- package の実 rename＝DD-011

## 仕様確認ゲートで確定した決定（前提・変更不可）

1. 論理名は目標名として境界だけ定義。実 rename は DD-011（強制しない）。
2. 最初の consumer 未定 → Stage 1 Facade は `grid`+`server-hono` の最小経路に限定。element/react は Stage 2。
3. CG台帳は常設 `doc/plan/cg-ledger.md`。

## 対象成果物（レビュー対象差分＝未コミット）

- `doc/DD/DD-009/poc-asset-ledger.md`
- `doc/DD/DD-009/package-boundary.md`
- `doc/plan/cg-ledger.md`
- `doc/adr/0015-stage1-api-maturity-and-tier1-support.md`
- `doc/DD/DD-009_基盤判断.md`（決定事項・タスク・ログ）
- `doc/DOC-MAP.md`（登録）

## 設計意図・制約

- 正典: `doc/plan/phase1-dd-roadmap.md` §0（CG-1〜6）・§2.3/2.4（不変条件・密度）・§4（DD一覧）・§6（製品境界）・§7（consumer 最小経路）。
- ゼロ依存原則 ADR-0022（boundary R6 の出所）。
- 判断DDのため、実装アルゴリズム変更なし。

## 重点的に確認してほしい点（findings 優先）

1. **仕様一致**: 台帳・境界・CG台帳・ADR がロードマップ §0/§2/§4/§6/§7 と矛盾しないか。特に「Alpha必須ライン」「未解除CG=変更トリガー例外」との整合。
2. **boundary lint 実装可能性**: §4 の許可import方向 DAG と禁止パターン R1〜R7 は、DD-011 が機械実装できる粒度か。判定漏れ・循環・自己矛盾はないか。
3. **公開面の最小化の妥当性**: grid+server-hono だけで最初の Alpha 縦切りマイルストーン（日本語入力→共同編集→永続化→独立 consumer 利用）を満たせるか。element/react 後送りで S1-3/S1-4 に穴が出ないか。
4. **CG台帳の網羅と正本一意化**: CG-1〜6 の主担当DD・解除証拠・期限がロードマップ §0 と一致するか。二重管理の腐敗リスクへの対処は十分か。
5. **資産分類の回帰リスク**: Discard/Rewrite 判断が後続DDの手戻りを生まないか。際どい分類（Q1〜Q7）の暫定判断は妥当か、見落とした際どい資産はないか。
6. **ADR の判断単位**: Internal→Experimental・Stable なし・0.x・fail-fast・Tier 1 が External Review 可能な単位に落ちているか。抜け（version 検出・compatibility matrix 更新責務等）はないか。
7. **テスト/検証不足**: doc-only だが、AC の機械検証（grep・doc-check）が判断の正しさを十分に担保するか。判断の検証で欠けている観点。
</content>
