(function () {
  const { $, esc, nf, pct, cls, api } = App;
  let symbols = [];

  App.init({ active: 'watchlist', symbols: [] });

  const order = () => {
    const mode = $('#sortSel').value;
    const q = (s) => App.state.quotes[s];
    const list = symbols.slice();
    if (mode === 'pctDesc') list.sort((a, b) => ((q(b) || {}).pct ?? -99) - ((q(a) || {}).pct ?? -99));
    if (mode === 'pctAsc') list.sort((a, b) => ((q(a) || {}).pct ?? 99) - ((q(b) || {}).pct ?? 99));
    if (mode === 'symbol') list.sort();
    return list;
  };

  function rangeCell(q) {
    if (!q || !(q.high > q.low)) return '<span class="muted">–</span>';
    const p = Math.min(100, Math.max(0, ((q.ltp - q.low) / (q.high - q.low)) * 100));
    return `<div class="range"><div class="bar-track"><i style="left:${p}%"></i></div><div class="ends"><span>${nf(q.low)}</span><span>${nf(q.high)}</span></div></div>`;
  }
  function draw() {
    const list = order();
    $('#rows').innerHTML = list.length ? list.map((s) => {
      const q = App.state.quotes[s];
      const e = encodeURIComponent(s);
      return `<tr data-s="${esc(s)}"><td class="l"><a class="sym" href="charts.html?s=${e}">${esc(s)}</a></td>
        <td class="num" data-c="ltp">${q ? nf(q.ltp) : '–'}</td><td class="num ${q ? cls(q.change) : ''}" data-c="chg">${q ? nf(q.change) : '–'}</td><td class="num ${q ? cls(q.pct) : ''}" data-c="pct">${q ? pct(q.pct) : '–'}</td>
        <td class="l" data-c="range">${rangeCell(q)}</td><td class="num" data-c="vol">${q && q.vol ? nf(q.vol, 0) : '–'}</td>
        <td class="num"><a class="btn small buy" href="paper.html?symbol=${e}&side=BUY">Buy</a> <a class="btn small sell" href="paper.html?symbol=${e}&side=SELL">Sell</a> <a class="btn small" href="charts.html?s=${e}">Chart</a> <button type="button" class="btn small danger" data-rm="${esc(s)}" aria-label="Remove ${esc(s)}">✕</button></td></tr>`;
    }).join('') : '<tr><td colspan="7" class="empty">Your watchlist is empty. Add a symbol above.</td></tr>';
  }

  // Update cells in place so the flash effect shows and the table does not jump
  App.on('quote', (q) => {
    const tr = $(`tr[data-s="${CSS.escape(q.symbol)}"]`);
    if (!tr) return;
    const set = (c, v, text, klass) => { const el = $(`[data-c="${c}"]`, tr); if (!el) return; if (klass !== undefined) el.className = `num ${klass}`; App.setNum(el, v, text); };
    set('ltp', q.ltp, nf(q.ltp)); set('chg', q.change, nf(q.change), cls(q.change)); set('pct', q.pct, pct(q.pct), cls(q.pct));
    $('[data-c="range"]', tr).innerHTML = rangeCell(q);
    $('[data-c="vol"]', tr).textContent = q.vol ? nf(q.vol, 0) : '–';
  });

  async function save() {
    const r = await api('/api/watchlist', { method: 'PUT', body: { symbols } });
    symbols = r.symbols; App.watch(symbols); draw();
  }
  async function load() {
    try {
      symbols = (await api('/api/watchlist')).symbols;
      App.watch(symbols);
      const q = await api(`/api/quotes?symbols=${encodeURIComponent(symbols.join(','))}`);
      Object.assign(App.state.quotes, q);
      draw();
    } catch (e) { $('#rows').innerHTML = `<tr><td colspan="7" class="note err">${esc(e.message)}</td></tr>`; }
  }

  App.symbolInput($('#addInput'), async (s) => {
    s = (s || '').toUpperCase().trim(); if (!s) return;
    $('#addInput').value = '';
    if (symbols.includes(s)) return App.toast(`${s} is already on your list`);
    try {
      const q = await api(`/api/quotes?symbols=${encodeURIComponent(s)}`);
      if (!q[s]) return App.toast(`Could not find a live price for ${s}. Check the symbol.`, 'err');
      Object.assign(App.state.quotes, q);
      symbols.push(s); await save();
    } catch (e) { App.toast(e.message, 'err'); }
  });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rm]'); if (!b) return;
    symbols = symbols.filter((s) => s !== b.dataset.rm);
    try { await save(); } catch (err) { App.toast(err.message, 'err'); }
  });
  $('#sortSel').addEventListener('change', draw);
  load();
})();
