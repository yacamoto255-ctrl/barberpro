// src/routes/sites.js — sites e recursos internos (serviços, profissionais, horários, bloqueios, imagens)
'use strict';

const express = require('express');
const { getDb, transaction } = require('../db');
const { Checker, HttpError, defined, slugify, isValidSlug, isValidTime } = require('../validators');
const { requireAuth, requireRole } = require('../auth');
const { audit } = require('../audit');
const { ah, idParam } = require('../util');
const { validateTheme, defaultThemeFor, generateTheme } = require('../services/theme');
const { nowLocal } = require('../services/slots');
const models = require('../services/models');

const CATEGORIES = [
  'barbearia', 'salao', 'estetica', 'clinica', 'odontologia', 'psicologia', 'nutricao',
  'estudio_tatuagem', 'pet', 'fitness', 'fotografia', 'consultoria', 'aulas', 'outro',
];
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR',
  'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_GALLERY = 12;

function getSite(id) {
  const site = getDb().prepare('SELECT * FROM sites WHERE id = ?').get(id);
  if (!site) throw new HttpError(404, 'Site não encontrado.');
  return site;
}

function siteOut(site) {
  const { theme_json, ...rest } = site;
  let theme = null;
  try { theme = theme_json ? JSON.parse(theme_json) : null; } catch { theme = null; }
  return { ...rest, theme: theme || defaultThemeFor(site) };
}

function readSiteFields(body, partial) {
  const c = new Checker(body, { partial });
  const data = defined({
    name: c.str('name', 'Nome do negócio', { required: true, min: 2, max: 120 }),
    slug: c.slug('slug', 'Endereço do site'),
    category: c.oneOf('category', 'Categoria', CATEGORIES),
    tagline: c.str('tagline', 'Frase de efeito', { max: 160 }),
    description: c.str('description', 'Descrição', { max: 2000 }),
    phone: c.phone('phone', 'Telefone'),
    whatsapp: c.phone('whatsapp', 'WhatsApp'),
    email: c.email('email', 'E-mail'),
    instagram: c.instagram('instagram', 'Instagram'),
    cnpj: c.cnpj('cnpj', 'CNPJ'),
    cep: c.cep('cep', 'CEP'),
    address: c.str('address', 'Endereço', { max: 200 }),
    city: c.str('city', 'Cidade', { max: 80 }),
    state: c.has('state') && body.state === '' ? '' : c.oneOf('state', 'UF', UFS),
    published: c.bool('published', 'Publicado'),
    booking_enabled: c.bool('booking_enabled', 'Agendamento online'),
    slot_interval_min: c.int('slot_interval_min', 'Intervalo entre horários', { min: 5, max: 240 }),
    min_notice_min: c.int('min_notice_min', 'Antecedência mínima', { min: 0, max: 10080 }),
    max_days_ahead: c.int('max_days_ahead', 'Dias de agenda aberta', { min: 1, max: 365 }),
    notify_whatsapp: c.bool('notify_whatsapp', 'Avisar o negócio por WhatsApp'),
    notify_client_whatsapp: c.bool('notify_client_whatsapp', 'Confirmar para o cliente por WhatsApp'),
    evolution_instance: c.str('evolution_instance', 'Instância Evolution', { max: 80 }),
    hide_prices: c.bool('hide_prices', 'Ocultar preços'),
    is_demo: c.bool('is_demo', 'Site de demonstração'),
    responsible_name: c.str('responsible_name', 'Responsável técnico', { max: 120 }),
    responsible_registration: c.registration('responsible_registration', 'Registro do responsável'),
    company_registration: c.registration('company_registration', 'Registro da empresa no conselho'),
  });
  c.done();
  // campos opcionais esvaziados viram NULL
  for (const k of ['tagline', 'description', 'phone', 'whatsapp', 'email', 'instagram', 'cnpj', 'cep',
    'address', 'city', 'state', 'evolution_instance', 'responsible_name', 'responsible_registration', 'company_registration']) {
    if (data[k] === '') data[k] = null;
  }
  return data;
}

function uniqueSlug(base, excludeId = 0) {
  const db = getDb();
  let slug = base;
  for (let i = 2; db.prepare('SELECT 1 FROM sites WHERE slug = ? AND id <> ?').get(slug, excludeId); i++) {
    slug = `${base.slice(0, 55)}-${i}`;
  }
  return slug;
}

function detectImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function hasFutureBookings(column, id) {
  const now = nowLocal();
  return getDb().prepare(
    `SELECT COUNT(*) AS n FROM bookings WHERE ${column} = ? AND status IN ('pending','confirmed') AND starts_at >= ?`
  ).get(id, now).n;
}

module.exports = (limits) => {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin', 'operator'));

  /* ── Sites ─────────────────────────────────────────────── */
  router.get('/', (req, res) => {
    const rows = getDb().prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM services sv WHERE sv.site_id = s.id AND sv.active = 1) AS services_count,
        (SELECT COUNT(*) FROM bookings b WHERE b.site_id = s.id AND b.status IN ('pending','confirmed')
           AND b.starts_at >= ?) AS upcoming_count
      FROM sites s ORDER BY s.name`).all(nowLocal());
    res.json({ sites: rows.map(siteOut), categories: CATEGORIES, ufs: UFS });
  });

  router.post('/', ah(async (req, res) => {
    const data = readSiteFields(req.body, false);
    const db = getDb();
    if (data.slug) {
      if (db.prepare('SELECT 1 FROM sites WHERE slug = ?').get(data.slug)) {
        throw new HttpError(409, 'Este endereço já está em uso.', { fields: { slug: 'Endereço já em uso.' } });
      }
    } else {
      let base = slugify(data.name);
      if (!isValidSlug(base)) base = `site-${base || 'novo'}`.slice(0, 60).replace(/-+$/, '');
      data.slug = uniqueSlug(base);
    }
    data.category = data.category || 'outro';
    // Odontologia: o Código de Ética do CFO veda anunciar preços; começa oculto (pode ser mudado no painel)
    if (data.hide_prices === undefined && data.category === 'odontologia') data.hide_prices = 1;
    const id = transaction((tx) => {
      const cols = Object.keys(data);
      const info = tx.prepare(`INSERT INTO sites (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(...Object.values(data));
      const siteId = Number(info.lastInsertRowid);
      // Horário padrão: seg a sex 09–18, sáb 09–13
      const ins = tx.prepare('INSERT INTO business_hours (site_id, weekday, open_time, close_time) VALUES (?, ?, ?, ?)');
      for (let wd = 1; wd <= 5; wd++) ins.run(siteId, wd, '09:00', '18:00');
      ins.run(siteId, 6, '09:00', '13:00');
      return siteId;
    });
    audit(req, 'site.create', 'site', id, { name: data.name, slug: data.slug });
    res.status(201).json({ site: siteOut(getSite(id)) });
  }));

  router.get('/:id', (req, res) => {
    const site = getSite(idParam(req));
    const db = getDb();
    res.json({
      site: siteOut(site),
      services: db.prepare('SELECT * FROM services WHERE site_id = ? ORDER BY sort_order, name').all(site.id),
      professionals: db.prepare('SELECT * FROM professionals WHERE site_id = ? ORDER BY sort_order, name').all(site.id)
        .map((p) => ({
          ...p,
          service_ids: db.prepare('SELECT service_id FROM professional_services WHERE professional_id = ?')
            .all(p.id).map((r) => r.service_id),
        })),
      hours: db.prepare('SELECT weekday, open_time, close_time FROM business_hours WHERE site_id = ? ORDER BY weekday, open_time').all(site.id),
      blocks: db.prepare('SELECT * FROM blocks WHERE site_id = ? AND ends_at >= ? ORDER BY starts_at').all(site.id, nowLocal()),
      images: db.prepare('SELECT id, kind, mime, size, created_at FROM images WHERE site_id = ? ORDER BY id').all(site.id),
    });
  });

  router.patch('/:id', ah(async (req, res) => {
    const site = getSite(idParam(req));
    const data = readSiteFields(req.body, true);
    const db = getDb();
    if (data.slug && data.slug !== site.slug
      && db.prepare('SELECT 1 FROM sites WHERE slug = ? AND id <> ?').get(data.slug, site.id)) {
      throw new HttpError(409, 'Este endereço já está em uso.', { fields: { slug: 'Endereço já em uso.' } });
    }
    if (Object.keys(data).length) {
      const sets = Object.keys(data).map((k) => `${k} = ?`).join(', ');
      db.prepare(`UPDATE sites SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...Object.values(data), site.id);
    }
    audit(req, 'site.update', 'site', site.id, data);
    res.json({ site: siteOut(getSite(site.id)) });
  }));

  // Exclusão definitiva: só admin, e exige digitar o endereço do site como confirmação
  router.delete('/:id', requireRole('admin'), (req, res) => {
    const site = getSite(idParam(req));
    if (req.body?.confirm !== site.slug) {
      throw new HttpError(400, `Para excluir, confirme digitando o endereço do site: ${site.slug}`);
    }
    getDb().prepare('DELETE FROM sites WHERE id = ?').run(site.id);
    audit(req, 'site.delete', 'site', site.id, { name: site.name, slug: site.slug });
    res.json({ ok: true });
  });

  router.put('/:id/theme', ah(async (req, res) => {
    const site = getSite(idParam(req));
    const { theme, warnings } = validateTheme(req.body?.theme);
    getDb().prepare(`UPDATE sites SET theme_json = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(JSON.stringify(theme), site.id);
    audit(req, 'site.theme_update', 'site', site.id);
    res.json({ site: siteOut(getSite(site.id)), warnings });
  }));

  // Gera tema com IA e já salva; devolve o anterior para o painel oferecer "desfazer"
  router.post('/:id/theme/generate', limits.ai, ah(async (req, res) => {
    const site = getSite(idParam(req));
    const c = new Checker(req.body || {});
    const hint = c.str('hint', 'Orientação de estilo', { max: 300 });
    c.done();
    const services = getDb().prepare('SELECT name, duration_min FROM services WHERE site_id = ? AND active = 1 ORDER BY sort_order, name').all(site.id);
    const previous = siteOut(site).theme;
    const { theme, warnings, model } = await generateTheme(site, services, hint || '');
    getDb().prepare(`UPDATE sites SET theme_json = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(theme), site.id);
    audit(req, 'site.theme_ai', 'site', site.id, { model, hint: hint || null });
    res.json({ site: siteOut(getSite(site.id)), previous_theme: previous, warnings, model });
  }));

  // Aplica um modelo do catálogo (sites/modelos): visual sempre; textos e capa ilustrada se pedidos
  router.post('/:id/apply-model', (req, res) => {
    const site = getSite(idParam(req));
    const c = new Checker(req.body || {});
    const modelId = c.str('model_id', 'Modelo', { required: true, max: 40 });
    const withCopy = c.bool('copy', 'Usar os textos do modelo');
    const withCover = c.bool('cover', 'Usar a capa do modelo');
    c.done();
    const model = models.getModel(modelId);
    if (!model) throw new HttpError(404, 'Modelo não encontrado.', { fields: { model_id: 'Modelo não encontrado.' } });
    const previous = siteOut(site).theme;
    const theme = structuredClone(model.theme);
    theme.preset = 'custom';
    const useCopy = withCopy !== 0 && withCopy !== false;
    const useCover = withCover !== 0 && withCover !== false;
    if (!useCopy) theme.copy = previous.copy;
    const warnings = [];
    if (useCopy && model.category !== site.category) {
      warnings.push(`Os textos deste modelo foram escritos para ${model.category_label.toLowerCase()}. Revise-os em "Ajuste fino".`);
    }
    const coverFile = useCover ? models.imagePath(model.id, 'cover') : null;
    if (useCover && !coverFile) warnings.push('Este modelo não tem capa ilustrada; a imagem de capa atual foi mantida.');
    transaction((tx) => {
      tx.prepare(`UPDATE sites SET theme_json = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(theme), site.id);
      if (coverFile) {
        const buf = require('fs').readFileSync(coverFile);
        const info = tx.prepare('INSERT INTO images (site_id, kind, mime, size, data) VALUES (?, ?, ?, ?, ?)').run(site.id, 'hero', 'image/png', buf.length, buf);
        if (site.hero_image_id) tx.prepare('DELETE FROM images WHERE id = ?').run(site.hero_image_id);
        tx.prepare('UPDATE sites SET hero_image_id = ? WHERE id = ?').run(Number(info.lastInsertRowid), site.id);
      }
    });
    audit(req, 'site.apply_model', 'site', site.id, { model_id: model.id, copy: useCopy, cover: !!coverFile });
    res.json({ site: siteOut(getSite(site.id)), previous_theme: previous, warnings, model: models.summary(model) });
  });

  router.get('/:id/preview-link', (req, res) => {
    const site = getSite(idParam(req));
    const { previewToken } = require('./public');
    const url = site.published ? `/s/${site.slug}` : `/s/${site.slug}?preview=${previewToken(site.id)}`;
    res.json({ url, published: !!site.published });
  });

  /* ── Serviços ──────────────────────────────────────────── */
  function readService(body, partial) {
    const c = new Checker(body, { partial });
    const data = defined({
      name: c.str('name', 'Nome do serviço', { required: true, min: 2, max: 120 }),
      description: c.str('description', 'Descrição', { max: 500 }),
      duration_min: c.int('duration_min', 'Duração (min)', { required: true, min: 5, max: 720 }),
      price_cents: c.money('price', 'Preço', { required: true }),
      active: c.bool('active', 'Ativo'),
      sort_order: c.int('sort_order', 'Ordem', { min: 0, max: 9999 }),
    });
    c.done();
    if (data.description === '') data.description = null;
    return data;
  }

  function getService(siteId, serviceId) {
    const s = getDb().prepare('SELECT * FROM services WHERE id = ? AND site_id = ?').get(serviceId, siteId);
    if (!s) throw new HttpError(404, 'Serviço não encontrado.');
    return s;
  }

  function assertServiceNameFree(siteId, name, exceptId = 0) {
    if (getDb().prepare('SELECT 1 FROM services WHERE site_id = ? AND name = ? COLLATE NOCASE AND id <> ?').get(siteId, name, exceptId)) {
      throw new HttpError(409, 'Já existe um serviço com este nome neste site.', { fields: { name: 'Nome já cadastrado.' } });
    }
  }

  router.post('/:id/services', (req, res) => {
    const site = getSite(idParam(req));
    const data = readService(req.body, false);
    assertServiceNameFree(site.id, data.name);
    const cols = ['site_id', ...Object.keys(data)];
    const info = getDb().prepare(`INSERT INTO services (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(site.id, ...Object.values(data));
    audit(req, 'service.create', 'service', Number(info.lastInsertRowid), { site_id: site.id, name: data.name });
    res.status(201).json({ service: getService(site.id, Number(info.lastInsertRowid)) });
  });

  router.patch('/:id/services/:serviceId', (req, res) => {
    const site = getSite(idParam(req));
    const svc = getService(site.id, idParam(req, 'serviceId'));
    const data = readService(req.body, true);
    if (data.name) assertServiceNameFree(site.id, data.name, svc.id);
    if (Object.keys(data).length) {
      const sets = Object.keys(data).map((k) => `${k} = ?`).join(', ');
      getDb().prepare(`UPDATE services SET ${sets} WHERE id = ?`).run(...Object.values(data), svc.id);
    }
    audit(req, 'service.update', 'service', svc.id, data);
    res.json({ service: getService(site.id, svc.id) });
  });

  router.delete('/:id/services/:serviceId', (req, res) => {
    const site = getSite(idParam(req));
    const svc = getService(site.id, idParam(req, 'serviceId'));
    const n = hasFutureBookings('service_id', svc.id);
    if (n) throw new HttpError(409, `Este serviço tem ${n} agendamento(s) futuro(s). Desative-o em vez de excluir, ou cancele os agendamentos.`);
    getDb().prepare('DELETE FROM services WHERE id = ?').run(svc.id);
    audit(req, 'service.delete', 'service', svc.id, { name: svc.name, site_id: site.id });
    res.json({ ok: true });
  });

  /* ── Profissionais ─────────────────────────────────────── */
  function readProfessional(body, partial, siteId) {
    const c = new Checker(body, { partial });
    const data = defined({
      name: c.str('name', 'Nome', { required: true, min: 2, max: 120 }),
      title: c.str('title', 'Função', { max: 80 }),
      bio: c.str('bio', 'Apresentação', { max: 600 }),
      registration: c.registration('registration', 'Registro profissional'),
      active: c.bool('active', 'Ativo'),
      sort_order: c.int('sort_order', 'Ordem', { min: 0, max: 9999 }),
    });
    let serviceIds;
    if (body && body.service_ids !== undefined) {
      if (!Array.isArray(body.service_ids) || body.service_ids.some((x) => !Number.isInteger(Number(x)))) {
        c.fail('service_ids', 'Serviços inválidos.');
      } else {
        serviceIds = [...new Set(body.service_ids.map(Number))];
        const valid = serviceIds.length
          ? getDb().prepare(`SELECT COUNT(*) AS n FROM services WHERE site_id = ? AND id IN (${serviceIds.map(() => '?').join(',')})`)
            .get(siteId, ...serviceIds).n
          : 0;
        if (valid !== serviceIds.length) c.fail('service_ids', 'Há serviços que não pertencem a este site.');
      }
    }
    c.done();
    for (const k of ['title', 'bio', 'registration']) if (data[k] === '') data[k] = null;
    return { data, serviceIds };
  }

  function getProfessional(siteId, pid) {
    const db = getDb();
    const p = db.prepare('SELECT * FROM professionals WHERE id = ? AND site_id = ?').get(pid, siteId);
    if (!p) throw new HttpError(404, 'Profissional não encontrado.');
    p.service_ids = db.prepare('SELECT service_id FROM professional_services WHERE professional_id = ?').all(pid).map((r) => r.service_id);
    return p;
  }

  function saveProfessionalServices(tx, pid, serviceIds) {
    if (!serviceIds) return;
    tx.prepare('DELETE FROM professional_services WHERE professional_id = ?').run(pid);
    const ins = tx.prepare('INSERT INTO professional_services (professional_id, service_id) VALUES (?, ?)');
    for (const sid of serviceIds) ins.run(pid, sid);
  }

  router.post('/:id/professionals', (req, res) => {
    const site = getSite(idParam(req));
    const { data, serviceIds } = readProfessional(req.body, false, site.id);
    const pid = transaction((tx) => {
      const cols = ['site_id', ...Object.keys(data)];
      const info = tx.prepare(`INSERT INTO professionals (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(site.id, ...Object.values(data));
      const id = Number(info.lastInsertRowid);
      saveProfessionalServices(tx, id, serviceIds);
      return id;
    });
    audit(req, 'professional.create', 'professional', pid, { site_id: site.id, name: data.name });
    res.status(201).json({ professional: getProfessional(site.id, pid) });
  });

  router.patch('/:id/professionals/:pid', (req, res) => {
    const site = getSite(idParam(req));
    const prof = getProfessional(site.id, idParam(req, 'pid'));
    const { data, serviceIds } = readProfessional(req.body, true, site.id);
    transaction((tx) => {
      if (Object.keys(data).length) {
        const sets = Object.keys(data).map((k) => `${k} = ?`).join(', ');
        tx.prepare(`UPDATE professionals SET ${sets} WHERE id = ?`).run(...Object.values(data), prof.id);
      }
      saveProfessionalServices(tx, prof.id, serviceIds);
    });
    audit(req, 'professional.update', 'professional', prof.id, { ...data, service_ids: serviceIds });
    res.json({ professional: getProfessional(site.id, prof.id) });
  });

  router.delete('/:id/professionals/:pid', (req, res) => {
    const site = getSite(idParam(req));
    const prof = getProfessional(site.id, idParam(req, 'pid'));
    const n = hasFutureBookings('professional_id', prof.id);
    if (n) throw new HttpError(409, `Este profissional tem ${n} agendamento(s) futuro(s). Desative-o em vez de excluir, ou cancele os agendamentos.`);
    transaction((tx) => {
      if (prof.photo_image_id) tx.prepare('DELETE FROM images WHERE id = ?').run(prof.photo_image_id);
      tx.prepare('DELETE FROM professionals WHERE id = ?').run(prof.id);
    });
    audit(req, 'professional.delete', 'professional', prof.id, { name: prof.name, site_id: site.id });
    res.json({ ok: true });
  });

  /* ── Horários de funcionamento ─────────────────────────── */
  router.put('/:id/hours', (req, res) => {
    const site = getSite(idParam(req));
    const list = req.body?.hours;
    if (!Array.isArray(list) || list.length > 28) throw new HttpError(400, 'Envie a lista de horários (até 4 faixas por dia).');
    const byDay = new Map();
    list.forEach((h, i) => {
      const wd = Number(h?.weekday);
      if (!Number.isInteger(wd) || wd < 0 || wd > 6) throw new HttpError(400, `Faixa ${i + 1}: dia da semana inválido.`);
      if (!isValidTime(h.open_time) || !isValidTime(h.close_time)) throw new HttpError(400, `Faixa ${i + 1}: horário inválido (use HH:MM).`);
      if (h.open_time >= h.close_time) throw new HttpError(400, `Faixa ${i + 1}: a abertura deve ser antes do fechamento.`);
      if (!byDay.has(wd)) byDay.set(wd, []);
      byDay.get(wd).push({ open: h.open_time, close: h.close_time });
    });
    for (const [wd, ranges] of byDay) {
      if (ranges.length > 4) throw new HttpError(400, 'Máximo de 4 faixas de horário por dia.');
      ranges.sort((a, b) => a.open.localeCompare(b.open));
      for (let i = 1; i < ranges.length; i++) {
        if (ranges[i].open < ranges[i - 1].close) throw new HttpError(400, `Há faixas sobrepostas no mesmo dia (${wd}).`);
      }
    }
    transaction((tx) => {
      tx.prepare('DELETE FROM business_hours WHERE site_id = ?').run(site.id);
      const ins = tx.prepare('INSERT INTO business_hours (site_id, weekday, open_time, close_time) VALUES (?, ?, ?, ?)');
      for (const [wd, ranges] of byDay) for (const r of ranges) ins.run(site.id, wd, r.open, r.close);
    });
    audit(req, 'site.hours_update', 'site', site.id, list);
    res.json({ hours: getDb().prepare('SELECT weekday, open_time, close_time FROM business_hours WHERE site_id = ? ORDER BY weekday, open_time').all(site.id) });
  });

  /* ── Bloqueios (folgas, feriados, férias) ──────────────── */
  router.post('/:id/blocks', (req, res) => {
    const site = getSite(idParam(req));
    const c = new Checker(req.body);
    const starts = c.dateTime('starts_at', 'Início', { required: true });
    const ends = c.dateTime('ends_at', 'Fim', { required: true });
    const reason = c.str('reason', 'Motivo', { max: 160 });
    const pid = c.int('professional_id', 'Profissional', { min: 1 });
    c.done();
    if (starts >= ends) throw new HttpError(400, 'O início deve ser antes do fim.', { fields: { ends_at: 'Fim deve ser depois do início.' } });
    if (pid) getProfessional(site.id, pid);
    const info = getDb().prepare('INSERT INTO blocks (site_id, professional_id, starts_at, ends_at, reason) VALUES (?, ?, ?, ?, ?)')
      .run(site.id, pid || null, starts, ends, reason || null);
    audit(req, 'block.create', 'block', Number(info.lastInsertRowid), { site_id: site.id, starts, ends });
    res.status(201).json({ block: getDb().prepare('SELECT * FROM blocks WHERE id = ?').get(info.lastInsertRowid) });
  });

  router.delete('/:id/blocks/:blockId', (req, res) => {
    const site = getSite(idParam(req));
    const id = idParam(req, 'blockId');
    const r = getDb().prepare('DELETE FROM blocks WHERE id = ? AND site_id = ?').run(id, site.id);
    if (!r.changes) throw new HttpError(404, 'Bloqueio não encontrado.');
    audit(req, 'block.delete', 'block', id, { site_id: site.id });
    res.json({ ok: true });
  });

  /* ── Imagens (logo, capa, galeria, foto de profissional) ── */
  const rawImage = express.raw({ type: () => true, limit: MAX_IMAGE_BYTES });

  function storeImage(req, siteId, kind) {
    const mime = detectImage(req.body);
    if (!mime) throw new HttpError(415, 'Arquivo inválido. Envie uma imagem PNG, JPG ou WebP.');
    const info = getDb().prepare('INSERT INTO images (site_id, kind, mime, size, data) VALUES (?, ?, ?, ?, ?)')
      .run(siteId, kind, mime, req.body.length, req.body);
    return Number(info.lastInsertRowid);
  }

  router.post('/:id/images', rawImage, (req, res) => {
    const site = getSite(idParam(req));
    const kind = req.query.kind;
    if (!['logo', 'hero', 'gallery'].includes(kind)) throw new HttpError(400, 'Tipo de imagem inválido (logo, hero ou gallery).');
    const db = getDb();
    if (kind === 'gallery' && db.prepare("SELECT COUNT(*) AS n FROM images WHERE site_id = ? AND kind = 'gallery'").get(site.id).n >= MAX_GALLERY) {
      throw new HttpError(400, `A galeria aceita no máximo ${MAX_GALLERY} imagens.`);
    }
    const imageId = transaction((tx) => {
      const newId = storeImage(req, site.id, kind);
      if (kind === 'logo' || kind === 'hero') {
        const col = kind === 'logo' ? 'logo_image_id' : 'hero_image_id';
        if (site[col]) tx.prepare('DELETE FROM images WHERE id = ?').run(site[col]);
        tx.prepare(`UPDATE sites SET ${col} = ?, updated_at = datetime('now') WHERE id = ?`).run(newId, site.id);
      }
      return newId;
    });
    audit(req, 'image.upload', 'image', imageId, { site_id: site.id, kind, size: req.body.length });
    res.status(201).json({ image: db.prepare('SELECT id, kind, mime, size, created_at FROM images WHERE id = ?').get(imageId) });
  });

  router.post('/:id/professionals/:pid/photo', rawImage, (req, res) => {
    const site = getSite(idParam(req));
    const prof = getProfessional(site.id, idParam(req, 'pid'));
    const imageId = transaction((tx) => {
      const newId = storeImage(req, site.id, 'professional');
      if (prof.photo_image_id) tx.prepare('DELETE FROM images WHERE id = ?').run(prof.photo_image_id);
      tx.prepare('UPDATE professionals SET photo_image_id = ? WHERE id = ?').run(newId, prof.id);
      return newId;
    });
    audit(req, 'image.upload', 'image', imageId, { site_id: site.id, kind: 'professional', professional_id: prof.id });
    res.status(201).json({ professional: getProfessional(site.id, prof.id) });
  });

  router.delete('/:id/images/:imageId', (req, res) => {
    const site = getSite(idParam(req));
    const imageId = idParam(req, 'imageId');
    transaction((tx) => {
      const r = tx.prepare('DELETE FROM images WHERE id = ? AND site_id = ?').run(imageId, site.id);
      if (!r.changes) throw new HttpError(404, 'Imagem não encontrada.');
      tx.prepare('UPDATE sites SET logo_image_id = NULL WHERE id = ? AND logo_image_id = ?').run(site.id, imageId);
      tx.prepare('UPDATE sites SET hero_image_id = NULL WHERE id = ? AND hero_image_id = ?').run(site.id, imageId);
      tx.prepare('UPDATE professionals SET photo_image_id = NULL WHERE site_id = ? AND photo_image_id = ?').run(site.id, imageId);
    });
    audit(req, 'image.delete', 'image', imageId, { site_id: site.id });
    res.json({ ok: true });
  });

  return router;
};

module.exports.CATEGORIES = CATEGORIES;
module.exports.siteOut = siteOut;
module.exports.detectImage = detectImage;
