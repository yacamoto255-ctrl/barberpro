// scripts/seed-site.js — cadastra (ou atualiza) um site completo a partir de um arquivo JSON.
//   npm run seed-site -- sites/consultorio.json            cria o site
//   npm run seed-site -- sites/consultorio.json --update   atualiza um site existente (mesmo "slug")
//   npm run seed-demos                                     cria/atualiza os sites de demonstração (sites/demos)
//
// Passa pela própria API do app (mesmas validações do painel), autenticado como o
// primeiro administrador ativo. Com --update nada é apagado: serviços e profissionais
// são casados pelo nome (cria os novos, atualiza os existentes); horários e tema são substituídos.
// Formato do arquivo: veja sites/exemplo.json.
'use strict';

const fs = require('fs');
const path = require('path');

const emitWarning = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w).includes('SQLite is an experimental') ? undefined : emitWarning.call(process, w, ...a));
try { process.loadEnvFile?.(); } catch (_) { /* sem .env */ }

const { createApp } = require('../src/app');
const { getDb, closeDb } = require('../src/db');
const { signToken } = require('../src/auth');

const DAYS = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6, 'sáb': 6 };
const off = (req, res, next) => next();

/** {"seg": "08:00-12:00, 13:30-18:00", "dom": null} -> [{weekday, open_time, close_time}] */
function parseHours(hours) {
  const out = [];
  for (const [day, value] of Object.entries(hours || {})) {
    const wd = DAYS[day.toLowerCase()];
    if (wd === undefined) throw new Error(`Dia inválido em "horarios": ${day} (use dom, seg, ter, qua, qui, sex, sab)`);
    if (!value) continue;
    for (const range of String(value).split(',').map((r) => r.trim()).filter(Boolean)) {
      const m = range.match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);
      if (!m) throw new Error(`Faixa inválida em "horarios.${day}": "${range}" (use 08:00-12:00)`);
      out.push({ weekday: wd, open_time: m[1], close_time: m[2] });
    }
  }
  return out;
}

async function seed(file, { update = false, log = console.log } = {}) {
  const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
  const baseDir = path.dirname(path.resolve(file));
  if (!spec.site || !spec.site.name) throw new Error('O arquivo precisa de "site.name".');

  const admin = getDb().prepare("SELECT * FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1").get();
  if (!admin) throw new Error('Nenhum administrador ativo. Abra o painel e faça o primeiro acesso antes.');

  const server = createApp({ limits: { login: off, publicWrite: off, publicRead: off, ai: off } }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const token = signToken(admin);
  const call = async (method, p, body, contentType = 'application/json') => {
    const res = await fetch(base + p, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': contentType } : {}) },
      body: body === undefined ? undefined : (contentType === 'application/json' ? JSON.stringify(body) : body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const fields = data.fields ? ` ${JSON.stringify(data.fields)}` : '';
      throw new Error(`${method} ${p}: ${data.error || res.status}${fields}`);
    }
    return data;
  };
  const upload = (p, rel) => {
    const abs = path.resolve(baseDir, rel);
    const buf = fs.readFileSync(abs);
    const ext = path.extname(abs).toLowerCase();
    const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return call('POST', p, buf, type);
  };

  let site;
  try {
    const { published, ...siteFields } = spec.site;
    const existing = siteFields.slug && getDb().prepare('SELECT id FROM sites WHERE slug = ?').get(siteFields.slug);
    if (existing && !update) throw new Error(`Já existe um site com o endereço "${siteFields.slug}". Use --update para atualizar.`);
    if (existing) {
      site = (await call('PATCH', `/sites/${existing.id}`, siteFields)).site;
      log(`✔ Site atualizado: ${site.name} (/s/${site.slug})`);
    } else {
      site = (await call('POST', '/sites', siteFields)).site;
      log(`✔ Site criado: ${site.name} (/s/${site.slug})`);
    }

    const current = await call('GET', `/sites/${site.id}`);
    const svcByName = Object.fromEntries(current.services.map((s) => [s.name.toLowerCase(), s]));
    for (const [i, s] of (spec.servicos || []).entries()) {
      const body = { sort_order: i, active: true, price: 0, ...s };
      const found = svcByName[s.name.toLowerCase()];
      const saved = found ? (await call('PATCH', `/sites/${site.id}/services/${found.id}`, body)).service
        : (await call('POST', `/sites/${site.id}/services`, body)).service;
      svcByName[saved.name.toLowerCase()] = saved;
    }
    log(`✔ ${(spec.servicos || []).length} serviço(s)`);

    const profByName = Object.fromEntries(current.professionals.map((p) => [p.name.toLowerCase(), p]));
    for (const [i, p] of (spec.profissionais || []).entries()) {
      const { servicos, foto, ...rest } = p;
      const body = { sort_order: i, active: true, ...rest };
      if (servicos) {
        body.service_ids = servicos.map((n) => {
          const s = svcByName[String(n).toLowerCase()];
          if (!s) throw new Error(`Profissional "${p.name}": serviço "${n}" não está em "servicos".`);
          return s.id;
        });
      }
      const found = profByName[p.name.toLowerCase()];
      const saved = found ? (await call('PATCH', `/sites/${site.id}/professionals/${found.id}`, body)).professional
        : (await call('POST', `/sites/${site.id}/professionals`, body)).professional;
      if (foto) await upload(`/sites/${site.id}/professionals/${saved.id}/photo`, foto);
    }
    log(`✔ ${(spec.profissionais || []).length} profissional(is)`);

    if (spec.horarios) {
      const hours = parseHours(spec.horarios);
      await call('PUT', `/sites/${site.id}/hours`, { hours });
      log(`✔ Horários: ${hours.length} faixa(s)`);
    }
    for (const b of spec.bloqueios || []) await call('POST', `/sites/${site.id}/blocks`, b);

    if (spec.tema) {
      const r = await call('PUT', `/sites/${site.id}/theme`, { theme: spec.tema });
      log(`✔ Tema aplicado${r.warnings.length ? ` (ajustes: ${r.warnings.join(' ')})` : ''}`);
    }
    const img = spec.imagens || {};
    if (img.logo) await upload(`/sites/${site.id}/images?kind=logo`, img.logo);
    if (img.capa) await upload(`/sites/${site.id}/images?kind=hero`, img.capa);
    for (const g of img.galeria || []) await upload(`/sites/${site.id}/images?kind=gallery`, g);
    if (img.logo || img.capa || img.galeria) log('✔ Imagens enviadas');

    if (published !== undefined) {
      site = (await call('PATCH', `/sites/${site.id}`, { published })).site;
      log(published ? `✔ Publicado em /s/${site.slug}` : '• Mantido como rascunho (published: false)');
    }
    return site;
  } catch (e) {
    if (site) e.message += ` — o site "${site.slug}" já foi criado em parte; corrija o arquivo e rode de novo com --update.`;
    throw e;
  } finally {
    server.close();
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Uso: npm run seed-site -- caminho/do/site.json [--update]');
    process.exit(1);
  }
  // Uma pasta cadastra todos os .json dela (ex.: npm run seed-demos)
  const files = fs.statSync(file).isDirectory()
    ? fs.readdirSync(file).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(file, f))
    : [file];
  (async () => {
    for (const f of files) {
      console.log(`\n» ${path.basename(f)}`);
      await seed(f, { update: args.includes('--update') });
    }
  })()
    .then(() => { closeDb(); process.exit(0); })
    .catch((e) => { console.error(`✘ ${e.message}`); closeDb(); process.exit(1); });
}

module.exports = { seed, parseHours };
