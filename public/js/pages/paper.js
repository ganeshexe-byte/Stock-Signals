(function () {
  const { $, $$, esc, nf, pct, inr, sinr, cls, labelCls, api } = App;
  const params = new URLSearchParams(location.search);
  let sym = (params.get('symbol') || 'RELIANCE').toUpperCase();
  let side = params.get('side') === 'SELL' ? 'SELL' : 'BUY';
  let view = null;

  App.init({ active: 'paper', symbols: [sym] });
  App.tabs($('#histTabs'));
  const chart = new StockChart($('#chart'), { symbol: sym, interval: '5m', overlays: ['vwap', 'ema21'], height: 300 });
  $('#tfSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $$('#tfSeg button').forEach((x) => x.classList.toggle('on', x === b)); chart.setInterval(b.dataset.iv); });

  const time = (t) => App.istTime(t, true);
  const tag = (l) => (l ? `<span class="tag ${labelCls(l)}">${esc(l)}</span>` : '<span class="muted">–</span>');

  // Same approximate Indian equity charges as the server (server/paper.js)
  function charges(turnover, s, product) {
    const brokerage = Math.min(20, turnover * 0.0003);
    const stt = product === 'MIS' ? (s === 'SELL' ? turnover * 0.00025 : 0) : turnover * 0.001;
    const txn = turnover * 0.0000297, sebi = turnover * 0.000001;
    const stamp = s === 'BUY' ? turnover * (product === 'MIS' ? 0.00003 : 0.00015) : 0;
    return brokerage + stt + txn + sebi + stamp + (brokerage + txn + sebi) * 0.18;
  }

  /* ---------- account + tables ---------- */
  function drawStats() {
    if (!view) return;
    const a = view.account;
    const unreal = view.positions.reduce((s, p) => s + p.pnl, 0);
    const equity = a.startingCapital + a.realized + unreal;
    const items = [['Equity', inr(equity), ''], ['Available', inr(equity - a.blocked), ''], ['Margin in use', inr(a.blocked), ''], ['Realized today', sinr(a.realizedToday), cls(a.realizedToday)], ['Unrealized', sinr(unreal), cls(unreal)], ['Total realized', sinr(a.realized), cls(a.realized)]];
    $('#stats').innerHTML = items.map(([k, v, c]) => `<div class="stat"><span>${k}</span><b class="${c}">${v}</b></div>`).join('');
  }
  function drawPositions() {
    if (!view) return;
    $('#positions').innerHTML = view.positions.length ? view.positions.map((p) => `<tr><td class="l"><a class="sym" href="charts.html?s=${encodeURIComponent(p.symbol)}">${esc(p.symbol)}</a></td><td class="l">${p.product === 'MIS' ? 'Intraday' : 'Delivery'}</td><td class="num">${p.qty}</td><td class="num">${nf(p.avg)}</td><td class="num">${nf(p.ltp)}</td><td class="num ${cls(p.pnl)}">${sinr(p.pnl, 2)}</td><td class="num ${cls(p.pnl)}">${pct(p.pnlPct)}</td><td class="num"><button type="button" class="btn small danger" data-close="${esc(p.symbol)}|${p.product}">Close</button></td></tr>`).join('') : '<tr><td colspan="8" class="empty">No open positions. Place an order to get started.</td></tr>';
  }
  function drawLists() {
    if (!view) return;
    const open = view.orders.filter((o) => o.status === 'OPEN');
    $('#openOrders').innerHTML = open.length ? open.map((o) => `<tr><td class="l">${time(o.ts)}</td><td class="l">${esc(o.symbol)}</td><td class="l ${o.side === 'BUY' ? 'up' : 'down'}">${o.side}</td><td class="l">${o.type}</td><td class="num">${nf(o.type === 'SL' ? o.trigger : o.price)}</td><td class="num">${o.qty}</td><td class="l">${o.product}</td><td class="num"><button type="button" class="btn small" data-cancel="${esc(o.id)}">Cancel</button></td></tr>`).join('') : '<tr><td colspan="8" class="empty">No open orders</td></tr>';
    $('#orderHist').innerHTML = view.orders.length ? view.orders.map((o) => `<tr><td class="l">${time(o.ts)}</td><td class="l">${esc(o.symbol)}</td><td class="l ${o.side === 'BUY' ? 'up' : 'down'}">${o.side}</td><td class="l">${o.type}</td><td class="num">${o.qty}</td><td class="num">${o.fillPrice ? nf(o.fillPrice) : '–'}</td><td class="num">${o.charges ? nf(o.charges) : '–'}</td><td class="l">${o.status}${o.tag === 'auto-squareoff' ? ' (auto square-off)' : ''}</td></tr>`).join('') : '<tr><td colspan="8" class="empty">No orders yet</td></tr>';
    $('#trades').innerHTML = view.trades.length ? view.trades.map((t) => `<tr><td class="l">${time(t.exitTs)}</td><td class="l">${esc(t.symbol)}</td><td class="l">${t.side}</td><td class="num">${t.qty}</td><td class="num">${nf(t.entry)}</td><td class="num">${nf(t.exit)}</td><td class="num ${cls(t.gross)}">${nf(t.gross)}</td><td class="num">${nf(t.charges)}</td><td class="num ${cls(t.net)}"><b>${sinr(t.net, 2)}</b></td><td class="l">${tag(t.condition && t.condition.overall)}</td><td class="l muted">${esc(t.exitReason || t.tag || '')}</td></tr>`).join('') : '<tr><td colspan="11" class="empty">Closed trades appear here and in your Journal</td></tr>';
  }
  async function reload() {
    try { view = await api('/api/paper'); drawStats(); drawPositions(); drawLists(); App.watch([...new Set([sym, ...view.positions.map((p) => p.symbol), ...view.orders.filter((o) => o.status === 'OPEN').map((o) => o.symbol)])]); estimate(); }
    catch (e) { App.toast(e.message, 'err'); }
  }
  // keep P&L live between server refreshes
  App.on('quote', (q) => {
    if (q.symbol === sym) { App.setNum($('#tLtp'), q.ltp, nf(q.ltp)); estimate(); }
    if (!view) return;
    let hit = false;
    view.positions.forEach((p) => { if (p.symbol === q.symbol) { p.ltp = q.ltp; p.pnl = (q.ltp - p.avg) * p.qty; p.pnlPct = p.avg ? (p.pnl / (Math.abs(p.qty) * p.avg)) * 100 : 0; hit = true; } });
    if (hit) { drawStats(); drawPositions(); }
  });
  App.on('paper', reload);

  /* ---------- ticket ---------- */
  function type() { return $('#tType').value; }
  function drawTicket() {
    $$('#sideSeg button').forEach((b) => b.classList.toggle('on', b.dataset.side === side));
    const submit = $('#tSubmit'); submit.className = `btn ${side === 'BUY' ? 'buy' : 'sell'}`; submit.textContent = `${side === 'BUY' ? 'Buy' : 'Sell'} ${sym} (paper)`;
    $('#priceWrap').hidden = type() !== 'LIMIT'; $('#trigWrap').hidden = type() !== 'SL';
    estimate();
  }
  function estimate() {
    const q = App.state.quotes[sym], qty = Math.floor(Number($('#tQty').value)) || 0, product = $('#tProduct').value;
    const ref = type() === 'LIMIT' ? Number($('#tPrice').value) || (q && q.ltp) : type() === 'SL' ? Number($('#tTrig').value) || (q && q.ltp) : q && q.ltp;
    if (!q || !ref || !qty) { $('#estimate').innerHTML = '<li><span>Enter a quantity to see an estimate</span><b></b></li>'; return; }
    const value = ref * qty;
    const lev = view ? view.account.misLeverage : 5;
    const need = product === 'MIS' ? value / lev : value;
    const avail = view ? view.account.equity - view.account.blocked : null;
    $('#estimate').innerHTML = `<li><span>Order value</span><b>${inr(value, 2)}</b></li><li><span>Margin needed (about)</span><b>${inr(need, 2)}</b></li><li><span>Estimated charges</span><b>${inr(charges(value, side, product), 2)}</b></li>${avail != null ? `<li><span>Available</span><b class="${need > avail ? 'down' : ''}">${inr(avail)}</b></li>` : ''}`;
  }
  $('#sideSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { side = b.dataset.side; drawTicket(); } });
  ['tType', 'tProduct'].forEach((id) => $(`#${id}`).addEventListener('change', drawTicket));
  ['tQty', 'tPrice', 'tTrig'].forEach((id) => $(`#${id}`).addEventListener('input', estimate));
  function setSymbol(s) {
    sym = (s || '').toUpperCase().trim(); if (!sym) return;
    $('#tSymbol').value = sym; $('#tLtp').textContent = '–';
    chart.setSymbol(sym); App.watch([sym]);
    api(`/api/quotes?symbols=${encodeURIComponent(sym)}`).then((r) => { if (r[sym]) { App.state.quotes[sym] = r[sym]; $('#tLtp').textContent = nf(r[sym].ltp); estimate(); } }).catch(() => {});
    drawTicket();
  }
  $('#tSymbol').value = sym;
  App.symbolInput($('#tSymbol'), setSymbol);
  setSymbol(sym);

  $('#ticket').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#tErr'); err.hidden = true;
    const btn = $('#tSubmit'); btn.disabled = true;
    try {
      await api('/api/paper/orders', { method: 'POST', body: { symbol: sym, side, qty: $('#tQty').value, type: type(), product: $('#tProduct').value, price: $('#tPrice').value, trigger: $('#tTrig').value, tag: $('#tTag').value } });
      await reload();
    } catch (ex) { err.hidden = false; err.textContent = ex.message; }
    btn.disabled = false;
  });

  document.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-close]'), x = e.target.closest('[data-cancel]');
    try {
      if (c) { const [s, p] = c.dataset.close.split('|'); await api('/api/paper/close', { method: 'POST', body: { symbol: s, product: p } }); await reload(); }
      if (x) { await api(`/api/paper/orders/${encodeURIComponent(x.dataset.cancel)}`, { method: 'DELETE' }); await reload(); }
    } catch (ex) { App.toast(ex.message, 'err'); }
  });
  $('#resetBtn').addEventListener('click', async () => {
    const v = prompt('Reset the paper account? This clears all positions, orders and trades. Starting virtual capital (₹):', view ? view.account.startingCapital : 1000000);
    if (v === null) return;
    try { await api('/api/paper/reset', { method: 'POST', body: { capital: Number(String(v).replace(/,/g, '')) } }); App.toast('Paper account reset', 'ok'); await reload(); }
    catch (ex) { App.toast(ex.message, 'err'); }
  });

  reload();
  setInterval(reload, 8000);
})();
