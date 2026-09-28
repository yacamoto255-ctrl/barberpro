// AUDITORIA — registros somente-inserção (quem, quando, o quê, antes/depois).
import { api } from '../api.js';
import { html, mount, $, dateTimeBr, table } from '../ui.js';

const ENTITIES = { helpers: 'Ajudantes', loads: 'Cargas', activities: 'Execuções de atividade', activity_participants: 'Apontamentos', activity_types: 'Tipos de atividade', productivity_rules: 'Regras', users: 'Usuários', squares: 'Praças', checkers: 'Conferentes', shifts: 'Turnos', teams: 'Equipes' };
const ACTIONS = ['CRIAR', 'EDITAR', 'ATIVAR', 'INATIVAR', 'EXCLUIR', 'INICIAR', 'FINALIZAR', 'CANCELAR', 'CORRIGIR', 'RECALCULAR', 'LOGIN', 'LOGIN_FALHA', 'LOGOUT', 'ALTERAR_SENHA', 'REDEFINIR_SENHA'];

function pretty(json) {
  if (!json) return '';
  try { return html`<pre class="json">${JSON.stringify(JSON.parse(json), null, 1)}</pre>`; } catch { return json; }
}

export default async function (root) {
  mount(root, html`
    <div class="page-head"><div><h1>Auditoria</h1><p class="muted">Registro imutável de alterações importantes.</p></div></div>
    <form class="card filters" id="f">
      <div class="field"><label for="a_ent">Registro</label><select id="a_ent" name="entity"><option value="">Todos</option>${Object.entries(ENTITIES).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></div>
      <div class="field"><label for="a_act">Ação</label><select id="a_act" name="action"><option value="">Todas</option>${ACTIONS.map(a => html`<option>${a}</option>`)}</select></div>
      <div class="field"><label for="a_from">De</label><input type="date" id="a_from" name="date_from"></div>
      <div class="field"><label for="a_to">Até</label><input type="date" id="a_to" name="date_to"></div>
      <div class="field"><button class="btn-primary">Filtrar</button></div>
    </form>
    <div class="card mt"><div id="body"></div><div class="pager" id="pager"></div></div>`);
  let page = 1;
  const form = $('#f', root);
  async function load() {
    const params = Object.fromEntries([...new FormData(form)].filter(([, v]) => v));
    const d = await api.get('/audit', { ...params, page });
    mount($('#body', root), table([
      { label: 'Data/hora', render: r => dateTimeBr(r.created_at), cls: 'nowrap' },
      { label: 'Usuário', render: r => r.user_name || '—' },
      { label: 'Ação', render: r => html`<span class="badge b-info">${r.action}</span>` },
      { label: 'Registro', render: r => `${ENTITIES[r.entity] || r.entity} #${r.entity_id ?? ''}` },
      { label: 'Valor anterior', render: r => pretty(r.old_values) },
      { label: 'Novo valor', render: r => pretty(r.new_values) },
      { label: 'Motivo', key: 'reason' },
      { label: 'IP', key: 'ip' },
    ], d.rows));
    const pages = Math.max(1, Math.ceil(d.total / d.page_size));
    mount($('#pager', root), html`<span class="muted small">${d.total} registro(s)</span>
      <button class="btn-sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹</button><span class="small">${page}/${pages}</span>
      <button class="btn-sm" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>›</button>`);
  }
  form.addEventListener('submit', e => { e.preventDefault(); page = 1; load(); });
  root.addEventListener('click', e => { const p = e.target.closest('[data-page]'); if (p && !p.disabled) { page = Number(p.dataset.page); load(); } });
  await load();
}
