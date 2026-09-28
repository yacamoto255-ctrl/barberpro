// HISTÓRICO DE ATIVIDADES — todos os apontamentos (inclusive em andamento e cancelados).
import { api } from '../api.js';
import { filterBar } from '../filters.js';
import { hasRole } from '../app.js';
import { html, mount, $, num, dur, dateBr, hhmm, table, statusBadge, modal, formFields, readForm, reasonDialog, toast } from '../ui.js';

export default async function (root) {
  const mgmt = hasRole('ADMIN', 'GESTOR');
  mount(root, html`
    <div class="page-head"><div><h1>Histórico de Atividades</h1>
      <p class="muted">${mgmt ? 'Consulte, corrija horários ou cancele apontamentos (tudo fica registrado na auditoria).' : 'Apontamentos de hoje.'}</p></div></div>
    <div id="flt"></div>
    <div class="card mt"><div id="body"></div><div class="pager" id="pager"></div></div>`);
  let filters = {}; let page = 1;

  async function load() {
    const d = await api.get('/history', { ...filters, page, page_size: 50 });
    mount($('#body', root), table([
      { label: 'Data', render: r => dateBr(r.joined_at.slice(0, 10)) },
      { label: 'Início', render: r => hhmm(r.joined_at) },
      { label: 'Fim', render: r => hhmm(r.left_at) },
      { label: 'Ajudante', render: r => html`<strong>${r.helper_name}</strong>` },
      { label: 'Código', key: 'helper_barcode' },
      { label: 'Carga', key: 'load_number' },
      { label: 'Atividade', render: r => html`<span class="dot" data-bg="${r.activity_type_color}"></span>${r.activity_type_name}` },
      { label: 'Praça', render: r => r.square_code ? `Praça ${r.square_code}` : '' },
      { label: 'Peso carga', num: true, render: r => `${num(r.load_weight_kg, 0)} kg` },
      { label: 'Duração', num: true, render: r => dur(r.duration_seconds) },
      { label: 'Nº ajud.', num: true, render: r => r.participants_count ?? '' },
      { label: 'Peso atribuído', num: true, render: r => r.allocated_weight_kg != null ? `${num(r.allocated_weight_kg)} kg` : '—' },
      { label: 'Situação', render: r => html`${statusBadge(r.status)}${r.cancel_reason ? html`<div class="small muted">${r.cancel_reason}</div>` : ''}` },
      { label: 'Apontado por', key: 'started_by_name' },
      { label: '', render: r => html`<div class="row nowrap">
          ${mgmt && r.status === 'FINALIZADO' ? html`<button class="btn-sm" data-edit="${r.id}">Corrigir</button>` : ''}
          ${r.status !== 'CANCELADO' && (mgmt || r.status === 'ATIVO') ? html`<button class="btn-sm btn-ghost" data-cancel="${r.id}">Cancelar</button>` : ''}
          ${hasRole('ADMIN') && r.activity_status === 'FINALIZADA' ? html`<button class="btn-sm btn-ghost" data-recalc="${r.activity_id}" title="Reaplicar a regra atual">Recalcular</button>` : ''}
        </div>` },
    ], d.rows));
    const pages = Math.max(1, Math.ceil(d.total / d.page_size));
    mount($('#pager', root), html`<span class="muted small">${d.total} registro(s)</span>
      <button class="btn-sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹ Anterior</button>
      <span class="small">Página ${page} de ${pages}</span>
      <button class="btn-sm" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Próxima ›</button>`);
    root._rows = d.rows;
  }

  root.addEventListener('click', async e => {
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) { page = Number(pg.dataset.page); return load(); }
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const r = root._rows.find(x => x.id === Number(ed.dataset.edit));
      const fields = [
        { name: 'joined_at', label: 'Início', type: 'datetime', required: true },
        { name: 'left_at', label: 'Fim', type: 'datetime', required: true },
        { name: 'reason', label: 'Motivo da correção', type: 'textarea', required: true, full: true },
      ];
      modal({
        title: `Corrigir horário — ${r.helper_name} / carga ${r.load_number}`,
        body: html`<div class="note warn mb">A correção recalcula o tempo e o rateio da atividade e fica registrada na auditoria.</div>${formFields(fields, r)}`,
        actions: [{ label: 'Cancelar' }, { label: 'Salvar correção', cls: 'btn-primary', onClick: async b => {
          await api.patch(`/operations/participants/${r.id}`, readForm(b, fields)); toast('Horário corrigido e rateio recalculado.', 'ok'); load();
        } }],
      });
    }
    const c = e.target.closest('[data-cancel]');
    if (c) {
      const res = await reasonDialog('Cancelar apontamento', 'Motivo do cancelamento');
      if (!res) return;
      try { await api.post(`/operations/participants/${c.dataset.cancel}/cancel`, { reason: res.reason }); toast('Apontamento cancelado.', 'ok'); load(); }
      catch (err) { toast(err.message, 'err', 5000); }
    }
    const rc = e.target.closest('[data-recalc]');
    if (rc) {
      const res = await reasonDialog('Recalcular rateio com a regra atual', 'Motivo', html`<div class="note warn mb">A regra de produtividade vigente do tipo de atividade será reaplicada nesta execução. Os valores anteriores ficam na auditoria.</div>`);
      if (!res) return;
      try { await api.post(`/operations/activities/${rc.dataset.recalc}/recalculate`, { reason: res.reason }); toast('Rateio recalculado.', 'ok'); load(); }
      catch (err) { toast(err.message, 'err'); }
    }
  });

  if (mgmt) await filterBar($('#flt', root), f => { filters = f; page = 1; load(); }, { search: true, status: true });
  await load();
}
