// RELATÓRIOS exportáveis (CSV padrão Excel pt-BR e XLSX)
import { api } from '../api.js';
import { filterBar } from '../filters.js';
import { html, mount, $, num, int, dur, table, toast, dateBr } from '../ui.js';

export default async function (root) {
  mount(root, html`
    <div class="page-head"><div><h1>Relatórios</h1><p class="muted">Pré-visualize e exporte para Excel (XLSX) ou CSV.</p></div>
      <div class="row no-print">
        <div class="field"><label for="kind">Relatório</label><select id="kind"><option value="individual">Individual (por atividade)</option><option value="consolidated">Consolidado (por ajudante)</option></select></div>
        <button class="btn-amber" id="xlsx">⇩ Excel (XLSX)</button>
        <button id="csv">⇩ CSV</button>
      </div></div>
    <div id="flt"></div>
    <div class="note mt">Peso atribuído = peso de referência da atividade rateado entre os ajudantes pela regra vigente. Não representa peso carregado fisicamente por uma pessoa.</div>
    <div class="card mt"><div class="card-title"><h2 id="title"></h2><span class="muted small" id="count"></span></div><div id="body"></div></div>`);
  let filters = {};
  const kind = $('#kind', root);
  async function load() {
    const d = await api.get(`/reports/${kind.value}`, filters);
    $('#title', root).textContent = kind.value === 'individual' ? 'Relatório individual' : 'Relatório consolidado';
    $('#count', root).textContent = `${d.rows.length} linha(s) • ${dateBr(d.filters.date_from)} a ${dateBr(d.filters.date_to)}`;
    const rows = d.rows.slice(0, 500);
    const cols = kind.value === 'individual' ? [
      { label: 'Data', render: r => dateBr(r.date) }, { label: 'Ajudante', key: 'helper_name' }, { label: 'Código', key: 'helper_barcode' },
      { label: 'Carga', key: 'load_number' }, { label: 'Atividade', key: 'activity' }, { label: 'Praça', key: 'square' },
      { label: 'Peso carga', num: true, render: r => num(r.load_weight_kg) }, { label: 'Peso ref.', num: true, render: r => num(r.reference_weight_kg) },
      { label: 'Volumes', num: true, render: r => int(r.reference_volumes) },
      { label: 'Início', key: 'start' }, { label: 'Fim', key: 'end' }, { label: 'Duração', render: r => dur(r.duration_seconds) },
      { label: 'Nº ajud.', num: true, render: r => int(r.participants_count) },
      { label: 'Peso atribuído', num: true, render: r => html`<strong>${num(r.allocated_weight_kg)}</strong>` },
      { label: 'Vol. atrib.', num: true, render: r => num(r.allocated_volumes) },
      { label: 'Obs.', key: 'notes' },
    ] : [
      { label: 'Ajudante', key: 'helper_name' }, { label: 'Código', key: 'helper_barcode' },
      { label: 'Cargas', num: true, render: r => int(r.loads) }, { label: 'Volumes', num: true, render: r => num(r.volumes) },
      { label: 'Kg', num: true, render: r => html`<strong>${num(r.kg)}</strong>` }, { label: 'Atividades', num: true, render: r => int(r.activities) },
      { label: 'Tempo total', render: r => dur(r.seconds) }, { label: 'Kg/hora', num: true, render: r => num(r.kg_per_hour) },
      { label: 'Volumes/hora', num: true, render: r => num(r.volumes_per_hour) },
    ];
    mount($('#body', root), html`${table(cols, rows, { empty: 'Sem dados no período.' })}${d.rows.length > 500 ? html`<p class="muted small">Mostrando 500 de ${d.rows.length}. A exportação contém todas as linhas.</p>` : ''}`);
  }
  async function exp(format) {
    try { await api.download(`/reports/${kind.value}`, { ...filters, format }, `relatorio.${format}`); toast('Arquivo gerado.', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  }
  await filterBar($('#flt', root), f => { filters = f; load(); }, { search: true });
  kind.addEventListener('change', load);
  $('#xlsx', root).addEventListener('click', () => exp('xlsx'));
  $('#csv', root).addEventListener('click', () => exp('csv'));
  await load();
}
