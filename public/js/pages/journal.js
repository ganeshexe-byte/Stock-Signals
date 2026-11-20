(function () {
  const { $, $$, esc, nf, pct, inr, sinr, cls, labelCls, api } = App;
  const EMOTIONS = ['', 'Calm', 'Confident', 'Anxious', 'FOMO', 'Revenge', 'Bored'];
  let chart = null, series = null;

  App.init({ active: 'journal', symbols: [] });

  function drawStats(s) {
    const items = [
      ['Trades', s.count, ''], ['Win rate', s.count ? `${nf(s.winRate, 0)}%` : '–', ''], ['Net P&L', sinr(s.totalNet, 2), cls(s.totalNet)],
      ['Avg win / loss', s.count ? `${inr(s.avgWin)} / ${inr(s.avgLoss)}` : '–', ''], ['Profit factor', s.profitFactor == null ? '∞' : s.count ? nf(s.profitFactor) : '–', ''], ['Expectancy / trade', s.count ? sinr(s.expectancy, 2) : '–', cls(s.expectancy)],
    ];
    $('#stats').innerHTML = items.map(([k, v, c]) => `<div class="stat"><span>${k}</span><b class="${c}">${v}</b></div>`).join('');
  }
  function breakdown(rows, tagged) {
    if (!rows.length) return '<p class="empty">No trades yet</p>';
    return `<div class="table-wrap"><table class="table"><thead><tr><th class="l">${tagged ? 'Condition' : 'Group'}</th><th class="num">Trades</th><th class="num">Win rate</th><th class="num">Net</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="l">${tagged ? `<span class="tag ${labelCls(r.name)}">${esc(r.name)}</span>` : esc(r.name)}</td><td class="num">${r.n}</td><td class="num">${nf(r.winRate, 0)}%</td><td class="num ${cls(r.net)}">${sinr(r.net, 2)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function drawCurve(points) {
    $('#curveEmpty').hidden = points.length >= 2;
    $('#curve').hidden = points.length < 2;
    if (points.length < 2) return;
    if (!chart) {
      chart = LightweightCharts.createChart($('#curve'), { height: 260, layout: { background: { type: 'solid', color: '#111821' }, textColor: '#8796a8', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11 }, grid: { vertLines: { color: '#1a2430' }, horzLines: { color: '#1a2430' } }, rightPriceScale: { borderColor: '#1f2b38' }, timeScale: { borderColor: '#1f2b38', timeVisible: true } });
      series = chart.addAreaSeries({ lineColor: '#4f8cff', topColor: 'rgba(79,140,255,.35)', bottomColor: 'rgba(79,140,255,0)', lineWidth: 2 });
      new ResizeObserver(() => chart.applyOptions({ width: $('#curve').clientWidth })).observe($('#curve'));
    }
    let last = 0;
    series.setData(points.map((p) => { const t = Math.max(p.t + 19800, last + 1); last = t; return { time: t, value: Math.round(p.v * 100) / 100 }; }));
    chart.timeScale().fitContent();
  }

  const stars = (n) => `<span class="stars" role="group" aria-label="Rating">${[1, 2, 3, 4, 5].map((i) => `<button type="button" data-star="${i}" class="${i <= n ? 'on' : ''}" aria-label="${i} star${i > 1 ? 's' : ''}">★</button>`).join('')}</span>`;
  function drawEntries(list) {
    $('#count').textContent = `${list.length} total`;
    $('#entries').innerHTML = list.length ? list.map((e) => `<article class="card entry" data-id="${esc(e.id)}">
      <div class="entry-head"><div><a class="sym mono" style="font-weight:600;color:var(--text)" href="charts.html?s=${encodeURIComponent(e.symbol)}">${esc(e.symbol)}</a> <span class="tag ${e.side === 'LONG' ? 'bullish' : 'bearish'}">${e.side}</span> <span class="muted">${e.qty} @ ${nf(e.entry)} → ${nf(e.exit)}${e.product ? ` · ${e.product === 'MIS' ? 'Intraday' : 'Delivery'}` : ''}${e.manual ? ' · manual' : ''}</span></div>
        <div class="mono"><b class="${cls(e.net)}">${sinr(e.net, 2)}</b> <span class="muted">${App.istTime(e.exitTs, true)}</span></div></div>
      ${e.condition ? `<div class="row help">Market at entry: <span class="tag ${labelCls(e.condition.overall)}">${esc(e.condition.overall)}</span> intraday ${esc(e.condition.intraday)} · short ${esc(e.condition.short)} · medium ${esc(e.condition.medium)}</div>` : ''}
      <div class="form-grid">
        <label>Setup tag<input data-f="tag" type="text" maxlength="40" value="${esc(e.tag)}" /></label>
        <label>How did you feel?<select data-f="emotion">${EMOTIONS.map((x) => `<option ${x === e.emotion ? 'selected' : ''} value="${x}">${x || '–'}</option>`).join('')}</select></label>
      </div>
      <label class="help">Notes: what was the plan, and did you follow it?<textarea class="input" data-f="notes" rows="2" maxlength="2000">${esc(e.notes)}</textarea></label>
      <div class="row" style="justify-content:space-between"><div class="row"><span class="help">Execution quality</span>${stars(e.rating)}</div><button type="button" class="btn small danger" data-del="${esc(e.id)}">Delete</button></div>
    </article>`).join('') : '<p class="empty">No entries yet. Close a paper trade and it appears here automatically.</p>';
  }

  function apply(r) {
    drawStats(r.stats);
    $('#byCond').innerHTML = breakdown(r.stats.byCondition, true);
    $('#byTag').innerHTML = breakdown(r.stats.byTag);
    $('#bySide').innerHTML = breakdown(r.stats.bySide);
    drawCurve(r.stats.curve);
    drawEntries(r.entries);
  }
  async function load() { try { apply(await api('/api/journal')); } catch (e) { $('#entries').innerHTML = `<p class="note err">${esc(e.message)}</p>`; } }

  async function patch(id, body) {
    try { const r = await api(`/api/journal/${encodeURIComponent(id)}`, { method: 'PATCH', body }); drawStats(r.stats); $('#byTag').innerHTML = breakdown(r.stats.byTag); }
    catch (e) { App.toast(e.message, 'err'); }
  }
  const entries = $('#entries');
  entries.addEventListener('change', (e) => { const f = e.target.dataset.f; if (f) patch(e.target.closest('[data-id]').dataset.id, { [f]: e.target.value }); });
  entries.addEventListener('click', async (e) => {
    const card = e.target.closest('[data-id]'); if (!card) return;
    const star = e.target.closest('[data-star]'), del = e.target.closest('[data-del]');
    if (star) {
      const n = Number(star.dataset.star), cur = $$('.stars button.on', card).length;
      const next = n === cur ? 0 : n;
      $$('.stars button', card).forEach((b, i) => b.classList.toggle('on', i < next));
      patch(card.dataset.id, { rating: next });
    }
    if (del && confirm('Delete this journal entry? The trade stays in your paper account history.')) {
      try { apply(await api(`/api/journal/${encodeURIComponent(del.dataset.del)}`, { method: 'DELETE' })); } catch (ex) { App.toast(ex.message, 'err'); }
    }
  });
  $('#manual').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    try { apply(await api('/api/journal', { method: 'POST', body })); e.target.reset(); App.toast('Entry added', 'ok'); }
    catch (ex) { App.toast(ex.message, 'err'); }
  });
  App.on('paper', (ev) => { if (ev.type === 'trade') load(); });
  load();
})();
