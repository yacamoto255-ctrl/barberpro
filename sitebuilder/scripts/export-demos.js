// scripts/export-demos.js — exporta o portfólio (/exemplos) e os sites de demonstração
// como páginas estáticas, para hospedar em qualquer lugar (Netlify, GitHub Pages...).
//   npm run export-demos -- pasta-de-saida
// Cada página sai autossuficiente: imagens embutidas e o agendamento simulado no próprio
// navegador (calcula horários a partir do expediente; nada é enviado a servidor algum).
'use strict';

const fs = require('fs');
const path = require('path');

const emitWarning = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w).includes('SQLite is an experimental') ? undefined : emitWarning.call(process, w, ...a));
try { process.loadEnvFile?.(); } catch (_) { /* sem .env */ }

const { createApp } = require('../src/app');
const { getDb, closeDb } = require('../src/db');

const off = (req, res, next) => next();

// Simulador da API pública, embutido em cada página exportada
const SHIM = `(function () {
  var D = window.__DEMO__;
  var realFetch = window.fetch;
  var p2 = function (n) { return String(n).padStart(2, '0'); };
  function nowLocal() {
    var f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    var o = {}; f.formatToParts(new Date()).forEach(function (x) { o[x.type] = x.value; });
    return o.year + '-' + o.month + '-' + o.day + ' ' + o.hour + ':' + o.minute;
  }
  function toDate(s) { var a = s.split(' '), d = a[0].split('-'), t = (a[1] || '00:00').split(':'); return new Date(Date.UTC(+d[0], d[1] - 1, +d[2], +t[0], +t[1])); }
  function fmt(dt) { return dt.getUTCFullYear() + '-' + p2(dt.getUTCMonth() + 1) + '-' + p2(dt.getUTCDate()) + ' ' + p2(dt.getUTCHours()) + ':' + p2(dt.getUTCMinutes()); }
  function addMin(s, m) { return fmt(new Date(toDate(s).getTime() + m * 60000)); }
  function addDays(d, n) { return addMin(d + ' 00:00', n * 1440).slice(0, 10); }
  function eligible(serviceId) {
    return D.professionals.filter(function (p) { return !p.service_ids.length || p.service_ids.indexOf(serviceId) >= 0; }).map(function (p) { return p.id; });
  }
  function slots(serviceId, date, profId) {
    var now = nowLocal(), today = now.slice(0, 10);
    if (date < today) return { slots: [], reason: 'Data no passado.' };
    if (date > addDays(today, D.site.max_days_ahead)) return { slots: [], reason: 'Agenda aberta até ' + D.site.max_days_ahead + ' dias à frente.' };
    var svc = D.services.filter(function (s) { return s.id === serviceId; })[0];
    if (!svc) return { slots: [], reason: 'Serviço não encontrado.' };
    var ranges = D.hours[toDate(date).getUTCDay()] || [];
    if (!ranges.length) return { slots: [], reason: 'Fechado neste dia.' };
    var res = D.professionals.length ? eligible(serviceId) : [null];
    if (profId) res = res.filter(function (x) { return x === profId; });
    if (!res.length) return { slots: [], reason: 'Nenhum profissional disponível para este serviço.' };
    var earliest = addMin(now, D.min_notice_min), out = [];
    ranges.forEach(function (r) {
      for (var st = date + ' ' + r[0]; addMin(st, svc.duration_min) <= date + ' ' + r[1]; st = addMin(st, D.slot_interval_min)) {
        if (st >= earliest) out.push({ time: st.slice(11), professional_ids: res.filter(function (x) { return x !== null; }) });
      }
    });
    return { slots: out };
  }
  function json(status, body) { return Promise.resolve(new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } })); }
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input.url;
    var base = '/api/public/sites/' + D.site.slug;
    if (url.indexOf(base) !== 0) return realFetch.apply(this, arguments);
    var u = new URL(url, 'https://demo.local'), q = u.searchParams, rest = u.pathname.slice(base.length);
    var sid = Number(q.get('service_id')), pid = q.get('professional_id') ? Number(q.get('professional_id')) : null;
    if (rest === '') return json(200, { site: D.site, services: D.services, professionals: D.professionals, today: nowLocal().slice(0, 10) });
    if (rest === '/days') {
      var today = nowLocal().slice(0, 10), from = q.get('from') && q.get('from') > today ? q.get('from') : today, last = addDays(today, D.site.max_days_ahead), days = [];
      for (var i = 0; i < 14 && from <= last; i++, from = addDays(from, 1)) days.push({ date: from, available: slots(sid, from, pid).slots.length > 0 });
      return json(200, { days: days, has_more: from <= last, next_from: from <= last ? from : null });
    }
    if (rest === '/availability') { var r = slots(sid, q.get('date'), pid); return json(200, { date: q.get('date'), service_id: sid, slots: r.slots, reason: r.reason || null }); }
    if (rest === '/bookings' && init && init.method === 'POST') {
      var b = JSON.parse(init.body || '{}');
      var phone = String(b.client_phone || '').replace(/\\D/g, '');
      if (!b.client_name || b.client_name.trim().length < 2) return json(400, { error: 'Informe seu nome.' });
      if (phone.length < 10 || phone.length > 13) return json(400, { error: 'WhatsApp inválido. Use DDD + número.' });
      var ok = slots(b.service_id, b.date, b.professional_id || null).slots.filter(function (s) { return s.time === b.time; })[0];
      if (!ok) return json(409, { error: 'Este horário acabou de ficar indisponível. Escolha outro.' });
      var svc = D.services.filter(function (s) { return s.id === b.service_id; })[0];
      var prof = D.professionals.filter(function (p) { return p.id === (b.professional_id || ok.professional_ids[0]); })[0];
      return json(201, { demo: true, cancel_url: null, booking: { id: null, service_name: svc.name, professional_name: prof ? prof.name : null,
        starts_at: b.date + ' ' + b.time, ends_at: addMin(b.date + ' ' + b.time, svc.duration_min), price_cents: svc.price_cents, status: 'confirmed' } });
    }
    return json(404, { error: 'Não encontrado.' });
  };
})();`;

async function exportDemos(outDir, { portfolioHref = 'index.html' } = {}) {
  const db = getDb();
  const sites = db.prepare('SELECT * FROM sites WHERE is_demo = 1 AND published = 1 ORDER BY name').all();
  if (!sites.length) throw new Error('Nenhum site de demonstração publicado. Rode "npm run seed-demos" antes.');

  const server = createApp({ limits: { login: off, publicWrite: off, publicRead: off, ai: off } }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p) => { const r = await fetch(base + p); if (!r.ok) throw new Error(`GET ${p}: ${r.status}`); return r; };
  const imgCache = new Map();
  const inlineImages = async (html) => {
    for (const m of new Set(html.match(/\/img\/\d+/g) || [])) {
      if (!imgCache.has(m)) {
        const r = await get(m);
        imgCache.set(m, `data:${r.headers.get('content-type')};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`);
      }
      html = html.split(`"${m}"`).join(`"${imgCache.get(m)}"`);
    }
    return html;
  };

  try {
    fs.mkdirSync(outDir, { recursive: true });
    const bookingJs = await (await get('/assets/booking.js')).text();
    const written = [];
    for (const site of sites) {
      let html = await (await get(`/s/${site.slug}`)).text();
      const api = await (await get(`/api/public/sites/${site.slug}`)).json();
      const hours = {};
      for (const h of db.prepare('SELECT weekday, open_time, close_time FROM business_hours WHERE site_id = ? ORDER BY weekday, open_time').all(site.id)) {
        (hours[h.weekday] ||= []).push([h.open_time, h.close_time]);
      }
      const demoData = {
        site: api.site, services: api.services, professionals: api.professionals, hours,
        slot_interval_min: site.slot_interval_min, min_notice_min: site.min_notice_min,
      };
      const scripts = `<script>window.__DEMO__=${JSON.stringify(demoData).replace(/</g, '\\u003c')};</script>\n<script>${SHIM}</script>\n<script>${bookingJs}</script>`;
      html = html.replace('<script src="/assets/booking.js" defer></script>', () => scripts)
        .split('href="/exemplos"').join(`href="${portfolioHref}"`);
      html = await inlineImages(html);
      const file = `${site.slug}.html`;
      fs.writeFileSync(path.join(outDir, file), html);
      written.push(file);
    }
    let index = await (await get('/exemplos')).text();
    for (const site of sites) index = index.split(`href="/s/${site.slug}"`).join(`href="${site.slug}.html"`);
    index = await inlineImages(index);
    fs.writeFileSync(path.join(outDir, 'index.html'), index);
    written.unshift('index.html');
    return written;
  } finally {
    server.close();
  }
}

if (require.main === module) {
  const out = process.argv[2] || path.join(__dirname, '..', 'data', 'export-demos');
  exportDemos(out)
    .then((files) => { console.log(`✔ ${files.length} páginas em ${out}:\n  ${files.join('\n  ')}`); closeDb(); process.exit(0); })
    .catch((e) => { console.error(`✘ ${e.message}`); closeDb(); process.exit(1); });
}

module.exports = { exportDemos, SHIM };
