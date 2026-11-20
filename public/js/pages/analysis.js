(function () {
  const { $, esc, nf, pct, cls, labelCls, api } = App;
  const INDICES = [['NIFTY', 'Nifty 50'], ['BANKNIFTY', 'Bank Nifty'], ['SENSEX', 'Sensex']];
  let sym = (new URLSearchParams(location.search).get('s') || 'NIFTY').toUpperCase();
  if (!INDICES.some(([s]) => s === sym)) sym = 'NIFTY';

  App.init({ active: 'analysis', symbols: [] });
  App.tabs($('#phaseTabs'));
  const tag = (l) => `<span class="tag ${labelCls(l)}">${esc(l)}</span>`;

  $('#indexTabs').innerHTML = INDICES.map(([s, n]) => `<button type="button" role="tab" aria-selected="${s === sym}" data-s="${s}">${n}</button>`).join('');
  $('#indexTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.dataset.s === sym) return;
    sym = b.dataset.s; history.replaceState(null, '', `analysis.html?s=${sym}`);
    [...$('#indexTabs').children].forEach((x) => x.setAttribute('aria-selected', x.dataset.s === sym));
    loadIndex();
  });

  function drawAll(m) {
    if (!m) return;
    $('#allIdx').innerHTML = m.indices.map((p) => {
      const q = App.state.quotes[p.symbol] || p.quote;
      return `<tr><td class="l"><a class="sym" href="market.html?s=${p.symbol}">${esc(p.name)}</a></td><td class="num">${q ? nf(q.ltp) : '–'}</td><td class="num ${q ? cls(q.pct) : ''}">${q ? pct(q.pct) : '–'}</td>${p.conditions.map((c) => `<td class="l">${tag(c.label)} <span class="muted mono">${c.score ?? ''}</span></td>`).join('')}<td class="l">${tag(p.overall.label)}</td></tr>`;
    }).join('');
  }
  App.on('market', drawAll);
  drawAll(App.state.market);

  async function loadIndex() {
    try {
      const a = await api(`/api/index/${sym}`);
      $('#phasePre').innerHTML = Panels.phase(a, 'pre'); $('#phaseLive').innerHTML = Panels.phase(a, 'live'); $('#phasePost').innerHTML = Panels.phase(a, 'post');
      $('#levels').innerHTML = Panels.levels(a);
      $('#conds').innerHTML = a.conditions.map(Panels.condCard).join('');
      $('#asOf').textContent = `Updated ${App.istTime(Math.floor(a.asOf / 1000))} IST`;
    } catch (e) { $('#phasePre').innerHTML = `<p class="note err">${esc(e.message)}</p>`; }
  }
  loadIndex(); setInterval(loadIndex, 20000);

  async function loadHistory() {
    try {
      const { snapshots } = await api('/api/analysis/history');
      const rows = snapshots.slice().reverse();
      $('#hist').innerHTML = rows.length ? rows.map((s) => {
        const n = s.indices.NIFTY || {}, tf = s.timeframes || [];
        const o = s.outcome;
        return `<tr><td class="l">${esc(s.date)}</td><td class="l">${tag(s.overall)}</td>${[0, 1, 2].map((i) => `<td class="l">${tf[i] ? tag(tf[i].label) : '–'}</td>`).join('')}<td class="num">${nf(n.close)}</td><td class="num ${cls(n.pct)}">${pct(n.pct)}</td><td class="num ${o ? cls(o.nextPct) : ''}">${o ? pct(o.nextPct) : '–'}</td><td class="l">${o ? (o.hit ? '<span class="up">Yes</span>' : '<span class="down">No</span>') : '<span class="muted">pending</span>'}</td></tr>`;
      }).join('') : '<tr><td colspan="9" class="empty">No snapshots yet. Use "Save today\'s snapshot", or leave the server running past 15:35 IST on a trading day.</td></tr>';
      const judged = snapshots.filter((s) => s.outcome);
      const hits = judged.filter((s) => s.outcome.hit).length;
      $('#histSummary').textContent = judged.length ? `${hits} of ${judged.length} saved days matched the next session${judged.length < 30 ? ' (small sample, treat with caution)' : ''}.` : `${snapshots.length} snapshot(s) saved; a match is counted once the following day is saved.`;
    } catch (e) { $('#hist').innerHTML = `<tr><td colspan="9" class="note err">${esc(e.message)}</td></tr>`; }
  }
  loadHistory();

  $('#snapBtn').addEventListener('click', async () => {
    try { await api('/api/analysis/snapshot', { method: 'POST' }); App.toast("Today's snapshot saved", 'ok'); loadHistory(); }
    catch (e) { App.toast(e.message, 'err'); }
  });
})();
