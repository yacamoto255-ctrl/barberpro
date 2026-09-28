'use strict';
// Relógio da aplicação. Horários são gravados como texto 'YYYY-MM-DD HH:MM:SS'
// no fuso da operação (APP_TZ). Isso simplifica filtros por dia/turno no SQL.
// Observação: o Brasil não tem horário de verão desde 2019, então a diferença
// entre dois horários locais é igual à diferença real em segundos.
const { APP_TZ } = require('../config');

let override = null; // usado apenas em testes

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});

function toLocal(date) {
  const p = Object.fromEntries(fmt.formatToParts(date).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

function now() {
  return override || toLocal(new Date());
}

function today() {
  return now().slice(0, 10);
}

function setNow(value) { override = value; }

const TS_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidTimestamp(s) {
  if (typeof s !== 'string' || !TS_RE.test(s)) return false;
  return !Number.isNaN(Date.parse(normalize(s).replace(' ', 'T') + 'Z'));
}

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Aceita 'YYYY-MM-DDTHH:MM' (input datetime-local) e devolve 'YYYY-MM-DD HH:MM:SS'
function normalize(s) {
  let v = s.replace('T', ' ');
  if (v.length === 16) v += ':00';
  return v;
}

function diffSeconds(start, end) {
  const a = Date.parse(start.replace(' ', 'T') + 'Z');
  const b = Date.parse(end.replace(' ', 'T') + 'Z');
  return Math.round((b - a) / 1000);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

module.exports = { now, today, setNow, toLocal, isValidTimestamp, isValidDate, normalize, diffSeconds, addDays };
