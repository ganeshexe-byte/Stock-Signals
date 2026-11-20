// Option-chain summary maths shared by the simulated and Angel One feeds.
function summarize(rows, spot) {
  const withOI = rows.filter((r) => r.ce || r.pe);
  const ceOI = withOI.reduce((s, r) => s + (r.ce ? r.ce.oi || 0 : 0), 0);
  const peOI = withOI.reduce((s, r) => s + (r.pe ? r.pe.oi || 0 : 0), 0);
  const pcr = ceOI > 0 ? peOI / ceOI : null;

  // Max pain: strike where total option-writer payout is smallest
  let maxPain = null, best = Infinity;
  withOI.forEach((k) => {
    let pain = 0;
    withOI.forEach((r) => {
      pain += (r.ce ? r.ce.oi || 0 : 0) * Math.max(0, k.strike - r.strike);
      pain += (r.pe ? r.pe.oi || 0 : 0) * Math.max(0, r.strike - k.strike);
    });
    if (pain < best) { best = pain; maxPain = k.strike; }
  });

  const top = (side) => withOI.reduce((a, r) => ((r[side] ? r[side].oi || 0 : 0) > (a ? a.oi : -1) ? { strike: r.strike, oi: r[side] ? r[side].oi || 0 : 0 } : a), null);
  const atm = withOI.length ? withOI.reduce((a, r) => (Math.abs(r.strike - spot) < Math.abs(a.strike - spot) ? r : a)).strike : null;
  return { ceOI, peOI, pcr, maxPain, resistance: top('ce'), support: top('pe'), atm };
}

module.exports = { summarize };
