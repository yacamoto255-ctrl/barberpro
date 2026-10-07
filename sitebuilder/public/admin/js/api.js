// api.js — acesso à API com token, tratamento de sessão expirada e erros
const KEY = 'versal.token';
let token = null;
try { token = localStorage.getItem(KEY); } catch (_) { token = null; }
let onUnauthorized = () => {};

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || `Erro ${status}`);
    this.status = status;
    this.data = data || {};
    this.fields = data?.fields || {};
  }
}

export const auth = {
  get token() { return token; },
  set(t) { token = t; try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch (_) { /* modo privado */ } },
  onUnauthorized(fn) { onUnauthorized = fn; },
};

export async function api(method, path, body, opts = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof Blob || body instanceof ArrayBuffer) {
    payload = body;
    headers['Content-Type'] = body.type || 'application/octet-stream';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload });
  } catch (_) {
    throw new ApiError(0, { error: 'Sem conexão com o servidor. Verifique a internet.' });
  }
  if (opts.raw && res.ok) return res;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !opts.allow401) {
    auth.set(null);
    onUnauthorized(data.error || 'Sessão encerrada. Entre novamente.');
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const get = (p, o) => api('GET', p, undefined, o);
export const post = (p, b, o) => api('POST', p, b ?? {}, o);
export const patch = (p, b) => api('PATCH', p, b);
export const put = (p, b) => api('PUT', p, b);
export const del = (p, b) => api('DELETE', p, b);

/** Baixa um arquivo autenticado (CSV, Excel, PDF, backup) */
export async function download(path, fallbackName) {
  const res = await api('GET', path, undefined, { raw: true });
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const name = (cd.match(/filename="([^"]+)"/) || [])[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { name, size: blob.size };
}
