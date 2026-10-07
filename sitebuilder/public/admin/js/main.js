// main.js — inicialização, rotas (hash), layout e telas de acesso
import { auth, get, post } from './api.js';
import { h, clear, toast, field, onSubmit } from './ui.js';
import { dashboardView } from './views/dashboard.js';
import { sitesView, siteNewView, siteEditView } from './views/sites.js';
import { bookingsView } from './views/bookings.js';
import { reportsView } from './views/reports.js';
import { notificationsView } from './views/notifications.js';
import { usersView, settingsView, auditView, accountView } from './views/admin.js';

const app = document.getElementById('app');
export const session = { user: null, unread: 0, unreadKnown: false };
let pollTimer = null;
let currentCleanup = null;

/* ── Rotas ─────────────────────────────────────────────── */
const routes = [
  [/^\/$/, dashboardView, 'Painel'],
  [/^\/sites$/, sitesView, 'Sites'],
  [/^\/sites\/novo$/, siteNewView, 'Sites'],
  [/^\/sites\/(\d+)(?:\/([a-z]+))?$/, siteEditView, 'Sites'],
  [/^\/agenda$/, bookingsView, 'Agenda'],
  [/^\/relatorios$/, reportsView, 'Relatórios'],
  [/^\/notificacoes$/, notificationsView, 'Notificações'],
  [/^\/usuarios$/, usersView, 'Equipe', 'admin'],
  [/^\/configuracoes$/, settingsView, 'Configurações', 'admin'],
  [/^\/auditoria$/, auditView, 'Auditoria', 'admin'],
  [/^\/conta$/, accountView, 'Minha conta'],
];

const NAV = [
  ['#/', 'Painel'], ['#/sites', 'Sites'], ['#/agenda', 'Agenda'], ['#/relatorios', 'Relatórios'],
  ['#/notificacoes', 'Notificações', 'badge'],
  null,
  ['#/usuarios', 'Equipe', null, 'admin'], ['#/configuracoes', 'Configurações', null, 'admin'], ['#/auditoria', 'Auditoria', null, 'admin'],
  ['#/conta', 'Minha conta'],
];

function currentPath() { return (location.hash.replace(/^#/, '') || '/').split('?')[0]; }
export function go(path) { location.hash = `#${path}`; }

function layout(content, activeLabel) {
  const shell = h('div', { class: 'shell' });
  const navEl = h('nav', { class: 'nav', 'aria-label': 'Menu principal' });
  for (const item of NAV) {
    if (!item) { navEl.append(h('div', { class: 'sep', role: 'separator' })); continue; }
    const [href, label, badge, role] = item;
    if (role && session.user.role !== role) continue;
    const a = h('a', { href, 'aria-current': label === activeLabel ? 'page' : null, onclick: () => shell.classList.remove('nav-open') }, h('span', { text: label }));
    if (badge) a.append(h('span', { class: 'badge', id: 'nav-badge', hidden: session.unread ? null : true }, String(session.unread)));
    navEl.append(a);
  }
  const side = h('aside', { class: 'side' },
    h('a', { class: 'brand', href: '#/' }, h('img', { src: 'icon.svg', alt: '' }), h('span', {}, 'Versal Estúdio', h('small', { text: 'Sites com agendamento' }))),
    navEl,
    h('div', { class: 'who' }, h('strong', { text: session.user.name }), h('span', { text: session.user.role === 'admin' ? 'Administrador' : 'Operador' }), ' · ',
      h('button', { type: 'button', class: 'link', onclick: logout }, 'Sair')));
  const top = h('div', { class: 'topbar' },
    h('button', { type: 'button', 'aria-label': 'Abrir menu', onclick: () => shell.classList.toggle('nav-open') }, '☰'),
    h('span', { class: 't', text: activeLabel }),
    h('a', { href: '#/notificacoes', class: 'btn sm ghost', style: { color: '#fff', borderColor: '#3a3642' }, 'aria-label': 'Notificações' }, '🔔 ', h('span', { id: 'top-badge', text: String(session.unread) })));
  shell.addEventListener('click', (e) => { if (e.target === shell) shell.classList.remove('nav-open'); });
  shell.append(side, h('div', {}, top, h('main', { class: 'main', id: 'main', tabindex: '-1' }, content)));
  return shell;
}

export function setUnread(n) {
  session.unread = n;
  const b = document.getElementById('nav-badge');
  if (b) { b.textContent = String(n); b.hidden = !n; }
  const t = document.getElementById('top-badge');
  if (t) t.textContent = String(n);
  document.title = `${n ? `(${n}) ` : ''}Versal Estúdio — Painel`;
}

async function pollUnread() {
  if (!auth.token || !navigator.onLine) return;
  try {
    const { unread } = await get('/notifications/count');
    // Só avisa quando chega algo novo durante o uso (não ao abrir o painel com pendências antigas)
    if (session.unreadKnown && unread > session.unread) toast('Nova notificação: confira os agendamentos.', 'ok');
    session.unreadKnown = true;
    setUnread(unread);
  } catch (_) { /* tenta de novo no próximo ciclo */ }
}

async function render() {
  app.classList.remove('boot');
  if (typeof currentCleanup === 'function') { try { currentCleanup(); } catch (_) { /* nada */ } }
  currentCleanup = null;
  const path = currentPath();

  const reset = path.match(/^\/redefinir-senha\/([A-Za-z0-9_-]+)$/);
  if (reset) return resetView(reset[1]);
  if (!auth.token || !session.user) return loginView();

  const found = routes.find(([re]) => re.test(path));
  if (!found) { go('/'); return; }
  const [re, view, label, role] = found;
  if (role && session.user.role !== role) {
    clear(app).append(layout(h('div', { class: 'alert err' }, 'Seu perfil não tem acesso a esta página.'), label));
    return;
  }
  const container = h('div', {}, h('p', { class: 'muted' }, 'Carregando…'));
  clear(app).append(layout(container, label));
  try {
    const params = path.match(re).slice(1);
    const out = await view(container, ...params);
    if (typeof out === 'function') currentCleanup = out;
  } catch (err) {
    if (err.status === 401) return;
    clear(container).append(h('div', { class: 'alert err', role: 'alert' }, err.message || 'Erro ao carregar.'),
      h('button', { class: 'btn ghost', type: 'button', onclick: render }, 'Tentar de novo'));
  }
  document.getElementById('main')?.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

/* ── Acesso ─────────────────────────────────────────────── */
function authFrame(...content) {
  clear(app).append(h('div', { class: 'auth' },
    h('section', { class: 'art' },
      h('div', {}, h('div', { class: 'brand' }, h('img', { src: 'icon.svg', alt: '' }), 'Versal Estúdio')),
      h('div', {}, h('h1', { text: 'Sites que enchem a agenda dos seus clientes.' }),
        h('p', { text: 'Crie o site de qualquer negócio, publique em minutos e receba agendamentos online com aviso no painel e no WhatsApp.' })),
      h('div', { class: 'foot small muted' }, '@versal.estudio')),
    h('section', { class: 'panel' }, h('div', { class: 'box' }, ...content))));
}

async function loginView(message) {
  let needsSetup = false;
  try { needsSetup = (await get('/auth/setup-status')).needsSetup; } catch (_) { /* offline */ }
  if (needsSetup) return setupView();
  const form = h('form', { class: 'form', novalidate: true },
    field({ label: 'E-mail', name: 'email', type: 'email', required: true, autocomplete: 'username' }),
    field({ label: 'Senha', name: 'password', type: 'password', required: true, autocomplete: 'current-password' }),
    h('button', { class: 'btn primary', type: 'submit' }, 'Entrar'),
    h('button', { class: 'link', type: 'button', onclick: forgotView }, 'Esqueci minha senha'));
  onSubmit(form, async (v) => {
    const r = await post('/auth/login', v, { allow401: true });
    auth.set(r.token);
    session.user = r.user;
    rememberUser(r.user);
    startSession();
    render();
  });
  authFrame(h('h2', { text: 'Entrar no painel' }),
    message ? h('div', { class: 'alert info', role: 'status', text: message }) : null, form);
  form.querySelector('input')?.focus();
}

function setupView() {
  const form = h('form', { class: 'form', novalidate: true },
    h('div', { class: 'alert info', text: 'Primeiro acesso: crie a conta de administrador da agência.' }),
    field({ label: 'Seu nome', name: 'name', required: true, autocomplete: 'name' }),
    field({ label: 'E-mail', name: 'email', type: 'email', required: true, autocomplete: 'username' }),
    field({ label: 'Senha', name: 'password', type: 'password', required: true, autocomplete: 'new-password', hint: 'Mínimo 8 caracteres, com letras e números.' }),
    field({ label: 'Código de instalação', name: 'setup_token', hint: 'Só se o servidor tiver SETUP_TOKEN configurado.' }),
    h('button', { class: 'btn primary', type: 'submit' }, 'Criar administrador'));
  onSubmit(form, async (v) => {
    const r = await post('/auth/setup', v, { allow401: true });
    auth.set(r.token); session.user = r.user; rememberUser(r.user); startSession(); go('/'); render();
  });
  authFrame(h('h2', { text: 'Configuração inicial' }), form);
}

function forgotView() {
  const form = h('form', { class: 'form', novalidate: true },
    field({ label: 'E-mail da sua conta', name: 'email', type: 'email', required: true }),
    h('button', { class: 'btn primary', type: 'submit' }, 'Enviar link'),
    h('button', { class: 'link', type: 'button', onclick: () => loginView() }, 'Voltar ao login'));
  const out = h('div');
  onSubmit(form, async (v) => {
    const r = await post('/auth/forgot-password', v, { allow401: true });
    clear(out).append(h('div', { class: 'alert ok', role: 'status', text: r.message }));
  });
  authFrame(h('h2', { text: 'Recuperar senha' }), out, form);
}

function resetView(token) {
  const form = h('form', { class: 'form', novalidate: true },
    field({ label: 'Nova senha', name: 'new_password', type: 'password', required: true, autocomplete: 'new-password', hint: 'Mínimo 8 caracteres, com letras e números.' }),
    field({ label: 'Repita a nova senha', name: 'confirm', type: 'password', required: true, autocomplete: 'new-password' }),
    h('button', { class: 'btn primary', type: 'submit' }, 'Salvar nova senha'));
  onSubmit(form, async (v) => {
    if (v.new_password !== v.confirm) throw Object.assign(new Error('As senhas não conferem.'), { fields: { confirm: 'As senhas não conferem.' } });
    const r = await post('/auth/reset-password', { token, new_password: v.new_password }, { allow401: true });
    auth.set(null); session.user = null;
    history.replaceState(null, '', '#/');
    loginView(r.message);
  });
  authFrame(h('h2', { text: 'Definir nova senha' }), form);
}

async function logout() {
  try { await post('/auth/logout'); } catch (_) { /* sessão já pode estar inválida */ }
  auth.set(null); session.user = null; rememberUser(null); stopSession();
  go('/'); loginView('Você saiu do painel.');
}

function startSession() {
  stopSession();
  pollUnread();
  pollTimer = setInterval(pollUnread, 30_000);
}
function stopSession() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; session.unreadKnown = false; }

function rememberUser(u) {
  try { u ? localStorage.setItem('versal.user', JSON.stringify(u)) : localStorage.removeItem('versal.user'); } catch (_) { /* modo privado */ }
}
function cachedUser() {
  try { return JSON.parse(localStorage.getItem('versal.user') || 'null'); } catch (_) { return null; }
}

auth.onUnauthorized((msg) => {
  session.user = null; rememberUser(null); stopSession();
  loginView(msg);
});

/* ── Offline / PWA ─────────────────────────────────────── */
function updateOnline() {
  document.getElementById('offline').hidden = navigator.onLine;
  if (navigator.onLine && auth.token && session.user) pollUnread();
}
window.addEventListener('online', () => { updateOnline(); toast('Conexão restabelecida.', 'ok'); render(); });
window.addEventListener('offline', updateOnline);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

/* ── Início ────────────────────────────────────────────── */
window.addEventListener('hashchange', render);
(async () => {
  updateOnline();
  if (auth.token) {
    try {
      const r = await get('/auth/me');
      session.user = r.user;
      rememberUser(r.user);
      startSession();
    } catch (err) {
      // Sem internet: abre o painel com o último usuário conhecido (as telas avisam que estão offline)
      if (err.status === 0) session.user = cachedUser();
    }
  }
  render();
})();

export { render };
