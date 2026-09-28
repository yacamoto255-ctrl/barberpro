'use strict';
// Validações simples e explícitas (sem dependência externa).
const { badRequest } = require('./errors');
const clock = require('./clock');

function str(v) { return typeof v === 'string' ? v.trim() : v; }

function isCpfValid(cpf) {
  const d = String(cpf).replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (let t = 9; t < 11; t++) {
    let sum = 0;
    for (let i = 0; i < t; i++) sum += Number(d[i]) * (t + 1 - i);
    const dig = ((sum * 10) % 11) % 10;
    if (dig !== Number(d[t])) return false;
  }
  return true;
}

// Código de barras do ajudante: letras, números e hífen, 1 a 32 caracteres.
// É normalizado para MAIÚSCULAS e sem espaços — o leitor "digita" o código.
function normalizeBarcode(v) {
  return String(v ?? '').trim().toUpperCase();
}
const BARCODE_RE = /^[A-Z0-9-]{1,32}$/;

/**
 * Valida um objeto contra um esquema simples.
 * schema: { campo: { required, type: 'string'|'number'|'int'|'bool'|'date'|'timestamp'|'enum', max, min, values, label } }
 * Retorna somente os campos presentes no esquema (whitelist).
 */
function validate(body, schema, { partial = false } = {}) {
  const out = {};
  const errors = {};
  const src = body && typeof body === 'object' ? body : {};
  for (const [key, rule] of Object.entries(schema)) {
    const label = rule.label || key;
    let v = str(src[key]);
    const absent = v === undefined || v === null || v === '';
    if (absent) {
      if (rule.default !== undefined && (!partial || key in src)) { out[key] = rule.default; continue; }
      if (rule.required && !partial) errors[key] = `${label} é obrigatório.`;
      else if (key in src && rule.type !== 'bool') out[key] = null;
      continue;
    }
    switch (rule.type) {
      case 'string':
        if (typeof v !== 'string') { errors[key] = `${label} inválido.`; break; }
        if (rule.max && v.length > rule.max) { errors[key] = `${label} deve ter no máximo ${rule.max} caracteres.`; break; }
        if (rule.pattern && !rule.pattern.test(v)) { errors[key] = rule.patternMsg || `${label} inválido.`; break; }
        out[key] = v; break;
      case 'number':
      case 'int': {
        const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
        if (!Number.isFinite(n) || (rule.type === 'int' && !Number.isInteger(n))) { errors[key] = `${label} deve ser um número${rule.type === 'int' ? ' inteiro' : ''}.`; break; }
        if (rule.min !== undefined && n < rule.min) { errors[key] = `${label} deve ser maior ou igual a ${rule.min}.`; break; }
        if (rule.max !== undefined && n > rule.max) { errors[key] = `${label} deve ser menor ou igual a ${rule.max}.`; break; }
        out[key] = n; break;
      }
      case 'bool':
        out[key] = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0; break;
      case 'date':
        if (!clock.isValidDate(v)) { errors[key] = `${label}: data inválida (use AAAA-MM-DD).`; break; }
        out[key] = v; break;
      case 'timestamp':
        if (!clock.isValidTimestamp(v)) { errors[key] = `${label}: data/hora inválida.`; break; }
        out[key] = clock.normalize(v); break;
      case 'enum':
        if (!rule.values.includes(v)) { errors[key] = `${label}: valor inválido.`; break; }
        out[key] = v; break;
      default:
        out[key] = v;
    }
  }
  if (Object.keys(errors).length) {
    throw badRequest(Object.values(errors)[0], errors);
  }
  return out;
}

function toInt(v, def) {
  const n = Number(v);
  return Number.isInteger(n) ? n : def;
}

module.exports = { validate, isCpfValid, normalizeBarcode, BARCODE_RE, toInt };
