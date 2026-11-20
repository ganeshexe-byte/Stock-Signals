(function () {
  const { $, $$, esc, nf, pct, signed, cls, labelCls, api } = App;
  const INDICES = [['NIFTY', 'Nifty 50'], ['BANKNIFTY', 'Bank Nifty'], ['SENSEX', 'Sensex'], ['INDIAVIX', 'India VIX']];
  let sym = (new URLSearchParams(location.search).get('s') || 'NIFTY').toUpperCase();
  if (!INDICES.some(([s]) => s === sym)) sym = 'NIFTY';
  const name = INDICES.find(([s]) => s === sym)[1];
  document.title = `${name} analysis – StockLens`;

  $('#indexTabs').innerHTML = INDICES.map(([s, n]) => `<button type="button" role="tab" aria-selected="${s === sym}" data-s="${s}">${n}</button>`).join('');
  $('#indexTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && b.dataset.s !== sym) location.href = `market.html?s=${b.dataset.s}`; });

  App.init({ active: `market:${sym}`, symbols: [sym] });
  App.tabs($('#phaseTabs'));

  /* ---------- chart + toggles ---------- */
  let overlays = ['ema9', 'ema21', 'vwap', 'volume'];
  let custom = StockChart.store.list();
  const chart = new StockChart($('#chart'), {
    symbol: sym, interval: '15m', overlays, height: 420,
    onError: (errs) => { const el = $('#chartErr'); el.hidden = !errs.length; el.textContent = errs.join(' | '); },
  });
  chart.setCustom(custom);

  $('#tfSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#tfSeg button').forEach((x) => x.classList.toggle('on', x === b));
    chart.setInterval(b.dataset.iv);
  });
  $('#overlayChips').innerHTML = StockChart.BUILTIN.map((b) => `<label class="chip-btn ${overlays.includes(b.key) ? 'on' : ''}"><input type="checkbox" value="${b.key}" ${overlays.includes(b.key) ? 'checked' : ''}><i style="background:${b.color}"></i>${esc(b.label)}</label>`).join('');
  $('#overlayChips').addEventListener('change', (e) => {
    overlays = $$('#overlayChips input:checked').map((i) => i.value);
    $$('#overlayChips .chip-btn').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
    chart.setOverlays(overlays);
  });
  function drawCustomChips() {
    $('#customChips').innerHTML = custom.length
      ? `<span class="help">My indicators:</span>${custom.map((c) => `<label class="chip-btn ${c.on ? 'on' : ''}"><input type="checkbox" data-id="${esc(c.id)}" ${c.on ? 'checked' : ''}>${esc(c.name)}</label>`).join('')}<a class="help" href="charts.html?s=${sym}">Edit →</a>`
      : `<span class="help">Add your own indicators on the <a href="charts.html?s=${sym}">Charts page</a>; they show up here too.</span>`;
  }
  drawCustomChips();
  $('#customChips').addEventListener('change', (e) => {
    const c = custom.find((x) => x.id === e.target.dataset.id);
    if (c) { c.on = e.target.checked; StockChart.store.save(custom); chart.setCustom(custom); drawCustomChips(); }
  });

  /* ---------- live header ---------- */
  function renderQuote(q) {
    if (!q) return;
    App.setNum($('#price'), q.ltp, nf(q.ltp));
    const c = $('#change'); c.className = `mono ${cls(q.change)}`;
    c.textContent = `${q.change >= 0 ? '▲' : '▼'} ${nf(Math.abs(q.change))} (${pct(q.pct)})`;
    $('#dayRange').innerHTML = q.high > q.low ? Panels.rangeBar(q.low, q.high, q.ltp) : '<span class="help">–</span>';
    $('#sOpen').textContent = nf(q.open); $('#sClose').textContent = nf(q.close);
  }
  App.on('quote', (q) => { if (q.symbol === sym) renderQuote(q); });

  /* ---------- analysis (refreshed every 20s) ---------- */
  let membersWatched = false;
  async function loadAnalysis() {
    try {
      const a = await api(`/api/index/${sym}`);
      $('#title').textContent = a.name;
      renderQuote(a.quote || App.state.quotes[sym]);
      $('#conds').innerHTML = a.conditions.map(Panels.condCard).join('');
      $('#overallText').innerHTML = `· overall <span class="tag ${labelCls(a.overall.label)}">${esc(a.overall.text)}</span>`;
      $('#levels').innerHTML = Panels.levels(a);
      $('#indicators').innerHTML = Panels.indicators(a);
      if (a.levels) $('#yearRange').innerHTML = Panels.rangeBar(a.levels.low52, a.levels.high52, a.quote ? a.quote.ltp : a.levels.prevDay.c);
      $('#phasePre').innerHTML = Panels.phase(a, 'pre'); $('#phaseLive').innerHTML = Panels.phase(a, 'live'); $('#phasePost').innerHTML = Panels.phase(a, 'post');
      $('#moversCard').hidden = !a.members.length;
      if (a.members.length) {
        $('#movers').innerHTML = Panels.movers(a);
        if (!membersWatched) { membersWatched = true; App.watch([sym, ...a.members]); }
      }
      $('#asOf').textContent = `Analysis updated ${App.istTime(Math.floor(a.asOf / 1000))} IST`;
      if (a.errors.length) { const el = $('#chartErr'); el.hidden = false; el.textContent = `Data issue: ${a.errors.join(' | ')}`; }
    } catch (e) {
      $('#conds').innerHTML = `<p class="note err">Could not load analysis: ${esc(e.message)}</p>`;
    }
  }
  loadAnalysis();
  setInterval(loadAnalysis, 20000);

  /* ---------- option chain (indices that have options) ---------- */
  const hasOptions = sym !== 'INDIAVIX';
  $('#optionsCard').hidden = !hasOptions;
  async function loadOptions() {
    if (!hasOptions) return;
    try { $('#options').innerHTML = Panels.optionChain(await api(`/api/optionchain/${sym}`)); }
    catch (e) { $('#options').innerHTML = `<p class="note err">${esc(e.message)}</p>`; }
  }
  loadOptions();
  setInterval(loadOptions, 6000);
})();
