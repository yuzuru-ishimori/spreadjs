// CG-1 実機 IME trace の機械判定（DD-012-1 Phase 4・AC8）。
//
// trace-panel（apps/playground/src/ui/trace-panel.ts）がエクスポートした JSON
//   { meta:{browser,os,ime,userAgent,...}, traces: ImeEventTrace[] }
// を 1 つ以上受け取り、次を機械判定する:
//   - 確定 Enter 順序A（変換中 Enter＝keydown Enter isComposing:true）と
//     順序B（compositionend 後の keydown Enter isComposing:false）が **両方** 採取されているか。
//   - 各 composition セッションで **先頭文字保全（欠落0）**: compositionend.data の先頭文字が
//     確定後の textarea value に先頭から保持されているか（先頭欠落バグの検出）。
//
// 使い方:
//   node scripts/cg1/judge-ime-trace.mjs <trace1.json> [trace2.json ...]
// 出力: 判定サマリ（JSON）を stdout。合格（両順序あり・先頭欠落0）なら exit 0、不合格なら exit 1。
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

  const pass = orderA && orderB && headDrops === 0 && sessionTotal > 0;
  const summary = {
    verdict: pass ? 'PASS' : 'FAIL',
    orderAPresent: orderA,
    orderBPresent: orderB,
    headDropSessions: headDrops,
    sessionTotal,
    perFile,
    criteria: '両順序A/B採取・先頭欠落0・セッション1件以上 で PASS（AC8）',
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(pass ? 0 : 1);
}

main();
