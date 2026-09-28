// MINHA CONTA — alteração de senha.
import { api, setSession, getSession } from '../api.js';
import { html, mount, $, formFields, readForm, showFormError, toast } from '../ui.js';

export default async function (root) {
  const u = getSession().user;
  const fs = [
    { name: 'current_password', label: 'Senha atual', type: 'password', required: true, full: true },
    { name: 'new_password', label: 'Nova senha (mín. 8, letras e números)', type: 'password', required: true },
    { name: 'confirm', label: 'Confirme a nova senha', type: 'password', required: true },
  ];
  mount(root, html`<div class="page-head"><div><h1>Minha conta</h1><p class="muted">${u.name} • ${u.email} • ${u.role}</p></div></div>
    <form class="card" id="pw"><h2>Alterar senha</h2>${formFields(fs)}<button class="btn-primary" type="submit">Alterar senha</button></form>`);
  $('#pw', root).addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.currentTarget;
    const d = readForm(f, fs);
    if (d.new_password !== d.confirm) return showFormError(f, { message: 'A confirmação não confere com a nova senha.' });
    try {
      const r = await api.post('/auth/change-password', { current_password: d.current_password, new_password: d.new_password });
      setSession(r); f.reset(); toast('Senha alterada. Outras sessões foram encerradas.', 'ok');
    } catch (err) { showFormError(f, err); }
  });
}
