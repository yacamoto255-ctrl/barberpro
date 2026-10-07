// src/services/models.js — catálogo de modelos de site da Versal (sites/modelos/<categoria>.json)
//
// Cada modelo é um tema pronto (cores, fontes, layout, textos) mais uma capa ilustrada e um
// negócio fictício usado só na prévia pública (/modelos/<id>). No painel, "Aplicar modelo"
// copia o visual (e, se pedido, os textos e a capa) para um site real.
'use strict';

const fs = require('fs');
const path = require('path');
const { validateTheme } = require('./theme');
const { parseHours } = require('../util');

const DIR = path.join(__dirname, '..', '..', 'sites', 'modelos');
const IMG_DIR = path.join(DIR, 'img');
const ID_RE = /^[a-z_]+-\d{2}$/;

let cache = null;

function digits(v) { return String(v || '').replace(/\D/g, ''); }

function load() {
  if (cache) return cache;
  const niches = [];
  const byId = new Map();
  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort() : [];
  for (const file of files) {
    const doc = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
    const models = doc.modelos.map((m, i) => {
      if (!ID_RE.test(m.id)) throw new Error(`Modelo com id inválido em ${file}: ${m.id}`);
      if (byId.has(m.id)) throw new Error(`Modelo repetido: ${m.id}`);
      const { theme, warnings } = validateTheme({ ...m.tema, preset: 'custom' });
      const model = {
        id: m.id, number: i + 1, name: m.nome, style: m.estilo || '', category: doc.categoria, category_label: doc.rotulo,
        business: m.negocio, theme, art: m.arte || {}, warnings, niche: doc,
      };
      byId.set(m.id, model);
      return model;
    });
    niches.push({ category: doc.categoria, label: doc.rotulo, models });
  }
  cache = { niches, byId };
  return cache;
}

function getModel(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  return load().byId.get(id) || null;
}

function imagePath(id, kind = 'cover') {
  if (!getModel(id)) return null;
  const file = kind === 'thumb' ? path.join(IMG_DIR, 'thumbs', `${id}.jpg`) : path.join(IMG_DIR, `${id}.png`);
  return fs.existsSync(file) ? file : null;
}

/** Resumo para o painel e para a galeria */
function summary(m) {
  const hasThumb = !!imagePath(m.id, 'thumb');
  const hasCover = !!imagePath(m.id, 'cover');
  return {
    id: m.id, number: m.number, name: m.name, style: m.style, category: m.category, category_label: m.category_label,
    business_name: m.business.name, palette: m.theme.palette, fonts: m.theme.fonts, hero_layout: m.theme.hero_layout,
    preview_url: `/modelos/${m.id}`,
    cover_url: hasCover ? `/modelos/img/${m.id}.png` : null,
    thumb_url: hasThumb ? `/modelos/img/thumbs/${m.id}.jpg` : (hasCover ? `/modelos/img/${m.id}.png` : null),
  };
}

function listModels({ category } = {}) {
  return load().niches
    .filter((n) => !category || n.category === category)
    .flatMap((n) => n.models.map(summary));
}

function categories() {
  return load().niches.map((n) => ({ category: n.category, label: n.label, count: n.models.length }));
}

/**
 * Dados para renderizar a prévia do modelo com renderSite() e a agenda simulada (public/assets/demo-shim.js).
 * Nada vem do banco: o "site" é o negócio fictício do modelo.
 */
function previewData(m) {
  const n = m.niche;
  const b = m.business;
  const hide = !!n.site?.hide_prices;
  const site = {
    id: 0, slug: `modelo-${m.id}`, name: b.name, category: m.category, tagline: b.tagline || null, description: null,
    whatsapp: b.whatsapp ? `55${digits(b.whatsapp)}` : null, phone: null, email: null, instagram: null, cnpj: null, cep: null,
    address: b.address || null, city: b.city || null, state: b.state || null,
    published: 1, booking_enabled: 1, is_demo: 1, hide_prices: hide ? 1 : 0,
    slot_interval_min: n.site?.slot_interval_min || 30, min_notice_min: n.site?.min_notice_min ?? 60, max_days_ahead: n.site?.max_days_ahead || 21,
    responsible_name: b.responsible_name || null, responsible_registration: b.responsible_registration || null, company_registration: null,
    logo_image_id: null, hero_image_id: null,
  };
  const services = n.servicos.map((s, i) => ({
    id: i + 1, name: s.name, description: s.description || null, duration_min: s.duration_min,
    price_cents: Math.round(Number(s.price || 0) * 100), active: 1, sort_order: i,
  }));
  const byName = Object.fromEntries(services.map((s) => [s.name.toLowerCase(), s.id]));
  const professionals = (n.profissionais || []).map((p, i) => ({
    id: i + 1, name: p.name, title: p.title || null, bio: p.bio || null, photo_image_id: null, active: 1, sort_order: i,
    registration: p.registration ? p.registration.replace('{REGISTRO}', b.responsible_registration || '').trim() || null : null,
    service_ids: (p.servicos || []).map((x) => byName[String(x).toLowerCase()]).filter(Boolean),
  }));
  const hours = parseHours(n.horarios);
  const byDay = {};
  for (const h of hours) (byDay[h.weekday] ||= []).push([h.open_time, h.close_time]);
  const demoData = {
    site: { name: site.name, slug: site.slug, booking_enabled: true, max_days_ahead: site.max_days_ahead, whatsapp: site.whatsapp },
    services: services.map(({ id, name, description, duration_min, price_cents }) => ({ id, name, description, duration_min, price_cents: hide ? null : price_cents })),
    professionals: professionals.map(({ id, name, title, registration, service_ids }) => ({ id, name, title, registration, photo_image_id: null, service_ids })),
    hours: byDay, slot_interval_min: site.slot_interval_min, min_notice_min: site.min_notice_min,
  };
  return {
    site, theme: m.theme, services, professionals, hours, gallery: [], demoData,
    heroSrc: imagePath(m.id, 'cover') ? `/modelos/img/${m.id}.png` : null,
    model: { name: m.name, category_label: m.category_label },
  };
}

function _reset() { cache = null; }

module.exports = { load, getModel, listModels, categories, previewData, imagePath, summary, IMG_DIR, ID_RE, _reset };
