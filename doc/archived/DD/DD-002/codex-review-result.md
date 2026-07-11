IME イベント順によって正規の Enter が抑止されたり、最終 input 前の値がコミットされたりする中核的な状態遷移不具合があります。また、競合 draft の破棄経路とシミュレーター UI のフォーカス問題もあるため、現状では PoC-A の受け入れ条件を満たしません。

Full review comments:

- [P1] event.isComposing も変換中判定に含める — C:\repo\spreadjs\apps\playground\src\ime\editor-state-machine.ts:216-217
  ブラウザーのイベント順差により内部 `composing` がまだ立っていない一方で `keydown.isComposing` が true の場合、この分岐を通過して Enter/Tab/矢印が通常ナビゲーションとして処理されます。I-2 は DOM の `isComposing` と内部フラグの併用を要求しているため、ここでも `event.isComposing` を判定しないと R-01 の対象環境で確定 Enter による誤移動が起こります。

- [P1] Enter 以外で確定した後の通常 Enter を抑止しない — C:\repo\spreadjs\apps\playground\src\ime\editor-state-machine.ts:337-339
  このフラグはすべての `compositionend` で無条件に立つため、候補のマウス選択やフォーカス変更など Enter を伴わない確定でも、次にユーザーが押した正規の Enter が `SuppressKey` として飲まれます。これは「確定の次の Enter で下移動」という受け入れ #2 に反するので、確定 Enter と関連付けられる場合だけ抑止状態に入る必要があります。

- [P1] 最終 input 前の blur で暫定値をコミットしない — C:\repo\spreadjs\apps\playground\src\ime\editor-state-machine.ts:469-477
  `compositionend` と後続の確定 `input` の間に blur が届くイベント順では、`EditingAwaitFinalInput` の暫定的な `compositionBase + data` がここで Commit されます。その後の正しい input は Navigation から新規編集を開始して未確定のまま残るため、I-1 に反して保存値が欠落または不正になります。AwaitFinalInput 中の blur は最終 input まで保留すべきです。

- [P1] 競合中のダブルクリックでドラフトを破棄しない — C:\repo\spreadjs\apps\playground\src\ime\editor-state-machine.ts:443-448
  競合中に別セルをダブルクリックすると、先行する pointerdown は commit を保留しますが、この処理は Commit を省略したまま `beginExistingEffects(cell)` を実行します。これにより競合フラグとローカル draft が黙って消え、別セルの編集へ遷移するため、S-F5 のサイレント上書き・破棄防止が迂回されます。競合中はダブルクリックも無視または明示的な解決待ちにする必要があります。

- [P2] シミュレーター操作前に textarea の blur を防ぐ — C:\repo\spreadjs\apps\playground\src\main.ts:102-105
  シミュレーターボタンをマウス操作すると、`click` ハンドラーより先に既定のフォーカス移動で textarea が blur します。非 composing 編集は先に Commit され、IME 変換中なら composition 自体が終了するため、「変換中の編集中セルへ更新して draft を維持する」という §11.7／受け入れ #4・#5 の advertised scenario をこの UI では再現できません。ボタンの pointerdown でフォーカス移動を抑止するなど、更新投入まで textarea のフォーカスを維持する必要があります。