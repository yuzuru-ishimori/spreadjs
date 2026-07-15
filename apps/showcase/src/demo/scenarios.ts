// 動作デモの5シナリオ定義（DD-017-2 要確認②＝提供中機能の実演台本）。
// features.json の demo リンク（./demo.html?scenario=<id>）と id を一致させること（features.test.ts が検査する）。

export interface DemoScenario {
  readonly id: string;
  readonly title: string;
  /** このシナリオで何が確認できるか（1文）。 */
  readonly goal: string;
  /** 操作手順（画面の脇に表示する）。<code>...</code> はコマンド表示に使う。 */
  readonly steps: readonly string[];
  /** 追加アクション（別ウィンドウを開く等）。 */
  readonly action?: 'open-second-window';
}

export const SCENARIOS: readonly DemoScenario[] = [
  {
    id: 'ime',
    title: '日本語入力（IME）',
    goal: '変換中の文字を取りこぼさず入力できることを確認します。',
    steps: [
      'セルをクリックして日本語を入力し、変換候補を選んで Enter で確定します。',
      '長い文章を変換しながら連続入力しても、先頭文字が欠けたり確定文字が二重になったりしないことを確認します。',
      '変換ウィンドウを表示したまま（未確定のまま）でも、画面や他ユーザーの編集が入力を壊さないことを確認します。',
    ],
  },
  {
    id: 'scroll',
    title: '大量データの高速表示',
    goal: '5万行のデータを滑らかにスクロールできることを確認します。',
    steps: [
      'マウスホイールやスクロールバーで一気にスクロールします（このデモには 50,000 行がシードされています）。',
      '高速スクロール中も行が崩れず、停止後すぐにセル内容が表示されることを確認します。',
      'PageUp / PageDown・矢印キーでのキーボード移動も試せます。',
    ],
  },
  {
    id: 'editing',
    title: 'セル編集・データ型',
    goal: '文字列・数値・日付の入力と型変換、キーボード操作を確認します。',
    steps: [
      'セルに「123」「2026-07-15」「テキスト」をそれぞれ入力し、型に応じて扱われることを確認します。',
      '矢印キー・Enter・Tab でアクティブセルが移動し、画面外へ移動するとスクロールが追従することを確認します。',
      'ドラッグまたは Shift+矢印キーで範囲選択できることを確認します。',
    ],
  },
  {
    id: 'collab',
    title: 'リアルタイム共同編集',
    goal: '複数ウィンドウでの同時編集が即時に相互反映されることを確認します。',
    steps: [
      '下の「別ウィンドウで開く」で2つ目のウィンドウを開き、左右に並べます。',
      '片方のウィンドウでセルを編集すると、もう片方へ即時に反映されることを確認します。',
      '同じセルを両方からほぼ同時に編集すると、後から届いた方が競合として通知され、黙って上書きされないことを確認します（右上の未送信・イベントログ参照）。',
    ],
    action: 'open-second-window',
  },
  {
    id: 'persist',
    title: '保存と復元',
    goal: 'サーバーを再起動しても編集内容が失われないことを確認します。',
    steps: [
      '任意のセルに目印になる値を入力します（例: 「再起動テスト」）。',
      'ターミナルで <code>bash scripts/dev-kill.sh --server</code> を実行し、同期サーバーだけを停止します（右上が「オフライン」になります）。',
      '<code>bash scripts/dev-start.sh --showcase --server-only</code> でサーバーを再起動します。',
      'このページを再読込すると、入力した値が復元されていることを確認します（snapshot＋ログからの復旧）。',
    ],
  },
  {
    id: 'reconnect',
    title: '切断・再接続耐性',
    goal: '切断中の編集が失われず、再接続後に自動送信されることを確認します。',
    steps: [
      'ターミナルで <code>bash scripts/dev-kill.sh --server</code> を実行し、同期サーバーだけを停止します（右上が「オフライン」になります）。',
      'そのままセルをいくつか編集します。右上の「未送信」カウントが増えることを確認します（入力はローカルに保持されています）。',
      '<code>bash scripts/dev-start.sh --showcase --server-only</code> でサーバーを再起動します。',
      '自動的に再接続し、未送信の編集が送信されて「未送信 0」へ戻ることを確認します（再読込は不要です）。',
    ],
  },
];

export function findScenario(id: string | null): DemoScenario {
  const found = SCENARIOS.find((s) => s.id === id);
  return found ?? SCENARIOS[0]!;
}
