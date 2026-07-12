// 初期ロード計測（DD-005 #6・合否でなく記録）。統合ページの起動〜初回操作可能までのマイルストーンと、
// WS operations 転送量・JSON parse 時間を集計する。DOM 非依存（now は注入。既定は performance.now）。
// 実際の数値はヘッドレスでは取れないため、統合ページ（headed smoke）で計測して DD-005/initial-load-metrics.md へ記録する。

/** 計測マイルストーン（起票の #6 経路に対応）。 */
export type LoadMilestone =
  | 'pageStart' // 計測開始（スクリプト実行直後）
  | 'wsConnected' // WebSocket open（handleConnected）
  | 'firstSync' // ClientSession が既知サーバー revision まで committed 到達（Document State ready）
  | 'axisBuilt' // 最初の構造 flush 完了（rowAxis 構築＝Render State ready）
  | 'firstDraw' // 初回 Canvas 描画完了
  | 'firstOperable'; // 初回操作可能（描画済み＋入力配線完了）

export interface LoadTransfer {
  /** 受信した operations フレーム数。 */
  frames: number;
  /** 受信文字数の合計（初期 snapshot 転送量の proxy）。 */
  chars: number;
  /** JSON parse 累計（ms）。 */
  parseMillis: number;
}

export interface LoadMetricsReport {
  /** 各マイルストーンの pageStart からの経過（ms）。未到達は欠落。 */
  elapsed: Partial<Record<LoadMilestone, number>>;
  /** 主要スパン（ms・両端が揃ったものだけ）。 */
  spans: Record<string, number>;
  transfer: LoadTransfer;
}

const SPAN_DEFS: Array<{ name: string; from: LoadMilestone; to: LoadMilestone }> = [
  { name: 'wsConnect', from: 'pageStart', to: 'wsConnected' },
  { name: 'clientSessionInit', from: 'wsConnected', to: 'firstSync' },
  { name: 'axisBuild', from: 'firstSync', to: 'axisBuilt' },
  { name: 'firstDraw', from: 'axisBuilt', to: 'firstDraw' },
  { name: 'toFirstOperable', from: 'pageStart', to: 'firstOperable' },
];

export interface LoadMetrics {
  /** マイルストーンを記録する（最初の 1 回だけ有効＝one-shot）。 */
  mark(name: LoadMilestone): void;
  /** 受信フレームの転送量を加算する（browser-transport の onServerFrame から）。 */
  recordFrame(info: { chars: number; parseMillis: number }): void;
  /** 現在のレポートを返す。 */
  report(): LoadMetricsReport;
  /** 人間可読テキスト（readout・エクスポート用）。 */
  toText(): string;
}

export function createLoadMetrics(now: () => number = () => performance.now()): LoadMetrics {
  const start = now();
  const marks = new Map<LoadMilestone, number>();
  const transfer: LoadTransfer = { frames: 0, chars: 0, parseMillis: 0 };
  marks.set('pageStart', 0);

  const buildReport = (): LoadMetricsReport => {
    const elapsed: Partial<Record<LoadMilestone, number>> = {};
    for (const [name, value] of marks) {
      elapsed[name] = value;
    }
    const spans: Record<string, number> = {};
    for (const def of SPAN_DEFS) {
      const from = marks.get(def.from);
      const to = marks.get(def.to);
      if (from !== undefined && to !== undefined) {
        spans[def.name] = to - from;
      }
    }
    return { elapsed, spans, transfer: { ...transfer } };
  };

  return {
    mark(name) {
      if (!marks.has(name)) {
        marks.set(name, now() - start);
      }
    },
    recordFrame(info) {
      transfer.frames += 1;
      transfer.chars += info.chars;
      transfer.parseMillis += info.parseMillis;
    },
    report: buildReport,
    toText() {
      const report = buildReport();
      const spanText = SPAN_DEFS.map((def) => {
        const value = report.spans[def.name];
        return `${def.name}=${value === undefined ? '—' : `${value.toFixed(1)}ms`}`;
      }).join('  ');
      const kb = (report.transfer.chars / 1024).toFixed(0);
      return [
        `初期ロード: ${spanText}`,
        `転送(operations): ${report.transfer.frames}フレーム / ${kb}KB(chars) / parse ${report.transfer.parseMillis.toFixed(1)}ms`,
      ].join('\n');
    },
  };
}
