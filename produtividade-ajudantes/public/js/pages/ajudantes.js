// CADASTRO DE AJUDANTES — código de barras único = identificação do ajudante.
import { api } from '../api.js';
import { getMeta, hasRole } from '../app.js';
import { html, mount, $, table, statusBadge, modal, formFields, readForm, toast, options, dateBr, confirmDialog, debounce } from '../ui.js';

export default async function (root) {
  const meta = await getMeta();
  mount(root, html`
    <div class="page-head"><div><h1>Cadastro de Ajudantes</h1><p class="muted">O código de barras identifica exclusivamente o ajudante (não é carga, atividade, peso nem praça).</p></div>
      <div class="row"><button id="badges">🖨 Imprimir crachás</button><button class="btn-primary" id="new">+ Novo ajudante</button></div></div>
    <form class="card filters" id="f">
      <div class="field"><label for="h_q">Pesquisar</label><input id="h_q" name="q" placeholder="Nome, código ou matrícula" maxlength="60"></div>
      <div class="field"><label for="h_st">Status</label><select id="h_st" name="status"><option value="">Todos</option><option>ATIVO</option><option>INATIVO</option></select></div>
      <div class="field"><label for="h_sh">Turno</label><select id="h_sh" name="shift_id"><option value="">Todos</option>${options(meta.shifts).map(o => html`<option value="${o.value}">${o.label}</option>`)}</select></div>
      <div class="field"><label for="h_tm">Equipe</label><select id="h_tm" name="team_id"><option value="">Todas</option>${options(meta.teams).map(o => html`<option value="${o.value}">${o.label}</option>`)}</select></div>
    </form>
    <div class="card mt" id="body"></div>`);
  const form = $('#f', root);
  let rows = [];
  async function load() {
    const params = Object.fromEntries([...new FormData(form)].filter(([, v]) => v));
    rows = await api.get('/helpers', params);
    mount($('#body', root), html`<div class="muted small mb">${rows.length} ajudante(s)</div>${table([
      { label: 'Código', render: r => html`<strong>${r.barcode}</strong>` },
      { label: 'Nome', key: 'name' },
      { label: 'Matrícula', key: 'registration' },
      { label: 'Setor', key: 'sector' },
      { label: 'Turno', key: 'shift_name' },
      { label: 'Equipe', key: 'team_name' },
      { label: 'Admissão', render: r => dateBr(r.admission_date) },
      { label: 'Status', render: r => statusBadge(r.status) },
      { label: '', render: r => html`<div class="row nowrap">
        <button class="btn-sm" data-edit="${r.id}">Editar</button>
        <button class="btn-sm" data-toggle="${r.id}">${r.status === 'ATIVO' ? 'Inativar' : 'Ativar'}</button>
        <button class="btn-sm btn-ghost" data-badge="${r.id}" title="Crachá">🖨</button>
        ${hasRole('ADMIN') ? html`<button class="btn-sm btn-ghost" data-del="${r.id}" title="Excluir (somente sem apontamentos)">🗑</button>` : ''}</div>` },
    ], rows)}`);
  }

  const fields = (sectors) => [
    { name: 'barcode', label: 'Código de barras', required: true, maxlength: 32, hint: 'Único por ajudante. Use "Gerar código" para o próximo número livre.' },
    { name: 'registration', label: 'Matrícula', maxlength: 30 },
    { name: 'name', label: 'Nome', required: true, maxlength: 100, full: true },
    { name: 'cpf', label: 'CPF (opcional)', maxlength: 14, placeholder: '000.000.000-00', inputmode: 'numeric' },
    { name: 'sector', label: 'Setor', maxlength: 60, placeholder: sectors.join(', ') },
    { name: 'shift_id', label: 'Turno', type: 'select', numeric: true, options: options(meta.shifts) },
    { name: 'team_id', label: 'Equipe', type: 'select', numeric: true, options: options(meta.teams) },
    { name: 'status', label: 'Status', type: 'select', placeholder: false, options: [{ value: 'ATIVO', label: 'ATIVO' }, { value: 'INATIVO', label: 'INATIVO' }] },
    { name: 'admission_date', label: 'Data de admissão', type: 'date' },
    { name: 'notes', label: 'Observações', type: 'textarea', full: true },
  ];

  async function edit(h) {
    const sectors = await api.get('/helpers/sectors').catch(() => []);
    const fs = fields(sectors);
    modal({
      title: h ? `Editar ajudante — ${h.name}` : 'Novo ajudante',
      body: html`${h ? '' : html`<div class="row mb"><button type="button" class="btn-amber btn-sm" id="gen">⚙ Gerar código</button></div>`}${formFields(fs, h || { status: 'ATIVO' })}`,
      onMount: (b) => {
        const cpf = b.querySelector('[name=cpf]');
        cpf.addEventListener('input', () => {
          const d = cpf.value.replace(/\D/g, '').slice(0, 11);
          cpf.value = d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
        });
        b.querySelector('#gen')?.addEventListener('click', async () => { b.querySelector('[name=barcode]').value = (await api.get('/helpers/next-code')).code; });
      },
      actions: [{ label: 'Cancelar' }, { label: 'Salvar', cls: 'btn-primary', onClick: async b => {
        const data = readForm(b, fs);
        if (h) await api.patch(`/helpers/${h.id}`, data); else await api.post('/helpers', data);
        toast('Ajudante salvo.', 'ok'); load();
      } }],
    });
  }

  function printBadges(list) {
    if (!window.JsBarcode) { toast('Gerador de código de barras indisponível.', 'err'); return; }
    const imgs = list.map(h => {
      const c = document.createElement('canvas');
      try { window.JsBarcode(c, h.barcode, { format: 'CODE128', height: 70, displayValue: true, fontSize: 18, margin: 8 }); return c.toDataURL('image/png'); }
      catch { return ''; }
    });
    const m = modal({
      title: `Crachás (${list.length})`, wide: true,
      body: html`<p class="muted no-print">Código CODE128 — compatível com leitores USB/Bluetooth comuns.</p><div class="badges-print">${list.map((h, i) => html`
        <div class="badge-card"><div class="top">LogiPonto • AJUDANTE</div><div class="nm">${h.name}</div>
        <div class="small muted">${h.registration ? `Matrícula ${h.registration}` : ''} ${h.team_name ? `• ${h.team_name}` : ''}</div>
        <img alt="Código de barras ${h.barcode}" src="${imgs[i]}"></div>`)}</div>`,
      actions: [{ label: 'Fechar' }, { label: '🖨 Imprimir', cls: 'btn-primary', onClick: () => { document.body.classList.add('print-modal'); window.print(); return false; } }],
    });
    return m;
  }

  root.addEventListener('click', async e => {
    const t = e.target.closest('button');
    if (!t) return;
    const id = Number(t.dataset.edit || t.dataset.toggle || t.dataset.badge || t.dataset.del);
    const h = rows.find(r => r.id === id);
    if (t.id === 'new') return edit(null);
    if (t.id === 'badges') return printBadges(rows.filter(r => r.status === 'ATIVO'));
    if (t.dataset.edit) return edit(h);
    if (t.dataset.badge) return printBadges([h]);
    if (t.dataset.toggle) {
      const to = h.status === 'ATIVO' ? 'INATIVO' : 'ATIVO';
      if (!(await confirmDialog(`${to === 'INATIVO' ? 'Inativar' : 'Ativar'} ${h.name}? ${to === 'INATIVO' ? 'O código deixará de ser aceito no apontamento. O histórico é mantido.' : ''}`, { danger: to === 'INATIVO' }))) return;
      try { await api.patch(`/helpers/${h.id}`, { status: to }); toast(`${h.name}: ${to}.`, 'ok'); load(); } catch (err) { toast(err.message, 'err'); }
    }
    if (t.dataset.del) {
      if (!(await confirmDialog(`Excluir definitivamente ${h.name}? Só é permitido se não houver apontamentos.`, { danger: true, okLabel: 'Excluir' }))) return;
      try { await api.del(`/helpers/${h.id}`); toast('Ajudante excluído.', 'ok'); load(); } catch (err) { toast(err.message, 'err', 5000); }
    }
  });
  form.addEventListener('submit', e => { e.preventDefault(); load(); });
  form.addEventListener('change', load);
  $('#h_q', root).addEventListener('input', debounce(load, 300));
  await load();
}
