// CARGAS — cadastro manual no MVP. Integração futura: POST /api/integration/loads (TMS/ERP).
import { api } from '../api.js';
import { getMeta } from '../app.js';
import { html, mount, $, table, statusBadge, modal, formFields, readForm, toast, options, dateBr, kg, int, num, dur, hhmm, confirmDialog, debounce } from '../ui.js';

export default async function (root) {
  const meta = await getMeta();
  mount(root, html`
    <div class="page-head"><div><h1>Cargas</h1><p class="muted">Cargas de demonstração/manuais. Na integração, virão do sistema da transportadora.</p></div>
      <button class="btn-primary" id="new">+ Nova carga</button></div>
    <form class="card filters" id="f">
      <div class="field"><label for="l_q">Número</label><input id="l_q" name="q" maxlength="30"></div>
      <div class="field"><label for="l_st">Status</label><select id="l_st" name="status"><option value="">Todos</option><option>ABERTA</option><option>CONCLUIDA</option><option>CANCELADA</option></select></div>
      <div class="field"><label for="l_from">Data de</label><input type="date" id="l_from" name="date_from"></div>
      <div class="field"><label for="l_to">até</label><input type="date" id="l_to" name="date_to"></div>
    </form>
    <div class="card mt" id="body"></div>`);
  const form = $('#f', root);
  let rows = [];
  async function load() {
    const params = Object.fromEntries([...new FormData(form)].filter(([, v]) => v));
    rows = await api.get('/loads', params);
    mount($('#body', root), table([
      { label: 'Carga', render: r => html`<strong>${r.load_number}</strong>` },
      { label: 'Data', render: r => dateBr(r.load_date) },
      { label: 'Peso', num: true, render: r => kg(r.weight_kg) },
      { label: 'Volumes', num: true, render: r => int(r.volumes) },
      { label: 'Conferente', key: 'checker_name' },
      { label: 'Praça', render: r => r.square_code ? `Praça ${r.square_code}` : '' },
      { label: 'Ajudantes', num: true, render: r => html`${int(r.helpers_count)}${r.active_count ? html` <span class="badge b-warn">${r.active_count} ativo(s)</span>` : ''}` },
      { label: 'Origem', key: 'source' },
      { label: 'Status', render: r => statusBadge(r.status) },
      { label: '', render: r => html`<div class="row nowrap"><button class="btn-sm" data-view="${r.id}">Detalhes</button><button class="btn-sm" data-edit="${r.id}">Editar</button><button class="btn-sm btn-ghost" data-del="${r.id}" title="Excluir">🗑</button></div>` },
    ], rows));
  }

  const fs = [
    { name: 'load_number', label: 'Número da carga', required: true, maxlength: 30 },
    { name: 'load_date', label: 'Data', type: 'date', required: true },
    { name: 'weight_kg', label: 'Peso (kg)', type: 'number', required: true, step: '0.01', min: 0 },
    { name: 'volumes', label: 'Volumes', type: 'number', required: true, step: '1', min: 0 },
    { name: 'checker_id', label: 'Conferente', type: 'select', numeric: true, options: options(meta.checkers) },
    { name: 'square_id', label: 'Praça de destino', type: 'select', numeric: true, options: options(meta.squares, s => `${s.code} — ${s.name}`) },
    { name: 'status', label: 'Status', type: 'select', placeholder: false, options: ['ABERTA', 'CONCLUIDA', 'CANCELADA'].map(v => ({ value: v, label: v })) },
    { name: 'notes', label: 'Observações', type: 'textarea', full: true },
    { name: 'reason', label: 'Motivo da alteração (obrigatório se mudar peso/volumes de carga com atividades)', type: 'textarea', full: true },
  ];

  function edit(l) {
    const f = l ? fs : fs.filter(x => x.name !== 'reason');
    modal({
      title: l ? `Editar carga ${l.load_number}` : 'Nova carga',
      body: formFields(f, l || { load_date: meta.today, status: 'ABERTA' }),
      actions: [{ label: 'Cancelar' }, { label: 'Salvar', cls: 'btn-primary', onClick: async b => {
        const d = readForm(b, f);
        if (l) await api.patch(`/loads/${l.id}`, d); else await api.post('/loads', d);
        toast('Carga salva.', 'ok'); load();
      } }],
    });
  }

  async function view(l) {
    const acts = await api.get(`/loads/${l.id}/activities`);
    modal({
      title: `Carga ${l.load_number} — ${kg(l.weight_kg)} • ${int(l.volumes)} volumes`, wide: true,
      body: html`<p class="muted">Conferente: ${l.checker_name || '—'} • Praça: ${l.square_code || '—'} • ${int(l.helpers_count)} ajudante(s) participaram</p>
        ${acts.length ? acts.map(a => html`<div class="card mb">
          <div class="row between"><div><span class="dot" data-bg="${a.activity_type_color}"></span><strong>${a.activity_type_name}</strong>${a.square_code ? ` • Praça ${a.square_code}` : ''} ${statusBadge(a.status)}</div>
          <span class="small muted">${hhmm(a.started_at)}–${hhmm(a.ended_at)} • ref. ${kg(a.reference_weight_kg)} / ${int(a.reference_volumes)} vol. • ${a.rule.name}</span></div>
          ${table([
            { label: 'Ajudante', render: p => `${p.helper_barcode} — ${p.helper_name}` },
            { label: 'Início', render: p => hhmm(p.joined_at) }, { label: 'Fim', render: p => hhmm(p.left_at) },
            { label: 'Duração', render: p => dur(p.duration_seconds) }, { label: 'Situação', render: p => statusBadge(p.status) },
          ], a.participants)}
          ${a.allocations.length ? html`<p class="small mt"><strong>${a.status === 'EM_ANDAMENTO' ? 'Rateio (prévia)' : 'Rateio'}</strong> entre ${a.allocations.length} ajudante(s): ${a.allocations.map(x => html`<span class="badge b-info">${a.participants.find(p => p.helper_id === x.helper_id)?.helper_name}: ${num(x.allocated_weight_kg)} kg • ${num(x.allocated_volumes)} vol.</span> `)}</p>` : ''}
        </div>`) : html`<div class="empty">Nenhuma atividade registrada.</div>`}`,
      actions: [{ label: 'Fechar' }],
    });
  }

  root.addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'new') return edit(null);
    const l = rows.find(r => r.id === Number(t.dataset.edit || t.dataset.view || t.dataset.del));
    if (t.dataset.edit) return edit(l);
    if (t.dataset.view) return view(l);
    if (t.dataset.del) {
      if (!(await confirmDialog(`Excluir a carga ${l.load_number}? Só é possível se não houver atividades.`, { danger: true, okLabel: 'Excluir' }))) return;
      try { await api.del(`/loads/${l.id}`); toast('Carga excluída.', 'ok'); load(); } catch (err) { toast(err.message, 'err', 5000); }
    }
  });
  form.addEventListener('change', load);
  form.addEventListener('submit', e => { e.preventDefault(); load(); });
  $('#l_q', root).addEventListener('input', debounce(load, 300));
  await load();
}
