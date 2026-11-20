/* Reusable render helpers for the analysis blocks (condition cards, levels, indicators, movers, options). */
(function () {
  const { esc, nf, pct, signed, cls, labelCls } = App;

  function rangeBar(lo, hi, px, d = 2) {
    const p = hi > lo ? Math.min(100, Math.max(0, ((px - lo) / (hi - lo)) * 100)) : 50;
    return `<div class="range"><div class="bar-track"><i style="left:${p}%"></i></div><div class="ends"><span>${nf(lo, d)}</span><span>${nf(hi, d)}</span></div></div>`;
  }

  function condCard(c) {
    const noData = c.label === 'No data';
    const checks = c.checks.map((k) => {
      const dot = k.signal === null ? '' : k.signal > 0 ? 'p' : k.signal < 0 ? 'n' : 'z';
      return `<li><span class="dot ${dot}" aria-hidden="true"></span><span>${esc(k.name)}<small>${esc(k.detail)}</small></span></li>`;
    }).join('');
    return `<article class="card cond-card">
      <div class="cond-head"><div><div class="tf">${esc(c.tf)}</div><div class="lab ${labelCls(c.label)}">${esc(c.label)}</div></div>${noData ? '' : `<span class="mono muted">${c.score}/100</span>`}</div>
      ${noData ? `<p class="note">${esc(c.note || 'Not enough data yet')}</p>` : `<div><div class="meter" role="img" aria-label="Score ${c.score} out of 100"><i style="left:${c.score}%"></i></div><div class="meter-scale"><span>Bearish</span><span>Sideways</span><span>Bullish</span></div></div>`}
      <ul class="checks">${checks}</ul></article>`;
  }

  function levels(a) {
    const L = a.levels;
    if (!L) return '<p class="empty">Levels need daily candles (not available yet).</p>';
    const px = a.quote ? a.quote.ltp : null;
    const p = L.pivots;
    const rows = [['R3', p.r3], ['R2', p.r2], ['R1', p.r1], ['Pivot', p.pp], ['S1', p.s1], ['S2', p.s2], ['S3', p.s3]];
    const near = (arr) => (arr.length ? arr.map((x) => `${nf(x.level, 0)}${x.touches > 1 ? ` <span class="muted">×${x.touches}</span>` : ''}`).join(' · ') : '–');
    return `<ul class="kv">
      ${rows.map(([n, v]) => `<li><span>${n}</span><b class="${px != null && n !== 'Pivot' ? (v > px ? 'down' : 'up') : ''}">${nf(v)}</b></li>`).join('')}
      <li><span>CPR (BC – TC)</span><b>${nf(p.cpr.bc)} – ${nf(p.cpr.tc)}</b></li>
      <li><span>Prev day O / H / L / C</span><b>${nf(L.prevDay.o, 0)} / ${nf(L.prevDay.h, 0)} / ${nf(L.prevDay.l, 0)} / ${nf(L.prevDay.c, 0)}</b></li>
      <li><span>Swing resistance</span><b>${near(L.resistance)}</b></li>
      <li><span>Swing support</span><b>${near(L.support)}</b></li>
      <li><span>52-week low / high</span><b>${nf(L.low52, 0)} / ${nf(L.high52, 0)}</b></li>
    </ul>
    <p class="help">Pivots come from the previous session. Red = above price, green = below.</p>`;
  }

  function indicators(a) {
    const t = a.indicators;
    if (!t || !t.rows.length) return '<p class="empty">Indicators need at least 30 daily candles.</p>';
    const tot = t.summary.buy + t.summary.sell + t.summary.neutral || 1;
    return `<div class="tally" role="img" aria-label="${t.summary.buy} buy, ${t.summary.neutral} neutral, ${t.summary.sell} sell"><i style="width:${(t.summary.buy / tot) * 100}%"></i><i style="width:${(t.summary.neutral / tot) * 100}%"></i><i style="width:${(t.summary.sell / tot) * 100}%"></i></div>
      <p class="help">${t.summary.buy} Buy · ${t.summary.neutral} Neutral · ${t.summary.sell} Sell (daily chart, rule-based readings)</p>
      <div class="table-wrap"><table class="table"><thead><tr><th class="l">Indicator</th><th class="num">Value</th><th class="l">Reading</th></tr></thead><tbody>
      ${t.rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${esc(r.value)}</td><td class="l"><span class="signal-pill ${r.signal}">${r.signal}</span> <span class="muted">${esc(r.note)}</span></td></tr>`).join('')}
      </tbody></table></div>`;
  }

  function movers(a) {
    const m = a.movers;
    if (!m) return '<p class="empty">Constituent prices are not available yet.</p>';
    const total = m.advancers + m.decliners + m.unchanged || 1;
    const list = (arr) => `<ul class="mover-list">${arr.map((r) => `<li><a href="charts.html?s=${encodeURIComponent(r.symbol)}">${esc(r.symbol)}</a><em class="${cls(r.pct)}">${pct(r.pct)}</em></li>`).join('')}</ul>`;
    return `<div class="row" style="justify-content:space-between"><span class="up">${m.advancers} advancing</span><span class="muted">${m.unchanged} flat</span><span class="down">${m.decliners} declining</span></div>
      <div class="breadth big" aria-hidden="true"><span class="adv" style="width:${(m.advancers / total) * 100}%"></span><span class="dec" style="width:${(m.decliners / total) * 100}%"></span></div>
      <div class="grid-2" style="margin-top:12px"><div><h4 class="help" style="margin:0 0 4px">Top gainers</h4>${list(m.gainers)}</div><div><h4 class="help" style="margin:0 0 4px">Top losers</h4>${list(m.losers)}</div></div>
      <h4 class="help" style="margin:14px 0 6px">Sectors (average change of members)</h4>
      <ul class="sectors">${m.sectors.map((s) => `<li><span>${esc(s.name)}</span><div class="bar"><i class="${s.pct >= 0 ? 'pos' : 'neg'}" style="width:${Math.min(100, Math.abs(s.pct) * 40)}%"></i></div><b class="${cls(s.pct)}">${pct(s.pct)}</b></li>`).join('')}</ul>
      <p class="help">Constituents are the list in <span class="code-inline">server/universe.js</span>; update it when the index is reconstituted.</p>`;
  }

  function optionChain(ch) {
    if (!ch) return '<p class="empty">No option chain for this symbol.</p>';
    if (ch.error) return `<p class="note err">${esc(ch.error)}</p>`;
    const rows = ch.rows.filter((r) => r.ce || r.pe);
    if (!rows.length) return '<p class="empty">Waiting for option prices…</p>';
    const max = Math.max(...rows.map((r) => Math.max(r.ce ? r.ce.oi : 0, r.pe ? r.pe.oi : 0))) || 1;
    const k = (n) => (n >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(n));
    return `<div class="grid-4" style="margin-bottom:12px">
      <div class="stat"><span>Expiry</span><b>${esc(ch.expiry)}</b></div>
      <div class="stat"><span>PCR (OI)</span><b class="${ch.pcr > 1.1 ? 'up' : ch.pcr < 0.9 ? 'down' : ''}">${ch.pcr != null ? nf(ch.pcr) : '–'}</b></div>
      <div class="stat"><span>Max pain</span><b>${nf(ch.maxPain, 0)}</b></div>
      <div class="stat"><span>Wall: resistance / support</span><b>${ch.resistance ? nf(ch.resistance.strike, 0) : '–'} / ${ch.support ? nf(ch.support.strike, 0) : '–'}</b></div></div>
      <div class="oi-head"><span>Call OI (sellers cap price)</span><span>Strike</span><span>Put OI (sellers support price)</span></div>
      ${rows.map((r) => `<div class="oi-row ${r.strike === ch.atm ? 'atm' : ''}">
        <div class="oi-side ce"><em>${r.ce ? k(r.ce.oi) : ''}</em><i style="width:${r.ce ? (r.ce.oi / max) * 100 : 0}%"></i></div><div class="strike">${nf(r.strike, 0)}</div>
        <div class="oi-side pe"><i style="width:${r.pe ? (r.pe.oi / max) * 100 : 0}%"></i><em>${r.pe ? k(r.pe.oi) : ''}</em></div></div>`).join('')}
      <p class="help">${ch.simulated ? 'Simulated open interest. ' : ''}Nearest expiry, 10 strikes either side of the money. PCR above ~1.1 is often read as supportive, below ~0.9 as cautious. It is context, not a signal. Greeks are not included.</p>`;
  }

  // Daily-analysis phases (pre-market / live / post-market) built from one index analysis
  function phase(a, which) {
    const q = a.quote, L = a.levels, [i, s, m] = a.conditions;
    const kv = (rows) => `<ul class="kv">${rows.filter(Boolean).map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join('')}</ul>`;
    const tag = (c) => `<span class="tag ${labelCls(c.label)}">${esc(c.label)}</span>`;
    if (which === 'pre') {
      return kv([
        ['Short-term trend', tag(s)], ['Medium-term trend', tag(m)],
        L && ['Previous close', nf(L.prevDay.c)], L && ['Previous range (L – H)', `${nf(L.prevDay.l)} – ${nf(L.prevDay.h)}`],
        L && L.support[0] && ['Nearest support', nf(L.support[0].level, 0)], L && L.resistance[0] && ['Nearest resistance', nf(L.resistance[0].level, 0)],
        L && ['Pivot (PP) / CPR', `${nf(L.pivots.pp)} / ${nf(L.pivots.cpr.bc, 0)}–${nf(L.pivots.cpr.tc, 0)}`],
      ]) + `<p class="note">${esc(a.narrative.pre)}</p><p class="help">Global cues (GIFT Nifty), FII/DII flows and the events calendar need data sources this app does not have yet.</p>`;
    }
    if (which === 'live') {
      const pick = (n) => { const c = i.checks.find((x) => x.name.startsWith(n)); return c ? c.detail : null; };
      const mv = a.movers;
      return kv([
        ['Intraday condition', `${tag(i)} <span class="muted">${i.label === 'No data' ? '' : i.score}</span>`],
        pick('Price vs VWAP') && ['Vs VWAP', esc(pick('Price vs VWAP'))], pick('Opening range') && ['Opening range', esc(pick('Opening range'))],
        pick('Change vs') && ['Vs previous close', esc(pick('Change vs'))], pick('Position') && ['Day range', esc(pick('Position'))],
        mv && ['Breadth', `${mv.advancers} up / ${mv.decliners} down`],
      ]) + `<p class="note">${esc(a.narrative.live)}</p>`;
    }
    return kv([
      q && ['Last / close', `${nf(q.ltp)} (${pct(q.pct)})`], q && ['Day range (L – H)', `${nf(q.low)} – ${nf(q.high)}`],
      ['Overall condition', `<span class="tag ${labelCls(a.overall.label)}">${esc(a.overall.text)}</span>`],
      a.movers && a.movers.sectors.length && ['Strongest / weakest sector', `${esc(a.movers.sectors[0].name)} / ${esc(a.movers.sectors[a.movers.sectors.length - 1].name)}`],
    ]) + `<p class="note">${esc(a.narrative.post)}</p>`;
  }

  window.Panels = { rangeBar, condCard, levels, indicators, movers, optionChain, phase };
})();
