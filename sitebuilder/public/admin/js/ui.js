// ui.js — helpers de DOM, formulários, máscaras, avisos e diálogos (sem innerHTML com dados)

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Esvazia o elemento; o append devolvido ignora null/false (evita o texto "null" na tela) */
export const clear = (el) => {
  el.replaceChildren();
  return { append: (...children) => { el.append(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false)); return el; } };
};

export function toast(msg, kind = '') {
  const box = document.getElementById('toasts');
  const t = h('div', { class: `toast ${kind}`, role: kind === 'err' ? 'alert' : 'status' }, msg);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3500);
}

export function dialog({ title, body, actions }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { 'aria-label': title });
    const close = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.append(
      h('div', { class: 'dlg-head' }, h('h2', { text: title })),
      h('div', { class: 'dlg-body' }, body),
      h('div', { class: 'dlg-foot' }, actions.map((a) => h('button', {
        type: 'button', class: `btn ${a.class || 'ghost'}`, onclick: async () => {
          if (a.handler) { const r = await a.handler(dlg); if (r === false) return; close(r ?? a.value); } else close(a.value);
        },
      }, a.label))),
    );
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(undefined); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function confirmDialog(title, message, { danger = false, ok = 'Confirmar' } = {}) {
  return dialog({
    title,
    body: h('p', { text: message }),
    actions: [{ label: 'Voltar', value: false }, { label: ok, value: true, class: danger ? 'danger' : 'primary' }],
  });
}

/* ── Máscaras ─────────────────────────────────────────── */
export const masks = {
  phone(v) {
    let d = v.replace(/\D/g, '');
    if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
    d = d.slice(0, 11);
    if (d.length <= 2) return d.length ? `(${d}` : '';
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  },
  cep(v) { const d = v.replace(/\D/g, '').slice(0, 8); return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; },
  cnpj(v) {
    const s = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14);
    const parts = [s.slice(0, 2), s.slice(2, 5), s.slice(5, 8), s.slice(8, 12), s.slice(12, 14)];
    let out = parts[0];
    if (parts[1]) out += `.${parts[1]}`; if (parts[2]) out += `.${parts[2]}`;
    if (parts[3]) out += `/${parts[3]}`; if (parts[4]) out += `-${parts[4]}`;
    return out;
  },
  money(v) {
    const d = v.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 9);
    if (!d) return '';
    const n = (Number(d) / 100).toFixed(2);
    const [i, c] = n.split('.');
    return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${c}`;
  },
};

export const fmt = {
  brl: (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
  moneyInput: (c) => (c === null || c === undefined ? '' : masks.money(String(c))),
  phone: (d) => (d ? masks.phone(String(d)) : ''),
  dt: (s) => { if (!s) return ''; const [d, t] = s.split(' '); const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}${t ? ' ' + t.slice(0, 5) : ''}`; },
  date: (s) => { if (!s) return ''; const [y, m, d] = s.slice(0, 10).split('-'); return `${d}/${m}/${y}`; },
  utc: (s) => (s ? new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z')).toLocaleString('pt-BR') : ''),
  status: { pending: 'Pendente', confirmed: 'Confirmado', cancelled: 'Cancelado', completed: 'Concluído', no_show: 'Não compareceu' },
  role: { admin: 'Administrador', operator: 'Operador' },
};

export const pill = (status) => h('span', { class: `pill ${status}` }, fmt.status[status] || status);

/* ── Formulários ──────────────────────────────────────── */
let uid = 0;
/**
 * Campo de formulário. Tipos: text, email, tel, number, password, date, time, textarea, select, checkbox, color, money, cep, cnpj
 */
export function field(o) {
  const id = `f${++uid}`;
  let input;
  const common = { id, name: o.name, required: o.required || null, placeholder: o.placeholder || null, autocomplete: o.autocomplete || null };
  if (o.type === 'textarea') {
    input = h('textarea', { ...common, maxlength: o.maxlength || null, rows: o.rows || 4 });
    input.value = o.value ?? '';
  } else if (o.type === 'select') {
    input = h('select', common, (o.options || []).map(([v, l]) => h('option', { value: String(v) }, l)));
    if (o.value !== undefined && o.value !== null) input.value = String(o.value);
  } else if (o.type === 'checkbox') {
    input = h('input', { ...common, type: 'checkbox', checked: !!o.value });
    return h('div', { class: 'field' }, h('label', { class: 'check', for: id }, input, o.label), o.hint ? h('div', { class: 'hint', text: o.hint }) : null);
  } else {
    const typeMap = { money: 'text', cep: 'text', cnpj: 'text', tel: 'tel' };
    input = h('input', {
      ...common,
      type: typeMap[o.type] || o.type || 'text',
      maxlength: o.maxlength || null,
      min: o.min ?? null, max: o.max ?? null, step: o.step ?? null,
      inputmode: o.type === 'money' || o.type === 'cep' ? 'numeric' : o.type === 'tel' ? 'tel' : o.inputmode || null,
    });
    input.value = o.value ?? '';
    const mask = { tel: masks.phone, money: masks.money, cep: masks.cep, cnpj: masks.cnpj }[o.type];
    if (mask) {
      if (input.value) input.value = mask(String(input.value));
      input.addEventListener('input', () => { input.value = mask(input.value); });
    }
  }
  return h('div', { class: 'field', 'data-field': o.name },
    h('label', { for: id }, o.label, o.required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null),
    input,
    o.hint ? h('div', { class: 'hint', text: o.hint }) : null);
}

/** Lê valores de um form (checkbox -> boolean) */
export function formValues(form) {
  const out = {};
  for (const el of form.querySelectorAll('input[name], select[name], textarea[name]')) {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else out[el.name] = el.value.trim();
  }
  return out;
}

/** Mostra erros do servidor nos campos; devolve true se encontrou algum campo */
export function showFieldErrors(form, err) {
  form.querySelectorAll('.field.invalid').forEach((f) => { f.classList.remove('invalid'); f.querySelector('.error')?.remove(); });
  const fields = err?.fields || {};
  let first = null;
  for (const [name, msg] of Object.entries(fields)) {
    const f = form.querySelector(`[data-field="${CSS.escape(name)}"]`) || form.querySelector(`[name="${CSS.escape(name)}"]`)?.closest('.field');
    if (!f) continue;
    f.classList.add('invalid');
    f.append(h('div', { class: 'error', role: 'alert', text: msg }));
    first = first || f.querySelector('input, select, textarea');
  }
  first?.focus();
  return !!first;
}

/** Envolve o submit: desabilita botão, mostra erros, evita duplo clique */
export function onSubmit(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    if (btn?.disabled) return;
    const label = btn?.textContent;
    if (btn) { btn.disabled = true; btn.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), ' Salvando…'); }
    try {
      showFieldErrors(form, {});
      await handler(formValues(form));
    } catch (err) {
      if (!showFieldErrors(form, err)) toast(err.message || 'Erro inesperado.', 'err');
      else toast(err.message, 'err');
    } finally {
      if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = label; }
    }
  });
  return form;
}

export function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, h('strong', { text: title }), text ? h('p', { text }) : null, action || null);
}

export function table(columns, rows, { empty = 'Nada por aqui ainda.' } = {}) {
  if (!rows.length) return emptyState(empty);
  return h('div', { class: 'table-wrap' }, h('table', { class: 'responsive' },
    h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.num ? 'num' : null, scope: 'col' }, c.label)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, columns.map((c) => {
      const v = c.render ? c.render(r) : r[c.key];
      return h('td', { class: c.num ? 'num' : null, 'data-label': c.label }, v ?? '');
    }))))));
}

export function pageHead(title, { crumbs, actions, subtitle } = {}) {
  return h('div', { class: 'page-head' },
    h('div', {}, crumbs ? h('div', { class: 'crumbs' }, crumbs) : null, h('h1', { text: title }), subtitle ? h('p', { class: 'muted', text: subtitle }) : null),
    actions ? h('div', { class: 'actions' }, actions) : null);
}

export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
