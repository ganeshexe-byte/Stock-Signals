// Trading journal: every closed paper trade becomes an entry you can annotate.
const store = require('./store');

function data() { return store.load('journal', () => ({ seq: 1, entries: [] })); }

function addFromTrade(trade) {
  const d = data();
  const e = {
    id: `J${d.seq++}`, tradeId: trade.id, manual: false, createdTs: Date.now(),
    symbol: trade.symbol, side: trade.side, qty: trade.qty, entry: trade.entry, exit: trade.exit,
    entryTs: trade.entryTs, exitTs: trade.exitTs, net: trade.net, product: trade.product,
    condition: trade.condition || null, tag: trade.tag || '', emotion: '', rating: 0, notes: '',
  };
  d.entries.push(e);
  store.save('journal');
  return e;
}

function addManual(x) {
  const d = data();
  const entry = Number(x.entry) || 0, exit = Number(x.exit) || 0, qty = Number(x.qty) || 0;
  const side = x.side === 'SHORT' ? 'SHORT' : 'LONG';
  const net = x.net !== undefined && x.net !== '' ? Number(x.net) : (side === 'LONG' ? exit - entry : entry - exit) * qty;
  const e = {
    id: `J${d.seq++}`, tradeId: null, manual: true, createdTs: Date.now(),
    symbol: String(x.symbol || '').toUpperCase(), side, qty, entry, exit,
    entryTs: x.entryTs || Math.floor(Date.now() / 1000), exitTs: x.exitTs || Math.floor(Date.now() / 1000), net, product: x.product || '',
    condition: x.condition || null, tag: x.tag || '', emotion: x.emotion || '', rating: Number(x.rating) || 0, notes: x.notes || '',
  };
  d.entries.push(e);
  store.save('journal');
  return e;
}

function update(id, patch) {
  const e = data().entries.find((x) => x.id === id);
  if (!e) return null;
  ['tag', 'emotion', 'notes'].forEach((k) => { if (typeof patch[k] === 'string') e[k] = patch[k].slice(0, 2000); });
  if (patch.rating !== undefined) e.rating = Math.max(0, Math.min(5, Number(patch.rating) || 0));
  store.save('journal');
  return e;
}

function remove(id) {
  const d = data();
  const n = d.entries.length;
  d.entries = d.entries.filter((x) => x.id !== id);
  store.save('journal');
  return d.entries.length < n;
}

function group(entries, keyFn, fallback = 'Untagged') {
  const m = {};
  entries.forEach((e) => {
    const k = keyFn(e) || fallback;
    const g = (m[k] = m[k] || { n: 0, wins: 0, net: 0 });
    g.n++; g.net += e.net; if (e.net > 0) g.wins++;
  });
  return Object.entries(m).map(([name, g]) => ({ name, n: g.n, net: g.net, winRate: g.n ? (g.wins / g.n) * 100 : 0 })).sort((a, b) => b.n - a.n);
}

function stats() {
  const es = data().entries.slice().sort((a, b) => a.exitTs - b.exitTs);
  const wins = es.filter((e) => e.net > 0), losses = es.filter((e) => e.net < 0);
  const sum = (a) => a.reduce((s, e) => s + e.net, 0);
  const gw = sum(wins), gl = Math.abs(sum(losses));
  let cum = 0;
  const curve = es.map((e) => ({ t: e.exitTs, v: (cum += e.net) }));
  return {
    count: es.length, wins: wins.length, losses: losses.length,
    winRate: es.length ? (wins.length / es.length) * 100 : 0,
    totalNet: sum(es), avgWin: wins.length ? gw / wins.length : 0, avgLoss: losses.length ? -gl / losses.length : 0,
    profitFactor: gl ? gw / gl : (gw ? null : 0),
    expectancy: es.length ? sum(es) / es.length : 0,
    best: es.length ? Math.max(...es.map((e) => e.net)) : 0, worst: es.length ? Math.min(...es.map((e) => e.net)) : 0,
    byCondition: group(es, (e) => e.condition && e.condition.overall, 'Not recorded'),
    byTag: group(es, (e) => e.tag),
    bySide: group(es, (e) => e.side),
    curve,
  };
}

function list() { return data().entries.slice().sort((a, b) => b.exitTs - a.exitTs); }

module.exports = { addFromTrade, addManual, update, remove, list, stats };
