// src/validators.js — validação e normalização de entrada
'use strict';

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Remove caracteres de controle (mantém \n e \t) e espaços nas pontas
function clean(s) {
  return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/;
const RESERVED_SLUGS = new Set(['admin', 'api', 'assets', 'login', 's', 'static', 'www', 'health']);

function isValidEmail(v) {
  return typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v);
}

/** Telefone BR: aceita DDD + número (10 ou 11 dígitos), opcionalmente com 55 na frente. Retorna só dígitos com 55. */
function normalizePhoneBR(v) {
  let d = String(v || '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  const ddd = Number(d.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;
  if (d.length === 11 && d[2] !== '9') return null; // celular com 9 dígitos começa com 9
  if (/^(\d)\1+$/.test(d.slice(2))) return null;    // 999999999 etc.
  return '55' + d;
}

function normalizeCep(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length !== 8 || /^(\d)\1+$/.test(d)) return null;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/**
 * CNPJ numérico ou alfanumérico (novo formato da Receita a partir de jul/2026):
 * 12 primeiros caracteres [A-Z0-9], 2 dígitos verificadores numéricos.
 * Valor de cada caractere = código ASCII − 48; pesos e módulo 11 iguais ao formato antigo.
 */
function normalizeCnpj(v) {
  const s = String(v || '').toUpperCase().replace(/[.\-/\s]/g, '');
  if (!/^[A-Z0-9]{12}\d{2}$/.test(s)) return null;
  if (/^(\d)\1+$/.test(s)) return null;
  const val = (ch) => ch.charCodeAt(0) - 48;
  const dv = (base) => {
    const weights = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = base.split('').reduce((acc, ch, i) => acc + val(ch) * weights[i], 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(s.slice(0, 12));
  const d2 = dv(s.slice(0, 12) + d1);
  if (Number(s[12]) !== d1 || Number(s[13]) !== d2) return null;
  return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`;
}

function normalizeInstagram(v) {
  let s = clean(v || '');
  if (!s) return '';
  s = s.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');
  if (!/^[A-Za-z0-9._]{1,30}$/.test(s)) return null;
  return s.toLowerCase();
}

function slugify(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
    .replace(/-+$/g, '');
}

function isValidSlug(s) {
  return typeof s === 'string' && SLUG_RE.test(s) && !s.includes('--') && !RESERVED_SLUGS.has(s);
}

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 2000 && y <= 2100;
}

function isValidTime(s) {
  return typeof s === 'string' && TIME_RE.test(s);
}

/** "YYYY-MM-DD HH:MM" (horário local do negócio) */
function isValidDateTime(s) {
  if (typeof s !== 'string') return false;
  const [d, t, ...rest] = s.split(' ');
  return rest.length === 0 && isValidDate(d) && isValidTime(t);
}

/** "R$ 1.234,56" | "1234.56" | 1234.56 -> centavos */
function parseMoneyToCents(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null;
  let s = String(v || '').replace(/[R$\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/**
 * Coletor de erros por campo:
 *   const c = new Checker(req.body);
 *   const name = c.str('name', 'Nome', { required: true, max: 120 });
 *   c.done();  // lança HttpError 400 com { fields: { name: '...' } }
 */
class Checker {
  constructor(src, { partial = false } = {}) {
    this.src = src && typeof src === 'object' ? src : {};
    this.partial = partial; // PATCH: campos ausentes são ignorados
    this.errors = {};
  }

  has(key) { return Object.prototype.hasOwnProperty.call(this.src, key) && this.src[key] !== undefined; }

  fail(key, msg) { if (!this.errors[key]) this.errors[key] = msg; return undefined; }

  _absent(key, label, required) {
    const v = this.src[key];
    const empty = v === undefined || v === null || (typeof v === 'string' && clean(v) === '');
    if (empty) {
      if (required && !(this.partial && !this.has(key))) this.fail(key, `${label} é obrigatório.`);
      return true;
    }
    return false;
  }

  str(key, label, { required = false, max = 255, min = 0 } = {}) {
    if (this._absent(key, label, required)) return this.has(key) ? '' : undefined;
    const v = this.src[key];
    if (typeof v !== 'string' && typeof v !== 'number') return this.fail(key, `${label} inválido.`);
    const s = clean(v);
    if (s.length < min) return this.fail(key, `${label} deve ter ao menos ${min} caracteres.`);
    if (s.length > max) return this.fail(key, `${label} deve ter no máximo ${max} caracteres.`);
    return s;
  }

  email(key, label, opts = {}) {
    const s = this.str(key, label, { ...opts, max: 254 });
    if (!s) return s;
    if (!isValidEmail(s)) return this.fail(key, `${label} inválido.`);
    return s.toLowerCase();
  }

  phone(key, label, opts = {}) {
    const s = this.str(key, label, { ...opts, max: 30 });
    if (!s) return s;
    const p = normalizePhoneBR(s);
    if (!p) return this.fail(key, `${label} inválido. Use DDD + número.`);
    return p;
  }

  cep(key, label, opts = {}) {
    const s = this.str(key, label, { ...opts, max: 12 });
    if (!s) return s;
    const c = normalizeCep(s);
    if (!c) return this.fail(key, `${label} inválido.`);
    return c;
  }

  cnpj(key, label, opts = {}) {
    const s = this.str(key, label, { ...opts, max: 20 });
    if (!s) return s;
    const c = normalizeCnpj(s);
    if (!c) return this.fail(key, `${label} inválido.`);
    return c;
  }

  instagram(key, label, opts = {}) {
    const s = this.str(key, label, { ...opts, max: 120 });
    if (!s) return s;
    const ig = normalizeInstagram(s);
    if (ig === null) return this.fail(key, `${label} inválido.`);
    return ig;
  }

  int(key, label, { required = false, min = -Infinity, max = Infinity } = {}) {
    if (this._absent(key, label, required)) return undefined;
    const n = Number(this.src[key]);
    if (!Number.isInteger(n)) return this.fail(key, `${label} deve ser um número inteiro.`);
    if (n < min || n > max) return this.fail(key, `${label} deve estar entre ${min} e ${max}.`);
    return n;
  }

  bool(key, label, { required = false } = {}) {
    if (this._absent(key, label, required)) return undefined;
    const v = this.src[key];
    if (v === true || v === 1 || v === '1' || v === 'true') return 1;
    if (v === false || v === 0 || v === '0' || v === 'false') return 0;
    return this.fail(key, `${label} inválido.`);
  }

  money(key, label, { required = false, max = 100000000 } = {}) {
    if (this._absent(key, label, required)) return undefined;
    const c = parseMoneyToCents(this.src[key]);
    if (c === null || c > max) return this.fail(key, `${label} inválido.`);
    return c;
  }

  oneOf(key, label, values, { required = false } = {}) {
    if (this._absent(key, label, required)) return undefined;
    const v = this.src[key];
    if (!values.includes(v)) return this.fail(key, `${label} inválido.`);
    return v;
  }

  date(key, label, { required = false } = {}) {
    if (this._absent(key, label, required)) return undefined;
    if (!isValidDate(this.src[key])) return this.fail(key, `${label} inválida (use AAAA-MM-DD).`);
    return this.src[key];
  }

  time(key, label, { required = false } = {}) {
    if (this._absent(key, label, required)) return undefined;
    if (!isValidTime(this.src[key])) return this.fail(key, `${label} inválido (use HH:MM).`);
    return this.src[key];
  }

  dateTime(key, label, { required = false } = {}) {
    if (this._absent(key, label, required)) return undefined;
    if (!isValidDateTime(this.src[key])) return this.fail(key, `${label} inválida (use AAAA-MM-DD HH:MM).`);
    return this.src[key];
  }

  slug(key, label, opts = {}) {
    const s = this.str(key, label, { ...opts, max: 60 });
    if (!s) return s;
    const lower = s.toLowerCase();
    if (!isValidSlug(lower)) return this.fail(key, `${label} inválido: use letras minúsculas, números e hífen (3 a 60 caracteres).`);
    return lower;
  }

  password(key, label, { required = true } = {}) {
    if (this._absent(key, label, required)) return undefined;
    const v = this.src[key];
    if (typeof v !== 'string') return this.fail(key, `${label} inválida.`);
    if (v.length < 8) return this.fail(key, `${label} deve ter ao menos 8 caracteres.`);
    if (v.length > 128) return this.fail(key, `${label} deve ter no máximo 128 caracteres.`);
    if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return this.fail(key, `${label} deve conter letras e números.`);
    return v;
  }

  done() {
    if (Object.keys(this.errors).length) {
      const first = Object.values(this.errors)[0];
      throw new HttpError(400, first, { fields: this.errors });
    }
  }
}

/** Remove chaves undefined (para UPDATE parcial) */
function defined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

module.exports = {
  HttpError, Checker, clean, defined,
  isValidEmail, normalizePhoneBR, normalizeCep, normalizeCnpj, normalizeInstagram,
  slugify, isValidSlug, isValidDate, isValidTime, isValidDateTime, parseMoneyToCents,
  HEX_RE,
};
