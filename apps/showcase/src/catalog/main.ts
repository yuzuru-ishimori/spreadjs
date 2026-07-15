// 機能カタログの描画（DD-017-2）。features.json（単一データ源・D2）から3区分のカードを生成する。
// このアプリは consumer（apps/*）として @nanairo-sheet/grid Facade 以外の SDK 内部を import しない（R1）。
import featuresData from '../features.json';

type FeatureStatus = 'available' | 'planned' | 'out-of-scope';

interface FeatureEntry {
  readonly id: string;
  readonly title: string;
  readonly status: FeatureStatus;
  readonly summary: string;
  readonly source: string;
  readonly meta?: string;
  readonly demo?: string;
}

interface FeaturesFile {
  readonly updated: string;
  readonly stage: { readonly current: string; readonly date: string };
  readonly features: readonly FeatureEntry[];
}

const data = featuresData as FeaturesFile;

const BADGE: Record<FeatureStatus, { label: string; className: string; cardClass: string }> = {
  available: { label: '提供中', className: 'badge ok', cardClass: 'card' },
  planned: { label: '開発予定', className: 'badge plan', cardClass: 'card plan' },
  'out-of-scope': { label: '対象外', className: 'badge out', cardClass: 'card out' },
};

function renderCard(feature: FeatureEntry): HTMLElement {
  const spec = BADGE[feature.status];
  const card = document.createElement('div');
  card.className = spec.cardClass;
  card.dataset['featureId'] = feature.id;
  // 出典（DD/CG 番号）はカード全体のツールチップで確認できる（利用者語彙を主・出典は裏＝要確認①。
  // meta が空でもホバーで機能するよう、幅のない span ではなくカードへ付ける＝Codex P2#2）。
  card.title = `出典: ${feature.source}`;

  const h3 = document.createElement('h3');
  h3.textContent = feature.title;
  if (feature.status !== 'out-of-scope') {
    const badge = document.createElement('span');
    badge.className = spec.className;
    badge.textContent = spec.label;
    h3.appendChild(document.createTextNode(' '));
    h3.appendChild(badge);
  }
  card.appendChild(h3);

  const p = document.createElement('p');
  p.textContent = feature.summary;
  card.appendChild(p);

  if (feature.status !== 'out-of-scope') {
    const meta = document.createElement('div');
    meta.className = 'meta';
    const metaText = document.createElement('span');
    metaText.textContent = feature.meta ?? '';
    meta.appendChild(metaText);
    if (feature.demo !== undefined) {
      const link = document.createElement('a');
      link.className = 'demo';
      link.href = feature.demo;
      link.textContent = 'デモを見る';
      meta.appendChild(link);
    }
    card.appendChild(meta);
  }

  return card;
}

function gridFor(status: FeatureStatus): HTMLElement {
  const el = document.getElementById(`grid-${status}`);
  if (el === null) throw new Error(`catalog: #grid-${status} が index.html にありません`);
  return el;
}

for (const feature of data.features) {
  gridFor(feature.status).appendChild(renderCard(feature));
}

const stageNow = document.getElementById('stage-now');
if (stageNow !== null) {
  stageNow.textContent = `現在: ${data.stage.current}（${data.stage.date}）`;
}

const footer = document.getElementById('footer');
if (footer !== null) {
  footer.textContent =
    `出典: Stage 1 ロードマップ（doc/plan/phase1-dd-roadmap.md）・Stage 2 バックログ（doc/plan/stage2-backlog.md）・製品憲章。` +
    `本ページの機能一覧は features.json（単一データ源・最終更新 ${data.updated}）から生成され、各開発単位（DD）の完了時に更新されます。`;
}
