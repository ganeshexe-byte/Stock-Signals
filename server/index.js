const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const cfg = require('./config');
const feed = require('./feed');
const analysis = require('./analysis');
const periods = require('./periods');
const scanners = require('./scanners');
const paper = require('./paper');
const journal = require('./journal');
const store = require('./store');
const { INDICES, STOCKS } = require('./universe');
const { marketOpen, istNow } = require('./util');

const app = express();
app.use(express.json({ limit: '100kb' }));

// Local-only safety: refuse requests whose Host / Origin is not this machine (DNS rebinding, other websites).
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
app.use((req, res, next) => {
  if (cfg.host === '127.0.0.1') {
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    if (!localHosts.has(host)) return res.status(403).json({ error: 'Forbidden host' });
  }
  const origin = req.headers.origin;
  if (origin && req.method !== 'GET' && new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Cross-site request blocked' });
  next();
});

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => res.status(400).json({ error: e.message || String(e) }));

/* ---------- static files ---------- */
app.use('/vendor/lightweight-charts.js', express.static(path.join(__dirname, '..', 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.production.js')));
app.use(express.static(cfg.publicDir, { extensions: ['html'] }));

/* ---------- market data ---------- */
app.get('/api/status', (req, res) => {
  res.json({ ...feed.status, marketOpen: marketOpen(), istTime: istNow().hhmm, serverTime: Date.now(), simulated: feed.mode === 'mock' });
});

app.get('/api/universe', (req, res) => {
  res.json({ indices: INDICES.map(({ symbol, name, exch }) => ({ symbol, name, exch })), stocks: STOCKS.map(({ symbol, sector }) => ({ symbol, sector })) });
});

app.get('/api/search', (req, res) => res.json(feed.search(String(req.query.q || ''), 15)));

app.get('/api/quotes', wrap(async (req, res) => {
  const symbols = String(req.query.symbols || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 200);
  await feed.ensure(symbols);
  const out = {};
  symbols.forEach((s) => { const q = feed.quote(s); if (q) out[s] = q; });
  res.json(out);
}));

app.get('/api/candles', wrap(async (req, res) => {
  const symbol = String(req.query.symbol || '').toUpperCase();
  const interval = String(req.query.interval || '5m');
  const count = Math.min(Math.max(parseInt(req.query.count, 10) || 200, 10), 1500);
  await feed.ensure([symbol]);
  res.json({ symbol, interval, candles: await feed.candles(symbol, interval, count) });
}));

app.get('/api/market', wrap(async (req, res) => res.json(await analysis.marketSummary())));
app.get('/api/index/:symbol', wrap(async (req, res) => res.json(await analysis.indexAnalysis(req.params.symbol.toUpperCase()))));
app.get('/api/periods/:symbol', wrap(async (req, res) => res.json(await periods.periods(req.params.symbol))));
app.get('/api/optionchain/:symbol', wrap(async (req, res) => {
  const chain = await feed.optionChain(req.params.symbol.toUpperCase());
  if (!chain) return res.status(404).json({ error: 'No option chain for this symbol' });
  res.json(chain);
}));

/* ---------- scanners / daily analysis ---------- */
app.get('/api/scan/:type', (req, res) => {
  if (!['intraday', 'swing', 'long'].includes(req.params.type)) return res.status(404).json({ error: 'Unknown scanner' });
  res.json(scanners.get(req.params.type));
});
app.get('/api/analysis/history', (req, res) => res.json({ snapshots: analysis.historyWithOutcomes() }));
app.post('/api/analysis/snapshot', wrap(async (req, res) => res.json(await analysis.saveSnapshot(true))));

/* ---------- paper trading ---------- */
app.get('/api/paper', (req, res) => res.json(paper.view()));
app.post('/api/paper/orders', wrap(async (req, res) => res.json({ order: paper.placeOrder(req.body || {}), ...paper.view() })));
app.delete('/api/paper/orders/:id', wrap(async (req, res) => { paper.cancelOrder(req.params.id); res.json(paper.view()); }));
app.post('/api/paper/close', wrap(async (req, res) => { paper.closePosition(String(req.body.symbol || '').toUpperCase(), req.body.product); res.json(paper.view()); }));
app.post('/api/paper/reset', wrap(async (req, res) => { paper.reset(req.body && req.body.capital); res.json(paper.view()); }));

/* ---------- journal + watchlist ---------- */
app.get('/api/journal', (req, res) => res.json({ entries: journal.list(), stats: journal.stats() }));
app.post('/api/journal', wrap(async (req, res) => { journal.addManual(req.body || {}); res.json({ entries: journal.list(), stats: journal.stats() }); }));
app.patch('/api/journal/:id', wrap(async (req, res) => {
  if (!journal.update(req.params.id, req.body || {})) return res.status(404).json({ error: 'Entry not found' });
  res.json({ entries: journal.list(), stats: journal.stats() });
}));
app.delete('/api/journal/:id', wrap(async (req, res) => { journal.remove(req.params.id); res.json({ entries: journal.list(), stats: journal.stats() }); }));

const DEFAULT_WATCH = ['RELIANCE', 'HDFCBANK', 'TCS', 'INFY', 'ICICIBANK', 'SBIN', 'ITC', 'TATAMOTORS'];
app.get('/api/watchlist', (req, res) => res.json({ symbols: store.load('watchlist', () => ({ symbols: DEFAULT_WATCH })).symbols }));
app.put('/api/watchlist', wrap(async (req, res) => {
  const list = [...new Set((req.body.symbols || []).map((s) => String(s).toUpperCase().trim()).filter(Boolean))].slice(0, 100);
  store.load('watchlist', () => ({ symbols: [] })).symbols = list;
  store.save('watchlist');
  await feed.ensure(list);
  res.json({ symbols: list });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

/* ---------- WebSocket: quotes pushed to the browser ---------- */
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/stream' });
const clients = new Set();

wss.on('connection', (ws, req) => {
  if (cfg.host === '127.0.0.1') {
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    if (!localHosts.has(host)) return ws.close();
  }
  const c = { ws, symbols: new Set(), dirty: new Set() };
  clients.add(c);
  ws.send(JSON.stringify({ type: 'status', data: { ...feed.status, marketOpen: marketOpen(), simulated: feed.mode === 'mock' } }));
  ws.on('message', async (raw) => {
    try {
      const m = JSON.parse(raw);
      if (m.type === 'sub' && Array.isArray(m.symbols)) {
        c.symbols = new Set(m.symbols.map((s) => String(s).toUpperCase()).slice(0, 300));
        await feed.ensure([...c.symbols]);
        const snap = {};
        c.symbols.forEach((s) => { const q = feed.quote(s); if (q) snap[s] = q; });
        ws.send(JSON.stringify({ type: 'quotes', data: snap }));
      }
    } catch { /* ignore malformed messages */ }
  });
  ws.on('close', () => clients.delete(c));
});

feed.on('quote', (q) => { clients.forEach((c) => { if (c.symbols.has(q.symbol)) c.dirty.add(q.symbol); }); });

setInterval(() => {
  clients.forEach((c) => {
    if (!c.dirty.size || c.ws.readyState !== 1) return;
    const data = {};
    c.dirty.forEach((s) => { const q = feed.quote(s); if (q) data[s] = q; });
    c.dirty.clear();
    c.ws.send(JSON.stringify({ type: 'quotes', data }));
  });
}, 400);

function broadcast(obj) {
  const s = JSON.stringify(obj);
  clients.forEach((c) => { if (c.ws.readyState === 1) c.ws.send(s); });
}
setInterval(() => broadcast({ type: 'status', data: { ...feed.status, marketOpen: marketOpen(), simulated: feed.mode === 'mock' } }), 10000);
paper.on('event', (event) => broadcast({ type: 'paper', event }));

/* ---------- boot ---------- */
// Remember the last prices (live mode only) so a restart while the market is closed still shows data
if (feed.mode !== 'mock') {
  feed.seed(store.load('lastquotes', () => ({ quotes: {} })).quotes);
  setInterval(() => {
    const snap = feed.snapshot();
    if (!Object.keys(snap).length) return; // never overwrite good data with an empty snapshot
    const saved = store.load('lastquotes', () => ({ quotes: {} }));
    saved.quotes = { ...saved.quotes, ...snap };
    store.save('lastquotes');
  }, 30000);
}

(async () => {
  console.log(`Mode: ${feed.mode === 'mock' ? 'SIMULATED data (no Angel One credentials in .env)' : 'LIVE data via Angel One SmartAPI'}`);
  feed.start().catch((e) => console.error('[feed]', e.message));
  paper.start();
  scanners.start();
  analysis.startJobs(broadcast);
  server.listen(cfg.port, cfg.host, () => console.log(`StockLens running at http://${cfg.host === '0.0.0.0' ? 'localhost' : cfg.host}:${cfg.port}`));
})();

process.on('SIGINT', () => { store.flushAll(); process.exit(0); });
process.on('SIGTERM', () => { store.flushAll(); process.exit(0); });
