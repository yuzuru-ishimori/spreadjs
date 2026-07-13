// CG-1 実機 IME trace の機械判定（DD-012-1 Phase 4・AC8）。
//
// trace-panel（apps/playground/src/ui/trace-panel.ts）がエクスポートした JSON
//   { meta:{browser,os,ime,userAgent,...}, traces: ImeEventTrace[] }
// を 1 つ以上受け取り、次を機械判定する（PASS 条件は 2026-07-13 の実機知見で改訂）:
//   - **先頭文字保全（欠落0）**: 各 composition セッションで compositionend.data の先頭文字が
//     確定後の textarea value に先頭から保持されているか（＝CG-1 が最も守る先頭欠落バグの実機担保）。
//   - **確定 Enter 順序B**（compositionend 後の keydown Enter isComposing:false）の実機採取。
//   - **Tier-1 両ブラウザ（Chrome・Edge）** をカバーしているか。
//
// 【順序A について（2026-07-13 実機知見・ユーザー判断）】
//   順序A（変換中 Enter＝keydown Enter isComposing:true）は、現行 Tier-1（Windows Chromium 150・
//   Chrome/Edge）では **構造的に発生しない**（確定 Enter は key=Process(229)＋compositionend 先行＝
//   順序B に統一）。実機採取 25 セッションで順序A=0・先頭欠落=0 を確認。よって順序Aは「実機で証明する
//   対象」ではなく「状態機械が備える防御経路」とし、**自動不変条件・E2E（synthetic）で担保**（green）。
//   実機 PASS 条件から順序Aの必須要件を外す（順序Aは informational として報告）。詳細=DD-012-1 evidence.md。
//
// 使い方:
//   node scripts/cg1/judge-ime-trace.mjs <trace1.json> [trace2.json ...]
// 出力: 判定サマリ（JSON）を stdout。合格（先頭欠落0・順序B採取・Chrome/Edge両カバー）なら exit 0、不合格なら exit 1。
//
// これは Phase 4（人手・実機 Win Chrome/Edge）で採取した trace を検証するためのツール。
// Phase 3 までに用意し、synthetic フィクスチャ（fixtures/）で判定ロジックを検証済み。

import fs from 'node:fs';

/** 1 ファイルの trace 配列を読む（{traces:[...]} でも生配列でも受ける）。 */
function loadTraces(path) {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  const traces = Array.isArray(raw) ? raw : raw.traces;
  if (!Array.isArray(traces)) {
    throw new Error(`${path}: traces 配列が見つからない`);
  }
  return { path, meta: raw.meta ?? {}, traces };
}

/**
 * trace 列を composition セッションへ分割し、各セッションで
 *   - composed: compositionend.data（確定文字列）
 *   - finalValue: 確定後の textarea value（compositionend 以降の最初の非 composing input か compositionend の value）
 *   - confirmOrder: 'A' | 'B' | null（確定 Enter の順序）
 * を求める。
 */
function analyze(traces) {
  const sessions = [];
  let cur = null;

  const finalize = () => {
    if (cur === null) return;
    // 順序A: 変換中（isComposing:true）の確定 Enter を見た。
    // 順序B: compositionend 後（非 composing）に確定 Enter を見た（かつ順序A でない）。
    cur.order = cur.sawComposingEnter ? 'A' : cur.sawPostEndEnter ? 'B' : null;
    sessions.push(cur);
    cur = null;
  };

  for (const t of traces) {
    if (t.eventType === 'compositionstart') {
      finalize(); // 前セッションを閉じる（セッションは次の compositionstart まで＝確定/移動を含む）。
      cur = {
        composed: '',
        endValue: null,
        finalValue: null,
        ended: false,
        sawComposingEnter: false,
        sawPostEndEnter: false,
        order: null,
      };
      continue;
    }
    if (cur === null) continue;
    switch (t.eventType) {
      case 'compositionupdate':
        cur.composed = t.data ?? cur.composed;
        break;
      case 'compositionend':
        cur.composed = t.data ?? cur.composed;
        cur.endValue = t.value ?? '';
        cur.ended = true;
        break;
      case 'input':
        if (t.isComposing === false && cur.ended && cur.finalValue === null) {
          cur.finalValue = t.value ?? '';
        }
        break;
      case 'keydown':
        if (t.key === 'Enter') {
          if (t.isComposing === true) {
            cur.sawComposingEnter = true; // 順序A の印（変換中の確定 Enter）
          } else if (cur.ended) {
            cur.sawPostEndEnter = true; // 順序B の印（compositionend 後の確定 Enter）
          }
        }
        break;
      default:
        break;
    }
  }
  finalize();
  return sessions;
}

/** 先頭文字保全: composed の先頭文字が確定後 value に先頭から残っているか。 */
function headPreserved(session) {
  const composed = session.composed ?? '';
  if (composed === '') return true; // 空変換は対象外
  const value = session.finalValue ?? session.endValue ?? '';
  // 置換編集（空セル）想定: value は composed で始まる（先頭欠落なし）。
  // 既存値編集で前置がある場合も composed 全体を含めば先頭欠落なしとみなす。
  return value.startsWith(composed) || value.includes(composed);
}

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: node scripts/cg1/judge-ime-trace.mjs <trace.json> [...]');
    process.exit(2);
  }

  const perFile = [];
  let orderA = false;
  let orderB = false;
  let headDrops = 0;
  let sessionTotal = 0;

  for (const f of files) {
    const { path, meta, traces } = loadTraces(f);
    const sessions = analyze(traces);
    let fileA = false;
    let fileB = false;
    let fileDrops = 0;
    for (const s of sessions) {
      if (s.order === 'A') fileA = true;
      if (s.order === 'B') fileB = true;
      if (!headPreserved(s)) fileDrops += 1;
    }
    orderA = orderA || fileA;
    orderB = orderB || fileB;
    headDrops += fileDrops;
    sessionTotal += sessions.length;
    perFile.push({
      file: path,
      env: { browser: meta.browser, os: meta.os, ime: meta.ime },
      sessions: sessions.length,
      orderA: fileA,
      orderB: fileB,
      headDrops: fileDrops,
    });
  }

  // Tier-1 両ブラウザ（Chrome/Edge）カバレッジ（meta.browser を lower-case で判定）。
  const browsers = new Set(
    perFile.map((p) => (p.env.browser ?? '').toLowerCase()).filter((b) => b !== ''),
  );
  const hasChrome = [...browsers].some((b) => b.includes('chrome'));
  const hasEdge = [...browsers].some((b) => b.includes('edge'));
  const bothBrowsers = hasChrome && hasEdge;

  // PASS 条件（2026-07-13 改訂）: 先頭欠落0・順序B採取・Tier-1 両ブラウザ・セッション1件以上。
  // 順序A は実機で構造的に発生しないため必須から除外（自動テストで担保・informational 報告）。
  const pass = orderB && headDrops === 0 && sessionTotal > 0 && bothBrowsers;
  const summary = {
    verdict: pass ? 'PASS' : 'FAIL',
    orderBPresent: orderB,
    headDropSessions: headDrops,
    sessionTotal,
    tier1Browsers: { chrome: hasChrome, edge: hasEdge, bothCovered: bothBrowsers },
    orderAPresent_informational: orderA,
    orderANote:
      '順序A（keydown Enter isComposing:true）は現行 Tier-1(Chromium 150) で構造的に発生せず（実機25セッションで0）。自動不変条件・E2E で担保。実機 PASS 条件からは除外（DD-012-1 evidence.md）。',
    perFile,
    criteria: '先頭欠落0・順序B採取・Chrome/Edge両カバー・セッション1件以上 で PASS（AC8・2026-07-13改訂）',
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(pass ? 0 : 1);
}

main();
