/* Past reviews, outlook and data tables for any symbol (index or stock).
   Usage: const p = Periods.mount(element, 'NIFTY'); p.setSymbol('TCS');
   Works when the market is closed: everything comes from daily candles. */
(function () {
  const { $, $$, esc, nf, pct, cls, labelCls, api } = App;

  const fmtDate = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const fmtMonth = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const span = (a, b) => (a === b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`);

  // India VIX measures fear, so "Bullish" would mislead: show Rising / Falling / Flat in a neutral colour
  const VIXW = { Bullish: 'Rising', Bearish: 'Falling', Sideways: 'Flat' };
  const word = (l, vix) => (vix ? VIXW[l] || l : l);
  const tagCls = (l, vix) => (vix ? 'nodata' : labelCls(l));

  function rangeBar(lo, hi, px) {
    const p = hi > lo ? Math.min(100, Math.max(0, ((px - lo) / (hi - lo)) * 100)) : 50;
    return `<div class="range"><div class="bar-track"><i style="left:${p}%"></i></div><div class="ends"><span>Low ${nf(lo)}</span><span>High ${nf(hi)}</span></div></div>`;
  }

  /* ---------- reviews ---------- */
  function reviewCard(r) {
    if (!r) return '';
    return `<article class="mini">
      <div class="mini-head"><div><div class="tf">${esc(r.title)}</div><div class="help">${esc(span(r.from, r.to))}${r.partial ? ' · still in progress' : ''}</div></div><div class="mini-chg ${cls(r.chgPct)}">${pct(r.chgPct)}</div></div>
      ${rangeBar(r.l, r.h, r.c)}
      <p class="help" style="margin:4px 0 8px">Closed ${r.closePos >= 0.67 ? 'near the high' : r.closePos <= 0.33 ? 'near the low' : 'mid-range'}</p>
      <ul class="kv">
        <li><span>Open</span><b>${nf(r.o)}</b></li><li><span>High</span><b>${nf(r.h)}</b></li><li><span>Low</span><b>${nf(r.l)}</b></li><li><span>Close</span><b>${nf(r.c)}</b></li>
        <li><span>Change</span><b class="${cls(r.chg)}">${r.chg >= 0 ? '+' : ''}${nf(r.chg)}</b></li>
        <li><span>Range</span><b>${nf(r.range)} (${nf(r.rangePct)}%)</b></li>
        ${r.v ? `<li><span>Volume</span><b>${nf(r.v, 0)}</b></li>` : ''}
        ${r.days > 1 ? `<li><span>Trading days</span><b>${r.days}</b></li>` : ''}
      </ul>
      ${r.pattern ? `<p class="help">${esc(r.pattern)}</p>` : ''}
    </article>`;
  }

  function reviewsPanel(p) {
    const done = [p.reviews.day, p.reviews.week, p.reviews.month];
    const cur = [p.current.day, p.current.week, p.current.month].filter(Boolean);
    return `<div class="grid-3">${done.map(reviewCard).join('')}</div>
      ${cur.length ? `<h4 class="sub-title">In progress right now</h4><div class="grid-3">${cur.map(reviewCard).join('')}</div>` : ''}`;
  }

  /* ---------- outlook ---------- */
  function outlookCard(o, price, vix) {
    if (!o) return '';
    const P = o.pivots;
    const ladder = [['R3', P.r3], ['R2', P.r2], ['R1', P.r1], ['Pivot', P.pp], ['S1', P.s1], ['S2', P.s2], ['S3', P.s3]];
    const checks = o.bias.checks.map((k) => `<li><span class="dot ${k.signal === null ? '' : k.signal > 0 ? 'p' : k.signal < 0 ? 'n' : 'z'}" aria-hidden="true"></span><span>${esc(k.name)}<small>${esc(k.detail)}</small></span></li>`).join('');
    return `<article class="mini">
      <div class="mini-head"><div><div class="tf">${esc(o.label)}</div><div class="help">${o.kind === 'month' ? 'from ' + esc(fmtMonth(o.from)) : 'from ' + esc(fmtDate(o.from))} · built from ${esc(span(o.basis.from, o.basis.to))}</div></div>
        <span class="tag ${tagCls(o.bias.label, vix)}">${esc(word(o.bias.label, vix))} <span class="mono">${o.bias.score}</span></span></div>
      ${o.typical ? `<p class="help">Typical range (1 ATR, about ${nf(o.typical.atrPct)}% of price): <b class="mono">${nf(o.typical.low)} – ${nf(o.typical.high)}</b></p>` : ''}
      <ul class="kv">
        ${ladder.map(([n, v]) => `<li><span>${n}</span><b class="${n !== 'Pivot' && price != null ? (v > price ? 'down' : 'up') : ''}">${nf(v)}</b></li>`).join('')}
        <li><span>Central pivot range</span><b>${nf(P.bc)} – ${nf(P.tc)}</b></li>
      </ul>
      <ul class="scen">${o.scenarios.map((s) => `<li><span class="tag ${tagCls(s.case, vix)}">${esc(word(s.case, vix))}</span><span>${esc(vix ? s.text.replace(/bias up/g, 'VIX trending up').replace(/bias down/g, 'VIX trending down') : s.text)}</span></li>`).join('')}</ul>
      <details class="why"><summary>Why ${esc(word(o.bias.label, vix).toLowerCase())}?</summary><ul class="checks">${checks}</ul></details>
    </article>`;
  }

  function outlookPanel(p) {
    const vix = p.symbol === 'INDIAVIX';
    const sw = p.swing;
    const lv = (a) => (a.length ? a.map((x) => `${nf(x.level, 0)}${x.touches > 1 ? ` <span class="muted">×${x.touches}</span>` : ''}`).join(' · ') : '–');
    return `<div class="grid-3">${['day', 'week', 'month'].map((k) => outlookCard(p.outlook[k], p.price, vix)).join('')}</div>
      <ul class="kv" style="margin-top:12px"><li><span>Nearest resistance (recent swing highs)</span><b>${lv(sw.resistance)}</b></li><li><span>Nearest support (recent swing lows)</span><b>${lv(sw.support)}</b></li></ul>
      <p class="help">${vix ? 'For India VIX, Rising means volatility (fear) has been climbing; it is not a Bullish or Bearish call on the market. ' : ''}${esc(p.disclaimer)} Exchange holidays are not known, so a "next session" may fall on a holiday.</p>`;
  }

  /* ---------- data tables ---------- */
  const TABLES = [['daily', 'Daily (60)'], ['weekly', 'Weekly (52)'], ['monthly', 'Monthly (24)']];

  function tablePanel(p, kind) {
    const rows = p.tables[kind].slice().reverse();
    const label = (r) => (kind === 'daily' ? fmtDate(r.from) : kind === 'monthly' ? fmtMonth(r.from) : span(r.from, r.to));
    return `<div class="row" style="justify-content:space-between;margin:10px 0">
        <div class="seg" role="group" aria-label="Table">${TABLES.map(([k, n]) => `<button type="button" data-tbl="${k}" class="${k === kind ? 'on' : ''}">${n}</button>`).join('')}</div>
        <button type="button" class="btn small" data-csv="${kind}">Download CSV</button>
      </div>
      <div class="table-wrap data-table"><table class="table"><thead><tr><th class="l">${kind === 'daily' ? 'Date' : kind === 'weekly' ? 'Week' : 'Month'}</th><th class="num">Open</th><th class="num">High</th><th class="num">Low</th><th class="num">Close</th><th class="num">Change</th><th class="num">Change %</th><th class="num">Volume</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td class="l">${esc(label(r))}${r.partial ? ' <span class="muted small">so far</span>' : ''}</td><td class="num">${nf(r.o)}</td><td class="num">${nf(r.h)}</td><td class="num">${nf(r.l)}</td><td class="num">${nf(r.c)}</td><td class="num ${cls(r.chg)}">${r.chg >= 0 ? '+' : ''}${nf(r.chg)}</td><td class="num ${cls(r.chgPct)}">${pct(r.chgPct)}</td><td class="num">${r.v ? nf(r.v, 0) : '–'}</td></tr>`).join('')}</tbody></table></div>
      <p class="help">Newest first. Indices have no traded volume. Source: daily candles from the data feed.</p>`;
  }

  function downloadCsv(p, kind) {
    const head = 'from,to,open,high,low,close,change,change_pct,volume';
    const lines = p.tables[kind].map((r) => [r.from, r.to, r.o, r.h, r.l, r.c, r.chg, r.chgPct, r.v].join(','));
    const blob = new Blob([[head, ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${p.symbol}_${kind}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- mount ---------- */
  function mount(el, symbol) {
    let sym = String(symbol).toUpperCase(), data = null, tab = 'rev', tbl = 'daily', dead = false;
    el.innerHTML = `<p class="help" data-r="head">Loading…</p>
      <div class="seg fit" role="tablist" aria-label="Period views">
        <button type="button" data-tab="rev" class="on">Previous session, week, month</button>
        <button type="button" data-tab="out">Next session, week, month</button>
        <button type="button" data-tab="data">Data tables</button>
      </div>
      <div data-r="body" style="margin-top:12px"></div>`;
    const head = $('[data-r=head]', el), body = $('[data-r=body]', el);

    function draw() {
      $$('[data-tab]', el).forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
      if (!data) return;
      const when = data.lastSession ? `Last completed session: ${fmtDate(data.lastSession)}, close ${nf(data.lastClose)}.` : '';
      head.textContent = `${data.headline || ''} ${when}`.trim();
      body.innerHTML = tab === 'rev' ? reviewsPanel(data) : tab === 'out' ? outlookPanel(data) : tablePanel(data, tbl);
    }
    async function load() {
      try { const d = await api(`/api/periods/${encodeURIComponent(sym)}`); if (dead || d.symbol !== sym) return; data = d; draw(); }
      catch (e) { if (!dead && !data) { head.textContent = ''; body.innerHTML = `<p class="note err">Could not load history for ${esc(sym)}: ${esc(e.message)}</p>`; } }
    }
    el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]'), b = e.target.closest('[data-tbl]'), c = e.target.closest('[data-csv]');
      if (t) { tab = t.dataset.tab; draw(); }
      if (b) { tbl = b.dataset.tbl; draw(); }
      if (c && data) downloadCsv(data, c.dataset.csv);
    });
    load();
    const timer = setInterval(load, 120000);
    return {
      setSymbol(s) { sym = String(s).toUpperCase(); data = null; head.textContent = 'Loading…'; body.innerHTML = ''; load(); },
      destroy() { dead = true; clearInterval(timer); },
    };
  }

  window.Periods = { mount };
})();
