// Shell da aplicação: login, layout, menu por perfil e roteamento por hash.
import { api, getSession, setSession, onUnauthorized } from './api.js';
import { html, mount, toast, $ } from './ui.js';

const ROUTES = {
  '/apontamento': { title: 'Apontamento de Atividades', icon: '▣', roles: ['ADMIN', 'GESTOR', 'OPERADOR'], load: () => import('./pages/apontamento.js') },
  '/dashboard': { title: 'Dashboard', icon: '▤', roles: ['ADMIN', 'GESTOR'], load: () => import('./pages/dashboard.js') },
  '/ranking': { title: 'Ranking', icon: '★', roles: ['ADMIN', 'GESTOR'], load: () => import('./pages/ranking.js') },
  '/relatorios': { title: 'Relatórios', icon: '⇩', roles: ['ADMIN', 'GESTOR'], load: () => import('./pages/relatorios.js') },
  '/historico': { title: 'Histórico de Atividades', icon: '☰', roles: ['ADMIN', 'GESTOR', 'OPERADOR'], load: () => import('./pages/historico.js') },
  '/ajudantes': { title: 'Cadastro de Ajudantes', icon: '👷', roles: ['ADMIN', 'GESTOR'], section: 'Cadastros', load: () => import('./pages/ajudantes.js') },
  '/cargas': { title: 'Cargas', icon: '🚚', roles: ['ADMIN', 'GESTOR'], section: 'Cadastros', load: () => import('./pages/cargas.js') },
  '/cadastros': { title: 'Atividades e Tabelas', icon: '⚙', roles: ['ADMIN', 'GESTOR'], section: 'Cadastros', load: () => import('./pages/cadastros.js') },
  '/usuarios': { title: 'Usuários', icon: '👤', roles: ['ADMIN'], section: 'Administração', load: () => import('./pages/usuarios.js') },
  '/auditoria': { title: 'Auditoria', icon: '🛡', roles: ['ADMIN', 'GESTOR'], section: 'Administração', load: () => import('./pages/auditoria.js') },
  '/conta': { title: 'Minha conta', icon: '🔑', roles: ['ADMIN', 'GESTOR', 'OPERADOR'], hidden: true, load: () => import('./pages/conta.js') },
};

const HOME = { ADMIN: '/dashboard', GESTOR: '/dashboard', OPERADOR: '/apontamento' };
let meta = null;
let cleanup = null;

export async function getMeta(force = false) {
  if (!meta || force) meta = await api.get('/meta');
  return meta;
}
export function currentUser() { return getSession()?.user; }
export function hasRole(...roles) { return roles.includes(currentUser()?.role); }

onUnauthorized((msg) => {
  toast(msg || 'Sessão expirada. Faça login novamente.', 'err', 5000);
  renderLogin();
});

function renderLogin() {
  cleanup?.(); cleanup = null;
  document.getElementById('modal-root').innerHTML = '';
  const app = document.getElementById('app');
  app.className = '';
  mount(app, html`
    <div class="login-wrap">
      <form class="login-card" id="login-form" novalidate>
        <div class="head"><div class="brand"><span class="brand-mark">LP</span><div>LogiPonto<small>Produtividade de ajudantes</small></div></div></div>
        <div class="stripe"></div>
        <div class="body">
          <div class="field"><label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="username" required></div>
          <div class="field"><label for="password">Senha</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
          <div class="err form-error" role="alert"></div>
          <button class="btn-primary btn-xl" type="submit" id="btn-login">Entrar</button>
          <div class="demo-users">
            <strong>Usuários de demonstração</strong> (clique para preencher):<br>
            <button type="button" class="btn-sm" data-demo="admin@logiponto.com|Admin1234">ADMIN</button>
            <button type="button" class="btn-sm" data-demo="gestor@logiponto.com|Gestor1234">GESTOR</button>
            <button type="button" class="btn-sm" data-demo="operador@logiponto.com|Operador1234">OPERADOR</button>
          </div>
        </div>
      </form>
    </div>`);
  $('#btn-login').classList.add('grow');
  $('#btn-login').style.width = '100%';
  app.querySelectorAll('[data-demo]').forEach(b => b.addEventListener('click', () => {
    const [e, p] = b.dataset.demo.split('|');
    $('#email').value = e; $('#password').value = p;
  }));
  $('#login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('#btn-login'); const err = $('.form-error');
    err.textContent = '';
    const email = $('#email').value.trim(); const password = $('#password').value;
    if (!email || !password) { err.textContent = 'Informe e-mail e senha.'; return; }
    btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      const r = await api.post('/auth/login', { email, password });
      setSession(r);
      meta = null;
      location.hash = '#' + HOME[r.user.role];
      renderShell();
    } catch (e) {
      err.textContent = e.message;
    } finally { btn.disabled = false; btn.textContent = 'Entrar'; }
  });
  $('#email').focus();
}

function navHtml(role, active) {
  let lastSection = null;
  const items = [];
  for (const [path, r] of Object.entries(ROUTES)) {
    if (r.hidden || !r.roles.includes(role)) continue;
    if (r.section && r.section !== lastSection) { items.push(html`<div class="sep">${r.section}</div>`); lastSection = r.section; }
    items.push(html`<a href="#${path}" class="${path === active ? 'active' : ''}"><span aria-hidden="true">${r.icon}</span>${r.title}</a>`);
  }
  return items;
}

function renderShell() {
  const user = currentUser();
  const app = document.getElementById('app');
  app.className = '';
  mount(app, html`
    <div class="layout">
      <aside class="sidebar" id="sidebar">
        <div class="brand"><span class="brand-mark">LP</span><div>LogiPonto<small>Produtividade de ajudantes</small></div></div>
        <div class="stripe"></div>
        <nav class="nav" id="nav"></nav>
        <div class="user">
          <div><strong>${user.name}</strong></div>
          <div class="role">${user.role}</div>
          <div class="row mt">
            <a href="#/conta" class="btn btn-sm">Minha conta</a>
            <button class="btn-sm" id="btn-logout">Sair</button>
          </div>
        </div>
      </aside>
      <div class="main">
        <header class="topbar"><button id="btn-menu" aria-label="Abrir menu">☰</button><span class="title" id="top-title">LogiPonto</span></header>
        <main class="content" id="content"></main>
      </div>
    </div>`);
  $('#btn-logout').addEventListener('click', logout);
  $('#btn-menu').addEventListener('click', () => toggleMenu(true));
  route();
}

function toggleMenu(open) {
  const sb = $('#sidebar');
  if (!sb) return;
  sb.classList.toggle('open', open);
  document.querySelector('.scrim')?.remove();
  if (open) {
    const s = document.createElement('div');
    s.className = 'scrim';
    s.addEventListener('click', () => toggleMenu(false));
    document.body.appendChild(s);
  }
}

async function logout() {
  try { await api.post('/auth/logout'); } catch { /* ignora */ }
  setSession(null);
  meta = null;
  location.hash = '';
  renderLogin();
  toast('Sessão encerrada.', 'ok');
}

async function route() {
  const user = currentUser();
  if (!user) return renderLogin();
  if (!$('#content')) return renderShell();
  let path = location.hash.replace(/^#/, '').split('?')[0] || HOME[user.role];
  let r = ROUTES[path];
  if (!r) { path = HOME[user.role]; r = ROUTES[path]; history.replaceState(null, '', '#' + path); }
  if (!r.roles.includes(user.role)) {
    toast('Seu perfil não tem acesso a esta tela.', 'err');
    path = HOME[user.role]; r = ROUTES[path]; history.replaceState(null, '', '#' + path);
  }
  toggleMenu(false);
  closeAllModals();
  const nav = $('#nav');
  mount(nav, html`${navHtml(user.role, path)}`);
  $('#top-title').textContent = r.title;
  document.title = `${r.title} — LogiPonto`;
  cleanup?.(); cleanup = null;
  const content = $('#content');
  content.innerHTML = '<div class="boot">Carregando…</div>';
  try {
    const mod = await r.load();
    const ret = await mod.default(content, { title: r.title });
    if (typeof ret === 'function') cleanup = ret;
  } catch (e) {
    if (e.status === 401) return;
    mount(content, html`<div class="card"><h2>Não foi possível carregar a tela</h2><p class="muted">${e.message}</p><button class="btn-primary" id="retry">Tentar novamente</button></div>`);
    $('#retry')?.addEventListener('click', route);
  }
}

function closeAllModals() {
  document.getElementById('modal-root').innerHTML = '';
  document.body.classList.remove('print-modal');
}

// Esc fecha o modal do topo mesmo que o foco tenha saído dele
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const all = document.querySelectorAll('#modal-root .modal-back');
  const top = all[all.length - 1];
  if (top && !top.contains(document.activeElement)) top.querySelector('[data-close]')?.click();
});

window.addEventListener('hashchange', route);

(async function boot() {
  const s = getSession();
  if (!s?.token) return renderLogin();
  try {
    const r = await api.get('/auth/me');
    setSession({ ...s, user: r.user });
    renderShell();
  } catch (e) {
    if (e.status !== 401) {
      document.getElementById('app').textContent = e.message;
    }
  }
})();
