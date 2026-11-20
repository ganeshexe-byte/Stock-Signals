/* Technical-analysis helpers. Works in Node (require) and the browser (window.TA).
   Candle format: { t: epochSeconds(UTC), o, h, l, c, v } */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const IST = 19800; // +05:30 in seconds

  const closes = (cs) => cs.map((c) => c.c);
  const istDay = (t) => Math.floor((t + IST) / 86400); // integer day number in IST
  const istDate = (t) => new Date((t + IST) * 1000).toISOString().slice(0, 10);
  const istMinutes = (t) => Math.floor(((t + IST) % 86400) / 60);

  function sma(a, n) {
    const out = new Array(a.length).fill(null);
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += a[i];
      if (i >= n) sum -= a[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  function ema(a, n) {
    const out = new Array(a.length).fill(null);
    if (a.length < n) return out;
    const k = 2 / (n + 1);
    let prev = 0;
    for (let i = 0; i < n; i++) prev += a[i];
    prev /= n;
    out[n - 1] = prev;
    for (let i = n; i < a.length; i++) {
      prev = a[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  // Wilder's RSI
  function rsi(a, n = 14) {
    const out = new Array(a.length).fill(null);
    if (a.length <= n) return out;
    let gain = 0, loss = 0;
    for (let i = 1; i <= n; i++) {
      const d = a[i] - a[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    gain /= n; loss /= n;
    out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    for (let i = n + 1; i < a.length; i++) {
      const d = a[i] - a[i - 1];
      gain = (gain * (n - 1) + Math.max(d, 0)) / n;
      loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
    return out;
  }

  function macd(a, fast = 12, slow = 26, sig = 9) {
    const ef = ema(a, fast), es = ema(a, slow);
    const line = a.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
    const first = line.findIndex((x) => x != null);
    const signal = new Array(a.length).fill(null);
    if (first >= 0) {
      const part = ema(line.slice(first), sig);
      part.forEach((v, i) => { signal[first + i] = v; });
    }
    const hist = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null));
    return { line, signal, hist };
  }

  function bollinger(a, n = 20, k = 2) {
    const mid = sma(a, n);
    const upper = new Array(a.length).fill(null), lower = new Array(a.length).fill(null);
    for (let i = n - 1; i < a.length; i++) {
      let s = 0;
      for (let j = i - n + 1; j <= i; j++) s += (a[j] - mid[i]) ** 2;
      const sd = Math.sqrt(s / n);
      upper[i] = mid[i] + k * sd;
      lower[i] = mid[i] - k * sd;
    }
    return { mid, upper, lower };
  }

  function atr(cs, n = 14) {
    const tr = cs.map((c, i) => {
      if (i === 0) return c.h - c.l;
      const pc = cs[i - 1].c;
      return Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc));
    });
    const out = new Array(cs.length).fill(null);
    if (cs.length < n) return out;
    let prev = 0;
    for (let i = 0; i < n; i++) prev += tr[i];
    prev /= n;
    out[n - 1] = prev;
    for (let i = n; i < cs.length; i++) {
      prev = (prev * (n - 1) + tr[i]) / n;
      out[i] = prev;
    }
    return out;
  }

  // Session VWAP, resets every IST day. Indices have no volume, so fall back to
  // the running average of the typical price.
  function vwap(cs) {
    const out = new Array(cs.length).fill(null);
    let day = null, pv = 0, vol = 0, tp = 0, n = 0;
    cs.forEach((c, i) => {
      const d = istDay(c.t);
      if (d !== day) { day = d; pv = 0; vol = 0; tp = 0; n = 0; }
      const typical = (c.h + c.l + c.c) / 3;
      pv += typical * (c.v || 0); vol += c.v || 0; tp += typical; n++;
      out[i] = vol > 0 ? pv / vol : tp / n;
    });
    return out;
  }

  function pivots(h, l, c) {
    const pp = (h + l + c) / 3;
    const bc = (h + l) / 2;
    const tc = pp * 2 - bc;
    return {
      pp,
      r1: 2 * pp - l, s1: 2 * pp - h,
      r2: pp + (h - l), s2: pp - (h - l),
      r3: h + 2 * (pp - l), s3: l - 2 * (h - pp),
      cpr: { tc: Math.max(tc, bc), bc: Math.min(tc, bc), pp },
    };
  }

  // Swing highs/lows -> clustered support / resistance levels
  function swingLevels(cs, price, left = 3, right = 3, lookback = 120) {
    const part = cs.slice(-lookback);
    const highs = [], lows = [];
    for (let i = left; i < part.length - right; i++) {
      let isH = true, isL = true;
      for (let j = i - left; j <= i + right; j++) {
        if (j === i) continue;
        if (part[j].h >= part[i].h) isH = false;
        if (part[j].l <= part[i].l) isL = false;
      }
      if (isH) highs.push(part[i].h);
      if (isL) lows.push(part[i].l);
    }
    const cluster = (arr) => {
      const sorted = arr.slice().sort((a, b) => a - b);
      const groups = [];
      sorted.forEach((p) => {
        const g = groups[groups.length - 1];
        if (g && Math.abs(p - g.avg) / g.avg < 0.004) { g.sum += p; g.n++; g.avg = g.sum / g.n; }
        else groups.push({ sum: p, n: 1, avg: p });
      });
      return groups.map((g) => ({ level: g.avg, touches: g.n }));
    };
    const all = cluster(highs.concat(lows));
    const resistance = all.filter((g) => g.level > price).sort((a, b) => a.level - b.level).slice(0, 3);
    const support = all.filter((g) => g.level < price).sort((a, b) => b.level - a.level).slice(0, 3);
    return { resistance, support };
  }

  function aggregate(cs, secs, anchorSecs) {
    // Bucket candles into `secs` windows. Intraday windows are anchored at 09:15 IST.
    const out = [];
    let cur = null;
    cs.forEach((c) => {
      const dayStart = Math.floor((c.t + IST) / 86400) * 86400 - IST;
      const bucket = secs >= 86400 ? dayStart : dayStart + anchorSecs + Math.floor((c.t - dayStart - anchorSecs) / secs) * secs;
      if (!cur || cur.t !== bucket) {
        cur = { t: bucket, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v || 0 };
        out.push(cur);
      } else {
        cur.h = Math.max(cur.h, c.h); cur.l = Math.min(cur.l, c.l);
        cur.c = c.c; cur.v += c.v || 0;
      }
    });
    return out;
  }

  function weekly(daily) {
    const out = [];
    let cur = null;
    daily.forEach((c) => {
      const d = new Date((c.t + IST) * 1000);
      const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
      const wk = c.t - dow * 86400;
      const key = Math.floor((wk + IST) / 86400);
      if (!cur || cur.key !== key) {
        cur = { key, t: wk, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v || 0 };
        out.push(cur);
      } else {
        cur.h = Math.max(cur.h, c.h); cur.l = Math.min(cur.l, c.l);
        cur.c = c.c; cur.v += c.v || 0;
      }
    });
    return out.map(({ key, ...c }) => c);
  }

  const last = (a) => { for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]; return null; };

  return { IST, closes, istDay, istDate, istMinutes, sma, ema, rsi, macd, bollinger, atr, vwap, pivots, swingLevels, aggregate, weekly, last };
});
