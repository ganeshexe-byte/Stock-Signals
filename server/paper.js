// Paper-trading engine. Virtual money only: nothing here ever contacts a broker order API.
const { EventEmitter } = require('events');
const feed = require('./feed');
const store = require('./store');
const journal = require('./journal');
const analysis = require('./analysis');
const { istNow, marketOpen } = require('./util');

const DEFAULTS = { startingCapital: 1000000, slippagePct: 0.02, misLeverage: 5 };
const round05 = (x) => Math.round(x * 20) / 20;
const r2 = (x) => Math.round(x * 100) / 100;

// Approximate Indian equity charges (edit if rates change): brokerage min(Rs 20, 0.03%),
// STT, exchange fee, SEBI fee, stamp duty and 18% GST on fees.
function charges(turnover, side, product) {
  const brokerage = Math.min(20, turnover * 0.0003);
  const stt = product === 'MIS' ? (side === 'SELL' ? turnover * 0.00025 : 0) : turnover * 0.001;
  const txn = turnover * 0.0000297;
  const sebi = turnover * 0.000001;
  const stamp = side === 'BUY' ? turnover * (product === 'MIS' ? 0.00003 : 0.00015) : 0;
  const gst = (brokerage + txn + sebi) * 0.18;
  return r2(brokerage + stt + txn + sebi + stamp + gst);
}

class Paper extends EventEmitter {
  data() {
    return store.load('paper', () => ({ ...DEFAULTS, realized: 0, seq: 1, tseq: 1, orders: [], positions: {}, trades: [] }));
  }

  /* ---------- accounting ---------- */
  unrealized() {
    return Object.values(this.data().positions).reduce((s, p) => {
      const q = feed.quote(p.symbol);
      return s + (q ? (q.ltp - p.avg) * p.qty : 0);
    }, 0);
  }

  blocked() {
    const d = this.data();
    return Object.values(d.positions).reduce((s, p) => s + (Math.abs(p.qty) * p.avg) / (p.product === 'MIS' ? d.misLeverage : 1), 0);
  }

  equity() { const d = this.data(); return d.startingCapital + d.realized + this.unrealized(); }
  available() { return this.equity() - this.blocked(); }

  view() {
    const d = this.data();
    const today = istNow().date;
    const positions = Object.values(d.positions).map((p) => {
      const q = feed.quote(p.symbol);
      const ltp = q ? q.ltp : p.avg;
      const pnl = (ltp - p.avg) * p.qty;
      return { ...p, ltp, pnl, pnlPct: p.avg ? (pnl / (Math.abs(p.qty) * p.avg)) * 100 : 0 };
    });
    const tradesToday = d.trades.filter((t) => new Date((t.exitTs + 19800) * 1000).toISOString().slice(0, 10) === today);
    return {
      account: {
        startingCapital: d.startingCapital, realized: d.realized, unrealized: this.unrealized(), equity: this.equity(),
        blocked: this.blocked(), available: this.available(), realizedToday: tradesToday.reduce((s, t) => s + t.net, 0),
        misLeverage: d.misLeverage, slippagePct: d.slippagePct,
      },
      positions,
      orders: d.orders.slice(-150).reverse(),
      trades: d.trades.slice(-200).reverse(),
      mode: feed.mode, marketOpen: marketOpen(),
    };
  }

  /* ---------- orders ---------- */
  placeOrder(inp) {
    const d = this.data();
    const symbol = String(inp.symbol || '').toUpperCase().trim();
    const side = String(inp.side || '').toUpperCase();
    const type = String(inp.type || 'MARKET').toUpperCase();
    const product = String(inp.product || 'MIS').toUpperCase();
    const qty = Math.floor(Number(inp.qty));
    const price = Number(inp.price) || 0, trigger = Number(inp.trigger) || 0;

    const fail = (m) => { throw new Error(m); };
    if (!symbol) fail('Symbol is required');
    if (!['BUY', 'SELL'].includes(side)) fail('Side must be BUY or SELL');
    if (!['MARKET', 'LIMIT', 'SL'].includes(type)) fail('Order type must be MARKET, LIMIT or SL');
    if (!['MIS', 'CNC'].includes(product)) fail('Product must be MIS (intraday) or CNC (delivery)');
    if (!(qty >= 1)) fail('Quantity must be at least 1');
    if (type === 'LIMIT' && !(price > 0)) fail('Enter a limit price');
    if (type === 'SL' && !(trigger > 0)) fail('Enter a trigger price');
    const q = feed.quote(symbol);
    if (!q) fail(`No live price for ${symbol} yet. Open it in Charts first, or check the symbol.`);
    if (feed.mode === 'angel' && type === 'MARKET' && !marketOpen()) fail('Market is closed. Use a limit or stop order to queue one.');

    const key = `${symbol}|${product}`;
    const pos = d.positions[key];
    const cur = pos ? pos.qty : 0;
    const delta = side === 'BUY' ? qty : -qty;
    if (product === 'CNC' && cur + delta < 0) fail(cur > 0 ? `You hold only ${cur} ${symbol} (delivery). Short selling is only allowed for intraday (MIS).` : 'Delivery (CNC) orders cannot be sold short. Use MIS for short selling.');

    // margin for the part of the order that increases exposure
    const ref = type === 'LIMIT' ? price : type === 'SL' ? trigger : q.ltp;
    const increase = Math.max(0, Math.abs(cur + delta) - Math.abs(cur));
    const need = (increase * ref) / (product === 'MIS' ? d.misLeverage : 1);
    if (need > this.available() + 1e-6) fail(`Not enough virtual funds: need about Rs ${r2(need).toLocaleString('en-IN')}, available Rs ${r2(this.available()).toLocaleString('en-IN')}`);

    const order = {
      id: `O${d.seq++}`, ts: Math.floor(Date.now() / 1000), symbol, side, qty, type, price: type === 'LIMIT' ? price : 0, trigger: type === 'SL' ? trigger : 0,
      product, status: 'OPEN', fillPrice: null, fillTs: null, charges: 0, tag: String(inp.tag || '').slice(0, 40), condition: analysis.conditionSnapshot(),
    };
    d.orders.push(order);
    if (type === 'MARKET') this.fill(order, q.ltp, true);
    else this.emit('event', { type: 'order', order });
    store.save('paper');
    return order;
  }

  cancelOrder(id) {
    const o = this.data().orders.find((x) => x.id === id);
    if (!o) throw new Error('Order not found');
    if (o.status !== 'OPEN') throw new Error(`Order is already ${o.status.toLowerCase()}`);
    o.status = 'CANCELLED';
    store.save('paper');
    this.emit('event', { type: 'order', order: o });
    return o;
  }

  closePosition(symbol, product) {
    const p = this.data().positions[`${symbol}|${product}`];
    if (!p) throw new Error('No such position');
    return this.placeOrder({ symbol, product, side: p.qty > 0 ? 'SELL' : 'BUY', qty: Math.abs(p.qty), type: 'MARKET', tag: 'manual close' });
  }

  reset(capital) {
    const d = this.data();
    const c = Number(capital) > 0 ? Number(capital) : d.startingCapital;
    Object.assign(d, { startingCapital: c, realized: 0, orders: [], positions: {}, trades: [] });
    store.save('paper');
    this.emit('event', { type: 'reset' });
  }

  /* ---------- fills ---------- */
  fill(order, ltp, slip) {
    const d = this.data();
    const s = slip ? d.slippagePct / 100 : 0;
    const price = round05(order.side === 'BUY' ? ltp * (1 + s) : ltp * (1 - s));
    const key = `${order.symbol}|${order.product}`;
    const pos = d.positions[key] || { symbol: order.symbol, product: order.product, qty: 0, avg: 0, openedTs: order.ts, entryCharges: 0, tag: order.tag, condition: order.condition };
    const delta = order.side === 'BUY' ? order.qty : -order.qty;
    const fee = charges(price * order.qty, order.side, order.product);
    order.status = 'FILLED'; order.fillPrice = price; order.fillTs = Math.floor(Date.now() / 1000); order.charges = fee;

    const sameDir = pos.qty === 0 || Math.sign(pos.qty) === Math.sign(delta);
    if (sameDir) {
      if (pos.qty === 0) { pos.openedTs = order.fillTs; pos.tag = order.tag; pos.condition = order.condition; pos.entryCharges = 0; }
      pos.avg = (Math.abs(pos.qty) * pos.avg + Math.abs(delta) * price) / (Math.abs(pos.qty) + Math.abs(delta));
      pos.qty += delta;
      pos.entryCharges += fee;
    } else {
      const closeQty = Math.min(Math.abs(delta), Math.abs(pos.qty));
      const closeFee = fee * (closeQty / Math.abs(delta));
      const entryShare = pos.entryCharges * (closeQty / Math.abs(pos.qty));
      const gross = (price - pos.avg) * closeQty * Math.sign(pos.qty);
      const net = gross - closeFee - entryShare;
      const trade = {
        id: `T${d.tseq++}`, symbol: pos.symbol, product: pos.product, side: pos.qty > 0 ? 'LONG' : 'SHORT', qty: closeQty,
        entry: r2(pos.avg), exit: price, entryTs: pos.openedTs, exitTs: order.fillTs, gross: r2(gross), charges: r2(closeFee + entryShare), net: r2(net),
        condition: pos.condition || null, tag: order.tag === 'manual close' || order.tag === 'auto-squareoff' ? pos.tag : (pos.tag || order.tag),
        exitReason: order.tag === 'auto-squareoff' ? 'Auto square-off' : '',
      };
      d.trades.push(trade);
      d.realized += trade.net;
      pos.entryCharges -= entryShare;
      pos.qty += delta;
      journal.addFromTrade(trade);
      this.emit('event', { type: 'trade', trade });
      const rest = Math.abs(delta) - closeQty; // flipped through zero: the remainder opens a new position
      if (rest > 0) { pos.avg = price; pos.openedTs = order.fillTs; pos.entryCharges = fee - closeFee; pos.tag = order.tag; pos.condition = order.condition; }
    }
    if (pos.qty === 0) delete d.positions[key]; else d.positions[key] = pos;
    store.save('paper');
    this.emit('event', { type: 'order', order });
    this.emit('event', { type: 'position' });
  }

  onQuote(q) {
    const d = this.data();
    const open = d.orders.filter((o) => o.status === 'OPEN' && o.symbol === q.symbol);
    if (!open.length) return;
    if (feed.mode === 'angel' && !marketOpen()) return;
    open.forEach((o) => {
      const buy = o.side === 'BUY';
      let hit = false, slip = false;
      if (o.type === 'LIMIT') hit = buy ? q.ltp <= o.price : q.ltp >= o.price;
      else if (o.type === 'SL') { hit = buy ? q.ltp >= o.trigger : q.ltp <= o.trigger; slip = true; }
      if (!hit) return;
      const pos = d.positions[`${o.symbol}|${o.product}`];
      if (o.product === 'CNC' && !buy && (!pos || pos.qty < o.qty)) { o.status = 'REJECTED'; this.emit('event', { type: 'order', order: o }); return; }
      this.fill(o, q.ltp, slip);
    });
  }

  // Intraday (MIS) positions are closed automatically at 15:20 IST on live data.
  // Skipped in simulated mode, which runs around the clock.
  autoSquareOff() {
    if (feed.mode !== 'angel') return;
    const n = istNow();
    if (n.dow < 1 || n.dow > 5 || n.minutes < 15 * 60 + 20) return;
    const d = this.data();
    d.orders.filter((o) => o.status === 'OPEN' && o.product === 'MIS').forEach((o) => { o.status = 'CANCELLED'; });
    Object.values(d.positions).filter((p) => p.product === 'MIS').forEach((p) => {
      const q = feed.quote(p.symbol);
      if (!q) return;
      const order = {
        id: `O${d.seq++}`, ts: Math.floor(Date.now() / 1000), symbol: p.symbol, side: p.qty > 0 ? 'SELL' : 'BUY', qty: Math.abs(p.qty),
        type: 'MARKET', price: 0, trigger: 0, product: 'MIS', status: 'OPEN', fillPrice: null, fillTs: null, charges: 0, tag: 'auto-squareoff', condition: null,
      };
      d.orders.push(order);
      this.fill(order, q.ltp, true);
    });
  }

  start() {
    feed.on('quote', (q) => { try { this.onQuote(q); } catch (e) { console.error('[paper]', e.message); } });
    setInterval(() => this.autoSquareOff(), 10000);
  }
}

module.exports = new Paper();
module.exports.charges = charges;
