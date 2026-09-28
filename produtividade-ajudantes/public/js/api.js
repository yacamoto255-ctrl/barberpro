// Cliente HTTP da API. Guarda o token e trata sessão expirada.
const KEY = 'logiponto.session';
let session = null;
try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { session = null; }
const listeners = new Set();

export function getSession() { return session; }
export function setSession(s) {
  session = s;
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* sem storage */ }
}
export function onUnauthorized(fn) { listeners.add(fn); }

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Erro ${status}`);
    this.status = status; this.code = body?.code; this.details = body?.details;
  }
}

function qs(params) {
  if (!params) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function request(method, path, { body, params, raw } = {}) {
  const headers = {};
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`/api${path}${qs(params)}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, { error: 'Sem conexão com o servidor. Verifique a rede e tente novamente.', code: 'OFFLINE' });
  }
  if (res.status === 401 && path !== '/auth/login') {
    const b = await res.json().catch(() => ({}));
    setSession(null);
    listeners.forEach(fn => fn(b.error));
    throw new ApiError(401, b);
  }
  if (raw) {
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
    return res;
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  get: (p, params) => request('GET', p, { params }),
  post: (p, body) => request('POST', p, { body: body ?? {} }),
  put: (p, body) => request('PUT', p, { body }),
  patch: (p, body) => request('PATCH', p, { body }),
  del: (p) => request('DELETE', p),
  async download(p, params, fallbackName) {
    const res = await request('GET', p, { params, raw: true });
    const cd = res.headers.get('Content-Disposition') || '';
    const name = (cd.match(/filename="([^"]+)"/) || [])[1] || fallbackName;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
};
