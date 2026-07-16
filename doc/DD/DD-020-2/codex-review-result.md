画面外まで拡張した選択で clipboard listener が到達不能になり、主要操作が失敗します。また、standalone の既存イベント契約を破る実行前拒否通知が追加されています。

Full review comments:

- [P1] Keep clipboard handling alive when the anchor scrolls away — C:\repo\spreadjs\packages\grid\src\integration-editor.ts:258-258
  Shift+矢印で選択端をスクロール追従させて active-cell の anchor が画面外へ出ると、`refreshPlacement` が textarea を `display:none` にしてフォーカスが外れます。その後の copy/cut/paste は textarea 以外を対象に発火するため、ここにだけ登録した listener が呼ばれず、大きな範囲でクリップボード操作が機能しません。Navigation 中は textarea をフォーカス可能な状態で保持するか、フォーカスが外れても届く要素へ listener を配置する必要があります。

- [P2] Preserve the standalone no-rejected contract — C:\repo\spreadjs\packages\grid\src\mount-controller.ts:980-984
  `mode:'standalone'` で上限超過または範囲外の paste/cut を行うと、同じ callback が配線されているためこの `rejected` が発火します。これは `doc/archived/DD/DD-024/standalone-contract.md` と `doc/quick-start.md` の「standalone では rejected は発火しない」という公開契約に反し、保存側が共同編集競合と誤認できます。standalone では通知を抑止するか、契約変更として関連仕様とテストを一貫して更新してください。