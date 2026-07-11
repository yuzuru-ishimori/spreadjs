# ADR-0005: サーバー主導型全順序 Operation ログ

- **Status**: Proposed（Go/No-Go 確定は Phase 0 ロードマップ⑥）
- **関連**: 計画書 §3.4（一貫性モデル）・§7（Command/Operation）・§8（WebSocket プロトコル）・§18.3（PoC-C）／DD-003（PoC-C 共同編集 Operation）／ADR-0008（楽観適用＋rollback/replay）

## 背景・課題

リアルタイム共同編集スプレッドシートで、複数クライアントの並行編集（セル値・行挿入・行削除）を、切断・競合・重複・遅延・リオーダーを経ても**全クライアントで同一の最終状態へ収束**させる必要がある。行の順序（rowOrder）と削除（tombstone）を含む構造の一貫性も保たねばならない。この収束方式の選択が Phase 0 の技術リスクの一つ（No-Go 条件「Operation 収束性」）。

## 選択肢

| 選択肢 | 概要 | 長所 | 短所 |
|--------|------|------|------|
| **(A) サーバー主導型全順序 Operation ログ** | サーバーが単一の権威。revision を単調付与し、Operation を全順序ログに追記。クライアントは決定論的適用関数（§7.6）で同順に適用 | 収束が単純に保証（全員が同じ順序で同じ決定論適用）／実装・検証が容易／サーバーで権限・バリデーションを一元化 | 全順序の単一サーバーがスループット/レイテンシの中心。オフライン耐性は上限付き（§8.5） |
| (B) CRDT（op-based / state-based） | 中央順序なしで可換な操作/状態マージ | 中央サーバー順序不要・強いオフライン耐性 | 行順序・tombstone・セル構造の CRDT 設計が複雑／メタデータ肥大／因果メタデータの GC 難 |
| (C) OT（Operational Transformation） | 変換関数で並行操作を整合 | 中央順序を緩められる | 変換関数の網羅的正しさ証明が困難・実装バグ多発（歴史的に事故が多い） |

## 決定

**(A) サーバー主導型全順序 Operation ログ**を採用する（Status: Proposed）。

- サーバー（Sequencer）が revision を単調付与し、`operationId` 冪等・`baseRevision`/`beforeRevision` 検証・`clientSequence` 検査を経て全順序ログへ追記する（protocol-subset §5 の処理順）。
- 適用は決定論的な共有関数 `applyOperation`（§7.6・時刻/乱数/DOM/ネットワーク非参照）で、サーバーとクライアントが同一コードを使う。
- 文書ハッシュは正準直列化＋純 TS FNV-1a 64bit（依存ゼロ・Node/ブラウザー共通）。

Go/No-Go の確定は Phase 0 ロードマップ⑥。

## 結果（本 PoC の計測・観察）

DD-003（PoC-C）で `sheet-core` / `sheet-server-core` の最小実装＋開発用 WS サーバー＋ヘッドレスクライアント群により検証した（**163 テスト green**: sheet-core 68・sheet-server-core 51・collaboration-server 44）。

- **収束（AC1）**: 3〜10 クライアント × **10,000 件ランダム Operation**（SetCells/InsertRows/DeleteRows 混合）＋フォールト注入で、静止点において
  (a) 全クライアント committed hash == サーバー hash、
  (b) == スナップショットのログ replay hash（`verifySnapshotIntegrity`）、
  (c) rowOrder/tombstone/slot/全セルを含む**構造 deep-equal**（hash 盲点 D12 対策・hash と独立の導出）、
  を全て満たすことを確認。
- **二重適用0（AC2/I-3）**: サーバーログの operationId 重複なし・revision 連番・各クライアントの適用 revision 列が単調連続（`nextExpectedRevision === serverRevision + 1`）。
- **フォールト発火実測（S-M3）**: 3 体 10,000 件で 重複 7,408 / 欠落 8,728 / 遅延 10,847 / 切断 208、10 体で 重複 15,372 / 欠落 17,366 / 遅延 28,408 / 切断 192（種類ごと > 0 を assert）。
- **スループット**: in-process 決定論試験で **ops/sec ≈ 5,000〜16,000**（3〜10 クライアント）。実 WS 縮小スモークは 3 クライアント × 1,000 件で収束（S-M5）。
- **復元（AC5）**: snapshot（`{document, operationLog, currentRevision, ackCache, clientSequenceTable}` 全部）から**新インスタンスを別ポートで復元起動** → 同一 clientId 再接続 → catch-up → 全 hash 一致・復元後の新規 op で revision 継続（S-K4）。ackCache/clientSequenceTable 復元により再送誤 reject を防止（D17/D18）。
- **既知の知見**: 契約テスト（§20.3）で 重複=同一 ACK 再返却・欠落=requestCatchup 追従・stale=operationRejected〔現在値/現在 revision〕→ Conflict Queue 保持（消失0）を個別実証。

## 再検討条件

- 全順序の**単一サーバーがスループット/レイテンシのボトルネック**になる（シャーディング・複数リージョン・水平分割が必要）。
- **長時間オフライン編集**（§8.5 の上限「30 秒 / 100 Operation」超過）が主要ユースケースになり、CRDT の強いオフライン耐性が要件になる。
- ログの無限成長（in-memory 前提）が運用上の制約になり、`resyncRequired`（ログ退避・スナップショット圧縮）の本実装が必要になる。
