# DD-002 Phase 2 生 IME トレース採取手順（実機作業メモ）

> 目的: 状態機械を作る前に、実 IME の**生イベント列**を採取する。ここで採ったトレースを見て
> `scenarios.md`（特に確定 Enter の発火順 Q-1〜5・S-D3/D5）と編集状態機械（Phase 3）を実挙動から確定する。
> このツール（最小常駐 textarea + 生イベント recorder）は**生挙動をそのまま記録するだけ**で、
> 確定 Enter 抑止・pendingNavigation・スクロール追従などの高度制御は入れていない（Phase 3/4 で実装）。

## 対象環境（4 組み合わせ）

Windows 11 で **{Microsoft IME, Google 日本語入力} × {Chrome, Edge}** の 4 通り。
Google 日本語入力が未導入なら先にインストールする。macOS・Firefox は本 PoC 対象外。

## 起動

```bash
npm run dev            # apps/playground が起動（ポートは自動。表示された URL を開く）
```

対象ブラウザーでページを開き、下部パネル「IME イベントトレース」の **IME 欄**に、今から使う IME 名を入力する
（例: `Microsoft IME` / `Google`）。browser / os は UA から自動表示される。

## 採取する代表操作（各組み合わせで実施）

各操作の前に **「クリア」**で記録を空にしてから行うと、対象操作の列だけが残って分析しやすい。
（1 ファイルにまとめて採ってもよい。その場合は操作の区切りが分かるよう少し間を空ける。）

1. **直接入力 → 変換 → 確定 → 移動 → 再入力**
   セルを選び、ローマ字で日本語を入力 → スペースで変換 → Enter で確定 → 矢印/Enter で移動 → 移動先で再度日本語入力。
   （観点: 先頭文字の欠落、移動後の再入力成功、`compositionstart` が移動直後に取れているか。）
2. **確定 Enter**
   変換候補が出ている状態で Enter を押して確定する。続けてもう一度 Enter を押す。
   （観点: 確定の Enter が `keydown{Enter,isComposing:true}`（順序A）か、`compositionend`→`input` の後に
   `keydown{Enter,isComposing:false}` が来る（順序B）か。**最小版は抑止未実装のため、順序B環境では
   確定 Enter でセルが下移動してしまうことがある**が、それも含めて生挙動をそのまま記録する。）
3. **変換中に別セルをクリック**
   日本語を変換中（未確定のまま）に、別のセルをマウスでクリックする。
   （観点: `pointerdown` と composition の前後関係、`compositionend`/`input` の順序。）
4. **変換中にスクロール**
   日本語を変換中に、グリッドを縦スクロールする。
   （観点: composition が壊れず継続するか、`compositionupdate`/`compositionend` の並び。）
5. （任意）F2 で既存値編集、Escape で取消、長文変換、文節移動、再変換、Backspace 開始挙動。

## 保存

パネルの **「JSON エクスポート」**を押すとダウンロードされる。ファイル名は自動で `{ime}-{browser}.json`
（例: `microsoft-ime-chrome.json`）。これを以下へ配置する。

```
doc/DD/DD-002/traces/phase2-raw/{ime}-{browser}.json
```

4 組み合わせぶん（`microsoft-ime-chrome.json` / `microsoft-ime-edge.json` /
`google-chrome.json` / `google-edge.json`）を目標に採る。組み合わせを変えるときは
IME 欄を書き換え、「クリア」してから次の環境で採取する。

## 記録に含まれるイベント

`compositionstart` / `compositionupdate` / `compositionend` / `beforeinput` / `input` /
`keydown` / `keyup` / `focus` / `blur` / `pointerdown`（`preventDefault` より前に記録）。
各行に state（Navigation/Editing/Composing・粗いラベル）・value（textarea の値）・selection・activeCell が付く。

## 採取後（Phase 2 の締め）

採れたトレースを `scenarios.md` の Q-1〜5・S-D3/S-D5 と突き合わせ、
確定 Enter の発火順・先頭文字挙動・composition 境界のブラウザー/IME 差を観察記録にまとめてから、
`scenarios.md` を確定 → **ユーザー確認**（テスト設計の確定）→ Phase 3（状態機械 TDD）へ進む。
