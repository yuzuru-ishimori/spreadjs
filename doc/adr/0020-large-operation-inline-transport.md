# ADR-0020: 大量 Operation の transport（Stage 2 は inline＋セル数上限・payload 参照方式は不採用）

- **Status**: Accepted（DD-020 で決定・2026-07-17。従来は計画書 ADR 台帳で Open〔期限=Phase 2 開始前〕）
- **関連**: 計画書 §14（Operation transport・inline/参照方式・payload_or_object_key）／§4 ADR 台帳 ADR-020 行／D-12（大量 Operation transport＝inline＋将来 payload ref）／R-08（大量 paste が WS・DB を圧迫）／DD-020（Clipboard アンブレラ・親①上限＝D3）／DD-020-1（範囲クリア）／DD-020-2（貼り付け）

## 背景・課題

計画書 §14 は大量 Operation の transport を「小さい Operation は WebSocket 内へ inline／大きいものは payload を別送し参照（object key）で運ぶ」二方式で素描し、inline 上限を「Phase 0 の計測後に決める」として **ADR-020 を Open**（期限=Phase 2 開始前）にしていた。R-08（大量 paste が WS・DB を圧迫）の対策として「セル数上限・batch・payload 参照方式」が挙がっていた。

Stage 2 の貼り付け（DD-020-2）は SetCells batch を transport に載せる最初の大量 Operation ユースケースであり、Phase 2 開始前に本 ADR を解消する必要があった。論点は「inline のままで足りるか、payload 参照方式（object key 別送）を今 実装すべきか」。

## 選択肢

| 選択肢 | 概要 | 長所 | 短所 |
|--------|------|------|------|
| (A) payload 参照方式を今 実装 | 大 Operation の payload を別チャネル（object store）へ置き、ws には参照（key＋hash）だけを流す | 上限を事実上撤廃できる／超巨大 batch に対応 | 別ストア・整合（hash 照合）・GC の実装が必要／単独グリッドモード（DD-024・サーバー無し）に別経路が要る／Stage 2 に不要な複雑性 |
| **(B) inline＋セル数上限（採用）** | SetCells batch を現行 inline JSON のまま ws で運び、セル数を定数上限で実行前に弾く | protocol/transport 変更ゼロ／単独・共同で同一経路／R-08 を定数 1 つで防げる／上限内（10 万セル TSV ≒ 数 MB）は ws 既定上限内 | 上限超のユースケース（超巨大一括投入・添付・数式大量参照）は将来 ADR で参照方式を再検討する必要 |

## 決定

**(B) inline＋セル数上限** を Stage 2 の transport とする。

- SetCells batch（範囲クリア・貼り付け・cut のクリア・IME 単一確定・Undo/Redo 補償）は**現行 inline JSON のまま** WebSocket で運ぶ（新規 wire メッセージ・別ストア・payload 参照は導入しない）。
- **上限**: `SETCELLS_MAX_CELLS = 100_000`（`packages/core/src/protocol-limits.ts`・client/server 共有）。範囲クリア（DD-020-1）と貼り付け（DD-020-2）は**実行前**に矩形セル数をこの値で検査し、超過は submit せず公開コード（`range-too-large` / `paste-too-large`）で通知する（走査もしない＝巨大 matrix で bounds を読まない）。
- **根拠**: 10 万セルの TSV は概ね数 MB で ws 既定上限内に収まり、大量明細入力（数万行×数列）を妨げない。R-08 は上限定数で構造的に防げる。payload 参照方式は単独グリッドモードに別経路を強いるため、Stage 2 の主 consumer（単独モード・DD-024）と相性が悪い。
- **性能保証の切り分け**: 性能目標（計画書 §21「ローカル適用 250〜500ms」）は **10,000 セル**で実測する（DD-020 Phase 4・headed 計測 `apps/playground/e2e/paste-perf.spec.ts`＝実測 中央値 50ms）。10,000〜100,000 セルの範囲は「動作するが性能目標の対象外」と明示する。

## 既知の未保証境界

- **上限超のユースケース**は本 ADR の対象外（実行前拒否で保護する）。超巨大一括投入・ファイル添付・数式の大量参照など inline 上限を超える transport が要件化したら、payload 参照方式（§14・object key 別送）を別 ADR で再評価する。
- ws 既定上限に依存する（明示的な `maxPayload` 上書きはしていない）。上限セル数×平均セルバイト長が ws フレーム上限へ近づく構成（極端に長い文字列セルの集合）は理論上ありうるが、100,000 セル上限が実効的な安全弁として先に効く。

## 将来の再検討条件

- inline 上限（100,000 セル）を超える一括操作が実案件で要件化 → payload 参照方式（別ストア＋key/hash 参照・GC）を新 ADR で設計（本 ADR は Stage 2 スコープの決定として維持し、上限拡張はその ADR が担う）。
- 共同編集で PostgreSQL 本採用（backlog §2）時に、大 batch の永続化コスト（DB 側の R-08）を実測し、必要なら batch 分割や参照方式を再検討する。
