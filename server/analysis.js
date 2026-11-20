// Market-condition and index-analysis service. All the rules live in public/shared/condition.js.
const feed = require('./feed');
const TA = require('../public/shared/ta.js');
const C = require('../public/shared/condition.js');
const { INDICES, MEMBERS, bySymbol } = require('./universe');
const { TTLCache, istNow, marketOpen } = require('./util');
const store = require('./store');

const cache = new TTLCache();
const MAIN = ['NIFTY', 'BANKNIFTY', 'SENSEX'];

async function candles(symbol, interval, count, priority) {
  try { return { data: await feed.candles(symbol, interval, count, priority) }; }
  catch (e) { return { data: null, error: `${interval}: ${e.message}` }; }
}

async function conditionsFor(symbol, priority = 'high') {
  const q = feed.quote(symbol);
  const [i5, d1] = await Promise.all([candles(symbol, '5m', 150, priority), candles(symbol, '1d', 420, priority)]);
  const intraday = C.intraday(i5.data, q && q.close);
  const short = C.shortTerm(d1.data);
  const medium = C.mediumTerm(d1.data);
  if (i5.error && !i5.data) intraday.note = i5.error;
  if (d1.error && !d1.data) { short.note = d1.error; medium.note = d1.error; }
  return { conds: [intraday, short, medium], overall: C.overall([intraday, short, medium]), daily: d1.data, errors: [i5.error, d1.error].filter(Boolean) };
}

/* ---------- top-bar summary: the three main indices + VIX ---------- */
async function marketSummary() {
  const hit = cache.get('summary');
  if (hit) return hit;
  const per = await Promise.all(MAIN.map(async (s) => {
    const r = await conditionsFor(s);
    const q = feed.quote(s);
    return {
      symbol: s, name: bySymbol.get(s).name, quote: q || null, overall: r.overall, errors: r.errors,
      conditions: r.conds.map((c) => ({ tf: c.tf, label: c.label, score: c.score })),
    };
  }));
  // One chip per timeframe: majority across the three indices, average score
  const tfs = ['Intraday', 'Short term', 'Medium term'].map((tf, k) => {
    const items = per.map((p) => p.conditions[k]).filter((c) => c.label !== 'No data');
    const bull = items.filter((c) => c.label === 'Bullish').length, bear = items.filter((c) => c.label === 'Bearish').length;
    const label = !items.length ? 'No data' : bull >= 2 ? 'Bullish' : bear >= 2 ? 'Bearish' : 'Sideways';
    const score = items.length ? Math.round(items.reduce((s, c) => s + c.score, 0) / items.length) : null;
    return { tf, label, score };
  });
  const overall = C.overall(tfs);
  const out = { asOf: Date.now(), indices: per, vix: feed.quote('INDIAVIX') || null, timeframes: tfs, overall };
  cache.set('summary', out, 20000);
  return out;
}

// Synchronous snapshot used to tag paper trades with the market condition at entry
function conditionSnapshot() {
  const s = cache.getStale('summary');
  if (!s) return null;
  return { overall: s.overall.label, intraday: s.timeframes[0].label, short: s.timeframes[1].label, medium: s.timeframes[2].label };
}

/* ---------- full single-index analysis ---------- */
function movers(symbol) {
  const members = MEMBERS[symbol];
  if (!members) return null;
  const rows = members.map((m) => ({ m, q: feed.quote(m) })).filter((x) => x.q && x.q.pct != null)
    .map(({ m, q }) => ({ symbol: m, ltp: q.ltp, pct: q.pct, sector: (bySymbol.get(m) || {}).sector || 'Other' }));
  if (!rows.length) return null;
  const sorted = rows.slice().sort((a, b) => b.pct - a.pct);
  const sectors = {};
  rows.forEach((r) => { (sectors[r.sector] = sectors[r.sector] || []).push(r.pct); });
  return {
    count: rows.length,
    advancers: rows.filter((r) => r.pct > 0).length, decliners: rows.filter((r) => r.pct < 0).length, unchanged: rows.filter((r) => r.pct === 0).length,
    gainers: sorted.slice(0, 5), losers: sorted.slice(-5).reverse(),
    sectors: Object.entries(sectors).map(([name, a]) => ({ name, pct: a.reduce((s, x) => s + x, 0) / a.length, count: a.length })).sort((a, b) => b.pct - a.pct),
  };
}

async function indexAnalysis(symbol) {
  const key = `idx:${symbol}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const info = INDICES.find((i) => i.symbol === symbol);
  if (!info) throw new Error('Unknown index');
  const q = feed.quote(symbol);
  const { conds, overall, daily, errors } = await conditionsFor(symbol);

  let levels = null;
  if (daily && daily.length > 10) {
    const today = istNow().date;
    const prev = TA.istDate(daily[daily.length - 1].t) === today ? daily[daily.length - 2] : daily[daily.length - 1];
    const px = q ? q.ltp : daily[daily.length - 1].c;
    const sw = TA.swingLevels(daily, px);
    const w = daily.slice(-252);
    levels = {
      prevDay: { o: prev.o, h: prev.h, l: prev.l, c: prev.c },
      pivots: TA.pivots(prev.h, prev.l, prev.c),
      support: sw.support, resistance: sw.resistance,
      high52: Math.max(...w.map((c) => c.h)), low52: Math.min(...w.map((c) => c.l)),
    };
  }
  const table = C.indicatorTable(daily);
  const m = movers(symbol);
  const out = {
    symbol, name: info.name, hasOptions: Boolean(info.optionName), quote: q || null,
    conditions: conds, overall, indicators: table, levels, movers: m, members: MEMBERS[symbol] || [],
    narrative: C.narrative(info.name, q, conds, levels), errors, asOf: Date.now(),
  };
  cache.set(key, out, 15000);
  return out;
}

/* ---------- daily snapshots (history of what the app said each day) ---------- */
function history() { return store.load('analysis', () => ({ snapshots: [] })); }

async function saveSnapshot(force = false) {
  const h = history();
  const date = istNow().date;
  if (!force && h.snapshots.some((s) => s.date === date)) return null;
  const sum = await marketSummary();
  const narr = {};
  const snap = { date, savedAt: Date.now(), overall: sum.overall.label, timeframes: sum.timeframes, indices: {} };
  for (const p of sum.indices) {
    snap.indices[p.symbol] = { close: p.quote && p.quote.ltp, pct: p.quote && p.quote.pct, conditions: p.conditions, overall: p.overall.label };
  }
  try { narr.NIFTY = (await indexAnalysis('NIFTY')).narrative; } catch { /* optional */ }
  snap.narrative = narr;
  h.snapshots = h.snapshots.filter((s) => s.date !== date).concat(snap).slice(-400);
  store.save('analysis');
  return snap;
}

// Did the bias at the close agree with the next session's move? (descriptive only)
function historyWithOutcomes() {
  const s = history().snapshots.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  return s.map((x, i) => {
    const next = s[i + 1];
    let outcome = null;
    if (next && x.indices.NIFTY && next.indices.NIFTY && x.indices.NIFTY.close && next.indices.NIFTY.close) {
      const pct = ((next.indices.NIFTY.close - x.indices.NIFTY.close) / x.indices.NIFTY.close) * 100;
      const hit = x.overall === 'Bullish' ? pct > 0 : x.overall === 'Bearish' ? pct < 0 : Math.abs(pct) < 0.3;
      outcome = { nextPct: pct, hit };
    }
    return { ...x, outcome };
  });
}

function startJobs(broadcast) {
  // warm the cache early so the first paper trades can be tagged with the market condition
  setTimeout(() => marketSummary().then((s) => broadcast({ type: 'market', data: s })).catch(() => {}), feed.mode === 'mock' ? 2500 : 20000);
  setInterval(async () => {
    try {
      const sum = await marketSummary();
      broadcast({ type: 'market', data: sum });
      const n = istNow();
      if (n.dow >= 1 && n.dow <= 5 && n.minutes >= 15 * 60 + 35 && n.minutes < 16 * 60 + 30) await saveSnapshot(false);
    } catch (e) { console.error('[analysis]', e.message); }
  }, 20000);
}

module.exports = { marketSummary, indexAnalysis, conditionSnapshot, conditionsFor, saveSnapshot, historyWithOutcomes, startJobs, marketOpen };
