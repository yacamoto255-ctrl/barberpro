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

// Simulador da API pública (o mesmo das prévias de modelos), embutido em cada página exportada
const SHIM = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'demo-shim.js'), 'utf8');

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
