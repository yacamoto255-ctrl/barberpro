// USUÁRIOS (somente ADMIN). "Recuperação de senha" no MVP = redefinição pelo administrador.
import { api } from '../api.js';
import { html, mount, $, table, modal, formFields, readForm, toast, dateTimeBr } from '../ui.js';

const ROLES = [{ value: 'ADMIN', label: 'ADMIN — acesso total' }, { value: 'GESTOR', label: 'GESTOR — dashboard, relatórios, cadastros' }, { value: 'OPERADOR', label: 'OPERADOR — apontamento' }];

export default async function (root) {
  mount(root, html`<div class="page-head"><div><h1>Usuários</h1><p class="muted">Quem acessa o sistema. Ajudantes não são usuários — eles são identificados pelo crachá.</p></div>
    <button class="btn-primary" id="new">+ Novo usuário</button></div><div class="card" id="body"></div>`);
  let rows = [];
  async function load() {
    rows = await api.get('/users');
    mount($('#body', root), table([
      { label: 'Nome', render: r => html`<strong>${r.name}</strong>` }, { label: 'E-mail', key: 'email' },
      { label: 'Perfil', render: r => html`<span class="badge b-info">${r.role}</span>` },
      { label: 'Status', render: r => (r.active ? html`<span class="badge b-ok">ATIVO</span>` : html`<span class="badge b-muted">INATIVO</span>`) },
      { label: 'Último acesso', render: r => dateTimeBr(r.last_login_at) },
      { label: '', render: r => html`<div class="row nowrap"><button class="btn-sm" data-edit="${r.id}">Editar</button><button class="btn-sm" data-pw="${r.id}">Redefinir senha</button></div>` },
    ], rows));
  }
  const base = [
    { name: 'name', label: 'Nome', required: true, maxlength: 100 },
    { name: 'email', label: 'E-mail', type: 'email', required: true, maxlength: 120 },
    { name: 'role', label: 'Perfil', type: 'select', required: true, options: ROLES },
    { name: 'active', label: 'Ativo', type: 'checkbox', default: 1 },
  ];
  const pwField = { name: 'password', label: 'Senha inicial (mín. 8, letras e números)', type: 'password', required: true, full: true };
  function edit(u) {
    const fs = u ? base : [...base, pwField];
    modal({
      title: u ? `Editar ${u.name}` : 'Novo usuário', body: formFields(fs, u || {}),
      actions: [{ label: 'Cancelar' }, { label: 'Salvar', cls: 'btn-primary', onClick: async b => {
        const d = readForm(b, fs);
        if (u) await api.patch(`/users/${u.id}`, d); else await api.post('/users', d);
        toast('Usuário salvo.', 'ok'); load();
      } }],
    });
  }
  function resetPw(u) {
    const fs = [{ ...pwField, label: 'Nova senha (mín. 8, letras e números)' }];
    modal({
      title: `Redefinir senha — ${u.name}`, body: html`<p class="muted">As sessões abertas desse usuário serão encerradas.</p>${formFields(fs)}`,
      actions: [{ label: 'Cancelar' }, { label: 'Redefinir', cls: 'btn-primary', onClick: async b => {
        await api.post(`/users/${u.id}/reset-password`, readForm(b, fs)); toast('Senha redefinida.', 'ok');
      } }],
    });
  }
  root.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'new') return edit(null);
    const u = rows.find(r => r.id === Number(b.dataset.edit || b.dataset.pw));
    if (b.dataset.edit) edit(u);
    if (b.dataset.pw) resetPw(u);
  });
  await load();
}
