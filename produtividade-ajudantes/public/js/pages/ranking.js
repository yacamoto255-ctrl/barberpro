// RANKING — nunca exibido sozinho: todos os indicadores aparecem juntos.
import { api } from '../api.js';
import { filterBar } from '../filters.js';
import { html, mount, $, num, int, dur, table } from '../ui.js';

const METRICS = { kg: 'Kg atribuídos', volumes: 'Volumes', loads: 'Cargas', activities: 'Atividades', kg_per_hour: 'Kg/hora', volumes_per_hour: 'Volumes/hora' };

export default async function (root) {
  mount(root, html`
    <div class="page-head"><div><h1>Ranking de Produtividade</h1><p class="muted">Escolha o indicador de ordenação.</p></div>
      <div class="field"><label for="metric">Indicador</label><select id="metric">${Object.entries(METRICS).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></div></div>
    <div id="flt"></div>
    <div class="note warn mt">O ranking <strong>não deve ser usado como único indicador de desempenho</strong>. Tipo de atividade, peso das cargas do dia,
      tempo apontado e trabalho em equipe influenciam os números. Kg/hora com pouco tempo apontado pode distorcer a comparação.</div>
    <div class="card mt" id="body"></div>`);
  let filters = {};
  const metricSel = $('#metric', root);
  async function load() {
    const d = await api.get('/dashboard/ranking', { ...filters, metric: metricSel.value });
    const m = metricSel.value;
    const max = Math.max(1, ...d.rows.map(r => r[m] || 0));
    const fmt = v => (['loads', 'activities'].includes(m) ? int(v) : num(v, m.endsWith('hour') ? 1 : 2));
    mount($('#body', root), table([
      { label: '#', render: r => html`<span class="rank-pos rank-${r.position}">${r.position}º</span>` },
      { label: 'Ajudante', render: r => html`<strong>${r.helper_name}</strong> <span class="muted small">${r.helper_barcode}</span>` },
      { label: METRICS[m], render: r => html`<div class="rank-bar"><div class="bar-track grow"><div class="bar-fill" data-w="${Math.round(((r[m] || 0) / max) * 1000) / 10}"></div></div><strong class="num">${fmt(r[m])}</strong></div>` },
      { label: 'Kg', num: true, render: r => num(r.kg, 0) },
      { label: 'Volumes', num: true, render: r => num(r.volumes, 0) },
      { label: 'Cargas', num: true, render: r => int(r.loads) },
      { label: 'Ativid.', num: true, render: r => int(r.activities) },
      { label: 'Tempo', num: true, render: r => dur(r.seconds) },
      { label: 'Kg/h', num: true, render: r => num(r.kg_per_hour, 0) },
      { label: 'Vol./h', num: true, render: r => num(r.volumes_per_hour, 1) },
    ], d.rows, { empty: 'Sem apontamentos finalizados no período.' }));
  }
  await filterBar($('#flt', root), f => { filters = f; load(); });
  metricSel.addEventListener('change', load);
  await load();
}
