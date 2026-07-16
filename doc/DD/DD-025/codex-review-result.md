基本的な lifecycle は成立していますが、Concurrent React で未 commit の callback が現行 grid に漏れる問題と、大規模初期データを毎 render 直列化する性能問題があります。callback 差し替えと接続状態の写像にも契約不一致があります。

Full review comments:

- [P1] callback ref は commit 後に更新する — C:\repo\spreadjs\packages\react\src\index.ts:204-212
  `startTransition` や Suspense で document B の render が保留され、document A が引き続き画面に commit されている場合でも、この render 中の代入は共有 ref を B の callback に更新します。その間に A の grid から `cell-commit` が来ると B 用 callback が呼ばれ、A の編集を B へ保存し得ます。callback と props の公開は `useLayoutEffect` など commit 後に行い、未 commit render の値を現行 instance へ漏らさないでください。

- [P1] 初期文書全体を毎 render で直列化しない — C:\repo\spreadjs\packages\react\src\index.ts:150-155
  数万行の `initialData` を渡す consumer では、同じオブジェクトを維持していても親の再 render ごとに文書全体と行高・列幅を `JSON.stringify` するため、React の render がデータ量に比例して同期的に停止します。値比較が合意されているのは識別系配列なので、初期値系の変更警告は参照の記録など、文書全体を走査しない方式にしてください。

- [P2] onDiagnostic も最新 callback へ差し替える — C:\repo\spreadjs\packages\react\src\index.ts:168-168
  `onDiagnostic` を A から B へ変更した場合や mount 後に追加した場合、grid の `createDiagnosticSink` はここで渡した初回 hook を保持するため、以後の boot/connect/destroy 診断は A または無通知のままです。契約では callback 系として remount なしの差し替え対象なので、最新 ref を読む安定したラッパーを grid へ渡してください。

- [P2] mount ごとに接続状態キャッシュを初期化する — C:\repo\spreadjs\packages\react\src\index.ts:276-278
  共同編集 grid を mount して最初の `connection` イベントが来る前にユーザーが編集すると、`pending` は実際には `offline` でも初期値の `stopped` として通知されます。また識別系変更による remount では以前の `online` 状態を引き継ぐことがあります。instance 作成時に `instance.connectionState()` から `lastConnStateRef` を初期化し、新しい mount の pending を旧状態で通知しないようにしてください。