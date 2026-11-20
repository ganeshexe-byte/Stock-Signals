// Rule-based scanners. They list stocks that match simple, visible rules. They are
// filters for study, not recommendations. Rules are plain code - edit freely.
const feed = require('./feed');
const TA = require('../public/shared/ta.js');
const { STOCKS } = require('./universe');
const { marketOpen } = require('./util');

const state = {
  intraday: { asOf: null, rows: [] },
  swing: { asOf: null, rows: [], progress: { done: 0, total: STOCKS.length } },
  long: { asOf: null, rows: [], progress: { done: 0, total: STOCKS.length } },
};
const daily = new Map(); // symbol -> { swing, long }

const RULES = {
  intraday: [
    'Momentum up: change >= +1%, above VWAP, within the top quarter of the day range',
    'Momentum down: change <= -1%, below VWAP, within the bottom quarter of the day range',
    'Gap up / down of 1.5% or more that is still holding versus the open',
    'Near day high: within 0.3% of the high with a gain of at least 0.5%',
  ],
  swing: [
    'EMA 20 crossed above / below EMA 50 within the last 3 sessions',
    '20-day breakout (close above the prior 20-day high) or breakdown',
    'Pullback to EMA 20 inside an uptrend (EMA20 > EMA50, RSI 45-60)',
    'Close within 2% of the 52-week high',
  ],
  long: [
    'Close above the 200-day average and the 50-day above the 200-day',
    '1-year return of at least +15%',
    'Within 20% of the 52-week high',
    'Largest 1-year drawdown under 35%',
    'Technical screen only: fundamentals (earnings, debt, ROE) need a separate data source',
  ],
};

/* ---------- intraday: works purely from live quotes ---------- */
function runIntraday() {
  const rows = [];
  const vols = STOCKS.map((s) => (feed.quote(s.symbol) || {}).vol || 0).sort((a, b) => b - a);
  const volCut = vols[Math.min(9, vols.length - 1)] || Infinity;
  STOCKS.forEach((s) => {
    const q = feed.quote(s.symbol);
    if (!q || !q.close || !q.open) return;
    const range = q.high - q.low;
    const pos = range > 0 ? (q.ltp - q.low) / range : 0.5;
    const gap = ((q.open - q.close) / q.close) * 100;
    const reasons = [];
    let bias = 0;
    if (q.pct >= 1 && (!q.vwap || q.ltp > q.vwap) && pos >= 0.75) { reasons.push('Momentum up'); bias++; }
    if (q.pct <= -1 && (!q.vwap || q.ltp < q.vwap) && pos <= 0.25) { reasons.push('Momentum down'); bias--; }
    if (gap >= 1.5 && q.ltp >= q.open) { reasons.push(`Gap up ${gap.toFixed(1)}% holding`); bias++; }
    if (gap <= -1.5 && q.ltp <= q.open) { reasons.push(`Gap down ${Math.abs(gap).toFixed(1)}% holding`); bias--; }
    if (q.high && (q.high - q.ltp) / q.high <= 0.003 && q.pct >= 0.5) { reasons.push('Near day high'); bias++; }
    if (!reasons.length) return;
    if ((q.vol || 0) >= volCut) reasons.push('Top-10 volume');
    rows.push({
      symbol: s.symbol, sector: s.sector, ltp: q.ltp, pct: q.pct, vol: q.vol || 0, vwap: q.vwap || null, reasons,
      bias: bias > 0 ? 'Bullish' : bias < 0 ? 'Bearish' : 'Mixed', score: Math.abs(q.pct) + reasons.length,
    });
  });
  rows.sort((a, b) => b.score - a.score);
  state.intraday = { asOf: Date.now(), rows: rows.slice(0, 40), live: marketOpen() };
}

/* ---------- swing + long term: from daily candles ---------- */
function evalDaily(symbol, d) {
  if (!d || d.length < 60) return null;
  const cl = d.map((c) => c.c);
  const n = cl.length, px = cl[n - 1];
  const e20 = TA.ema(cl, 20), e50 = TA.ema(cl, 50), r = TA.rsi(cl, 14);
  const pct = n > 1 ? ((px - cl[n - 2]) / cl[n - 2]) * 100 : 0;

  const sw = [];
  let bias = 0;
  for (let k = n - 3; k < n; k++) {
    if (e20[k] != null && e50[k] != null && e20[k - 1] != null && e50[k - 1] != null) {
      if (e20[k - 1] <= e50[k - 1] && e20[k] > e50[k]) { sw.push('EMA 20/50 bullish crossover'); bias++; break; }
      if (e20[k - 1] >= e50[k - 1] && e20[k] < e50[k]) { sw.push('EMA 20/50 bearish crossover'); bias--; break; }
    }
  }
  const prior = d.slice(-21, -1);
  if (prior.length === 20) {
    if (px > Math.max(...prior.map((c) => c.h))) { sw.push('20-day breakout'); bias++; }
    if (px < Math.min(...prior.map((c) => c.l))) { sw.push('20-day breakdown'); bias--; }
  }
  const last20 = e20[n - 1], last50 = e50[n - 1], rs = r[n - 1];
  if (last20 && last50 && last20 > last50 && px >= last20 && px <= last20 * 1.015 && rs >= 45 && rs <= 60) { sw.push('Pullback to EMA 20 in uptrend'); bias++; }
  const w = d.slice(-252);
  const hi = Math.max(...w.map((c) => c.h)), lo = Math.min(...w.map((c) => c.l));
  if (px >= hi * 0.98) { sw.push('Within 2% of 52-week high'); bias++; }

  const lg = [];
  const s50 = TA.last(TA.sma(cl, 50)), s200 = n >= 200 ? TA.last(TA.sma(cl, 200)) : null;
  if (s200 && px > s200 && s50 > s200) lg.push('Above 200-day, 50-day > 200-day');
  const ago = cl[n - 253] || cl[0];
  const ret = ((px - ago) / ago) * 100;
  if (ret >= 15) lg.push(`1-year return ${ret.toFixed(0)}%`);
  if (px >= hi * 0.8) lg.push('Within 20% of 52-week high');
  let peak = 0, dd = 0;
  w.forEach((c) => { peak = Math.max(peak, c.c); dd = Math.max(dd, (peak - c.c) / peak); });
  if (dd < 0.35) lg.push(`Max drawdown ${(dd * 100).toFixed(0)}%`);

  const info = STOCKS.find((s) => s.symbol === symbol);
  const base = { symbol, sector: info ? info.sector : '', ltp: px, pct };
  return {
    swing: sw.length ? { ...base, reasons: sw, bias: bias > 0 ? 'Bullish' : bias < 0 ? 'Bearish' : 'Mixed', score: sw.length } : null,
    long: lg.length >= 3 ? { ...base, reasons: lg, matches: lg.length, ret1y: ret, score: lg.length + ret / 100 } : null,
  };
}

async function runDaily() {
  state.swing.progress = { done: 0, total: STOCKS.length };
  state.long.progress = state.swing.progress;
  for (const s of STOCKS) {
    try {
      const d = await feed.candles(s.symbol, '1d', 420, 'low');
      daily.set(s.symbol, evalDaily(s.symbol, d));
    } catch { /* leave previous result */ }
    state.swing.progress.done++;
    if (state.swing.progress.done % 10 === 0 || state.swing.progress.done === STOCKS.length) publishDaily();
  }
  publishDaily();
}

function publishDaily() {
  const rows = [...daily.values()].filter(Boolean);
  state.swing.rows = rows.map((r) => r.swing).filter(Boolean).sort((a, b) => b.score - a.score || Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 60);
  state.long.rows = rows.map((r) => r.long).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 60);
  state.swing.asOf = state.long.asOf = Date.now();
}

function start() {
  const kick = async () => { try { runIntraday(); } catch (e) { console.error('[scan]', e.message); } };
  setInterval(kick, 5000);
  const go = () => runDaily().catch((e) => console.error('[scan]', e.message));
  setTimeout(() => { kick(); go(); setInterval(go, 30 * 60 * 1000); }, feed.mode === 'mock' ? 1500 : 15000);
}

function get(type) { return { ...state[type], rules: RULES[type], universe: STOCKS.length }; }

module.exports = { start, get };
