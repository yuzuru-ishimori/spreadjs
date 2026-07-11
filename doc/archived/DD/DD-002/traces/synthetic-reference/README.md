# 合成リファレンストレース（⚠️ 実機の実IME出力ではない）

> **これらは手作業で構築した合成（synthetic）リファレンスです。実機の Microsoft IME / Google 日本語入力が
> 出力した本物のトレースではありません。** 計画書 §11.5 の既知の IME 挙動（確定 Enter の発火順 A/B 等）を
> `ImeEventTrace` 形式（Appendix B）で表現したもので、**Phase 3（編集状態機械 TDD）のテスト種**と、
> 実機トレースを突き合わせる際の**期待列の参照**に使う。

## なぜ合成なのか

Claude/Playwright はブラウザに文字を直接挿入する（`insertText`）ため、OS の実 IME を通らず、
本物の `compositionstart`/`compositionupdate`/`compositionend` や `isComposing` を再現できない
（§11.8/§20.5）。したがって、確定 Enter の実発火順・Chrome/Edge の実差・Google 日本語入力固有の差
といった **R-01 の核心はこれらの合成トレースでは判定できない**。それは実機でのみ現れる。

## 実機トレースとの区別

| 種類 | 置き場所 | 由来 | 用途 |
|------|---------|------|------|
| 合成リファレンス（本フォルダ） | `traces/synthetic-reference/` | 手作業・§11.5 準拠 | Phase 3 テスト種・期待列の参照 |
| 実機トレース | `traces/phase2-raw/` | ユーザーの Windows 実機・実 IME | R-01 の実挙動確定（未採取） |

各ファイルの `meta.ime` は `SYNTHETIC ...` と明記してある。実機採取（4環境）は本 PoC の
**Phase 6 受入試験**で実施し、そこで初めて合格条件 1〜5 を実機判定する。

## ファイル

- `orderA-enter-during-composition.json` — 確定 Enter が **composition 中**（`keydown{Enter, isComposing:true}` が `compositionend` より前）。scenarios.md S-D3。
- `orderB-enter-after-compositionend.json` — 確定 Enter が **`compositionend` 後**（`keydown{Enter, isComposing:false}`）。scenarios.md S-D5。**最小 textarea では順序B の確定 Enter がセル下移動になりうる**＝状態機械が `suppressCommitUntilKeyup` で抑止すべき対象。
- `direct-input-convert-confirm-move.json` — 直接入力→変換→確定→**次の独立 Enter で下移動**（「確定の次の Enter で移動」＝受け入れ #2）。
