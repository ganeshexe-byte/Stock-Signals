(function () {
  const { $, $$, esc, nf, pct, cls, api } = App;
  let sym = (new URLSearchParams(location.search).get('s') || 'NIFTY').toUpperCase();

  const EXAMPLES = {
    'EMA 9/21 crossover signals': `const close = candles.map(c => c.c);
const fast = ta.ema(close, 9), slow = ta.ema(close, 21);
const markers = [];
for (let i = 1; i < candles.length; i++) {
  if (fast[i] == null || slow[i] == null || fast[i-1] == null || slow[i-1] == null) continue;
  if (fast[i-1] <= slow[i-1] && fast[i] > slow[i]) markers.push({ index: i, position: 'below', text: 'Up', color: '#22c55e' });
  if (fast[i-1] >= slow[i-1] && fast[i] < slow[i]) markers.push({ index: i, position: 'above', text: 'Down', color: '#ef4444' });
}
return {
  name: 'EMA 9/21 cross', pane: 'overlay',
  lines: [{ name: 'Fast', color: '#4f8cff', values: fast }, { name: 'Slow', color: '#f5a524', values: slow }],
  markers
};`,
    'Momentum: rate of change (separate pane)': `const close = candles.map(c => c.c);
const n = 10;
const roc = close.map((c, i) => i < n ? null : (c - close[i - n]) / close[i - n] * 100);
return { name: 'ROC 10 (%)', pane: 'separate', type: 'hist', values: roc };`,
    'Donchian channel 20 (overlay)': `const n = 20;
const upper = candles.map((_, i) => i < n ? null : Math.max(...candles.slice(i - n, i).map(c => c.h)));
const lower = candles.map((_, i) => i < n ? null : Math.min(...candles.slice(i - n, i).map(c => c.l)));
return {
  name: 'Donchian 20', pane: 'overlay',
  lines: [
    { name: 'Upper', color: '#22c55e', values: upper, style: 'dashed' },
    { name: 'Lower', color: '#ef4444', values: lower, style: 'dashed' }
  ]
};`,
  };

  $('#symInput').value = sym;
  App.init({ active: 'charts', symbols: [sym] });

  let overlays = ['ema9', 'ema21', 'vwap', 'volume'];
  let custom = StockChart.store.list();
  const chart = new StockChart($('#chart'), {
    symbol: sym, interval: '15m', overlays, height: 540,
    onError: (errs) => { const el = $('#chartErr'); el.hidden = !errs.length; el.textContent = errs.join(' | '); },
  });
  chart.setCustom(custom);

  /* ---------- symbol + live header ---------- */
  let periods = null;
  function setSymbol(s) {
    s = (s || '').toUpperCase().trim();
    if (!s) return;
    sym = s;
    history.replaceState(null, '', `charts.html?s=${encodeURIComponent(sym)}`);
    $('#symInput').value = sym;
    App.watch([sym]);
    $('#buyBtn').href = `paper.html?symbol=${encodeURIComponent(sym)}&side=BUY`;
    $('#sellBtn').href = `paper.html?symbol=${encodeURIComponent(sym)}&side=SELL`;
    $('#qPrice').textContent = '–'; $('#qChg').textContent = '';
    chart.setSymbol(sym);
    if (periods) periods.setSymbol(sym);
    api(`/api/quotes?symbols=${encodeURIComponent(sym)}`).then((r) => { if (r[sym]) { App.state.quotes[sym] = r[sym]; renderQuote(r[sym]); } }).catch(() => {});
  }
  function renderQuote(q) {
    App.setNum($('#qPrice'), q.ltp, nf(q.ltp));
    const c = $('#qChg'); c.className = `mono ${cls(q.change)}`;
    c.textContent = `${q.change >= 0 ? '▲' : '▼'} ${nf(Math.abs(q.change))} (${pct(q.pct)})`;
  }
  App.on('quote', (q) => { if (q.symbol === sym) renderQuote(q); });
  App.symbolInput($('#symInput'), setSymbol);
  setSymbol(sym);
  periods = Periods.mount($('#periods'), sym);

  $('#watchBtn').addEventListener('click', async () => {
    try {
      const w = await api('/api/watchlist');
      if (w.symbols.includes(sym)) return App.toast(`${sym} is already on your watchlist`);
      await api('/api/watchlist', { method: 'PUT', body: { symbols: [...w.symbols, sym] } });
      App.toast(`${sym} added to your watchlist`, 'ok');
    } catch (e) { App.toast(e.message, 'err'); }
  });

  /* ---------- timeframe + overlays ---------- */
  $('#tfSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#tfSeg button').forEach((x) => x.classList.toggle('on', x === b));
    chart.setInterval(b.dataset.iv);
  });
  $('#overlayChips').innerHTML = StockChart.BUILTIN.map((b) => `<label class="chip-btn ${overlays.includes(b.key) ? 'on' : ''}"><input type="checkbox" value="${b.key}" ${overlays.includes(b.key) ? 'checked' : ''}><i style="background:${b.color}"></i>${esc(b.label)}</label>`).join('');
  $('#overlayChips').addEventListener('change', () => {
    overlays = $$('#overlayChips input:checked').map((i) => i.value);
    $$('#overlayChips .chip-btn').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
    chart.setOverlays(overlays);
  });

  /* ---------- custom indicators ---------- */
  let editing = null;
  const persist = () => { StockChart.store.save(custom); chart.setCustom(custom); drawCustom(); };
  function drawCustom() {
    $('#customChips').innerHTML = custom.length
      ? `<span class="help">My indicators:</span>${custom.map((c) => `<label class="chip-btn ${c.on ? 'on' : ''}"><input type="checkbox" data-id="${esc(c.id)}" ${c.on ? 'checked' : ''}>${esc(c.name)}</label>`).join('')}`
      : '<span class="help">No custom indicators yet. Write one below.</span>';
    $('#savedList').innerHTML = custom.length
      ? custom.map((c) => `<li><span>${esc(c.name)}</span><b><button type="button" class="btn small" data-edit="${esc(c.id)}">Edit</button></b></li>`).join('')
      : '<li><span>Nothing saved yet</span><b></b></li>';
    $('#cDelete').hidden = !editing;
  }
  $('#customChips').addEventListener('change', (e) => { const c = custom.find((x) => x.id === e.target.dataset.id); if (c) { c.on = e.target.checked; persist(); } });
  $('#savedList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-edit]'); if (!b) return;
    const c = custom.find((x) => x.id === b.dataset.edit); if (!c) return;
    editing = c.id; $('#cName').value = c.name; $('#cCode').value = c.code; $('#cErr').hidden = true; drawCustom();
    $('#editorCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  Object.keys(EXAMPLES).forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = k; $('#cExample').appendChild(o); });
  $('#cExample').addEventListener('change', (e) => {
    if (!e.target.value) return;
    // An example is a fresh indicator: never overwrite the one currently being edited
    editing = null;
    $('#cCode').value = EXAMPLES[e.target.value];
    $('#cName').value = e.target.value.split(':')[0];
    $('#cErr').hidden = true;
    e.target.value = '';
    drawCustom();
  });
  $('#cNew').addEventListener('click', () => { editing = null; $('#cName').value = ''; $('#cCode').value = ''; $('#cErr').hidden = true; drawCustom(); });
  $('#cDelete').addEventListener('click', () => {
    if (!editing || !confirm('Delete this indicator?')) return;
    custom = custom.filter((c) => c.id !== editing); editing = null; $('#cName').value = ''; $('#cCode').value = ''; persist();
  });
  $('#cCode').addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); const t = e.target, s = t.selectionStart; t.value = `${t.value.slice(0, s)}  ${t.value.slice(t.selectionEnd)}`; t.selectionStart = t.selectionEnd = s + 2; }
  });
  $('#editor').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#cName').value.trim(), code = $('#cCode').value;
    const err = $('#cErr');
    // Test-run against the loaded candles first so mistakes are reported here, not silently dropped
    try {
      if (!chart.candles.length) throw new Error('Wait for the chart to load, then save again.');
      StockChart.runCustom(code, chart.candles.slice());
      err.hidden = true;
    } catch (ex) { err.hidden = false; err.textContent = ex.message; return; }
    const existing = custom.find((c) => c.id === editing);
    if (existing) { existing.name = name; existing.code = code; existing.on = true; }
    else { const c = { id: `c${Date.now().toString(36)}`, name, code, on: true }; custom.push(c); editing = c.id; }
    persist();
    App.toast(`"${name}" saved`, 'ok');
  });
  drawCustom();
})();
