/* Rule-based market-condition scoring (Bullish / Bearish / Sideways).
   Every check is listed with its reading so the label can be explained, not just shown.
   This is a snapshot of trend, not a forecast. Edit weights/thresholds here. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ta.js'));
  else root.Condition = factory(root.TA);
})(typeof self !== 'undefined' ? self : this, function (TA) {
  const BULL = 60, BEAR = 40;

  const fmt = (n, d = 2) => (n == null || !isFinite(n) ? '–' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const lbl = (score) => (score >= BULL ? 'Bullish' : score <= BEAR ? 'Bearish' : 'Sideways');

  function finish(tf, checks, extra) {
    const used = checks.filter((c) => c.signal !== null);
    const wsum = used.reduce((s, c) => s + c.weight, 0);
    const net = used.reduce((s, c) => s + c.signal * c.weight, 0);
    const score = wsum ? Math.round(50 + 50 * (net / wsum)) : 50;
    return { tf, label: wsum ? lbl(score) : 'No data', score, checks, ...extra };
  }

  const chk = (name, signal, weight, detail) => ({ name, signal, weight, detail });
  const sig3 = (v, up, down) => (v > up ? 1 : v < down ? -1 : 0);

  /* ---------- Intraday (5-minute candles, latest IST session) ---------- */
  function intraday(c5, prevClose) {
    if (!c5 || !c5.length) return finish('Intraday', [], { note: 'No intraday candles' });
    const lastDay = TA.istDay(c5[c5.length - 1].t);
    const day = c5.filter((c) => TA.istDay(c.t) === lastDay);
    if (day.length < 4) return finish('Intraday', [], { note: 'Waiting for enough candles in today\'s session' });

    const closes = c5.map((c) => c.c);
    const px = day[day.length - 1].c;
    const vw = TA.last(TA.vwap(day));
    const e9 = TA.last(TA.ema(closes, 9)), e21 = TA.last(TA.ema(closes, 21));
    const r = TA.last(TA.rsi(closes, 14));
    const or = day.slice(0, 3);
    const orH = Math.max(...or.map((c) => c.h)), orL = Math.min(...or.map((c) => c.l));
    const dH = Math.max(...day.map((c) => c.h)), dL = Math.min(...day.map((c) => c.l));
    const pos = dH > dL ? (px - dL) / (dH - dL) : 0.5;
    const chg = prevClose ? ((px - prevClose) / prevClose) * 100 : null;

    const checks = [
      chk('Price vs VWAP', vw ? sig3(px - vw, 0, 0) : null, 2, vw ? `${fmt(px)} is ${px >= vw ? 'above' : 'below'} VWAP ${fmt(vw)}` : 'n/a'),
      chk('EMA 9 vs EMA 21', e9 != null && e21 != null ? sig3(e9 - e21, 0, 0) : null, 1.5, e9 != null && e21 != null ? `EMA9 ${fmt(e9)} ${e9 >= e21 ? '>' : '<'} EMA21 ${fmt(e21)}` : 'Not enough candles'),
      chk('Opening range (first 15 min)', px > orH ? 1 : px < orL ? -1 : 0, 1.5, `Range ${fmt(orL)} – ${fmt(orH)}; price ${px > orH ? 'broke above' : px < orL ? 'broke below' : 'is inside'}`),
      chk('RSI 14 (5m)', r != null ? sig3(r, 55, 45) : null, 1, r != null ? `RSI ${fmt(r, 1)}` : 'Not enough candles'),
      chk('Change vs previous close', chg != null ? sig3(chg, 0.25, -0.25) : null, 1, chg != null ? `${chg >= 0 ? '+' : ''}${fmt(chg)}% vs prev close ${fmt(prevClose)}` : 'No previous close'),
      chk('Position in day range', pos > 0.7 ? 1 : pos < 0.3 ? -1 : 0, 1, `Price is at ${Math.round(pos * 100)}% of today's range`),
    ];
    return finish('Intraday', checks, { vwap: vw, openingRange: { high: orH, low: orL }, dayHigh: dH, dayLow: dL, session: TA.istDate(day[0].t) });
  }

  /* ---------- Short term (daily candles, ~1-2 weeks) ---------- */
  function shortTerm(daily) {
    if (!daily || daily.length < 30) return finish('Short term', [], { note: 'Need at least 30 daily candles' });
    const cl = daily.map((c) => c.c);
    const px = cl[cl.length - 1];
    const e20 = TA.last(TA.ema(cl, 20)), e50 = TA.last(TA.ema(cl, 50));
    const r = TA.last(TA.rsi(cl, 14));
    const m = TA.macd(cl);
    const hist = TA.last(m.hist);
    const ago = cl[cl.length - 11];
    const roc = ago ? ((px - ago) / ago) * 100 : null;
    const w = daily.slice(-20);
    const hi = Math.max(...w.map((c) => c.h)), lo = Math.min(...w.map((c) => c.l));
    const pos = hi > lo ? (px - lo) / (hi - lo) : 0.5;
    const checks = [
      chk('Close vs EMA 20', e20 != null ? sig3(px - e20, 0, 0) : null, 2, e20 != null ? `${fmt(px)} is ${px >= e20 ? 'above' : 'below'} EMA20 ${fmt(e20)}` : 'n/a'),
      chk('EMA 20 vs EMA 50', e20 != null && e50 != null ? sig3(e20 - e50, 0, 0) : null, 1.5, e20 != null && e50 != null ? `EMA20 ${fmt(e20)} ${e20 >= e50 ? '>' : '<'} EMA50 ${fmt(e50)}` : 'Not enough candles'),
      chk('RSI 14 (daily)', r != null ? sig3(r, 55, 45) : null, 1, r != null ? `RSI ${fmt(r, 1)}` : 'n/a'),
      chk('MACD histogram', hist != null ? sig3(hist, 0, 0) : null, 1, hist != null ? `Histogram ${fmt(hist)} (${hist >= 0 ? 'positive' : 'negative'})` : 'n/a'),
      chk('10-day momentum', roc != null ? sig3(roc, 1, -1) : null, 1, roc != null ? `${roc >= 0 ? '+' : ''}${fmt(roc)}% over 10 sessions` : 'n/a'),
      chk('Position in 20-day range', pos > 0.7 ? 1 : pos < 0.3 ? -1 : 0, 1, `Price is at ${Math.round(pos * 100)}% of the 20-day range`),
    ];
    return finish('Short term', checks, {});
  }

  /* ---------- Medium term (daily candles, ~1-3 months) ---------- */
  function mediumTerm(daily) {
    if (!daily || daily.length < 120) return finish('Medium term', [], { note: 'Need at least 120 daily candles' });
    const cl = daily.map((c) => c.c);
    const px = cl[cl.length - 1];
    const s50 = TA.last(TA.sma(cl, 50));
    const s200 = daily.length >= 200 ? TA.last(TA.sma(cl, 200)) : null;
    const ago = cl[cl.length - 64];
    const roc = ago ? ((px - ago) / ago) * 100 : null;
    const w = daily.slice(-252);
    const hi = Math.max(...w.map((c) => c.h)), lo = Math.min(...w.map((c) => c.l));
    const pos = hi > lo ? (px - lo) / (hi - lo) : 0.5;
    const checks = [
      chk('Close vs SMA 50', s50 != null ? sig3(px - s50, 0, 0) : null, 1.5, s50 != null ? `${fmt(px)} is ${px >= s50 ? 'above' : 'below'} SMA50 ${fmt(s50)}` : 'n/a'),
      chk('SMA 50 vs SMA 200', s50 != null && s200 != null ? sig3(s50 - s200, 0, 0) : null, 2, s50 != null && s200 != null ? `SMA50 ${fmt(s50)} ${s50 >= s200 ? '>' : '<'} SMA200 ${fmt(s200)}` : 'Needs 200 candles'),
      chk('Close vs SMA 200', s200 != null ? sig3(px - s200, 0, 0) : null, 1.5, s200 != null ? `${fmt(px)} is ${px >= s200 ? 'above' : 'below'} SMA200 ${fmt(s200)}` : 'Needs 200 candles'),
      chk('3-month momentum', roc != null ? sig3(roc, 3, -3) : null, 1, roc != null ? `${roc >= 0 ? '+' : ''}${fmt(roc)}% over ~63 sessions` : 'n/a'),
      chk('Position in 52-week range', pos > 0.65 ? 1 : pos < 0.35 ? -1 : 0, 1, `Price is at ${Math.round(pos * 100)}% of the 52-week range`),
    ];
    return finish('Medium term', checks, { high52: hi, low52: lo });
  }

  function overall(list) {
    const valid = list.filter((c) => c.label !== 'No data');
    const bull = valid.filter((c) => c.label === 'Bullish').length;
    const bear = valid.filter((c) => c.label === 'Bearish').length;
    let label = 'Mixed';
    if (!valid.length) label = 'No data';
    else if (bull > bear && bull >= Math.ceil(valid.length / 2)) label = 'Bullish';
    else if (bear > bull && bear >= Math.ceil(valid.length / 2)) label = 'Bearish';
    else if (bull === 0 && bear === 0) label = 'Sideways';
    const n = label === 'Bearish' ? bear : label === 'Bullish' ? bull : 0;
    return { label, bull, bear, total: valid.length, text: n ? `${label} · ${n} of ${valid.length}` : label };
  }

  /* ---------- Indicator summary table (daily) ---------- */
  function indicatorTable(daily) {
    if (!daily || daily.length < 30) return { rows: [], summary: { buy: 0, sell: 0, neutral: 0 } };
    const cl = daily.map((c) => c.c);
    const px = cl[cl.length - 1];
    const rows = [];
    const add = (name, value, signal, note) => rows.push({ name, value, signal, note });
    const r = TA.last(TA.rsi(cl, 14));
    if (r != null) add('RSI (14)', fmt(r, 1), r < 30 ? 'Buy' : r > 70 ? 'Sell' : 'Neutral', r < 30 ? 'Oversold' : r > 70 ? 'Overbought' : r >= 50 ? 'Mild strength' : 'Mild weakness');
    const m = TA.macd(cl); const ml = TA.last(m.line), ms = TA.last(m.signal);
    if (ml != null && ms != null) add('MACD (12,26,9)', fmt(ml), ml > ms ? 'Buy' : 'Sell', ml > ms ? 'MACD above signal' : 'MACD below signal');
    [20, 50, 200].forEach((n) => {
      if (cl.length >= n) { const v = TA.last(TA.ema(cl, n)); add(`EMA ${n}`, fmt(v), px > v ? 'Buy' : 'Sell', px > v ? 'Price above' : 'Price below'); }
    });
    const bb = TA.bollinger(cl, 20, 2); const u = TA.last(bb.upper), lo = TA.last(bb.lower);
    if (u != null) { const pb = (px - lo) / (u - lo); add('Bollinger %B', fmt(pb, 2), pb < 0.1 ? 'Buy' : pb > 0.9 ? 'Sell' : 'Neutral', pb < 0.1 ? 'Near lower band' : pb > 0.9 ? 'Near upper band' : 'Inside bands'); }
    const a = TA.last(TA.atr(daily, 14));
    if (a != null) add('ATR (14)', `${fmt(a)} (${fmt((a / px) * 100)}%)`, 'Neutral', 'Average daily range');
    const summary = { buy: 0, sell: 0, neutral: 0 };
    rows.forEach((x) => { summary[x.signal.toLowerCase()]++; });
    return { rows, summary };
  }

  /* ---------- Plain-language daily summary generated from the numbers ---------- */
  function narrative(name, quote, conds, levels) {
    const [i, s, m] = conds;
    const px = quote && quote.ltp;
    const parts = {};
    const chg = quote && quote.pct != null ? `${quote.pct >= 0 ? '+' : ''}${fmt(quote.pct)}%` : '';
    parts.live = px
      ? `${name} is at ${fmt(px)} (${chg}). Intraday reads ${i.label}${i.score != null && i.label !== 'No data' ? ` (score ${i.score})` : ''}; ${i.checks.slice(0, 3).filter((c) => c.signal !== null).map((c) => c.detail).join('; ')}.`
      : `${name}: waiting for live price.`;
    const sup = levels && levels.support && levels.support[0], res = levels && levels.resistance && levels.resistance[0];
    parts.pre = `Short-term trend is ${s.label} and medium-term is ${m.label}. ` +
      (sup || res ? `Watch ${sup ? `support near ${fmt(sup.level, 0)}` : ''}${sup && res ? ' and ' : ''}${res ? `resistance near ${fmt(res.level, 0)}` : ''}.` : '');
    const o = overall(conds);
    parts.post = `Close ${px ? fmt(px) : '–'} (${chg}). Overall condition: ${o.text}. ` +
      (o.label === 'Bullish' ? 'Trend is constructive; a break below nearest support would weaken it.' : o.label === 'Bearish' ? 'Trend is weak; a close above nearest resistance would ease the pressure.' : 'No clear edge; wait for a break of the range.');
    return parts;
  }

  return { intraday, shortTerm, mediumTerm, overall, indicatorTable, narrative, label: lbl, BULL, BEAR };
});
