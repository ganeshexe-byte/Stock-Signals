// Simulated market feed. Prices are RANDOM and invented - used only so the whole app
// can be run and tested without a broker login. Never use this to make trading decisions.
const { BaseFeed, INTERVAL_SECS } = require('./base');
const { INDICES, STOCKS } = require('../universe');
const { istNow, istDayStart, IST } = require('../util');
const { summarize } = require('../optionmath');
const TA = require('../../public/shared/ta.js');

function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h; }
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gauss = (r) => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const round05 = (x) => Math.round(x * 20) / 20;

const FIXED = { NIFTY: 24800, BANKNIFTY: 53200, SENSEX: 81400, INDIAVIX: 13.4 };
const SESSION_START = 33300; // 09:15 in seconds from midnight IST

class MockFeed extends BaseFeed {
  constructor() {
    super();
    this.mode = 'mock';
    this.status = { mode: 'mock', connected: true, lastTickAt: null, error: null, note: 'Simulated prices - not real market data' };
    this.sym = new Map();
    this.chains = new Map();
  }

  async start() {
    [...INDICES, ...STOCKS].forEach((i) => this.init(i.symbol, i.type));
    this.timer = setInterval(() => this.tickAll(), 1000);
    this.tickAll();
  }

  async ensure(symbols) { symbols.forEach((s) => { if (!this.sym.has(s)) this.init(s, 'stock'); }); }

  search(q, limit = 12) {
    q = (q || '').toUpperCase();
    return [...INDICES, ...STOCKS].filter((i) => !q || i.symbol.includes(q) || i.name.toUpperCase().includes(q)).slice(0, limit)
      .map((i) => ({ symbol: i.symbol, name: i.name, exch: i.exch, type: i.type }));
  }

  /* ---------- history generation ---------- */
  init(symbol, type) {
    if (this.sym.has(symbol)) return;
    const r = rng(hash(symbol));
    const isIndex = type === 'index';
    const base = FIXED[symbol] || 150 + r() * 3500;
    const dailyVol = symbol === 'INDIAVIX' ? 0.035 : isIndex ? 0.0075 : 0.013 + r() * 0.01;
    const drift = (r() - 0.5) * 0.0016 * (symbol === 'INDIAVIX' ? 0 : 1);
    const st = { symbol, isIndex, r, base, dailyVol, drift, daily: [], m1: [], day: null, ltp: base, prevClose: base, tickSigma: (dailyVol / Math.sqrt(22500)) * 3, mood: 0 };
    this.sym.set(symbol, st);

    const nowSec = Math.floor(Date.now() / 1000);
    const today = istDayStart(nowSec);
    const days = [];
    for (let d = today - 86400, c = 0; c < 440; d -= 86400) {
      const dow = new Date((d + IST) * 1000).getUTCDay();
      if (dow !== 0 && dow !== 6) { days.unshift(d); c++; }
    }
    // older sessions: daily walk. Last 5 sessions: built from 1-minute paths.
    const older = days.slice(0, -5), recent = days.slice(-5);
    let p = base * 0.8, raw = [];
    older.forEach((d) => {
      const o = p * (1 + gauss(r) * dailyVol * 0.3);
      const c = o * (1 + drift + gauss(r) * dailyVol);
      const h = Math.max(o, c) * (1 + Math.abs(gauss(r)) * dailyVol * 0.4);
      const l = Math.min(o, c) * (1 - Math.abs(gauss(r)) * dailyVol * 0.4);
      raw.push({ t: d, o, h, l, c, v: isIndex ? 0 : Math.round(1e6 * (0.5 + r())) });
      p = c;
    });
    recent.forEach((d) => {
      const bars = this.session(st, d, p, 375);
      raw.push(this.dailyFrom(bars, d, isIndex));
      st.m1.push(...bars);
      p = bars[bars.length - 1].c;
    });
    // rescale so the last close sits near `base`
    const k = base / p;
    const scale = (c) => ({ ...c, o: c.o * k, h: c.h * k, l: c.l * k, c: c.c * k });
    st.daily = raw.map(scale);
    st.m1 = st.m1.map(scale);
    p *= k;

    st.prevClose = p;
    st.ltp = p;
    // today's session so far (weekday only)
    const n = istNow();
    if (n.dow >= 1 && n.dow <= 5 && n.minutes >= 9 * 60 + 15) {
      const mins = Math.min(n.minutes, 15 * 60 + 30) - (9 * 60 + 15);
      if (mins > 0) {
        const bars = this.session(st, today, p, mins);
        st.m1.push(...bars);
        st.ltp = bars[bars.length - 1].c;
        st.day = this.dailyFrom(bars, today, isIndex);
        st.day.pv = bars.reduce((s, b) => s + ((b.h + b.l + b.c) / 3) * b.v, 0);
      }
    }
    this.publish(st);
  }

  session(st, dayStart, startPrice, n) {
    const { r, dailyVol, drift, isIndex } = st;
    const sig = dailyVol / Math.sqrt(375);
    let p = startPrice * (1 + gauss(r) * dailyVol * 0.3);
    const out = [];
    for (let i = 0; i < n; i++) {
      const o = p;
      const c = o * (1 + drift / 375 + gauss(r) * sig);
      const h = Math.max(o, c) * (1 + Math.abs(gauss(r)) * sig * 0.3);
      const l = Math.min(o, c) * (1 - Math.abs(gauss(r)) * sig * 0.3);
      out.push({ t: dayStart + SESSION_START + i * 60, o, h, l, c, v: isIndex ? 0 : Math.round(2000 * (0.4 + r() * 1.2)) });
      p = c;
    }
    return out;
  }

  dailyFrom(bars, t, isIndex) {
    return {
      t, o: bars[0].o, h: Math.max(...bars.map((b) => b.h)), l: Math.min(...bars.map((b) => b.l)),
      c: bars[bars.length - 1].c, v: isIndex ? 0 : bars.reduce((s, b) => s + b.v, 0),
    };
  }

  /* ---------- live ticking ---------- */
  tickAll() { for (const st of this.sym.values()) this.step(st); }

  step(st) {
    const { r } = st;
    const nowSec = Math.floor(Date.now() / 1000);
    const today = istDayStart(nowSec);
    if (!st.day || st.day.t !== today) {
      if (st.day) { st.daily.push(st.day); st.prevClose = st.day.c; }
      st.day = { t: today, o: st.ltp, h: st.ltp, l: st.ltp, c: st.ltp, v: 0, pv: 0 };
    }
    st.mood = st.mood * 0.97 + gauss(r) * st.tickSigma * 0.15; // short-lived momentum so charts trend a little
    let p = st.ltp * (1 + st.mood + gauss(r) * st.tickSigma);
    p = Math.max(0.05, st.isIndex ? Math.round(p * 100) / 100 : round05(p));
    st.ltp = p;
    const vol = st.isIndex ? 0 : Math.round(20 + r() * 400);
    const d = st.day;
    d.h = Math.max(d.h, p); d.l = Math.min(d.l, p); d.c = p; d.v += vol; d.pv = (d.pv || 0) + p * vol;

    const minute = Math.floor(nowSec / 60) * 60;
    let m = st.m1[st.m1.length - 1];
    if (!m || m.t !== minute) { m = { t: minute, o: p, h: p, l: p, c: p, v: 0 }; st.m1.push(m); if (st.m1.length > 3000) st.m1.shift(); }
    m.h = Math.max(m.h, p); m.l = Math.min(m.l, p); m.c = p; m.v += vol;
    this.publish(st);
  }

  publish(st) {
    const d = st.day;
    this.setQuote(st.symbol, {
      ltp: st.ltp, open: d ? d.o : st.ltp, high: d ? d.h : st.ltp, low: d ? d.l : st.ltp, close: st.prevClose,
      vol: d ? d.v : 0, vwap: d && d.v ? d.pv / d.v : st.ltp,
    });
  }

  /* ---------- candles ---------- */
  async candles(symbol, interval = '5m', count = 200) {
    if (!this.sym.has(symbol)) this.init(symbol, 'stock');
    const st = this.sym.get(symbol);
    const secs = INTERVAL_SECS[interval] || 300;
    let out;
    if (interval === '1m') out = st.m1.slice();
    else if (secs < 86400) out = TA.aggregate(st.m1, secs, SESSION_START);
    else {
      const d = st.daily.slice();
      if (st.day) d.push({ t: st.day.t, o: st.day.o, h: st.day.h, l: st.day.l, c: st.day.c, v: st.day.v });
      out = interval === '1w' ? TA.weekly(d) : d;
    }
    return out.slice(-count);
  }

  /* ---------- simulated option chain ---------- */
  async optionChain(symbol) {
    const idx = INDICES.find((i) => i.symbol === symbol && i.optionName);
    const q = this.quote(symbol);
    if (!idx || !q) return null;
    const step = symbol === 'NIFTY' ? 50 : 100;
    const atm = Math.round(q.ltp / step) * step;
    let ch = this.chains.get(symbol);
    if (!ch) {
      const r = rng(hash('chain' + symbol));
      ch = { r, oi: {} };
      for (let i = -10; i <= 10; i++) {
        const w = Math.exp(-(i * i) / 40);
        ch.oi[i] = { ce: Math.round((2e5 + r() * 8e5) * w * (i >= 0 ? 1.4 : 0.7)), pe: Math.round((2e5 + r() * 8e5) * w * (i <= 0 ? 1.4 : 0.7)) };
      }
      this.chains.set(symbol, ch);
    }
    const rows = [];
    for (let i = -10; i <= 10; i++) {
      const strike = atm + i * step;
      const o = ch.oi[i];
      o.ce = Math.max(1000, Math.round(o.ce * (1 + (ch.r() - 0.5) * 0.01)));
      o.pe = Math.max(1000, Math.round(o.pe * (1 + (ch.r() - 0.5) * 0.01)));
      const tv = step * 3 * Math.exp(-Math.pow(i / 4, 2));
      rows.push({
        strike,
        ce: { ltp: +(Math.max(q.ltp - strike, 0) + tv).toFixed(2), oi: o.ce },
        pe: { ltp: +(Math.max(strike - q.ltp, 0) + tv).toFixed(2), oi: o.pe },
      });
    }
    const exp = new Date(Date.now() + 86400000 * (((2 - new Date().getUTCDay() + 7) % 7) || 7));
    return { symbol, expiry: exp.toISOString().slice(0, 10), spot: q.ltp, simulated: true, rows, ...summarize(rows, q.ltp) };
  }
}

module.exports = { MockFeed };
