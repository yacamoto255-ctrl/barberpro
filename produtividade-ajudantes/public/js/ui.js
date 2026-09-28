// Utilitários de interface. TODO conteúdo dinâmico passa por html`` (escape automático => sem XSS).
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = s => new Raw(s);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const esc = s => String(s).replace(/[&<>"'`]/g, c => ESC[c]);
function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(String(v));
}
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += render(vals[i]); });
  return new Raw(out);
}
export function mount(el, tpl) { el.innerHTML = render(tpl); applyStyles(el); return el; }

/** CSP bloqueia style="" no HTML; estilos dinâmicos são aplicados via CSSOM a partir de data-*. */
export function applyStyles(root) {
  root.querySelectorAll('[data-w]').forEach(e => { e.style.width = `${e.dataset.w}%`; });
  root.querySelectorAll('[data-h]').forEach(e => { e.style.height = `${e.dataset.h}%`; });
  root.querySelectorAll('[data-bg]').forEach(e => { e.style.background = e.dataset.bg; });
  root.querySelectorAll('[data-fg]').forEach(e => { e.style.color = e.dataset.fg; });
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ── Formatadores (pt-BR) ─────────────────────────────
const nf = {};
export function num(v, d = 2) {
  if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return '—';
  nf[d] ||= new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  return nf[d].format(Number(v));
}
export const kg = v => (v === null || v === undefined ? '—' : `${num(v, 2)} kg`);
export const int = v => num(v, 0);
export function dur(sec) {
  if (sec === null || sec === undefined) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}min` : `${m}min`;
}
export const hhmm = ts => (ts ? ts.slice(11, 16) : '—');
export const dateBr = d => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
export const dateTimeBr = ts => (ts ? `${dateBr(ts.slice(0, 10))} ${ts.slice(11, 16)}` : '—');
export function addDays(d, n) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }

// ── Toast ────────────────────────────────────────────
export function toast(msg, type = 'info', ms = 3500) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ── Modal ────────────────────────────────────────────
export function modal({ title, body, actions = [], wide = false, onMount }) {
  const root = document.getElementById('modal-root');
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = render(html`
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="modal-h"><h2>${title}</h2><button class="btn-ghost btn-sm" data-close aria-label="Fechar">✕</button></div>
      <div class="modal-b">${body}</div>
      ${actions.length ? html`<div class="modal-f">${actions.map((a, i) => html`<button data-act="${i}" class="${a.cls || ''}">${a.label}</button>`)}</div>` : ''}
    </div>`);
  root.appendChild(back);
  applyStyles(back);
  const prevFocus = document.activeElement;
  const close = () => { back.remove(); document.body.classList.remove('print-modal'); prevFocus?.focus?.(); };
  back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  back.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  actions.forEach((a, i) => {
    back.querySelector(`[data-act="${i}"]`).addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      if (!a.onClick) return close();
      btn.disabled = true;
      try { const r = await a.onClick(back.querySelector('.modal-b'), close); if (r !== false) close(); }
      catch (err) { showFormError(back, err); }
      finally { btn.disabled = false; }
    });
  });
  const first = back.querySelector('.modal-b input, .modal-b select, .modal-b textarea');
  (first || back.querySelector('[data-close]')).focus();
  onMount?.(back.querySelector('.modal-b'), close);
  return { el: back, close };
}

export function confirmDialog(message, { title = 'Confirmar', okLabel = 'Confirmar', danger = false } = {}) {
  return new Promise(resolve => {
    let done = false;
    const m = modal({
      title, body: html`<p>${message}</p>`,
      actions: [
        { label: 'Voltar', onClick: () => { done = true; resolve(false); } },
        { label: okLabel, cls: danger ? 'btn-danger' : 'btn-primary', onClick: () => { done = true; resolve(true); } },
      ],
    });
    const obs = new MutationObserver(() => { if (!m.el.isConnected) { obs.disconnect(); if (!done) resolve(false); } });
    obs.observe(document.getElementById('modal-root'), { childList: true });
  });
}

/** Pede um motivo obrigatório (auditoria). */
export function reasonDialog(title, label = 'Motivo', extraBody = '') {
  return new Promise(resolve => {
    let done = false;
    const m = modal({
      title,
      body: html`${extraBody}<div class="field"><label for="rsn">${label} *</label><textarea id="rsn" name="reason" maxlength="300"></textarea></div><div class="err form-error"></div>`,
      actions: [
        { label: 'Voltar', onClick: () => { done = true; resolve(null); } },
        { label: 'Confirmar', cls: 'btn-primary', onClick: (b) => {
          const v = b.querySelector('#rsn').value.trim();
          if (v.length < 3) { b.querySelector('.form-error').textContent = 'Informe o motivo (mínimo 3 caracteres).'; return false; }
          done = true; resolve({ reason: v, body: b }); return true;
        } },
      ],
    });
    const obs = new MutationObserver(() => { if (!m.el.isConnected) { obs.disconnect(); if (!done) resolve(null); } });
    obs.observe(document.getElementById('modal-root'), { childList: true });
  });
}

// ── Formulários ──────────────────────────────────────
/**
 * fields: [{ name, label, type: text|number|date|datetime|select|textarea|checkbox|password|email, options:[{value,label}], required, full, step, min, max, hint, placeholder }]
 */
export function formFields(fields, values = {}) {
  return html`<div class="form-grid">${fields.map(f => {
    const v = values[f.name] ?? f.default ?? '';
    const id = `f_${f.name}`;
    const req = f.required ? raw(' required') : '';
    let input;
    if (f.type === 'select') {
      input = html`<select id="${id}" name="${f.name}"${req}>${f.placeholder !== false ? html`<option value="">${f.placeholder || 'Selecione…'}</option>` : ''}${
        f.options.map(o => html`<option value="${o.value}"${String(o.value) === String(v) ? raw(' selected') : ''}>${o.label}</option>`)}</select>`;
    } else if (f.type === 'textarea') {
      input = html`<textarea id="${id}" name="${f.name}" maxlength="${f.max || 500}"${req}>${v}</textarea>`;
    } else if (f.type === 'checkbox') {
      return html`<div class="field ${f.full ? 'full' : ''}"><label class="check"><input type="checkbox" id="${id}" name="${f.name}"${v === 1 || v === true || v === '1' ? raw(' checked') : ''}> ${f.label}</label>${f.hint ? html`<div class="muted small">${f.hint}</div>` : ''}</div>`;
    } else {
      const t = f.type === 'datetime' ? 'datetime-local' : (f.type || 'text');
      const val = f.type === 'datetime' && v ? String(v).slice(0, 16).replace(' ', 'T') : v;
      input = html`<input id="${id}" name="${f.name}" type="${t}" value="${val}"${req}${f.step ? raw(` step="${esc(f.step)}"`) : ''}${f.min !== undefined ? raw(` min="${esc(f.min)}"`) : ''}${f.max !== undefined && t !== 'text' ? raw(` max="${esc(f.max)}"`) : ''}${f.maxlength ? raw(` maxlength="${esc(f.maxlength)}"`) : ''}${f.placeholder ? raw(` placeholder="${esc(f.placeholder)}"`) : ''}${f.inputmode ? raw(` inputmode="${esc(f.inputmode)}"`) : ''} autocomplete="off">`;
    }
    return html`<div class="field ${f.full ? 'full' : ''}"><label for="${id}">${f.label}${f.required ? ' *' : ''}</label>${input}${f.hint ? html`<div class="muted small">${f.hint}</div>` : ''}<div class="err" data-err="${f.name}"></div></div>`;
  })}</div><div class="err form-error"></div>`;
}

export function readForm(root, fields) {
  const out = {};
  for (const f of fields) {
    const el = root.querySelector(`[name="${f.name}"]`);
    if (!el) continue;
    if (f.type === 'checkbox') out[f.name] = el.checked ? 1 : 0;
    else if (f.type === 'number') out[f.name] = el.value === '' ? null : Number(el.value);
    else if (f.type === 'select' && f.numeric) out[f.name] = el.value === '' ? null : Number(el.value);
    else out[f.name] = el.value.trim() === '' ? null : el.value.trim();
  }
  return out;
}

export function showFormError(root, err) {
  root.querySelectorAll('[data-err]').forEach(e => { e.textContent = ''; });
  const box = root.querySelector('.form-error');
  if (err?.details && typeof err.details === 'object') {
    for (const [k, v] of Object.entries(err.details)) {
      const e = root.querySelector(`[data-err="${k}"]`);
      if (e && typeof v === 'string') e.textContent = v;
    }
  }
  if (box) box.textContent = err?.message || 'Erro ao salvar.';
  else toast(err?.message || 'Erro', 'err');
}

/** Tabela genérica: cols [{ label, key | render(row), num, cls }] */
export function table(cols, rows, { empty = 'Nenhum registro encontrado.', rowAttrs } = {}) {
  return html`<div class="table-wrap"><table>
    <thead><tr>${cols.map(c => html`<th class="${c.num ? 'num' : ''}">${c.label}</th>`)}</tr></thead>
    <tbody>${rows.length ? rows.map(r => html`<tr ${rowAttrs ? rowAttrs(r) : ''}>${cols.map(c => html`<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.render ? c.render(r) : r[c.key]}</td>`)}</tr>`)
      : html`<tr><td colspan="${cols.length}" class="empty">${empty}</td></tr>`}</tbody>
  </table></div>`;
}

export function statusBadge(s) {
  const map = {
    ATIVO: 'b-ok', INATIVO: 'b-muted', EM_ANDAMENTO: 'b-warn', FINALIZADA: 'b-ok', FINALIZADO: 'b-ok',
    CANCELADA: 'b-err', CANCELADO: 'b-err', ABERTA: 'b-info', CONCLUIDA: 'b-ok',
  };
  const label = { EM_ANDAMENTO: 'EM ANDAMENTO', ATIVO: 'ATIVO' }[s] || s;
  return html`<span class="badge ${map[s] || 'b-muted'}">${label}</span>`;
}

export function options(list, labelFn = x => x.name, valueFn = x => x.id) {
  return list.map(x => ({ value: valueFn(x), label: labelFn(x) }));
}

/** Barras horizontais simples (sem bibliotecas externas). */
export function hbars(items, { value, label, fmt = v => num(v), color }) {
  const max = Math.max(1, ...items.map(value));
  if (!items.length) return html`<div class="empty">Sem dados no período.</div>`;
  return html`<div class="bars">${items.map(it => html`<div class="bar-row"><div class="lbl" title="${label(it)}">${label(it)}</div>
    <div class="bar-track"><div class="bar-fill" data-w="${Math.round((value(it) / max) * 1000) / 10}" ${color && color(it) ? html`data-bg="${color(it)}"` : ''}></div></div>
    <div class="num small">${fmt(value(it))}</div></div>`)}</div>`;
}

export function vbars(items, { value, label, fmt = v => num(v, 0) }) {
  if (!items.length) return html`<div class="empty">Sem dados no período.</div>`;
  const max = Math.max(1, ...items.map(value));
  return html`<div class="vbars">${items.map(it => html`<div class="vbar" title="${label(it)}: ${fmt(value(it))}">
    <div class="val">${fmt(value(it))}</div><div class="fill" data-h="${Math.max(1, Math.round((value(it) / max) * 85))}"></div><div class="cap">${label(it)}</div></div>`)}</div>`;
}

export function debounce(fn, ms = 300) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
