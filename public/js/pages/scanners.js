(function () {
  const { $, $$, esc, nf, pct, cls, labelCls, api } = App;
  let type = (new URLSearchParams(location.search).get('t') || 'intraday');
  if (!['intraday', 'swing', 'long'].includes(type)) type = 'intraday';
  let data = null;

  App.init({ active: 'scanners', symbols: [] });

  const HEAD = {
    intraday: ['Symbol', 'Sector', 'LTP', 'Change', 'Volume', 'Bias', 'Why it matched', ''],
    swing: ['Symbol', 'Sector', 'Close', 'Day', 'Bias', 'Why it matched', ''],
    long: ['Symbol', 'Sector', 'Close', '1-year', 'Rules met', 'Why it matched', ''],
  };

  function setTab() {
    $$('#typeTabs button').forEach((b) => { const on = b.dataset.t === type; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    $('#fBias').parentNode.hidden = type === 'long';
  }
  $('#typeTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.dataset.t === type) return;
    type = b.dataset.t; history.replaceState(null, '', `scanners.html?t=${type}`); data = null; setTab(); $('#tbody').innerHTML = '<tr><td class="empty">Loading…</td></tr>'; load();
  });
  ['fBias', 'fSector', 'fText'].forEach((id) => $(`#${id}`).addEventListener('input', render));

  function render() {
    if (!data) return;
    const bias = $('#fBias').value, sector = $('#fSector').value, text = $('#fText').value.trim().toUpperCase();
    const sectors = [...new Set(data.rows.map((r) => r.sector).filter(Boolean))].sort();
    const cur = $('#fSector').value;
    if ($('#fSector').options.length - 1 !== sectors.length) { $('#fSector').innerHTML = `<option value="">All</option>${sectors.map((s) => `<option>${esc(s)}</option>`).join('')}`; $('#fSector').value = cur; }
    const rows = data.rows.filter((r) => (!bias || r.bias === bias) && (!sector || r.sector === sector) && (!text || r.symbol.includes(text)));
    $('#thead').innerHTML = `<tr>${HEAD[type].map((h, i) => `<th class="${['Symbol', 'Sector', 'Bias', 'Why it matched'].includes(h) ? 'l' : 'num'}">${h}</th>`).join('')}</tr>`;
    const actions = (r) => `<td class="num"><a class="btn small" href="charts.html?s=${encodeURIComponent(r.symbol)}">Chart</a> <button type="button" class="btn small" data-watch="${esc(r.symbol)}">+ Watch</button> <a class="btn small" href="paper.html?symbol=${encodeURIComponent(r.symbol)}">Paper</a></td>`;
    const why = (r) => `<td class="l wrap"><div class="reasons">${r.reasons.map((x) => `<span class="reason">${esc(x)}</span>`).join('')}</div></td>`;
    const sym = (r) => `<td class="l"><a class="sym" href="charts.html?s=${encodeURIComponent(r.symbol)}">${esc(r.symbol)}</a></td><td class="l muted">${esc(r.sector || '')}</td>`;
    const tag = (b) => `<td class="l"><span class="tag ${labelCls(b)}">${esc(b)}</span></td>`;
    $('#tbody').innerHTML = rows.length ? rows.map((r) => {
      if (type === 'intraday') return `<tr>${sym(r)}<td class="num">${nf(r.ltp)}</td><td class="num ${cls(r.pct)}">${pct(r.pct)}</td><td class="num">${r.vol ? nf(r.vol, 0) : '–'}</td>${tag(r.bias)}${why(r)}${actions(r)}</tr>`;
      if (type === 'swing') return `<tr>${sym(r)}<td class="num">${nf(r.ltp)}</td><td class="num ${cls(r.pct)}">${pct(r.pct)}</td>${tag(r.bias)}${why(r)}${actions(r)}</tr>`;
      return `<tr>${sym(r)}<td class="num">${nf(r.ltp)}</td><td class="num ${cls(r.ret1y)}">${pct(r.ret1y)}</td><td class="num">${r.matches}/4</td>${why(r)}${actions(r)}</tr>`;
    }).join('') : `<tr><td colspan="8" class="empty">${data.asOf ? 'No stocks match right now.' : 'The first scan is still running.'}</td></tr>`;
    $('#asOf').textContent = data.asOf ? `Updated ${App.istTime(Math.floor(data.asOf / 1000))} IST · ${data.universe} stocks scanned` : '';
    $('#rules').innerHTML = data.rules.map((r) => `<li><span>${esc(r)}</span></li>`).join('');
    const p = data.progress;
    $('#progressBox').hidden = !(p && p.done < p.total);
    if (p) { $('#progressText').textContent = `Scanning daily candles: ${p.done} of ${p.total}`; $('#progressBar').style.width = `${(p.done / p.total) * 100}%`; }
    $('#foot').textContent = type === 'intraday'
      ? (data.live ? 'Built from live quotes (change, VWAP, day range, gap) and refreshed every few seconds.' : 'Market is closed, so this shows the last session\'s quotes.')
      : type === 'long' ? 'Technical trend screen only. Earnings, debt and other fundamentals are not available in this app.' : 'Built from daily candles and refreshed about every 30 minutes.';
  }

  async function load() {
    try { data = await api(`/api/scan/${type}`); render(); }
    catch (e) { $('#tbody').innerHTML = `<tr><td class="note err">${esc(e.message)}</td></tr>`; }
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-watch]'); if (!b) return;
    try {
      const w = await api('/api/watchlist');
      if (w.symbols.includes(b.dataset.watch)) return App.toast(`${b.dataset.watch} is already on your watchlist`);
      await api('/api/watchlist', { method: 'PUT', body: { symbols: [...w.symbols, b.dataset.watch] } });
      App.toast(`${b.dataset.watch} added to your watchlist`, 'ok');
    } catch (err) { App.toast(err.message, 'err'); }
  });

  setTab(); load();
  setInterval(load, 5000);
})();
