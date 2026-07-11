# DD-002 編集状態機械テストシナリオ（自然言語）

> 目的: 計画書 §11.2/§11.4/§11.5/§11.6/§11.7 の編集状態機械を、Phase 2 で TDD コード化する前に
> 「操作 → 期待結果」で洗い出し、**ユーザー合意**を得る（guides.md §8）。
> ここで合意したシナリオを `apps/playground/src/ime/editor-state-machine.test.ts` へ synthetic な
> composition/keyboard/input 列として写像する。**本ファイルは実 IME の受入試験（Phase 5・手動）の代替ではない**
> — synthetic イベントでは候補ウィンドウやブラウザー間のイベント順差を再現できないため（§11.8/§20.5）。

## 0. 前提モデル（シナリオの語彙）

**状態（§11.2）**

| 状態 | 意味 |
|------|------|
| `Navigation` | 編集していない。常駐 textarea は空・フォーカス維持（§11.3）。 |
| `EditingReplace` | 直接入力で開始した編集。開始時に既存値を捨てて空から入力。 |
| `EditingExisting` | F2／ダブルクリックで開始した編集。既存値を初期値に持つ。 |
| `Composing` | IME 変換中（`isComposing` かつ内部 composing フラグ）。 |
| `EditingAwaitFinalInput` | `compositionend` 受信後、確定テキストを載せる最終 `input` を待つ短い状態。 |

`EditingReplace`/`EditingExisting` は「初期値が空か既存値か」だけが違い、確定後は共通の編集状態として扱う。

**入力イベント（machine への入力。DOM から抽出した素の値）**

`keydown{key,code,isComposing,shiftKey,altKey}` / `compositionstart` / `compositionupdate{data}` /
`compositionend{data}` / `beforeinput{inputType,data}` / `input{value,selectionStart,selectionEnd,isComposing,inputType}` /
`keyup{key,isComposing}` / `pointerdown{cell|header|outside}` / `f2` / `doubleClick{cell}` / `remoteUpdate{cell,value|delete}` /
`blur` / `focus`

**出力エフェクト（machine の出力。UI アダプタが適用）**

`BeginEdit(mode,cell,initialValue)` / `UpdateDraft(value)` / `Commit(cell,value)` / `Move(direction)` /
`MoveTo(cell)` / `Cancel` / `MarkConflict(cell)` / `SetPendingNavigation(cell)` / `ClearPendingNavigation` /
`SuppressKey`（IME 確定 Enter 等を握りつぶす）/ `None`

**不変条件（§11.5・§11.9。全シナリオで常に満たす）**

- I-1: 値の正は `input` 後の `textarea.value`。`keydown` だけで文字入力を推測しない。
- I-2: `isComposing` と内部 composing フラグの **両方** を見る。`keyCode === 229` は主判定にしない（限定 fallback のみ）。
- I-3: composition 中は textarea の `value`/selection/DOM 親/クラスを変更しない（再マウント・整形・サーバー値反映をしない）。
- I-4: IME 確定 Enter を通常 Enter として扱わない。
- I-5: セル移動でフォーカスを別 input へ移さない（常駐 textarea は 1 個を使い回す）。

---

## A. Navigation 状態（編集に入らない）

| ID | 前提 | 操作 | 期待結果 |
|----|------|------|---------|
| S-A1 | Navigation・A1 選択 | `ArrowDown` | アクティブセルが下へ 1 移動。状態は Navigation のまま。`BeginEdit` は出さない。 |
| S-A2 | Navigation・端 A1 | `ArrowUp` / `ArrowLeft` | 端でクランプし移動しない。Navigation のまま。 |
| S-A3 | Navigation・B2 選択 | `Enter` / `Shift+Enter` / `Tab` / `Shift+Tab` | それぞれ 下／上／右／左 へ移動。Navigation のまま（編集しない）。 |
| S-A4 | Navigation・値ありセル | `Delete` | そのセルを空にする（`Commit(cell,'')`）。Navigation のまま・移動しない。 |
| S-A5 | Navigation | `pointerdown{別セル}` | クリック先を選択（`MoveTo`）。Navigation のまま。 |
| S-A6 | Navigation | `pointerdown{ヘッダー/範囲外}` | 選択を変えない・何もしない（`None`）。 |

---

## B. 直接入力（EditingReplace・非 IME / ASCII）

| ID | 前提 | 操作 | 期待結果 |
|----|------|------|---------|
| S-B1 | Navigation・既存値 "old" の A1 | printable キー `a`（→ `beforeinput`→`input{value:"a"}`） | `BeginEdit(replace,A1,"")` 後 `EditingReplace`。既存値 "old" は捨て、draft は "a"（I-1: value の正は input 後）。 |
| S-B2 | S-B1 後（EditingReplace, draft "a"） | `b` を続けて入力 | draft "ab"。状態は EditingReplace のまま。 |
| S-B3 | EditingReplace, draft "ab" | `Enter`（isComposing=false） | `Commit(A1,"ab")` → `Move(down)` → Navigation。 |
| S-B4 | S-B3 直後（Navigation・A2） | `Enter` | 通常移動で下へ（S-A3）。直前の commit-Enter と混同しない。 |
| S-B5 | EditingReplace, draft "ab" | `Tab` | `Commit(A1,"ab")` → `Move(right)` → Navigation。 |
| S-B6 | EditingReplace, draft "ab" | `Escape` | `Cancel`。A1 は元の "old" のまま。Navigation へ戻る・移動しない。 |
| S-B7 | Navigation・空 A1 | `Delete` を先に押さず printable `x` | 空セルでも EditingReplace 開始し draft "x"。 |

---

## C. 既存値編集（EditingExisting・F2／ダブルクリック）

| ID | 前提 | 操作 | 期待結果 |
|----|------|------|---------|
| S-C1 | Navigation・値 "山田" の A1 | `f2` | `BeginEdit(existing,A1,"山田")` → `EditingExisting`。textarea に "山田"、キャレットは末尾（§11.4）。 |
| S-C2 | Navigation・値 "山田" の A1 | `doubleClick{A1}` | `BeginEdit(existing,A1,"山田")`。初期キャレットは末尾でも可（§11.4）。 |
| S-C3 | S-C1 後（EditingExisting "山田"） | `子` を追記 → `Enter` | draft "山田子" を `Commit(A1,"山田子")` → `Move(down)`。 |
| S-C4 | EditingExisting "山田" | `Escape` | `Cancel`。A1 は "山田" のまま。 |
| S-C5 | Navigation・空セル | `f2` | EditingExisting・初期値 ""。空からの編集を許可。 |

---

## D. IME 変換（Composing・確定 Enter と通常 Enter の区別）★中核

| ID | 前提 | 操作（イベント列） | 期待結果 |
|----|------|------|---------|
| S-D1 | Navigation・A1（textarea 空） | `compositionstart` → `compositionupdate{"にほn"}` → `compositionupdate{"日本"}` | `BeginEdit(replace,A1,"")` 相当を経て `Composing`。draft は変換中文字列（`UpdateDraft`）。**textarea の value/selection を machine から書き換えない**（I-3）。 |
| S-D2 | S-D1（Composing "日本"） | `compositionend{"日本"}` → `input{value:"日本",isComposing:false}` | `EditingAwaitFinalInput` を経て、最終 `input` で確定値 "日本" を採用し編集状態へ（I-1）。まだ Commit しない・移動しない。 |
| S-D3 ★ | Composing "日本"（変換候補確定のための Enter） | 【順序A】`keydown{Enter,isComposing:true}` → `compositionend{"日本"}` → `input{"日本"}` | 確定 Enter を **抑止**（`SuppressKey`）。Commit も Move もしない（I-4）。状態は編集状態（確定済み・同一セル）。 |
| S-D4 ★ | S-D3 後（確定済み・同一セル A1・isComposing=false） | `keydown{Enter,isComposing:false}`（次の独立した Enter） | `Commit(A1,"日本")` → `Move(down)`。**「確定の次の Enter」で下移動**（受け入れ #2）。 |
| S-D5 ★ | Composing "日本" | 【順序B】`compositionend{"日本"}` → `input{"日本"}` → `keydown{Enter,isComposing:false}`（同一キー押下由来）→ `keyup{Enter}` | `compositionend` 後は `suppressCommitUntilKeyup` を立て、**keyup までの最初の Enter keydown を抑止**（`SuppressKey`）。この Enter では Commit/Move しない。keyup でフラグ解除。以後の独立 Enter（S-D4）で初めて commit。 |
| S-D6 | Navigation | `keydown{key:"Process",code:"KeyA",keyCode:229 相当}`（IME 由来の生キー） | `keyCode 229` を主判定にしない（I-2）。composition 開始は `compositionstart`/`isComposing` で判断する。229 だけで commit や移動を起こさない。 |
| S-D7 | 直前セルで確定→下移動した直後（Navigation・A2・textarea は空にリセット・同一 textarea） | 直ちに `compositionstart` → 変換 → 確定 | 先頭文字の欠落なく Composing 開始（受け入れ #1）。移動でフォーカスを別要素へ移さないため（I-5）先頭 keystroke を取りこぼさない。 |
| S-D8 | Composing 中 | `keydown{ArrowDown,isComposing:true}`（IME 候補選択の矢印） | ナビゲーション移動として扱わない＝抑止／キュー（§11.2 Composing: navigation input → Suppress/Queue）。アクティブセルは動かさない。 |
| S-D9 | Composing 中 | `keydown{Tab,isComposing:true}` | 同上。変換中の Tab はセル移動にしない。compositionend 後の独立した Tab で初めて commit+右移動。 |
| S-D10 | Composing "にほん"（未確定のまま） | `Escape`（1 回目） | IME 側の取消を優先（§11.4）。この 1 回目では編集セルの Cancel を確定しない（compositionend{data:""} 等で composition だけ取り消す）。 |
| S-D11 | S-D10 後（composition 取消済み・非 composing の編集状態 or 空） | `Escape`（2 回目） | ここで初めて `Cancel`（編集取消）。セルは元値のまま Navigation へ。 |

---

## E. 変換中に別セルクリック（pendingNavigation・§11.6）★

| ID | 前提 | 操作 | 期待結果 |
|----|------|------|---------|
| S-E1 ★ | Composing "日本"（A1 編集中） | `pointerdown{C3}` | クリック先 C3 を `SetPendingNavigation(C3)`。**composition を壊す DOM 操作をしない**（I-3）。状態は Composing のまま・draft 保持・アクティブセルはまだ A1。 |
| S-E2 ★ | S-E1 後 | `compositionend{"日本"}` → `input{"日本"}`（最終 input 受信） | Commit を試み、競合なしなら `Commit(A1,"日本")` → `MoveTo(C3)` → `ClearPendingNavigation`（§11.6「最終 input 後に commit、競合なければクリック先へ」）。 |
| S-E3 ★ | S-E1 後・かつ composition 中に A1 がリモート変更（S-F2 発生） | `compositionend` → `input` | 競合あり。**現在セル A1 に留まり draft を保持**。C3 へ移動しない。`MarkConflict(A1)` 維持・`pendingNavigation` は保持または破棄（後述 Q-3）。 |
| S-E4 | S-E1 後（pendingNavigation=C3・Composing） | `Escape` 2 回（S-D10/11 と同様） | 編集取消 `Cancel`＋`ClearPendingNavigation`。アクティブセルは A1 のまま（クリック先へは移動しない）。 |

---

## F. リモート更新（§11.7・MarkConflictOnly）★

| ID | 前提 | 操作 | 期待結果 |
|----|------|------|---------|
| S-F1 ★ | Composing "日本"（A1 編集中） | `remoteUpdate{B5,"他人の値"}`（別セル） | cell-store 更新 → Canvas 再描画は可。**textarea の DOM/value/selection は不変**。A1 の draft 消失なし・Composing 継続・A1 に競合マークなし（受け入れ #5「他セルへ更新 → ドラフト消失0件」）。 |
| S-F2 ★ | Composing "日本"（A1 編集中） | `remoteUpdate{A1,"別値"}`（編集中セルそのもの） | `MarkConflict(A1)` のみ（MarkConflictOnly）。**textarea を書き換えない・サーバー値を draft へ反映しない**（I-3・§11.9）。Composing 継続・draft "日本" 保持（受け入れ #5）。 |
| S-F3 ★ | Composing "日本"（A1 編集中） | `remoteUpdate{A1,delete}`（編集中セルが削除） | draft を「復元可能な競合」として退避（§11.7）。`MarkConflict(A1)`。draft 保持・composition 継続。 |
| S-F4 ★ | Composing "日本"（A1 編集中） | `remoteUpdate` を短間隔で連続（他セルへ N 回・再描画誘発） | 各回で Canvas 再描画されても Composing draft は不変（受け入れ #4「変換中の Canvas 再描画で文字消失0件」）。 |
| S-F5 | S-F2 後（A1 競合マーク・compositionend 済みで確定 "日本"） | `Enter`（commit しようとする） | 競合未解決のためサイレント上書きしない。draft "日本" と競合マークを保持し、commit を保留（競合解決ダイアログはスコープ外＝Q-2）。移動しない。 |

---

## G. 移動直後の再入力（受け入れ #3）

| ID | 前提 | 操作 | 期待結果 |
|----|------|------|---------|
| S-G1 | 任意セルで `Enter` 確定→下移動した直後（Navigation） | 直ちに日本語入力（compositionstart→…） | 移動先で即 Composing 開始・成功（先頭欠落なし）。 |
| S-G2 | `ArrowRight` で移動した直後（Navigation） | 日本語入力 | 移動先で即 EditingReplace→Composing。成功率 100%。 |
| S-G3 | `Tab` / `Shift+Tab` / `Shift+Enter` で移動した直後 | 日本語入力 | いずれの移動後も再入力成功（受け入れ #3 の 5 経路 = 矢印/Enter/Shift+Enter/Tab/Shift+Tab を網羅）。 |

---

## H. フォーカス・その他境界

| ID | 前提 | 操作 | 期待結果 |
|----|------|------|---------|
| S-H1 | EditingReplace（draft "ab"・非 composing） | `blur`（別要素へフォーカス移動） | 編集確定として `Commit(A1,"ab")`（Excel 準拠。commit-on-blur）。または方針 Q-4 に従う。 |
| S-H2 | Composing 中 | `blur` | composition 中の強制確定・強制 blur を machine から誘発しない（§11.6）。実挙動は Phase 5 観察（recorder 記録）。 |
| S-H3 | Navigation | `focus`（常駐 textarea が再フォーカス） | 状態不変。textarea は空・Navigation 維持（I-5：フォーカスは常駐 textarea に維持）。 |

---

## 未確定・ユーザー判断が要る点（合意ゲートで確認）

> **2026-07-11 ユーザー合意: Q-1〜Q-5 は下記の仮決めどおり採用。**
> ただし本DDは「トレース先行方針」へ再構成されたため、これらは **Phase 2 の実IMEトレース採取後に最終確定**する
> （実挙動が仮決めと食い違った場合のみ調整し、再度ユーザー確認する）。状態機械のコード化は Phase 3。
>
> 以下はシナリオ内で仮決め（provisional）にしてある。

- **Q-1（Backspace 開始挙動・§11.4）**: Navigation で `Backspace` を押したときの挙動。Excel は「セルクリア後に編集開始」する。
  本 PoC の仮決め = **Backspace は選択セルをクリアして空の EditingReplace に入る**（Delete はクリアのみで Navigation 維持＝S-A4）。
  実挙動は Phase 5 で実 IME・実ブラウザー観察 → 確定。→ この仮決めで S-B/S-A にテストを起こしてよいか。
- **Q-2（変換中リモート競合の解決・§11.7）**: 競合解決ダイアログはスコープ外。仮決め = **競合マーク＋draft 保持で commit を保留**（S-F5）し、
  競合セルへの明示操作（再編集/破棄）は Phase 5 観察に回す。この範囲でよいか。
- **Q-3（pendingNavigation × 競合の後始末・S-E3）**: 変換中クリック先を持ったまま競合した場合、`pendingNavigation` を
  **保持**（競合解決後に移動）するか **破棄**（留まって明示クリックを待つ）か。仮決め = **破棄**（現在セルに留まる）。
- **Q-4（commit-on-blur・S-H1）**: 非 composing 編集中の `blur` を commit 扱いにするか cancel 扱いにするか。
  仮決め = **commit**（Excel 準拠）。composition 中 blur は machine から誘発しない（S-H2）。
- **Q-5（スクロール追従方式・§11.6）**: 変換中スクロールは 3 方式のうち **方式2（textarea をセルへ追従）** を PoC 採用予定
  （Phase 3）。残り 2 方式は比較メモに留める。この 1 方式先行でよいか。

## 実 IME 手動試験の前提（ユーザー合意反映・Phase 4 手順書へ引き継ぐ）

- 対象 IME: **Microsoft IME ＋ Google 日本語入力の両方**（Google 未導入ならユーザーがインストールして試験）。
- 対象ブラウザー: **Chrome ＋ Edge の両方**。
- **macOS・Firefox は本 PoC の判定対象外**（Phase 0 後半以降へ送る）。
- 上記の環境差（特に S-D3〔順序A〕と S-D5〔順序B〕の Enter 発火順）は synthetic では再現しきれないため、
  Phase 3 recorder のトレースと Phase 5 手動試験で確認する。
