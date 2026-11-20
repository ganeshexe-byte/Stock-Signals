(function () {
  const { $, $$, esc, nf, pct, sinr, cls, labelCls, api } = App;
  const MAIN = [['NIFTY', 'NIFTY 50'], ['BANKNIFTY', 'BANK NIFTY'], ['SENSEX', 'SENSEX']];

  App.init({ active: 'dashboard', symbols: [] });
  App.tabs($('#phaseTabs'));

  const chart = new StockChart($('#chart'), { symbol: 'NIFTY', interval: '15m', overlays: ['ema9', 'ema21', 'vwap'], height: 380 });
  $('#tfSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#tfSeg button').forEach((x) => x.classList.toggle('on', x === b));
    chart.setInterval(b.dataset.iv);
  });

  /* ---------- index cards ---------- */
  const sparks = {};
  function drawCards(m) {
    $('#indexCards').innerHTML = MAIN.map(([s, n]) => {
      const p = m && m.indices.find((x) => x.symbol === s);
      const q = App.state.quotes[s] || (p && p.quote);
      const conds = p ? p.conditions : [];
      return `<a class="card index-card" href="market.html?s=${s}" style="display:block">
        <header class="card-head"><div><h3>${n}</h3><p class="price"><span data-px="${s}" style="margin:0;font-size:inherit">${q ? nf(q.ltp) : '–'}</span> <span class="${q ? cls(q.pct) : ''}" data-chg="${s}">${q ? `${q.pct >= 0 ? '▲' : '▼'} ${nf(Math.abs(q.pct))}%` : ''}</span></p></div>
        <svg class="spark" data-spark="${s}" viewBox="0 0 120 40" preserveAspectRatio="none" aria-hidden="true"></svg></header>
        <ul class="tf-list">${(conds.length ? conds : [{ tf: 'Intraday', label: 'No data' }, { tf: 'Short term', label: 'No data' }, { tf: 'Medium term', label: 'No data' }]).map((c) => `<li><span>${esc(c.tf)}</span><span class="tag ${labelCls(c.label)}">${esc(c.label)}</span></li>`).join('')}</ul></a>`;
    }).join('');
    MAIN.forEach(([s]) => { if (sparks[s]) App.spark($(`[data-spark="${s}"]`), sparks[s].v, sparks[s].up); });
  }
  async function loadSparks() {
    for (const [s] of MAIN) {
      try {
        const r = await api(`/api/candles?symbol=${s}&interval=5m&count=80`);
        const last = r.candles[r.candles.length - 1];
        const day = r.candles.filter((c) => App.istDate(c.t) === App.istDate(last.t));
        sparks[s] = { v: day.map((c) => c.c), up: day.length > 1 && day[day.length - 1].c >= day[0].o };
        const el = $(`[data-spark="${s}"]`); if (el) App.spark(el, sparks[s].v, sparks[s].up);
      } catch { /* leave blank */ }
    }
  }
  App.on('market', drawCards);
  App.on('quote', (q) => {
    const px = $(`[data-px="${q.symbol}"]`);
    if (px) { App.setNum(px, q.ltp, nf(q.ltp)); const c = $(`[data-chg="${q.symbol}"]`); c.className = cls(q.pct); c.textContent = `${q.pct >= 0 ? '▲' : '▼'} ${nf(Math.abs(q.pct))}%`; }
  });
  drawCards(App.state.market);
  loadSparks(); setInterval(loadSparks, 60000);

  /* ---------- Nifty daily analysis + sectors + breadth ---------- */
  let watching = false;
  async function loadNifty() {
    try {
      const a = await api('/api/index/NIFTY');
      $('#phasePre').innerHTML = Panels.phase(a, 'pre'); $('#phaseLive').innerHTML = Panels.phase(a, 'live'); $('#phasePost').innerHTML = Panels.phase(a, 'post');
      const m = a.movers;
      $('#sectors').innerHTML = m ? m.sectors.map((s) => `<li><span>${esc(s.name)}</span><div class="bar"><i class="${s.pct >= 0 ? 'pos' : 'neg'}" style="width:${Math.min(100, Math.abs(s.pct) * 40)}%"></i></div><b class="${cls(s.pct)}">${pct(s.pct)}</b></li>`).join('') : '<li class="empty">Waiting for prices…</li>';
      if (m) {
        const t = m.advancers + m.decliners + m.unchanged || 1;
        $('#breadth').innerHTML = `<div class="row" style="justify-content:space-between"><span class="up">${m.advancers} advancing</span><span class="down">${m.decliners} declining</span></div><div class="breadth big"><span class="adv" style="width:${(m.advancers / t) * 100}%"></span><span class="dec" style="width:${(m.decliners / t) * 100}%"></span></div>`;
      }
      if (!watching && a.members.length) { watching = true; App.watch(a.members); }
    } catch (e) { $('#phasePre').innerHTML = `<p class="note err">${esc(e.message)}</p>`; }
  }
  loadNifty(); setInterval(loadNifty, 20000);

  /* ---------- scanner previews ---------- */
  async function loadScans() {
    const defs = [['intraday', 'Intraday', 'live quotes'], ['swing', 'Swing', 'daily'], ['long', 'Long term', 'trend screen']];
    const out = await Promise.all(defs.map(([t]) => api(`/api/scan/${t}`).catch(() => ({ rows: [] }))));
    $('#scanCards').innerHTML = defs.map(([t, n, pill], i) => {
      const rows = out[i].rows.slice(0, 4);
      return `<article class="card scan-card"><header class="card-head"><h3>${n}</h3><span class="pill">${pill}</span></header>
        <ul class="scan-list">${rows.length ? rows.map((r) => `<li><div><b><a href="charts.html?s=${encodeURIComponent(r.symbol)}">${esc(r.symbol)}</a></b><small>${esc(r.reasons[0])}</small></div><div class="r"><span>${nf(r.ltp)}</span><em class="${cls(r.pct)}">${pct(r.pct)}</em></div></li>`).join('') : '<li class="empty">No matches yet</li>'}</ul>
        <p style="margin-top:8px"><a class="help" href="scanners.html?t=${t}">See all →</a></p></article>`;
    }).join('');
  }
  loadScans(); setInterval(loadScans, 15000);

  /* ---------- paper summary ---------- */
  async function loadPaper() {
    try {
      const p = await api('/api/paper');
      const a = p.account;
      $('#paperStats').innerHTML = `<div><span class="muted">Equity</span><b>${App.inr(a.equity)}</b></div><div><span class="muted">Realized today</span><b class="${cls(a.realizedToday)}">${sinr(a.realizedToday)}</b></div><div><span class="muted">Open positions</span><b>${p.positions.length}</b></div>`;
      $('#paperPos').innerHTML = p.positions.length ? p.positions.slice(0, 5).map((x) => `<tr><td class="l"><a class="sym" href="charts.html?s=${encodeURIComponent(x.symbol)}">${esc(x.symbol)}</a></td><td class="l">${x.product === 'MIS' ? 'Intraday' : 'Delivery'}</td><td class="num">${x.qty}</td><td class="num">${nf(x.avg)}</td><td class="num">${nf(x.ltp)}</td><td class="num ${cls(x.pnl)}">${sinr(x.pnl)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">No open positions</td></tr>';
    } catch { /* ignore */ }
  }
  loadPaper(); setInterval(loadPaper, 4000);
  App.on('paper', loadPaper);
})();
