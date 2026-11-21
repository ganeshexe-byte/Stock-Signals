const { EventEmitter } = require('events');
const { bySymbol } = require('../universe');

// Interval name -> seconds per bar
const INTERVAL_SECS = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '1d': 86400, '1w': 604800 };

class BaseFeed extends EventEmitter {
  constructor() {
    super();
    this.mode = 'base';
    this.quotes = new Map();
    this.status = { mode: 'base', connected: false, lastTickAt: null, error: null, note: '' };
  }

  quote(symbol) { return this.quotes.get(symbol) || null; }

  // Quotes saved from the previous run: shown (flagged stale) until the first live tick replaces them,
  // so the site is never empty while the market is closed.
  seed(saved) {
    Object.entries(saved || {}).forEach(([s, q]) => {
      if (q && q.ltp != null && !this.quotes.has(s)) this.quotes.set(s, { ...q, symbol: s, stale: true });
    });
  }

  snapshot() {
    const out = {};
    this.quotes.forEach((q, s) => { if (q.ltp != null && !q.stale) out[s] = q; });
    return out;
  }

  info(symbol) { return bySymbol.get(symbol) || { symbol, name: symbol, exch: 'NSE', type: 'stock' }; }

  setQuote(symbol, q) {
    const prev = this.quotes.get(symbol) || {};
    const merged = { ...prev, ...q, symbol };
    delete merged.stale; // a live tick replaces any quote restored from disk
    if (merged.close) {
      merged.change = merged.ltp - merged.close;
      merged.pct = merged.close ? (merged.change / merged.close) * 100 : 0;
    }
    merged.ts = Date.now();
    this.quotes.set(symbol, merged);
    this.status.lastTickAt = merged.ts;
    this.emit('quote', merged);
    return merged;
  }

  // Subclasses implement: start(), ensure(symbols), candles(), search(), optionChain()
  async start() {}
  async ensure() {}
  async candles() { return []; }
  search() { return []; }
  async optionChain() { return null; }
}

module.exports = { BaseFeed, INTERVAL_SECS };
