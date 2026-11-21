// Previous session / week / month reviews and the outlook for the next session / week / month.
// Everything is computed from daily candles, so it still works when the market is closed.
// The outlook is rule-based levels, a typical range and if-then scenarios. It is NOT a price forecast.
const feed = require('./feed');
const TA = require('../public/shared/ta.js');
const C = require('../public/shared/condition.js');
const { TTLCache, istNow } = require('./util');

const cache = new TTLCache();
const dateOf = (t) => TA.istDate(t);
const f2 = (n) => (n == null || !isFinite(n) ? '–' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const r2 = (n) => (n == null || !isFinite(n) ? null : Math.round(n * 100) / 100);
const sig3 = (v, up, down) => (v > up ? 1 : v < down ? -1 : 0);
const chk = (name, signal, weight, detail) => ({ name, signal, weight, detail });

/* ---------- dates ---------- */
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dowOf = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0 = Sunday
const weekStart = (ymd) => addDays(ymd, -((dowOf(ymd) + 6) % 7)); // Monday
const nextWeekday = (ymd) => { let d = addDays(ymd, 1); while (dowOf(d) === 0 || dowOf(d) === 6) d = addDays(d, 1); return d; };
const nextMonthStart = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`; };

/* ---------- grouping daily candles into weeks and months ---------- */
function group(daily, keyFn) {
  const out = [];
  let cur = null;
  daily.forEach((b) => {
    const k = keyFn(dateOf(b.t));
    if (!cur || cur.key !== k) {
      cur = { key: k, from: dateOf(b.t), to: dateOf(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0, days: 1 };
      out.push(cur);
    } else {
      cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v || 0; cur.to = dateOf(b.t); cur.days++;
    }
  });
  out.forEach((b, i) => {
    const base = i ? out[i - 1].c : b.o;
    b.chg = b.c - base;
    b.chgPct = base ? (b.chg / base) * 100 : 0;
  });
  return out;
}

// A bar is "done" once its period can no longer change
function markDone(bars, kind, now) {
  const weekend = now.dow === 0 || now.dow === 6;
  const sessionDone = weekend || now.minutes >= 15 * 60 + 30;
  bars.forEach((b) => {
    if (kind === 'day') b.done = !(b.from === now.date && !sessionDone);
    else if (kind === 'week') {
      const wk = weekStart(now.date);
      b.done = b.key < wk || (b.key === wk && (weekend || (now.dow === 5 && sessionDone)));
    } else b.done = b.key < now.date.slice(0, 7);
  });
}

/* ---------- reviews ---------- */
const FLAT = { day: 0.25, week: 0.6, month: 1.2 };
const NAMES = { day: 'session', week: 'week', month: 'month' };

function pattern(b, p) {
  if (!p) return null;
  if (b.h <= p.h && b.l >= p.l) return 'Inside bar (range contained within the previous one, often a pause before a move)';
  if (b.h > p.h && b.l < p.l) return 'Outside bar (took out both the previous high and low, a volatile expansion)';
  if (b.h > p.h && b.l > p.l) return 'Higher high and higher low (uptrend structure)';
  if (b.h < p.h && b.l < p.l) return 'Lower high and lower low (downtrend structure)';
  return null;
}

function review(kind, title, b, p) {
  if (!b) return null;
  const range = b.h - b.l;
  const closePos = range > 0 ? (b.c - b.l) / range : 0.5;
  const trend = b.chgPct > FLAT[kind] ? 'Up' : b.chgPct < -FLAT[kind] ? 'Down' : 'Flat';
  const where = closePos >= 0.67 ? 'near its high' : closePos <= 0.33 ? 'near its low' : 'in the middle of its range';
  const span = b.from === b.to ? b.from : `${b.from} to ${b.to}`;
  const move = trend === 'Flat' ? `was little changed (${b.chgPct >= 0 ? '+' : ''}${f2(b.chgPct)}%)` : `${trend === 'Up' ? 'rose' : 'fell'} ${f2(Math.abs(b.chgPct))}%`;
  return {
    title, from: b.from, to: b.to, days: b.days, partial: !b.done,
    o: r2(b.o), h: r2(b.h), l: r2(b.l), c: r2(b.c), v: b.v || 0,
    chg: r2(b.chg), chgPct: r2(b.chgPct), range: r2(range), rangePct: b.c ? r2((range / b.c) * 100) : null,
    closePos: r2(closePos), trend, pattern: pattern(b, p),
    summary: `${title} (${span}) ${move}, opened ${f2(b.o)}, high ${f2(b.h)}, low ${f2(b.l)}, closed ${f2(b.c)} ${where}.`,
  };
}

/* ---------- outlook ---------- */
const CFG = {
  day: { fast: 10, slow: 20, rsi: 14, atr: 14 },
  week: { fast: 5, slow: 10, rsi: 14, atr: 14 },
  month: { fast: 3, slow: 6, rsi: 6, atr: 6 },
};

function scoreOf(checks) {
  const used = checks.filter((c) => c.signal !== null);
  const w = used.reduce((s, c) => s + c.weight, 0);
  const net = used.reduce((s, c) => s + c.signal * c.weight, 0);
  const score = w ? Math.round(50 + 50 * (net / w)) : 50;
  return { label: w ? C.label(score) : 'No data', score, checks };
}

function bias(kind, done, px) {
  const cfg = CFG[kind];
  const b = done[done.length - 1], p = done[done.length - 2];
  if (!b) return scoreOf([]);
  const cl = done.map((x) => x.c);
  const fast = TA.last(TA.ema(cl, cfg.fast)), slow = TA.last(TA.ema(cl, cfg.slow));
  const rsi = TA.last(TA.rsi(cl, cfg.rsi));
  const range = b.h - b.l;
  const pos = range > 0 ? (b.c - b.l) / range : 0.5;
  const nm = NAMES[kind];
  return scoreOf([
    chk(`Last ${nm} direction`, sig3(b.chgPct, FLAT[kind], -FLAT[kind]), 1, `${b.chgPct >= 0 ? '+' : ''}${f2(b.chgPct)}% vs the ${nm} before`),
    chk('Close within its range', pos > 0.66 ? 1 : pos < 0.34 ? -1 : 0, 1, `Closed at ${Math.round(pos * 100)}% of the ${nm}'s range`),
    chk(`Close vs previous ${nm}'s range`, p ? (b.c > p.h ? 1 : b.c < p.l ? -1 : 0) : null, 1.5, p ? `Close ${f2(b.c)} vs previous high ${f2(p.h)} / low ${f2(p.l)}` : 'Not enough history'),
    chk(`EMA ${cfg.fast} vs EMA ${cfg.slow}`, fast != null && slow != null ? sig3(fast - slow, 0, 0) : null, 2, fast != null && slow != null ? `EMA${cfg.fast} ${f2(fast)} ${fast >= slow ? 'above' : 'below'} EMA${cfg.slow} ${f2(slow)}` : 'Not enough history'),
    chk(`Price vs EMA ${cfg.slow}`, slow != null ? sig3(px - slow, 0, 0) : null, 1.5, slow != null ? `${f2(px)} is ${px >= slow ? 'above' : 'below'} ${f2(slow)}` : 'Not enough history'),
    chk(`RSI ${cfg.rsi}`, rsi != null ? sig3(rsi, 55, 45) : null, 1, rsi != null ? `RSI ${f2(rsi)} on ${nm} bars` : 'Not enough history'),
  ]);
}

function outlook(kind, done, px, target) {
  const b = done[done.length - 1];
  if (!b) return null;
  const pv = TA.pivots(b.h, b.l, b.c);
  const a = TA.last(TA.atr(done, CFG[kind].atr));
  const bi = bias(kind, done, px);
  const { tc, bc } = pv.cpr;
  return {
    kind, label: target.label, from: target.from, inProgress: target.inProgress,
    basis: { from: b.from, to: b.to, o: r2(b.o), h: r2(b.h), l: r2(b.l), c: r2(b.c) },
    bias: bi,
    pivots: { pp: r2(pv.pp), r1: r2(pv.r1), r2: r2(pv.r2), r3: r2(pv.r3), s1: r2(pv.s1), s2: r2(pv.s2), s3: r2(pv.s3), tc: r2(tc), bc: r2(bc) },
    typical: a ? { atr: r2(a), atrPct: px ? r2((a / px) * 100) : null, low: r2(px - a / 2), high: r2(px + a / 2) } : null,
    scenarios: [
      { case: 'Bullish', text: `Holding above ${f2(tc)} (top of the central pivot range) keeps the bias up. A move above R1 ${f2(pv.r1)} opens R2 ${f2(pv.r2)}.`, trigger: r2(tc), target: r2(pv.r1), stretch: r2(pv.r2) },
      { case: 'Sideways', text: `Between ${f2(bc)} and ${f2(tc)} the market is more likely to stay range-bound.`, trigger: r2(bc), target: r2(tc), stretch: null },
      { case: 'Bearish', text: `Slipping below ${f2(bc)} (bottom of the central pivot range) shifts the bias down. A move below S1 ${f2(pv.s1)} opens S2 ${f2(pv.s2)}.`, trigger: r2(bc), target: r2(pv.s1), stretch: r2(pv.s2) },
    ],
  };
}

/* ---------- tables for the Data tab ---------- */
const row = (b) => ({ from: b.from, to: b.to, o: r2(b.o), h: r2(b.h), l: r2(b.l), c: r2(b.c), v: b.v || 0, chg: r2(b.chg), chgPct: r2(b.chgPct), partial: !b.done });

/* ---------- main ---------- */
async function periods(symbol) {
  symbol = String(symbol || '').toUpperCase();
  const hit = cache.get(symbol);
  if (hit) return hit;
  await feed.ensure([symbol]);
  const daily = await feed.candles(symbol, '1d', 520, 'high');
  if (!daily || daily.length < 5) throw new Error(`Not enough daily history for ${symbol}`);

  const now = istNow();
  const q = feed.quote(symbol);
  const px = q && q.ltp != null ? q.ltp : daily[daily.length - 1].c;
  const days = group(daily, (d) => d);
  const weeks = group(daily, weekStart);
  const months = group(daily, (d) => d.slice(0, 7));
  markDone(days, 'day', now); markDone(weeks, 'week', now); markDone(months, 'month', now);
  const doneOf = (bars) => bars.filter((b) => b.done);
  const dDone = doneOf(days), wDone = doneOf(weeks), mDone = doneOf(months);
  const cur = (bars) => { const b = bars[bars.length - 1]; return b && !b.done ? b : null; };
  const prevOf = (bars, b) => bars[bars.indexOf(b) - 1];

  const lastD = dDone[dDone.length - 1], lastW = wDone[wDone.length - 1], lastM = mDone[mDone.length - 1];
  const reviews = {
    day: review('day', 'Previous session', lastD, prevOf(days, lastD)),
    week: review('week', 'Previous week', lastW, prevOf(weeks, lastW)),
    month: review('month', 'Previous month', lastM, prevOf(months, lastM)),
  };
  const current = {
    day: cur(days) ? review('day', 'Today so far', cur(days), prevOf(days, cur(days))) : null,
    week: cur(weeks) ? review('week', 'This week so far', cur(weeks), prevOf(weeks, cur(weeks))) : null,
    month: cur(months) ? review('month', 'This month so far', cur(months), prevOf(months, cur(months))) : null,
  };

  // The period each outlook applies to = the one right after the last completed bar
  const afterToday = (d) => now.date >= d;
  const preOpen = now.dow >= 1 && now.dow <= 5 && now.minutes < 9 * 60 + 15;
  const nextDay = lastD ? nextWeekday(lastD.to) : null;
  const nextWeekFrom = lastW ? addDays(lastW.key, 7) : null;
  const nextMonthFrom = lastM ? nextMonthStart(lastM.key) : null;
  const dayInProgress = nextDay ? (nextDay === now.date && !preOpen) : false;
  const targets = {
    day: nextDay && { from: nextDay, inProgress: dayInProgress, label: nextDay === now.date ? (dayInProgress ? 'Today' : 'Today (pre-open)') : 'Next session' },
    week: nextWeekFrom && { from: nextWeekFrom, inProgress: afterToday(nextWeekFrom), label: afterToday(nextWeekFrom) ? 'This week' : 'Next week' },
    month: nextMonthFrom && { from: nextMonthFrom, inProgress: afterToday(nextMonthFrom), label: afterToday(nextMonthFrom) ? 'This month' : 'Next month' },
  };
  const out = {
    symbol, name: feed.info(symbol).name, asOf: Date.now(), price: r2(px), stale: Boolean(q && q.stale),
    lastSession: lastD ? lastD.to : null, lastClose: lastD ? r2(lastD.c) : null,
    reviews, current,
    outlook: {
      day: targets.day && outlook('day', dDone, px, targets.day),
      week: targets.week && outlook('week', wDone, px, targets.week),
      month: targets.month && outlook('month', mDone, px, targets.month),
    },
    swing: (() => { const s = TA.swingLevels(daily, px); return { support: s.support.map((x) => ({ level: r2(x.level), touches: x.touches })), resistance: s.resistance.map((x) => ({ level: r2(x.level), touches: x.touches })) }; })(),
    tables: { daily: days.slice(-60).map(row), weekly: weeks.slice(-52).map(row), monthly: months.slice(-24).map(row) },
    disclaimer: 'Levels and scenarios are built from past prices with fixed rules. They describe what to watch, not what will happen.',
  };
  const bits = [reviews.day, reviews.week, reviews.month].filter(Boolean).map((r) => `${r.title.toLowerCase()} ${r.chgPct >= 0 ? '+' : ''}${f2(r.chgPct)}%`);
  out.headline = bits.length ? `${out.name}: ${bits.join(', ')}.` : null;

  cache.set(symbol, out, now.dow >= 1 && now.dow <= 5 && now.minutes >= 9 * 60 + 15 && now.minutes < 15 * 60 + 40 ? 60000 : 300000);
  return out;
}

module.exports = { periods, group, weekStart, nextWeekday };
