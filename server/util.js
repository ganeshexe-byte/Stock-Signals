const IST = 19800;

// Current time pieces in IST
function istNow(ms = Date.now()) {
  const d = new Date(ms + IST * 1000);
  return {
    date: d.toISOString().slice(0, 10),
    dow: d.getUTCDay(), // 0 = Sunday
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
    hhmm: d.toISOString().slice(11, 16),
  };
}

// NSE/BSE cash session: Mon-Fri 09:15 - 15:30 IST. Exchange holidays are NOT handled.
function marketOpen(ms = Date.now()) {
  const n = istNow(ms);
  return n.dow >= 1 && n.dow <= 5 && n.minutes >= 9 * 60 + 15 && n.minutes < 15 * 60 + 30;
}

function istDayStart(tSec) {
  return Math.floor((tSec + IST) / 86400) * 86400 - IST;
}

// 'YYYY-MM-DD HH:mm' in IST, for the Angel One candle API
function istString(tSec) {
  return new Date((tSec + IST) * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

class TTLCache {
  constructor() { this.m = new Map(); }
  get(k) { const e = this.m.get(k); if (!e) return undefined; if (e.exp < Date.now()) { this.m.delete(k); return undefined; } return e.v; }
  getStale(k) { const e = this.m.get(k); return e ? e.v : undefined; }
  set(k, v, ttlMs) { this.m.set(k, { v, exp: Date.now() + ttlMs }); return v; }
}

module.exports = { IST, istNow, marketOpen, istDayStart, istString, sleep, TTLCache };
