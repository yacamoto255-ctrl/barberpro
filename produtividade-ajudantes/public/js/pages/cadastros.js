// CADASTROS AUXILIARES: atividades, regras de produtividade, praças, conferentes, turnos e equipes.
import { api } from '../api.js';
import { getMeta, hasRole } from '../app.js';
import { html, mount, $, table, modal, formFields, readForm, toast, options, num, confirmDialog } from '../ui.js';

const yes = v => (v ? html`<span class="badge b-ok">Sim</span>` : html`<span class="badge b-muted">Não</span>`);
const act = v => (v ? html`<span class="badge b-ok">ATIVO</span>` : html`<span class="badge b-muted">INATIVO</span>`);

export default async function (root) {
  const isAdmin = hasRole('ADMIN');
  let rules = await api.get('/rules');
  const meta = await getMeta(true);
  const methodLabel = m => meta.methods[m] || m;

  const TABS = {
    activity_types: {
      title: 'Atividades', path: '/activity-types', canWrite: isAdmin,
      help: 'Cada atividade usa uma regra de produtividade (rateio). Alterar a regra vale para novas execuções; o histórico mantém a regra da época (use "Recalcular" no Histórico, se necessário).',
      cols: [
        { label: 'Ordem', key: 'sort_order' }, { label: 'Código', key: 'code' },
        { label: 'Nome', render: r => html`<span class="dot" data-bg="${r.color}"></span><strong>${r.name}</strong>` },
        { label: 'Descrição', key: 'description' }, { label: 'Exige praça', render: r => yes(r.requires_square) },
        { label: 'Regra', render: r => html`${r.rule_name}<div class="small muted">${methodLabel(r.rule_method)} • fator ${num(r.weight_factor)}</div>` },
        { label: 'Status', render: r => act(r.active) },
      ],
      fields: () => [
        { name: 'code', label: 'Código', required: true, maxlength: 30 }, { name: 'name', label: 'Nome', required: true, maxlength: 60 },
        { name: 'description', label: 'Descrição', type: 'textarea', full: true },
        { name: 'rule_id', label: 'Regra de produtividade', type: 'select', numeric: true, required: true, options: options(rules.filter(r => r.active), r => `${r.name} (${methodLabel(r.method)})`) },
        { name: 'color', label: 'Cor', type: 'color', default: '#1f6feb' }, { name: 'sort_order', label: 'Ordem', type: 'number', step: '1', min: 0 },
        { name: 'requires_square', label: 'Exige praça de destino', type: 'checkbox' }, { name: 'active', label: 'Ativa', type: 'checkbox', default: 1 },
      ],
    },
    rules: {
      title: 'Regras de produtividade', path: '/rules', canWrite: isAdmin,
      help: 'RATEIO_IGUAL: peso × fator ÷ nº de ajudantes. PROPORCIONAL_TEMPO: divide conforme o tempo de cada um. CREDITO_INTEGRAL: cada ajudante recebe peso × fator (soma pode passar do peso real). Fator 0,5 = conta metade do peso.',
      cols: [
        { label: 'Nome', render: r => html`<strong>${r.name}</strong>` }, { label: 'Método', render: r => methodLabel(r.method) },
        { label: 'Fator peso', num: true, render: r => num(r.weight_factor) }, { label: 'Fator volumes', num: true, render: r => num(r.volume_factor) },
        { label: 'Descrição', key: 'description' }, { label: 'Status', render: r => act(r.active) },
      ],
      fields: () => [
        { name: 'name', label: 'Nome', required: true, maxlength: 80 },
        { name: 'method', label: 'Método', type: 'select', required: true, options: Object.entries(meta.methods).map(([k, v]) => ({ value: k, label: v })) },
        { name: 'weight_factor', label: 'Fator de peso', type: 'number', step: '0.01', min: 0, max: 10, default: 1 },
        { name: 'volume_factor', label: 'Fator de volumes', type: 'number', step: '0.01', min: 0, max: 10, default: 1 },
        { name: 'description', label: 'Descrição', type: 'textarea', full: true }, { name: 'active', label: 'Ativa', type: 'checkbox', default: 1 },
      ],
    },
    squares: {
      title: 'Praças', path: '/squares', canWrite: true,
      cols: [{ label: 'Código', render: r => html`<strong>${r.code}</strong>` }, { label: 'Nome', key: 'name' }, { label: 'ID externo', key: 'external_id' }, { label: 'Status', render: r => act(r.active) }],
      fields: () => [{ name: 'code', label: 'Código', required: true, maxlength: 20 }, { name: 'name', label: 'Nome', required: true, maxlength: 80 }, { name: 'active', label: 'Ativa', type: 'checkbox', default: 1 }],
    },
    checkers: {
      title: 'Conferentes', path: '/checkers', canWrite: true,
      help: 'A produtividade dos conferentes continua no sistema atual; aqui o cadastro serve para relacionar cargas e filtrar indicadores.',
      cols: [{ label: 'Nome', render: r => html`<strong>${r.name}</strong>` }, { label: 'Matrícula', key: 'registration' }, { label: 'ID externo', key: 'external_id' }, { label: 'Status', render: r => act(r.active) }],
      fields: () => [{ name: 'name', label: 'Nome', required: true, maxlength: 100 }, { name: 'registration', label: 'Matrícula', maxlength: 30 }, { name: 'active', label: 'Ativo', type: 'checkbox', default: 1 }],
    },
    shifts: {
      title: 'Turnos', path: '/shifts', canWrite: true,
      cols: [{ label: 'Nome', render: r => html`<strong>${r.name}</strong>` }, { label: 'Início', key: 'start_time' }, { label: 'Fim', key: 'end_time' }, { label: 'Status', render: r => act(r.active) }],
      fields: () => [{ name: 'name', label: 'Nome', required: true, maxlength: 40 }, { name: 'start_time', label: 'Início', type: 'time', required: true }, { name: 'end_time', label: 'Fim', type: 'time', required: true }, { name: 'active', label: 'Ativo', type: 'checkbox', default: 1 }],
    },
    teams: {
      title: 'Equipes', path: '/teams', canWrite: true,
      cols: [{ label: 'Nome', render: r => html`<strong>${r.name}</strong>` }, { label: 'Status', render: r => act(r.active) }],
      fields: () => [{ name: 'name', label: 'Nome', required: true, maxlength: 60 }, { name: 'active', label: 'Ativa', type: 'checkbox', default: 1 }],
    },
  };

  let tab = 'activity_types';
  let rows = [];
  mount(root, html`
    <div class="page-head"><div><h1>Atividades e Tabelas</h1><p class="muted">Cadastros de apoio ao apontamento.</p></div></div>
    <div class="chips mb" id="tabs">${Object.entries(TABS).map(([k, t]) => html`<button class="chip" data-tab="${k}">${t.title}</button>`)}</div>
    <div class="card" id="body"></div>`);

  async function load() {
    const t = TABS[tab];
    root.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('sel', b.dataset.tab === tab));
    rows = await api.get(t.path);
    if (tab === 'rules') rules = rows;
    mount($('#body', root), html`
      <div class="card-title"><h2>${t.title}</h2>${t.canWrite ? html`<button class="btn-primary" data-new>+ Novo</button>` : html`<span class="muted small">Somente leitura para o seu perfil</span>`}</div>
      ${t.help ? html`<div class="note mb">${t.help}</div>` : ''}
      ${table([...t.cols, ...(t.canWrite ? [{ label: '', render: r => html`<div class="row nowrap"><button class="btn-sm" data-edit="${r.id}">Editar</button><button class="btn-sm" data-toggle="${r.id}">${r.active ? 'Inativar' : 'Ativar'}</button></div>` }] : [])], rows)}`);
  }

  function edit(r) {
    const t = TABS[tab];
    const fs = t.fields();
    modal({
      title: `${r ? 'Editar' : 'Novo'} — ${t.title}`,
      body: formFields(fs, r || {}),
      actions: [{ label: 'Cancelar' }, { label: 'Salvar', cls: 'btn-primary', onClick: async b => {
        const d = readForm(b, fs);
        if (r) await api.patch(`${t.path}/${r.id}`, d); else await api.post(t.path, d);
        toast('Salvo.', 'ok'); await getMeta(true); load();
      } }],
    });
  }

  root.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tab) { tab = b.dataset.tab; return load(); }
    if (b.hasAttribute('data-new')) return edit(null);
    const r = rows.find(x => x.id === Number(b.dataset.edit || b.dataset.toggle));
    if (b.dataset.edit) return edit(r);
    if (b.dataset.toggle) {
      if (!(await confirmDialog(`${r.active ? 'Inativar' : 'Ativar'} "${r.name || r.code}"?`))) return;
      try { await api.patch(`${TABS[tab].path}/${r.id}`, { active: r.active ? 0 : 1 }); toast('Atualizado.', 'ok'); await getMeta(true); load(); }
      catch (err) { toast(err.message, 'err', 5000); }
    }
  });
  await load();
}
