// Barra de filtros compartilhada (dashboard, ranking, relatórios, histórico).
import { api } from './api.js';
import { getMeta } from './app.js';
import { html, mount, $, addDays, options } from './ui.js';

let helpersCache = null;

/**
 * Monta os filtros em `el` e chama onChange(filtros) ao aplicar.
 * opts: { extra: [campos extras], search: bool, status: bool }
 */
export async function filterBar(el, onChange, opts = {}) {
  const meta = await getMeta();
  if (!helpersCache) helpersCache = await api.get('/helpers').catch(() => []);
  const today = meta.today;
  const sel = (name, label, list) => html`<div class="field"><label for="flt_${name}">${label}</label>
    <select id="flt_${name}" name="${name}"><option value="">Todos</option>${list.map(o => html`<option value="${o.value}">${o.label}</option>`)}</select></div>`;
  mount(el, html`<form class="card filters no-print" id="flt-form">
    <div class="field"><label for="flt_period">Período</label>
      <select id="flt_period" name="period">
        <option value="today">Hoje</option><option value="yesterday">Ontem</option>
        <option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option>
        <option value="month">Mês atual</option><option value="custom">Personalizado</option>
      </select></div>
    <div class="field"><label for="flt_from">De</label><input type="date" id="flt_from" name="date_from" value="${today}"></div>
    <div class="field"><label for="flt_to">Até</label><input type="date" id="flt_to" name="date_to" value="${today}"></div>
    ${sel('shift_id', 'Turno', options(meta.shifts))}
    ${sel('team_id', 'Equipe', options(meta.teams))}
    ${sel('helper_id', 'Ajudante', options(helpersCache, h => `${h.barcode} — ${h.name}`))}
    ${sel('activity_type_id', 'Atividade', options(meta.activity_types))}
    ${sel('square_id', 'Praça', options(meta.squares, s => `${s.code} — ${s.name}`))}
    ${sel('checker_id', 'Conferente', options(meta.checkers))}
    ${opts.status ? sel('status', 'Situação', [{ value: 'ATIVO', label: 'Em andamento' }, { value: 'FINALIZADO', label: 'Finalizado' }, { value: 'CANCELADO', label: 'Cancelado' }]) : ''}
    ${opts.search ? html`<div class="field"><label for="flt_q">Pesquisar</label><input id="flt_q" name="q" placeholder="Nome, código ou carga" maxlength="60"></div>` : ''}
    <div class="field"><button class="btn-primary" type="submit">Aplicar filtros</button></div>
  </form>`);

  const form = $('#flt-form', el);
  const from = $('#flt_from', form), to = $('#flt_to', form), period = $('#flt_period', form);
  period.addEventListener('change', () => {
    const v = period.value;
    if (v === 'today') { from.value = today; to.value = today; }
    else if (v === 'yesterday') { from.value = addDays(today, -1); to.value = from.value; }
    else if (v === '7') { from.value = addDays(today, -6); to.value = today; }
    else if (v === '30') { from.value = addDays(today, -29); to.value = today; }
    else if (v === 'month') { from.value = today.slice(0, 8) + '01'; to.value = today; }
    if (v !== 'custom') submit();
  });
  [from, to].forEach(i => i.addEventListener('change', () => { period.value = 'custom'; }));
  form.querySelectorAll('select:not(#flt_period)').forEach(s => s.addEventListener('change', submit));

  function values() {
    const out = {};
    new FormData(form).forEach((v, k) => { if (k !== 'period' && v !== '') out[k] = v; });
    return out;
  }
  function submit(e) {
    e?.preventDefault?.();
    if (from.value && to.value && to.value < from.value) { to.value = from.value; }
    onChange(values());
  }
  form.addEventListener('submit', submit);
  return { values, submit, set(k, v) { const i = form.querySelector(`[name="${k}"]`); if (i) i.value = v; } };
}
