// views/admin.js — equipe, configurações/backup, auditoria e minha conta
import { get, post, patch, put, del, api, download, auth } from '../api.js';
import {
  h, clear, toast, field, onSubmit, dialog, confirmDialog, formValues, showFieldErrors, fmt, table, pageHead,
} from '../ui.js';
import { session, render } from '../main.js';

/* ── Equipe da agência ─────────────────────────────────── */
function userDialog(user, reload) {
  const form = h('form', { class: 'form', novalidate: true },
    h('div', { class: 'row' },
      field({ label: 'Nome', name: 'name', required: true, value: user?.name || '', maxlength: 120 }),
      field({ label: 'E-mail', name: 'email', type: 'email', required: true, value: user?.email || '' })),
    h('div', { class: 'row' },
      field({ label: 'WhatsApp', name: 'phone', type: 'tel', value: user?.phone || '', hint: 'Usado para recuperar a senha.' }),
      field({ label: 'Perfil', name: 'role', type: 'select', value: user?.role || 'operator', options: [['operator', 'Operador'], ['admin', 'Administrador']] })),
    field({ label: user ? 'Nova senha (deixe vazio para manter)' : 'Senha', name: 'password', type: 'password', required: !user, autocomplete: 'new-password', hint: 'Mínimo 8 caracteres, com letras e números.' }),
    user ? field({ label: 'Ativo', name: 'active', type: 'checkbox', value: !!user.active }) : null,
    h('p', { class: 'small muted', text: 'Operador: sites, agenda, relatórios e notificações. Administrador: tudo, inclusive equipe, configurações, backup e auditoria.' }));
  return dialog({
    title: user ? `Editar ${user.name}` : 'Novo usuário', body: form,
    actions: [{ label: 'Cancelar', value: false }, { label: 'Salvar', class: 'primary', handler: async () => {
      const v = formValues(form);
      if (user && !v.password) delete v.password;
      try {
        if (user) await patch(`/users/${user.id}`, v); else await post('/users', v);
        toast('Usuário salvo.', 'ok'); reload(); return true;
      } catch (e) { if (!showFieldErrors(form, e)) toast(e.message, 'err'); return false; }
    } }],
  });
}

export async function usersView(root) {
  const { users } = await get('/users');
  const reload = () => usersView(root);
  clear(root).append(
    pageHead('Equipe da agência', { actions: [h('button', { class: 'btn primary', type: 'button', onclick: () => userDialog(null, reload) }, '+ Novo usuário')] }),
    table([
      { label: 'Nome', render: (u) => h('div', {}, h('strong', { text: u.name }), h('div', { class: 'small muted', text: u.email })) },
      { label: 'Perfil', render: (u) => fmt.role[u.role] },
      { label: 'Status', render: (u) => h('span', { class: `pill ${u.active ? 'on' : 'off'}`, text: u.active ? 'Ativo' : 'Inativo' }) },
      { label: 'Ações', render: (u) => h('div', { class: 'cell-actions' },
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => userDialog(u, reload) }, 'Editar'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => {
          try {
            const r = await post(`/users/${u.id}/reset-link`);
            const input = h('input', { readonly: true, value: r.url, 'aria-label': 'Link de redefinição' });
            await dialog({ title: 'Link de redefinição de senha', body: h('div', { class: 'field' }, h('p', { text: `Envie para ${u.name}. Vale por ${r.expires_in_minutes} minutos e só pode ser usado uma vez.` }), input),
              actions: [{ label: 'Copiar', class: 'primary', handler: async () => { try { await navigator.clipboard.writeText(r.url); toast('Link copiado.', 'ok'); } catch (_) { input.select(); } return false; } }, { label: 'Fechar' }] });
          } catch (e) { toast(e.message, 'err'); }
        } }, 'Link de senha'),
        u.id === session.user.id ? null : h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => {
          if (!(await confirmDialog('Excluir usuário', `Excluir ${u.name}? O histórico de auditoria é mantido.`, { danger: true, ok: 'Excluir' }))) return;
          try { await del(`/users/${u.id}`); toast('Usuário excluído.', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); }
        } }, 'Excluir')) },
    ], users),
  );
}

/* ── Configurações ─────────────────────────────────────── */
export async function settingsView(root) {
  const { settings: s } = await get('/settings');
  const reload = () => settingsView(root);

  const agency = h('form', { class: 'form card', novalidate: true },
    h('h2', { text: 'Agência' }),
    h('div', { class: 'row' },
      field({ label: 'Nome da agência', name: 'agency_name', required: true, value: s.agency_name, maxlength: 80, hint: 'Aparece no rodapé de todos os sites.' }),
      field({ label: 'Instagram da agência', name: 'agency_instagram', value: s.agency_instagram ? `@${s.agency_instagram}` : '', hint: 'Link do "Site por…" no rodapé.' })),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Salvar')));
  onSubmit(agency, async (v) => { await put('/settings', v); toast('Configurações salvas.', 'ok'); });

  const ai = h('form', { class: 'form card', novalidate: true },
    h('h2', { text: 'IA (Anthropic / Claude)' }),
    h('p', { class: 'muted small' }, 'Usada para criar tema e textos dos sites. Modelo: ', h('code', { class: 'k', text: s.ai_model }), '. Cada geração consome créditos da sua conta Anthropic.'),
    s.anthropic_key_from_env ? h('div', { class: 'alert info', text: 'Usando a chave definida na variável ANTHROPIC_API_KEY do servidor.' }) : null,
    field({ label: 'Chave da API', name: 'anthropic_api_key', type: 'password', value: s.anthropic_api_key, autocomplete: 'off', placeholder: 'sk-ant-…', hint: s.has_anthropic_key ? 'Chave salva (mascarada). Cole uma nova para trocar, ou apague o campo e salve para remover.' : 'Crie em console.anthropic.com → API Keys.' }),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Salvar chave')));
  onSubmit(ai, async (v) => { await put('/settings', { anthropic_api_key: v.anthropic_api_key }); toast('Chave salva.', 'ok'); reload(); });

  const testOut = h('div');
  const evo = h('form', { class: 'form card', novalidate: true },
    h('h2', { text: 'WhatsApp (Evolution API)' }),
    h('p', { class: 'muted small', text: 'Instância padrão usada para avisar os negócios e confirmar para os clientes. Cada site pode usar uma instância própria (aba Agendamento).' }),
    h('div', { class: 'row' },
      field({ label: 'URL do servidor', name: 'evolution_url', value: s.evolution_url, placeholder: 'https://evolution.seudominio.com' }),
      field({ label: 'Instância', name: 'evolution_instance', value: s.evolution_instance, maxlength: 80 }),
      field({ label: 'API key', name: 'evolution_apikey', type: 'password', value: s.evolution_apikey, autocomplete: 'off' })),
    field({ label: 'Número para mensagem de teste (opcional)', name: 'to', type: 'tel' }),
    testOut,
    h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Salvar'),
      h('button', { class: 'btn ghost', type: 'button', onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try {
          const to = evo.querySelector('[name="to"]').value.trim();
          const r = await post('/settings/test-whatsapp', to ? { to } : {});
          const ok = r.connection.ok;
          clear(testOut).append(h('div', { class: `alert ${ok ? 'ok' : 'err'}`, text: ok
            ? `Conectado (estado: ${r.connection.state}).${r.send ? ` Mensagem de teste: ${r.send.status === 'sent' ? 'enviada' : 'falhou — ' + (r.send.error || '')}` : ''}`
            : `Falha: ${r.connection.error}` }));
        } catch (err) { toast(err.message, 'err'); } finally { b.disabled = false; }
      } }, 'Testar conexão')));
  onSubmit(evo, async (v) => {
    const { to, ...rest } = v;
    await put('/settings', rest); toast('Evolution API salva.', 'ok');
  });

  // Backup
  const backups = h('div');
  async function loadBackups() {
    const { backups: list } = await get('/backups');
    clear(backups).append(table([
      { label: 'Arquivo', render: (b) => h('code', { class: 'k', text: b.name }) },
      { label: 'Tipo', render: (b) => ({ manual: 'Manual', auto: 'Automático', 'pre-restore': 'Antes de restaurar', upload: 'Enviado' }[b.kind] || b.kind) },
      { label: 'Tamanho', num: true, render: (b) => `${(b.size / 1024).toFixed(0)} KB` },
      { label: 'Criado em', render: (b) => new Date(b.created_at).toLocaleString('pt-BR') },
      { label: 'Ações', render: (b) => h('div', { class: 'cell-actions' },
        h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { try { await download(`/backups/${b.name}/download`, b.name); } catch (e) { toast(e.message, 'err'); } } }, 'Baixar'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => {
          if (!(await confirmDialog('Restaurar backup', `Substituir TODOS os dados atuais pelo backup ${b.name}? Uma cópia do estado atual é salva antes ("Antes de restaurar"). Talvez seja preciso entrar de novo.`, { danger: true, ok: 'Restaurar' }))) return;
          try {
            const r = await post(`/backups/${b.name}/restore`);
            toast(`Restaurado: ${r.counts.sites} site(s), ${r.counts.bookings} agendamento(s).`, 'ok');
            render();
          } catch (e) { toast(e.message, 'err'); }
        } }, 'Restaurar'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => {
          if (!(await confirmDialog('Excluir backup', `Excluir ${b.name}?`, { danger: true, ok: 'Excluir' }))) return;
          try { await del(`/backups/${b.name}`); toast('Backup excluído.', 'ok'); loadBackups(); } catch (e) { toast(e.message, 'err'); }
        } }, 'Excluir')) },
    ], list, { empty: 'Nenhum backup ainda.' }));
  }
  const uploadInput = h('input', { type: 'file', accept: '.db,application/octet-stream', hidden: true });
  uploadInput.addEventListener('change', async () => {
    const f = uploadInput.files[0]; uploadInput.value = '';
    if (!f) return;
    try { await api('POST', '/backups/upload', new Blob([await f.arrayBuffer()], { type: 'application/octet-stream' })); toast('Backup enviado e verificado.', 'ok'); loadBackups(); } catch (e) { toast(e.message, 'err'); }
  });

  const msgLog = h('div');
  async function loadLog() {
    const { messages } = await get('/settings/message-log');
    const label = { sent: 'Enviada', failed: 'Falhou', skipped: 'Não enviada', pending: 'Enviando' };
    clear(msgLog).append(table([
      { label: 'Quando', render: (m) => fmt.utc(m.created_at) },
      { label: 'Para', render: (m) => fmt.phone(m.recipient) },
      { label: 'Tipo', key: 'purpose' },
      { label: 'Status', render: (m) => `${label[m.status] || m.status}${m.attempts > 1 ? ` (${m.attempts} tentativas)` : ''}` },
      { label: 'Erro', render: (m) => (m.last_error ? h('span', { class: 'small muted', text: m.last_error }) : '') },
    ], messages, { empty: 'Nenhuma mensagem ainda.' }));
  }

  clear(root).append(
    pageHead('Configurações'),
    agency, ai, evo,
    h('div', { class: 'card' }, h('div', { class: 'page-head' }, h('h2', { text: 'Backup' }), h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'button', onclick: async () => { try { const r = await post('/backups'); toast(`Backup ${r.backup.name} criado.`, 'ok'); loadBackups(); } catch (e) { toast(e.message, 'err'); } } }, 'Fazer backup agora'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => uploadInput.click() }, 'Enviar arquivo de backup'), uploadInput)),
    h('p', { class: 'muted small', text: 'Backup automático a cada 24 h (configurável por BACKUP_INTERVAL_HOURS), mantendo os 14 mais recentes. Baixe cópias para fora do servidor com frequência.' }), backups),
    h('div', { class: 'card' }, h('div', { class: 'page-head' }, h('h2', { text: 'Mensagens de WhatsApp' }), h('button', { class: 'btn sm ghost', type: 'button', onclick: loadLog }, 'Atualizar')), msgLog),
  );
  await Promise.all([loadBackups(), loadLog()]);
}

/* ── Auditoria ─────────────────────────────────────────── */
export async function auditView(root) {
  const filters = h('form', { class: 'filters' },
    field({ label: 'Ação começa com', name: 'action', placeholder: 'auth., site., booking.…', maxlength: 60 }),
    field({ label: 'De', name: 'from', type: 'date' }), field({ label: 'Até', name: 'to', type: 'date' }),
    h('button', { class: 'btn', type: 'submit' }, 'Filtrar'));
  const out = h('div');
  let page = 1;
  async function load() {
    const q = new URLSearchParams(Object.entries(formValues(filters)).filter(([, v]) => v));
    q.set('page', page); q.set('limit', 100);
    const r = await get(`/audit?${q}`);
    const pages = Math.max(1, Math.ceil(r.total / 100));
    clear(out).append(
      table([
        { label: 'Quando', render: (l) => h('span', { class: 'nowrap', text: fmt.utc(l.created_at) }) },
        { label: 'Usuário', render: (l) => l.user_email || '—' },
        { label: 'Ação', render: (l) => h('code', { class: 'k', text: l.action }) },
        { label: 'Registro', render: (l) => (l.entity ? `${l.entity}${l.entity_id ? ' #' + l.entity_id : ''}` : '') },
        { label: 'Detalhes', render: (l) => (l.details ? h('span', { class: 'small muted', text: l.details.length > 140 ? l.details.slice(0, 140) + '…' : l.details, title: l.details }) : '') },
        { label: 'IP', key: 'ip' },
      ], r.logs, { empty: 'Nenhum registro.' }),
      h('div', { class: 'pager' },
        h('button', { class: 'btn sm ghost', type: 'button', disabled: page <= 1 ? true : null, onclick: () => { page--; load(); } }, '← Anterior'),
        h('span', { class: 'small', text: `Página ${page} de ${pages} · ${r.total} registros` }),
        h('button', { class: 'btn sm ghost', type: 'button', disabled: page >= pages ? true : null, onclick: () => { page++; load(); } }, 'Próxima →')));
  }
  filters.addEventListener('submit', (e) => { e.preventDefault(); page = 1; load().catch((err) => toast(err.message, 'err')); });
  clear(root).append(pageHead('Auditoria', { subtitle: 'Logins, alterações, exclusões, exportações e backups.' }), filters, out);
  await load();
}

/* ── Minha conta ───────────────────────────────────────── */
export async function accountView(root) {
  const form = h('form', { class: 'form card', novalidate: true },
    h('h2', { text: 'Trocar senha' }),
    field({ label: 'Senha atual', name: 'current_password', type: 'password', required: true, autocomplete: 'current-password' }),
    field({ label: 'Nova senha', name: 'new_password', type: 'password', required: true, autocomplete: 'new-password', hint: 'Mínimo 8 caracteres, com letras e números.' }),
    field({ label: 'Repita a nova senha', name: 'confirm', type: 'password', required: true, autocomplete: 'new-password' }),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Trocar senha')));
  onSubmit(form, async (v) => {
    if (v.new_password !== v.confirm) throw Object.assign(new Error('As senhas não conferem.'), { fields: { confirm: 'As senhas não conferem.' } });
    const r = await post('/auth/change-password', { current_password: v.current_password, new_password: v.new_password });
    auth.set(r.token);
    form.reset();
    toast('Senha alterada. As outras sessões foram encerradas.', 'ok');
  });
  clear(root).append(pageHead('Minha conta'),
    h('div', { class: 'card' }, h('p', {}, h('strong', { text: session.user.name })), h('p', { class: 'muted', text: `${session.user.email} · ${fmt.role[session.user.role]}` })),
    form);
}
