/* StockLens shared shell: top market bar, navigation, live quote socket, helpers. */
(function () {
  const IST = 19800;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (n, d = 2) => (n == null || !isFinite(n) ? '–' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pct = (n) => (n == null || !isFinite(n) ? '–' : `${n >= 0 ? '+' : ''}${nf(n)}%`);
  const signed = (n, d = 2) => (n == null || !isFinite(n) ? '–' : `${n >= 0 ? '+' : ''}${nf(n, d)}`);
  const inr = (n, d = 0) => (n == null || !isFinite(n) ? '–' : `${n < 0 ? '-' : ''}₹${nf(Math.abs(n), d)}`);
  const sinr = (n, d = 0) => (n == null || !isFinite(n) ? '–' : `${n >= 0 ? '+' : '-'}₹${nf(Math.abs(n), d)}`);
  const cls = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
  const labelCls = (l) => ({ Bullish: 'bullish', Bearish: 'bearish', Sideways: 'sideways', Mixed: 'sideways' }[l] || 'nodata');
  const istTime = (t, withDate) => {
    const d = new Date((t + IST) * 1000).toISOString();
    return withDate ? `${d.slice(8, 10)}-${d.slice(5, 7)} ${d.slice(11, 16)}` : d.slice(11, 16);
  };
  const istDate = (t) => new Date((t + IST) * 1000).toISOString().slice(0, 10);

  async function api(path, opts = {}) {
    const o = { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } };
    if (o.body && typeof o.body !== 'string') o.body = JSON.stringify(o.body);
    const r = await fetch(path, o);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }

  /* ---------- tiny event emitter ---------- */
  const handlers = {};
  const on = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); };
  const emit = (ev, ...a) => (handlers[ev] || []).forEach((fn) => { try { fn(...a); } catch (e) { console.error(e); } });

  const state = { quotes: {}, status: null, market: null, conn: false };
  const BASE = ['NIFTY', 'BANKNIFTY', 'SENSEX', 'INDIAVIX'];
  let pageSymbols = [];
  let ws = null, retry = 0;

  /* ---------- socket ---------- */
  function sendSubs() {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'sub', symbols: [...new Set([...BASE, ...pageSymbols])] }));
  }
  function watch(symbols) { pageSymbols = symbols.slice(0, 280); sendSubs(); }
  function connect() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/stream`);
    ws.onopen = () => { retry = 0; state.conn = true; sendSubs(); renderStatus(); };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'quotes') {
        Object.entries(m.data).forEach(([s, q]) => { const prev = state.quotes[s]; state.quotes[s] = q; emit('quote', q, prev); });
        emit('quotes', m.data);
      } else if (m.type === 'status') { state.status = m.data; renderStatus(); emit('status', m.data); }
      else if (m.type === 'market') { state.market = m.data; renderChips(); emit('market', m.data); }
      else if (m.type === 'paper') { emit('paper', m.event); paperToast(m.event); }
    };
    ws.onclose = () => { state.conn = false; renderStatus(); setTimeout(connect, Math.min(10000, 1000 * 2 ** retry++)); };
  }

  /* ---------- UI helpers ---------- */
  function toast(msg, kind = '') {
    let box = $('#toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = `toast ${kind}`; t.textContent = msg; box.appendChild(t);
    setTimeout(() => t.classList.add('out'), 3800); setTimeout(() => t.remove(), 4300);
  }
  function paperToast(ev) {
    if (ev.type === 'order' && ev.order.status === 'FILLED') toast(`${ev.order.side} ${ev.order.qty} ${ev.order.symbol} filled at ${nf(ev.order.fillPrice)}`, 'ok');
    if (ev.type === 'order' && ev.order.status === 'REJECTED') toast(`Order ${ev.order.id} rejected`, 'err');
    if (ev.type === 'trade') toast(`${ev.trade.symbol} closed: ${sinr(ev.trade.net, 2)}`, ev.trade.net >= 0 ? 'ok' : 'err');
  }
  function flash(el, dir) {
    if (!el || !dir) return;
    el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth;
    el.classList.add(dir > 0 ? 'flash-up' : 'flash-down');
  }
  // Set the text of a live number and flash it when it moves
  function setNum(el, value, text) {
    if (!el) return;
    const prev = el._v;
    el._v = value;
    if (el.textContent !== text) el.textContent = text;
    if (prev != null && value != null && value !== prev) flash(el, value > prev ? 1 : -1);
  }
  function tabs(root, onChange) {
    const btns = $$('[data-tab]', root), panels = $$('[data-panel]', root);
    const show = (name) => {
      btns.forEach((b) => { const on = b.dataset.tab === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
      panels.forEach((p) => { p.hidden = p.dataset.panel !== name; });
      if (onChange) onChange(name);
    };
    btns.forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
    show((btns.find((b) => b.classList.contains('on')) || btns[0]).dataset.tab);
    return show;
  }
  // Symbol search box with a dropdown of matches
  function symbolInput(input, onPick) {
    const box = document.createElement('div');
    box.className = 'suggest'; box.hidden = true;
    input.parentNode.style.position = 'relative';
    input.parentNode.appendChild(box);
    input.setAttribute('autocomplete', 'off');
    let timer, items = [], sel = -1;
    const close = () => { box.hidden = true; sel = -1; };
    const pick = (s) => { input.value = s; close(); onPick(s); };
    const draw = () => {
      box.innerHTML = items.map((x, i) => `<button type="button" class="${i === sel ? 'on' : ''}" data-s="${esc(x.symbol)}"><b>${esc(x.symbol)}</b><span>${esc(x.type === 'index' ? 'Index' : x.exch)}</span></button>`).join('');
      box.hidden = !items.length;
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => { try { items = await api(`/api/search?q=${encodeURIComponent(input.value.trim())}`); sel = -1; draw(); } catch { close(); } }, 160);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(sel >= 0 ? items[sel].symbol : input.value.trim().toUpperCase()); }
      else if (e.key === 'Escape') close();
    });
    box.addEventListener('mousedown', (e) => { const b = e.target.closest('button'); if (b) { e.preventDefault(); pick(b.dataset.s); } });
    input.addEventListener('blur', () => setTimeout(close, 120));
  }
  function spark(svg, values, up) {
    if (!svg || !values || values.length < 2) return;
    const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
    const pts = values.map((v, i) => `${((i / (values.length - 1)) * 120).toFixed(1)},${(36 - ((v - min) / span) * 32).toFixed(1)}`).join(' ');
    svg.setAttribute('class', `spark ${up ? 'up' : 'down'}`);
    svg.innerHTML = `<polyline points="${pts}"/>`;
  }

  /* ---------- shell: top bar + navigation ---------- */
  const IDX = [['NIFTY', 'NIFTY 50'], ['BANKNIFTY', 'BANK NIFTY'], ['SENSEX', 'SENSEX'], ['INDIAVIX', 'INDIA VIX']];
  const NAV = [
    ['index.html', 'Dashboard', 'dashboard'], ['market.html?s=NIFTY', 'Nifty 50', 'market:NIFTY'], ['market.html?s=BANKNIFTY', 'Bank Nifty', 'market:BANKNIFTY'],
    ['market.html?s=SENSEX', 'Sensex', 'market:SENSEX'], ['charts.html', 'Charts', 'charts'], ['analysis.html', 'Daily Analysis', 'analysis'],
    ['scanners.html', 'Scanners', 'scanners'], ['paper.html', 'Paper Trading', 'paper'], ['watchlist.html', 'Watchlist', 'watchlist'], ['journal.html', 'Journal', 'journal'],
  ];

  function renderShell(active) {
    const bar = $('#marketBar');
    bar.innerHTML = `
      <div class="bar-row">
        <a class="brand" href="index.html" aria-label="StockLens home">
          <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-6 4 3 8-9"/><path d="M15 5h5v5"/></svg></span>
          <span class="brand-name">Stock<strong>Lens</strong></span>
        </a>
        <ul class="indices">${IDX.map(([s, n]) => `<li class="index" data-sym="${s}"><a href="${s === 'INDIAVIX' ? 'market.html?s=INDIAVIX' : `market.html?s=${s}`}"><span class="index-name">${n}</span> <span class="index-val">–</span> <span class="index-chg">–</span></a></li>`).join('')}</ul>
        <div class="market-status" role="status"><span class="live-dot" id="liveDot" aria-hidden="true"></span><span id="mktText">Connecting…</span><time class="clock" id="clock"></time></div>
      </div>
      <div class="bar-row condition-row">
        <div class="overall"><span class="label">Market bias</span><strong class="bias nodata" id="biasText">Calculating…</strong></div>
        <ul class="chips" id="chips"></ul>
        <span class="changed" id="changed"></span>
      </div>
      <div class="sim-banner" id="simBanner" hidden>SIMULATED DATA: prices are random and for layout/testing only. Add your Angel One credentials in .env for live data.</div>`;
    $('#nav').innerHTML = `<ul>${NAV.map(([href, label, key]) => `<li><a href="${href}" class="${key === active ? 'active' : ''}">${label}</a></li>`).join('')}</ul><p class="sidebar-note">Paper trading only. No real orders are ever placed.</p>`;
    if ('ResizeObserver' in window) new ResizeObserver(() => document.documentElement.style.setProperty('--bar-h', `${bar.offsetHeight}px`)).observe(bar);
    $$('.index', bar).forEach((li) => { li._price = $('.index-val', li); li._chg = $('.index-chg', li); });
  }

  function renderStatus() {
    const st = state.status;
    const txt = $('#mktText'), dot = $('#liveDot');
    if (!txt) return;
    const open = st && st.marketOpen;
    txt.textContent = !state.conn ? 'Reconnecting…' : st && st.simulated ? 'Simulated' : open ? 'Market Live' : 'Market Closed';
    dot.className = `live-dot ${state.conn && (open || (st && st.simulated)) ? '' : 'off'}`;
    const sim = $('#simBanner'); if (sim) sim.hidden = !(st && st.simulated);
    if (st && st.error && !st.simulated) txt.textContent = `Feed issue`;
  }

  function renderIndex(q) {
    const li = $(`.index[data-sym="${q.symbol}"]`);
    if (!li) return;
    setNum(li._price, q.ltp, nf(q.ltp));
    li._chg.textContent = `${q.pct >= 0 ? '▲' : '▼'} ${nf(Math.abs(q.pct))}%`;
    li.classList.toggle('up', q.pct > 0); li.classList.toggle('down', q.pct < 0);
  }

  let labels = {};
  try { labels = JSON.parse(localStorage.getItem('sl.flips') || '{}'); } catch { /* ignore */ }
  function renderChips() {
    const m = state.market;
    if (!m) return;
    const chips = $('#chips');
    chips.innerHTML = m.timeframes.map((t) => `<li class="chip ${labelCls(t.label)}"><span class="dot"></span><span class="chip-tf">${esc(t.tf)}</span><b>${esc(t.label)}</b>${t.score != null ? `<span class="score">${t.score}</span>` : ''}</li>`).join('');
    const b = $('#biasText'); b.textContent = m.overall.text; b.className = `bias ${labelCls(m.overall.label)}`;
    // remember when a timeframe changed label today
    const today = istDate(Math.floor(Date.now() / 1000));
    if (labels.date !== today) labels = { date: today, last: {}, flip: null };
    m.timeframes.forEach((t) => {
      if (labels.last[t.tf] && labels.last[t.tf] !== t.label && t.label !== 'No data') labels.flip = { tf: t.tf, label: t.label, at: istTime(Math.floor(Date.now() / 1000)) };
      labels.last[t.tf] = t.label;
    });
    try { localStorage.setItem('sl.flips', JSON.stringify(labels)); } catch { /* ignore */ }
    $('#changed').textContent = labels.flip ? `${labels.flip.tf} flipped to ${labels.flip.label} at ${labels.flip.at}` : '';
  }

  function tickClock() {
    const c = $('#clock');
    if (c) c.textContent = `${new Date(Date.now() + IST * 1000).toISOString().slice(11, 19)} IST`;
  }

  async function init({ active, symbols = [] } = {}) {
    renderShell(active);
    on('quote', (q) => { if (BASE.includes(q.symbol)) renderIndex(q); });
    tickClock(); setInterval(tickClock, 1000);
    pageSymbols = symbols;
    connect();
    try { state.status = await api('/api/status'); renderStatus(); } catch { /* socket will retry */ }
    try {
      const q = await api(`/api/quotes?symbols=${BASE.join(',')}`);
      Object.values(q).forEach((x) => { state.quotes[x.symbol] = x; renderIndex(x); });
      state.market = await api('/api/market'); renderChips(); emit('market', state.market);
    } catch { /* the socket pushes the next update */ }
    setInterval(async () => { if (!state.conn) { try { state.market = await api('/api/market'); renderChips(); emit('market', state.market); } catch { /* ignore */ } } }, 30000);
  }

  window.App = { $, $$, esc, nf, pct, signed, inr, sinr, cls, labelCls, istTime, istDate, api, on, emit, state, watch, toast, flash, setNum, tabs, symbolInput, spark, init };
})();
