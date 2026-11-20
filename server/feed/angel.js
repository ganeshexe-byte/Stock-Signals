// Live feed from Angel One SmartAPI (WebSocket v2 for prices, REST for candles).
// Credentials stay on this server and are never sent to the browser.
// NOTE: written against the SDK source (smartapi-javascript 1.0.27) and Angel's published docs.
// It could not be exercised against a live account here, so check the first run's console output.
const fs = require('fs');
const path = require('path');
const { SmartAPI, WebSocketV2 } = require('smartapi-javascript');
const { authenticator } = require('otplib');
const { BaseFeed } = require('./base');
const { INDICES, STOCKS } = require('../universe');
const { istNow, istString, marketOpen, sleep, TTLCache } = require('../util');
const { summarize } = require('../optionmath');
const { dataDir } = require('../config');
const TA = require('../../public/shared/ta.js');

const MASTER_URL = 'https://margincalculator.angelbroking.com/OpenAPI_Files/files/OpenAPIScripMaster.json';
const EX = { NSE_CM: 1, NSE_FO: 2, BSE_CM: 3, BSE_FO: 4 };
const API_INTERVAL = { '1m': 'ONE_MINUTE', '5m': 'FIVE_MINUTE', '15m': 'FIFTEEN_MINUTE', '30m': 'THIRTY_MINUTE', '1h': 'ONE_HOUR', '1d': 'ONE_DAY' };
const MAX_DAYS = { '1m': 30, '5m': 100, '15m': 200, '30m': 200, '1h': 400, '1d': 2000 };
const BARS_PER_DAY = { '1m': 375, '5m': 75, '15m': 25, '30m': 13, '1h': 7, '1d': 1 };
const CACHE_MS = { '1m': 15e3, '5m': 20e3, '15m': 30e3, '30m': 60e3, '1h': 120e3, '1d': 600e3 };
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

class AngelFeed extends BaseFeed {
  constructor(cfg) {
    super();
    this.cfg = cfg;
    this.mode = 'angel';
    this.status = { mode: 'angel', connected: false, lastTickAt: null, error: null, note: 'Angel One SmartAPI' };
    this.gen = 0;
    this.eq = new Map();        // symbol -> {token, name}
    this.options = [];          // option contracts for index chains
    this.tokenToSym = new Map(); // "exchangeType:token" -> symbol
    this.subs = new Map();      // "exchangeType:token" -> {exchangeType, token, mode}
    this.optionData = new Map(); // "exchangeType:token" -> {ltp, oi}
    this.cache = new TTLCache();
    this.queue = { high: [], low: [] };
    this.pumping = false;
  }

  /* ---------- startup ---------- */
  async start() {
    try {
      await this.loadMaster();
      await this.connect();
      this.watchdog = setInterval(() => this.check().catch(() => {}), 30000);
    } catch (e) {
      this.status.error = e.message;
      console.error('[angel] startup failed:', e.message);
      // retry in the background so a temporary failure does not need a restart
      setTimeout(() => this.start(), 60000);
    }
  }

  async connect() {
    await this.login();
    await this.openSocket();
    await this.subscribeDefaults();
    this.loginAt = Date.now();
    this.status.error = null;
  }

  async login() {
    const { apiKey, clientCode, pin, totpSecret } = this.cfg;
    this.smart = new SmartAPI({ api_key: apiKey });
    const r = await this.smart.generateSession(clientCode, pin, authenticator.generate(totpSecret));
    if (!r || !r.status || !r.data) throw new Error(`Angel One login failed: ${(r && (r.message || r.errorcode)) || 'no response'}`);
    this.jwt = r.data.jwtToken;
    this.feedToken = r.data.feedToken;
    console.log('[angel] logged in as', clientCode);
  }

  async openSocket() {
    const gen = ++this.gen;
    if (this.ws) { try { this.ws.close(); } catch { /* already closed */ } }
    const ws = new WebSocketV2({ jwttoken: this.jwt, apikey: this.cfg.apiKey, clientcode: this.cfg.clientCode, feedtype: this.feedToken });
    await ws.connect();
    // The SDK keeps tick handlers in a module-level list, so ignore ticks from older sockets
    ws.on('tick', (t) => { if (gen === this.gen) { try { this.onTick(t); } catch (e) { console.error('[angel] tick error', e.message); } } });
    this.ws = ws;
    this.status.connected = true;
    console.log('[angel] WebSocket connected');
  }

  async check() {
    const stale = marketOpen() && this.status.lastTickAt && Date.now() - this.status.lastTickAt > 90e3;
    const old = this.loginAt && Date.now() - this.loginAt > 6 * 3600e3;
    if (stale || old) {
      console.log(`[angel] ${stale ? 'no ticks for 90s' : 'session is 6h old'} - reconnecting`);
      this.status.connected = false;
      try {
        await this.login();
        await this.openSocket();
        const all = [...this.subs.values()];
        this.subs.clear();
        all.forEach((s) => this.subscribe(s.exchangeType, [s.token], s.mode));
        this.loginAt = Date.now();
        this.status.error = null;
      } catch (e) { this.status.error = e.message; console.error('[angel] reconnect failed:', e.message); }
    }
  }

  /* ---------- instrument master ---------- */
  async loadMaster() {
    const file = path.join(dataDir, 'scrip-master.json');
    const today = istNow().date;
    let cached = null;
    try { cached = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none yet */ }
    if (!cached || cached.date !== today) {
      try {
        console.log('[angel] downloading instrument master...');
        const res = await fetch(MASTER_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const all = await res.json();
        const eq = all.filter((x) => x.exch_seg === 'NSE' && /-EQ$/.test(x.symbol)).map((x) => [x.name, x.token]);
        const opt = all.filter((x) => x.instrumenttype === 'OPTIDX' && ['NIFTY', 'BANKNIFTY', 'SENSEX'].includes(x.name))
          .map((x) => [x.name, x.expiry, Number(x.strike) / 100, /CE$/.test(x.symbol) ? 'CE' : 'PE', x.token, x.exch_seg]);
        cached = { date: today, eq, opt };
        fs.writeFileSync(file, JSON.stringify(cached));
      } catch (e) {
        if (!cached) throw new Error(`Could not download the instrument master: ${e.message}`);
        console.warn('[angel] master download failed, using older copy:', e.message);
      }
    }
    cached.eq.forEach(([name, token]) => this.eq.set(name, { token, name }));
    this.options = cached.opt.map(([name, expiry, strike, type, token, exch]) => ({ name, expiry, strike, type, token, exch }));
    console.log(`[angel] instrument master: ${this.eq.size} NSE equities, ${this.options.length} index option contracts`);
  }

  resolve(symbol) {
    const idx = INDICES.find((i) => i.symbol === symbol);
    if (idx) return { token: idx.token, exchangeType: idx.exch === 'BSE' ? EX.BSE_CM : EX.NSE_CM, exch: idx.exch };
    const e = this.eq.get(symbol);
    return e ? { token: e.token, exchangeType: EX.NSE_CM, exch: 'NSE' } : null;
  }

  search(q, limit = 12) {
    q = (q || '').toUpperCase();
    const out = INDICES.filter((i) => !q || i.symbol.includes(q) || i.name.includes(q)).map((i) => ({ symbol: i.symbol, name: i.name, exch: i.exch, type: 'index' }));
    for (const s of this.eq.keys()) {
      if (out.length >= limit) break;
      if (!q || s.includes(q)) out.push({ symbol: s, name: s, exch: 'NSE', type: 'stock' });
    }
    return out.slice(0, limit);
  }

  /* ---------- subscriptions ---------- */
  subscribe(exchangeType, tokens, mode = 2) {
    const fresh = tokens.filter((t) => !this.subs.has(`${exchangeType}:${t}`) || this.subs.get(`${exchangeType}:${t}`).mode < mode);
    if (!fresh.length || !this.ws) return;
    for (let i = 0; i < fresh.length; i += 100) {
      const chunk = fresh.slice(i, i + 100);
      this.ws.fetchData({ correlationID: `sl${Date.now() % 1e6}${i}`, action: 1, mode, exchangeType, tokens: chunk });
    }
    fresh.forEach((t) => this.subs.set(`${exchangeType}:${t}`, { exchangeType, token: t, mode }));
  }

  async subscribeDefaults() {
    const missing = [];
    const byEx = {};
    [...INDICES, ...STOCKS].forEach((i) => {
      const r = this.resolve(i.symbol);
      if (!r) { missing.push(i.symbol); return; }
      this.tokenToSym.set(`${r.exchangeType}:${r.token}`, i.symbol);
      (byEx[r.exchangeType] = byEx[r.exchangeType] || []).push(r.token);
    });
    Object.entries(byEx).forEach(([ex, tokens]) => this.subscribe(Number(ex), tokens, 2));
    if (missing.length) console.warn('[angel] not found in instrument master (check spelling):', missing.join(', '));
  }

  async ensure(symbols) {
    const byEx = {};
    symbols.forEach((s) => {
      const r = this.resolve(s);
      if (!r) return;
      this.tokenToSym.set(`${r.exchangeType}:${r.token}`, s);
      (byEx[r.exchangeType] = byEx[r.exchangeType] || []).push(r.token);
    });
    Object.entries(byEx).forEach(([ex, tokens]) => this.subscribe(Number(ex), tokens, 2));
  }

  /* ---------- ticks (prices arrive in paise) ---------- */
  onTick(t) {
    if (!t || typeof t !== 'object' || t.last_traded_price === undefined) return;
    const token = String(t.token || '').replace(/["\u0000\s]/g, '');
    const key = `${Number(t.exchange_type)}:${token}`;
    const ltp = Number(t.last_traded_price) / 100;
    if (!(ltp > 0)) return;

    if (this.optionKeys && this.optionKeys.has(key)) {
      const prev = this.optionData.get(key) || {};
      this.optionData.set(key, { ltp, oi: t.open_interest !== undefined ? Number(t.open_interest) : prev.oi || 0 });
      return;
    }
    const symbol = this.tokenToSym.get(key);
    if (!symbol) return;
    const q = { ltp };
    if (t.open_price_day !== undefined) {
      q.open = Number(t.open_price_day) / 100; q.high = Number(t.high_price_day) / 100; q.low = Number(t.low_price_day) / 100;
      q.close = Number(t.close_price) / 100; q.vol = Number(t.vol_traded) || 0;
      const avg = Number(t.avg_traded_price) / 100;
      if (avg > 0) q.vwap = avg;
    }
    this.setQuote(symbol, q);
  }

  /* ---------- candles (REST, rate limited) ---------- */
  pump() {
    if (this.pumping) return;
    this.pumping = true;
    (async () => {
      while (this.queue.high.length || this.queue.low.length) {
        const job = this.queue.high.shift() || this.queue.low.shift();
        try { job.resolve(await job.fn()); } catch (e) { job.reject(e); }
        await sleep(380); // Angel allows about 3 historical requests per second
      }
      this.pumping = false;
    })();
  }

  limited(fn, priority) {
    return new Promise((resolve, reject) => { this.queue[priority === 'low' ? 'low' : 'high'].push({ fn, resolve, reject }); this.pump(); });
  }

  async candles(symbol, interval = '5m', count = 200, priority = 'high') {
    if (interval === '1w') {
      const d = await this.candles(symbol, '1d', Math.min(count * 5 + 10, 1500), priority);
      return TA.weekly(d).slice(-count);
    }
    const key = `${symbol}|${interval}`;
    const hit = this.cache.get(key);
    if (hit && hit.count >= count) return hit.data.slice(-count);

    const r = this.resolve(symbol);
    if (!r) throw new Error(`Unknown symbol ${symbol}`);
    const iv = API_INTERVAL[interval];
    if (!iv) throw new Error(`Unsupported interval ${interval}`);
    const days = Math.min(MAX_DAYS[interval], Math.ceil(count / BARS_PER_DAY[interval]) * (interval === '1d' ? 1.5 : 1.6) + 4);
    const now = Math.floor(Date.now() / 1000);
    const params = { exchange: r.exch, symboltoken: r.token, interval: iv, fromdate: istString(now - days * 86400), todate: istString(now) };

    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await this.limited(() => this.smart.getCandleData(params), priority);
        if (res && res.status && Array.isArray(res.data)) {
          const data = res.data.map((x) => ({ t: Math.floor(Date.parse(x[0]) / 1000), o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] || 0 }));
          this.cache.set(key, { count, data }, CACHE_MS[interval]);
          return data.slice(-count);
        }
        lastErr = new Error((res && (res.message || res.errorcode)) || 'Empty response from Angel One');
      } catch (e) { lastErr = e; }
      await sleep(1500 * (attempt + 1)); // back off, then retry (rate-limit errors are common)
    }
    const stale = this.cache.getStale(key);
    if (stale) return stale.data.slice(-count);
    throw lastErr;
  }

  /* ---------- option chain (nearest expiry, 10 strikes either side) ---------- */
  async optionChain(symbol) {
    const idx = INDICES.find((i) => i.symbol === symbol && i.optionName);
    const q = this.quote(symbol);
    if (!idx || !q) return null;
    const parseExp = (s) => { const m = /^(\d{1,2})([A-Z]{3})(\d{4})$/.exec(s); return m ? Date.UTC(+m[3], MONTHS[m[2]], +m[1]) : Infinity; };
    const todayMs = Date.parse(istNow().date);
    const contracts = this.options.filter((o) => o.name === idx.optionName && parseExp(o.expiry) >= todayMs);
    if (!contracts.length) return { symbol, rows: [], error: 'No option contracts found in the instrument master' };
    const expiry = contracts.reduce((a, o) => (parseExp(o.expiry) < parseExp(a) ? o.expiry : a), contracts[0].expiry);
    const ofExp = contracts.filter((o) => o.expiry === expiry);
    const strikes = [...new Set(ofExp.map((o) => o.strike))].sort((a, b) => a - b);
    let ai = 0;
    strikes.forEach((s, i) => { if (Math.abs(s - q.ltp) < Math.abs(strikes[ai] - q.ltp)) ai = i; });
    const pick = strikes.slice(Math.max(0, ai - 10), ai + 11);
    const exType = idx.optionExch === 'BFO' ? EX.BSE_FO : EX.NSE_FO;
    this.optionKeys = this.optionKeys || new Set();
    const wanted = ofExp.filter((o) => pick.includes(o.strike));
    wanted.forEach((o) => this.optionKeys.add(`${exType}:${o.token}`));
    this.subscribe(exType, wanted.map((o) => o.token), 3);

    const rows = pick.map((strike) => {
      const row = { strike };
      ['CE', 'PE'].forEach((side) => {
        const c = wanted.find((o) => o.strike === strike && o.type === side);
        const d = c && this.optionData.get(`${exType}:${c.token}`);
        if (d) row[side.toLowerCase()] = { ltp: d.ltp, oi: d.oi };
      });
      return row;
    });
    const loaded = rows.filter((r) => r.ce || r.pe).length;
    return { symbol, expiry, spot: q.ltp, simulated: false, loading: loaded < rows.length / 2, rows, ...summarize(rows, q.ltp) };
  }
}

module.exports = { AngelFeed };
