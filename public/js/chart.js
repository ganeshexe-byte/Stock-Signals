/* StockChart: candlestick chart (TradingView Lightweight Charts) with built-in and custom indicators,
   live updates from the quote socket, and IST time labels. Needs LightweightCharts, TA and App. */
(function () {
  const IST = 19800;
  const SECS = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '1d': 86400, '1w': 604800 };
  const COUNT = { '1m': 400, '5m': 320, '15m': 320, '30m': 320, '1h': 320, '1d': 420, '1w': 200 };
  const C = { up: '#22c55e', down: '#ef4444', grid: '#1a2430', text: '#8796a8', bg: '#0a0e13', accent: '#4f8cff', amber: '#f5a524', purple: '#c084fc' };

  const BUILTIN = [
    { key: 'ema9', label: 'EMA 9', color: '#4f8cff', pane: 'overlay' },
    { key: 'ema21', label: 'EMA 21', color: '#f5a524', pane: 'overlay' },
    { key: 'ema50', label: 'EMA 50', color: '#22c55e', pane: 'overlay' },
    { key: 'ema200', label: 'EMA 200', color: '#ef4444', pane: 'overlay' },
    { key: 'vwap', label: 'VWAP', color: '#e879f9', pane: 'overlay' },
    { key: 'bb', label: 'Bollinger', color: '#64748b', pane: 'overlay' },
    { key: 'volume', label: 'Volume', color: '#334155', pane: 'overlay' },
    { key: 'rsi', label: 'RSI 14', color: '#4f8cff', pane: 'separate' },
    { key: 'macd', label: 'MACD', color: '#4f8cff', pane: 'separate' },
  ];

  const closes = (cs) => cs.map((c) => c.c);
  const CALC = {
    ema9: (cs) => [{ name: 'EMA 9', color: '#4f8cff', values: TA.ema(closes(cs), 9) }],
    ema21: (cs) => [{ name: 'EMA 21', color: '#f5a524', values: TA.ema(closes(cs), 21) }],
    ema50: (cs) => [{ name: 'EMA 50', color: '#22c55e', values: TA.ema(closes(cs), 50) }],
    ema200: (cs) => [{ name: 'EMA 200', color: '#ef4444', values: TA.ema(closes(cs), 200) }],
    vwap: (cs, iv) => (SECS[iv] >= 86400 ? [] : [{ name: 'VWAP', color: '#e879f9', values: TA.vwap(cs), style: 'dashed' }]),
    bb: (cs) => { const b = TA.bollinger(closes(cs), 20, 2); return [{ name: 'BB upper', color: '#64748b', values: b.upper, style: 'dashed' }, { name: 'BB mid', color: '#475569', values: b.mid }, { name: 'BB lower', color: '#64748b', values: b.lower, style: 'dashed' }]; },
    rsi: (cs) => [{ name: 'RSI 14', color: '#4f8cff', values: TA.rsi(closes(cs), 14), levels: [30, 70] }],
    macd: (cs) => { const m = TA.macd(closes(cs)); return [{ name: 'Histogram', type: 'hist', values: m.hist }, { name: 'MACD', color: '#4f8cff', values: m.line }, { name: 'Signal', color: '#f5a524', values: m.signal }]; },
  };

  function bucket(t, iv) {
    const dayStart = Math.floor((t + IST) / 86400) * 86400 - IST;
    if (iv === '1d') return dayStart;
    if (iv === '1w') return dayStart - ((new Date((t + IST) * 1000).getUTCDay() + 6) % 7) * 86400;
    const s = SECS[iv];
    return dayStart + 33300 + Math.floor((t - dayStart - 33300) / s) * s; // sessions start 09:15 IST
  }

  /* ---------- user-written indicators (run in this browser only) ---------- */
  function runCustom(code, candles) {
    const fn = new Function('candles', 'ta', `"use strict";\n${code}`);
    const out = fn(candles, TA);
    if (!out || typeof out !== 'object') throw new Error('The code must return an object, e.g. { name, color, pane, values }');
    const lines = out.lines || (out.values ? [out] : []);
    if (!lines.length && !(out.markers && out.markers.length)) throw new Error('Return { values: [...] } or { lines: [...] } or { markers: [...] }');
    lines.forEach((l) => { if (!Array.isArray(l.values) || l.values.length !== candles.length) throw new Error(`"values" needs one entry per candle (got ${l.values ? l.values.length : 'none'}, expected ${candles.length})`); });
    return {
      pane: out.pane === 'separate' ? 'separate' : 'overlay',
      lines: lines.map((l) => ({ name: l.name || out.name || 'Custom', color: l.color || out.color || C.purple, values: l.values, type: l.type || out.type || 'line', style: l.style, levels: l.levels || out.levels })),
      markers: (out.markers || []).filter((m) => Number.isInteger(m.index) && candles[m.index]),
    };
  }

  const store = {
    list() { try { return JSON.parse(localStorage.getItem('sl.custom') || '[]'); } catch { return []; } },
    save(list) { try { localStorage.setItem('sl.custom', JSON.stringify(list)); } catch { /* storage unavailable */ } },
  };

  class StockChart {
    constructor(el, opts = {}) {
      this.el = el;
      this.height = opts.height || 440;
      this.symbol = opts.symbol || 'NIFTY';
      this.interval = opts.interval || '15m';
      this.overlays = new Set(opts.overlays || ['ema9', 'ema21', 'vwap', 'volume']);
      this.custom = [];
      this.onError = opts.onError || (() => {});
      this.onLoad = opts.onLoad || (() => {});
      this.candles = [];
      this.entries = [];
      this.panes = [];
      this.token = 0;
      this.cum = null;
      el.classList.add('stockchart');
      el.innerHTML = '<div class="sc-main"></div><div class="sc-panes"></div><div class="sc-msg" hidden></div>';
      this.mainEl = el.querySelector('.sc-main'); this.panesEl = el.querySelector('.sc-panes'); this.msgEl = el.querySelector('.sc-msg');
      this.chart = this.make(this.mainEl, this.height);
      this.series = this.chart.addCandlestickSeries({ upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down });
      this.syncing = false;
      this.chart.timeScale().subscribeVisibleLogicalRangeChange((r) => this.syncPanes(r, this.chart));
      this.ro = new ResizeObserver(() => { const w = this.el.clientWidth; this.chart.applyOptions({ width: w }); this.panes.forEach((p) => p.chart.applyOptions({ width: w })); });
      this.ro.observe(el);
      this.handler = (q) => { if (!this.dead && q.symbol === this.symbol) this.onQuote(q); };
      App.on('quote', this.handler);
      this.load();
    }

    make(el, height) {
      return LightweightCharts.createChart(el, {
        width: this.el.clientWidth || 600, height,
        layout: { background: { type: 'solid', color: C.bg }, textColor: C.text, fontFamily: 'IBM Plex Mono, ui-monospace, monospace', fontSize: 11 },
        grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
        rightPriceScale: { borderColor: '#1f2b38' },
        timeScale: { borderColor: '#1f2b38', timeVisible: SECS[this.interval] < 86400, secondsVisible: false, rightOffset: 6 },
        crosshair: { mode: 0 },
      });
    }

    msg(text, isErr) { this.msgEl.hidden = !text; this.msgEl.textContent = text || ''; this.msgEl.classList.toggle('err', !!isErr); }

    setSymbol(s) { this.symbol = s; this.cum = null; return this.load(); }
    setInterval(iv) { this.interval = iv; this.cum = null; return this.load(); }
    setOverlays(list) { this.overlays = new Set(list); this.draw(); }
    setCustom(list) { this.custom = list; this.draw(); }

    async load() {
      const my = ++this.token;
      this.msg('Loading chart…');
      try {
        const r = await App.api(`/api/candles?symbol=${encodeURIComponent(this.symbol)}&interval=${this.interval}&count=${COUNT[this.interval] || 300}`);
        if (my !== this.token) return;
        const seen = new Set();
        this.candles = r.candles.filter((c) => c && isFinite(c.o) && isFinite(c.c) && !seen.has(c.t) && seen.add(c.t)).sort((a, b) => a.t - b.t);
        if (!this.candles.length) { this.msg('No candles returned for this symbol and timeframe.', true); this.series.setData([]); return; }
        this.chart.applyOptions({ timeScale: { timeVisible: SECS[this.interval] < 86400 } });
        this.series.setData(this.candles.map((c) => ({ time: c.t + IST, open: c.o, high: c.h, low: c.l, close: c.c })));
        this.draw();
        this.chart.timeScale().fitContent();
        this.msg('');
        const q = App.state.quotes[this.symbol];
        if (q) this.prevLine(q);
        this.onLoad(this.candles);
      } catch (e) {
        if (my === this.token) { this.series.setData([]); this.msg(`Could not load candles: ${e.message}`, true); }
      }
    }

    prevLine(q) {
      if (this.pl) { this.series.removePriceLine(this.pl); this.pl = null; }
      if (q && q.close && SECS[this.interval] < 86400) this.pl = this.series.createPriceLine({ price: q.close, color: '#64748b', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Prev close' });
    }

    /* build all indicator series from the current candles */
    clearIndicators() {
      this.entries.forEach((e) => { try { e.chart.removeSeries(e.series); } catch { /* already gone */ } });
      this.entries = [];
      this.panes.forEach((p) => p.chart.remove());
      this.panes = []; this.panesEl.innerHTML = '';
      this.series.setMarkers([]);
    }

    compute() {
      const out = [], errors = [];
      let markers = [];
      BUILTIN.filter((b) => this.overlays.has(b.key) && b.key !== 'volume').forEach((b) => {
        out.push({ id: b.key, pane: b.pane, title: b.label, lines: CALC[b.key](this.candles, this.interval) });
      });
      this.custom.filter((c) => c.on).forEach((c) => {
        try {
          const r = runCustom(c.code, this.candles);
          out.push({ id: `c:${c.id}`, pane: r.pane, title: c.name, lines: r.lines });
          r.markers.forEach((m) => markers.push({ time: this.candles[m.index].t + IST, position: m.position === 'above' || m.position === 'aboveBar' ? 'aboveBar' : 'belowBar', color: m.color || C.purple, shape: m.shape || (m.position === 'above' || m.position === 'aboveBar' ? 'arrowDown' : 'arrowUp'), text: m.text || '' }));
        } catch (e) { errors.push(`${c.name}: ${e.message}`); }
      });
      markers.sort((a, b) => a.time - b.time);
      return { out, markers, errors };
    }

    draw() {
      if (!this.candles.length) return;
      this.clearIndicators();
      const { out, markers, errors } = this.compute();
      const times = this.candles.map((c) => c.t + IST);
      const pts = (vals, hist) => vals.map((v, i) => (v == null || !isFinite(v) ? { time: times[i] } : { time: times[i], value: v, ...(hist ? { color: v >= 0 ? 'rgba(34,197,94,.55)' : 'rgba(239,68,68,.55)' } : {}) }));

      if (this.overlays.has('volume') && this.candles.some((c) => c.v > 0)) {
        const vs = this.chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
        this.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        vs.setData(this.candles.map((c) => ({ time: c.t + IST, value: c.v, color: c.c >= c.o ? 'rgba(34,197,94,.28)' : 'rgba(239,68,68,.28)' })));
        this.entries.push({ chart: this.chart, series: vs, id: 'volume', kind: 'volume' });
      }

      out.forEach((ind) => {
        let target = this.chart;
        if (ind.pane === 'separate') {
          const wrap = document.createElement('div'); wrap.className = 'sc-pane';
          wrap.innerHTML = `<span class="sc-pane-title">${App.esc(ind.title)}</span><div class="sc-pane-chart"></div>`;
          this.panesEl.appendChild(wrap);
          target = this.make(wrap.querySelector('.sc-pane-chart'), 130);
          target.timeScale().subscribeVisibleLogicalRangeChange((r) => this.syncPanes(r, target));
          this.panes.push({ chart: target, el: wrap });
        }
        ind.lines.forEach((l, li) => {
          let s;
          if (l.type === 'hist' || l.type === 'histogram') s = target.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
          else s = target.addLineSeries({ color: l.color, lineWidth: 2, lineStyle: l.style === 'dashed' ? 2 : 0, priceLineVisible: false, lastValueVisible: ind.pane === 'separate', title: ind.pane === 'overlay' ? '' : l.name });
          s.setData(pts(l.values, l.type === 'hist' || l.type === 'histogram'));
          (l.levels || []).forEach((p) => s.createPriceLine({ price: p, color: '#475569', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' }));
          this.entries.push({ chart: target, series: s, id: ind.id, line: li, kind: l.type === 'hist' || l.type === 'histogram' ? 'hist' : 'line' });
        });
      });
      this.series.setMarkers(markers);
      this.onError(errors);
      // keep the new panes lined up with the main chart
      const r = this.chart.timeScale().getVisibleLogicalRange();
      if (r) this.panes.forEach((p) => p.chart.timeScale().setVisibleLogicalRange(r));
    }

    syncPanes(range, from) {
      if (!range || this.syncing) return;
      this.syncing = true;
      [this.chart, ...this.panes.map((p) => p.chart)].forEach((c) => { if (c !== from) c.timeScale().setVisibleLogicalRange(range); });
      this.syncing = false;
    }

    /* ---------- live ticks ---------- */
    onQuote(q) {
      if (!this.candles.length || !q.ltp) return;
      const now = Math.floor(Date.now() / 1000);
      const b = bucket(now, this.interval);
      let last = this.candles[this.candles.length - 1];
      const dv = q.vol != null && this.cum != null ? Math.max(0, q.vol - this.cum) : 0;
      if (q.vol != null) this.cum = q.vol;
      let fresh = false;
      if (b > last.t && SECS[this.interval] < 604800 && b - last.t <= SECS[this.interval] * 400) {
        last = { t: b, o: last.c, h: q.ltp, l: q.ltp, c: q.ltp, v: 0 };
        this.candles.push(last); fresh = true;
      }
      last.h = Math.max(last.h, q.ltp); last.l = Math.min(last.l, q.ltp); last.c = q.ltp; last.v = (last.v || 0) + dv;
      this.series.update({ time: last.t + IST, open: last.o, high: last.h, low: last.l, close: last.c });
      if (fresh && this.candles.length > 2000) this.candles.shift();
      this.prevLine(q);
      if (!this.pending) { this.pending = setTimeout(() => { this.pending = null; this.refreshLast(); }, 1000); }
    }

    refreshLast() {
      if (!this.candles.length || !this.entries.length) return;
      const { out } = this.compute();
      const i = this.candles.length - 1, c = this.candles[i], time = c.t + IST;
      this.entries.forEach((e) => {
        try {
          if (e.kind === 'volume') { e.series.update({ time, value: c.v, color: c.c >= c.o ? 'rgba(34,197,94,.28)' : 'rgba(239,68,68,.28)' }); return; }
          const ind = out.find((o) => o.id === e.id);
          const v = ind && ind.lines[e.line] ? ind.lines[e.line].values[i] : null;
          if (v != null && isFinite(v)) e.series.update(e.kind === 'hist' ? { time, value: v, color: v >= 0 ? 'rgba(34,197,94,.55)' : 'rgba(239,68,68,.55)' } : { time, value: v });
          else e.series.update({ time });
        } catch { /* series was rebuilt */ }
      });
    }

    destroy() {
      this.dead = true;
      this.ro.disconnect();
      clearTimeout(this.pending);
      this.panes.forEach((p) => p.chart.remove());
      this.chart.remove();
    }
  }

  StockChart.BUILTIN = BUILTIN;
  StockChart.store = store;
  StockChart.runCustom = runCustom;
  window.StockChart = StockChart;
})();
