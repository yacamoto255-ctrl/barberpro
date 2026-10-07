// src/render/site.js — HTML do site público a partir do tema + dados ao vivo.
// Todo texto passa por escapeHtml; o tema só fornece valores já validados (hex, enums, fontes da lista).
'use strict';

const { escapeHtml: e, formatBRL } = require('../util');
const { googleFontsHref, HEADING_FONTS, BODY_FONTS, ensureContrast } = require('../services/theme');
const { getSetting } = require('../settings');

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const RADIUS = { sharp: '2px', soft: '10px', round: '22px' };
const CATEGORY_LABEL = {
  barbearia: 'Barbearia', salao: 'Salão de beleza', estetica: 'Estética', clinica: 'Clínica', odontologia: 'Odontologia',
  psicologia: 'Psicologia', nutricao: 'Nutrição', estudio_tatuagem: 'Estúdio de tatuagem', pet: 'Pet shop',
  fitness: 'Academia e treino', fotografia: 'Fotografia', consultoria: 'Consultoria', aulas: 'Aulas', outro: '',
};

function duration(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function formatPhone(d) {
  const n = String(d || '').replace(/^55/, '');
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return n;
}

function groupHours(hours) {
  return WEEKDAYS.map((label, wd) => {
    const ranges = hours.filter((h) => h.weekday === wd).map((h) => `${h.open_time}–${h.close_time}`);
    return { label, text: ranges.length ? ranges.join(' · ') : 'Fechado', closed: !ranges.length };
  });
}

function paragraphs(text) {
  return String(text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${e(p).replace(/\n/g, '<br>')}</p>`).join('');
}

function backgroundCss(kind, p) {
  switch (kind) {
    case 'gradient': return `background: radial-gradient(1200px 600px at 85% -10%, ${p.primary}33, transparent 60%), radial-gradient(900px 500px at -10% 30%, ${p.accent}26, transparent 60%), ${p.bg};`;
    case 'grid': return `background-color: ${p.bg}; background-image: linear-gradient(${p.text}0f 1px, transparent 1px), linear-gradient(90deg, ${p.text}0f 1px, transparent 1px); background-size: 36px 36px;`;
    case 'dots': return `background-color: ${p.bg}; background-image: radial-gradient(${p.text}1a 1.2px, transparent 1.2px); background-size: 22px 22px;`;
    case 'grain': return `background-color: ${p.bg}; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.07'/%3E%3C/svg%3E");`;
    default: return `background: ${p.bg};`;
  }
}

function css(theme, nonce) {
  const p = theme.palette;
  const hf = HEADING_FONTS[theme.fonts.heading];
  const bodyFallback = BODY_FONTS[theme.fonts.body];
  const upper = ['Bebas Neue', 'Oswald', 'Archivo Black', 'Unbounded', 'Anton'].includes(theme.fonts.heading);
  return `<style nonce="${nonce}">
:root{--bg:${p.bg};--surface:${p.surface};--text:${p.text};--muted:${p.muted};--primary:${p.primary};--on-primary:${p.on_primary};--accent:${p.accent};
--accent-text:${ensureContrast(p.accent, p.bg, 4.5)};--radius:${RADIUS[theme.radius]};--hf:"${theme.fonts.heading}",${hf.fallback};--bf:"${theme.fonts.body}",${bodyFallback};--hw:${hf.weight}}
*{box-sizing:border-box}[hidden]{display:none!important}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;${backgroundCss(theme.background, p)}color:var(--text);font-family:var(--bf);font-size:17px;line-height:1.6;overflow-x:hidden}
img{max-width:100%;display:block}a{color:inherit}
h1,h2,h3{font-family:var(--hf);font-weight:var(--hw);line-height:1.05;margin:0 0 .4em;letter-spacing:${upper ? '.02em' : '-.01em'};${upper ? 'text-transform:uppercase;' : ''}}
h1{font-size:clamp(2.4rem,7vw,5rem)}h2{font-size:clamp(1.8rem,4.4vw,3rem)}h3{font-size:1.25rem;letter-spacing:0}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}
.skip{position:absolute;left:-999px}.skip:focus{left:12px;top:12px;background:var(--surface);padding:8px 12px;z-index:10}
header.top{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid color-mix(in srgb,var(--text) 10%,transparent)}
.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:64px}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;font-family:var(--hf);font-weight:var(--hw);font-size:1.25rem;min-width:0}
.brand img{height:40px;width:auto;border-radius:6px}.brand span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
nav.links{display:flex;gap:22px;font-size:.95rem}nav.links a{text-decoration:none;opacity:.85}nav.links a:hover{opacity:1;text-decoration:underline}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:12px 22px;border-radius:var(--radius);background:var(--primary);color:var(--on-primary);text-decoration:none;font-weight:600;border:2px solid var(--primary);cursor:pointer;font:inherit;font-weight:600;transition:transform .15s ease,filter .15s ease}
.btn:hover{transform:translateY(-1px);filter:brightness(1.06)}.btn:focus-visible,a:focus-visible,button:focus-visible,select:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.btn.ghost{background:transparent;color:var(--text);border-color:color-mix(in srgb,var(--text) 35%,transparent)}
.btn[disabled]{opacity:.55;cursor:not-allowed;transform:none}
.hero{padding:72px 0 64px}.eyebrow{display:inline-block;font-size:.8rem;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-text);font-weight:600;margin-bottom:14px}
.hero p.lead{font-size:clamp(1.05rem,2.2vw,1.3rem);color:var(--muted);max-width:44ch}
.hero .actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}
.hero.centered{text-align:center}.hero.centered p.lead{margin-inline:auto}.hero.centered .actions{justify-content:center}
.hero.split .wrap,.hero.split_left .wrap{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center}
.hero.split_left .wrap{grid-template-columns:.9fr 1.1fr}.hero.split_left .hero-media{order:-1}
.hero.stacked{text-align:center;padding-bottom:24px}.hero.stacked p.lead{margin-inline:auto}.hero.stacked .actions{justify-content:center}
.hero-wide{margin-top:48px;aspect-ratio:21/9;border-radius:var(--radius);overflow:hidden;background:linear-gradient(135deg,var(--primary),var(--accent))}.hero-wide img{width:100%;height:100%;object-fit:cover}
.hero-media{aspect-ratio:4/5;border-radius:var(--radius);overflow:hidden;background:linear-gradient(135deg,var(--primary),var(--accent));box-shadow:0 30px 60px -30px color-mix(in srgb,var(--text) 45%,transparent)}
.hero-media img{width:100%;height:100%;object-fit:cover}
.hero.editorial h1{font-size:clamp(2.8rem,9vw,6.5rem);max-width:12ch}.hero.editorial .wrap{border-bottom:1px solid color-mix(in srgb,var(--text) 18%,transparent);padding-bottom:48px}
.hero.banner{padding:0}.hero.banner .cover{position:relative;min-height:min(78vh,720px);display:flex;align-items:flex-end;background:linear-gradient(160deg,var(--primary),var(--accent));overflow:hidden}
.hero.banner .cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero.banner .cover::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,color-mix(in srgb,var(--bg) 25%,transparent) 0%,color-mix(in srgb,var(--bg) 80%,transparent) 48%,color-mix(in srgb,var(--bg) 96%,transparent) 100%)}
.hero.banner .cover .wrap{position:relative;z-index:1;padding-bottom:56px;width:100%}
section{padding:72px 0}section.alt{background:color-mix(in srgb,var(--surface) 70%,transparent)}
.section-head{display:flex;justify-content:space-between;align-items:end;gap:16px;flex-wrap:wrap;margin-bottom:28px}
.about{display:grid;grid-template-columns:1fr 1fr;gap:48px}.about p{color:var(--muted);margin:0 0 1em}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px}
.card{background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 10%,transparent);border-radius:var(--radius);padding:22px;display:flex;flex-direction:column;gap:8px;opacity:0;transform:translateY(12px);animation:rise .6s ease forwards}
.card:nth-child(2){animation-delay:.06s}.card:nth-child(3){animation-delay:.12s}.card:nth-child(4){animation-delay:.18s}.card:nth-child(n+5){animation-delay:.24s}
@keyframes rise{to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.card{animation:none;opacity:1;transform:none}html{scroll-behavior:auto}}
.card p{margin:0;color:var(--muted);font-size:.95rem}.meta{display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:10px;font-weight:600}
.price{color:var(--primary)}.tag{font-size:.85rem;color:var(--muted);font-weight:500}
.team .card{align-items:flex-start}.avatar{width:84px;height:84px;border-radius:50%;object-fit:cover;background:linear-gradient(135deg,var(--primary),var(--accent));display:grid;place-items:center;color:var(--on-primary);font-family:var(--hf);font-size:1.8rem}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}.gallery img{aspect-ratio:1;object-fit:cover;border-radius:var(--radius);width:100%}
.info{display:grid;grid-template-columns:1fr 1fr;gap:32px}.hours{list-style:none;padding:0;margin:0}.hours li{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid color-mix(in srgb,var(--text) 10%,transparent)}
.hours li.closed span:last-child{color:var(--muted)}.contact a{display:flex;align-items:center;gap:10px;padding:8px 0;text-decoration:none}.contact a:hover{text-decoration:underline}
.booking{background:var(--surface);border-radius:calc(var(--radius) * 1.4);padding:28px;border:1px solid color-mix(in srgb,var(--text) 12%,transparent)}
.steps{display:grid;gap:18px}.field label{display:block;font-weight:600;margin-bottom:6px;font-size:.95rem}
.field select,.field input,.field textarea{width:100%;min-height:48px;padding:12px 14px;border-radius:calc(var(--radius) * .7);border:1px solid color-mix(in srgb,var(--text) 25%,transparent);background:var(--bg);color:var(--text);font:inherit}
.field textarea{min-height:90px;resize:vertical}.row2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px}
.slot{min-height:44px;border-radius:calc(var(--radius) * .7);border:1px solid color-mix(in srgb,var(--text) 25%,transparent);background:var(--bg);color:var(--text);font:inherit;font-weight:600;cursor:pointer}
.slot:disabled{opacity:.35;cursor:not-allowed;text-decoration:line-through}.days .slot{font-size:.85rem;line-height:1.25;padding:6px 4px}
.slot[aria-pressed="true"]{background:var(--primary);color:var(--on-primary);border-color:var(--primary)}
.msg{padding:14px 16px;border-radius:calc(var(--radius) * .7);background:color-mix(in srgb,var(--accent) 16%,var(--surface));margin:0}.msg.err{background:color-mix(in srgb,#d32f2f 16%,var(--surface))}
.demo-bar{background:#16141b;color:#f3efe8;text-align:center;padding:8px 14px;font:500 13px/1.4 system-ui,sans-serif}.demo-bar a{color:#ffb38a}
.demo-link{display:flex;align-items:center;gap:10px;padding:8px 0;cursor:help}
.preview-bar{background:#111;color:#fff;text-align:center;padding:6px;font:600 13px system-ui,sans-serif}
.muted{color:var(--muted)}.hp{position:absolute;left:-5000px;width:1px;height:1px;overflow:hidden}
footer{padding:36px 0 96px;border-top:1px solid color-mix(in srgb,var(--text) 10%,transparent);font-size:.9rem;color:var(--muted)}
footer .wrap{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}footer a{color:var(--text)}
.fab{position:fixed;right:16px;bottom:16px;z-index:6;box-shadow:0 12px 30px -10px rgba(0,0,0,.45)}
@media (max-width:860px){nav.links{display:none}.hero.split .wrap,.hero.split_left .wrap,.about,.info{grid-template-columns:1fr}.hero.split_left .hero-media{order:0}.hero-wide{aspect-ratio:4/3;margin-top:32px}.hero{padding:48px 0}.hero-media{aspect-ratio:16/10}section{padding:56px 0}}
@media (max-width:520px){body{font-size:16px}.row2{grid-template-columns:1fr}.booking{padding:20px}.top .btn{display:none}}
@media (min-width:861px){.fab{display:none}}
</style>`;
}

function heroHtml(site, theme, copy, heroImg) {
  const category = CATEGORY_LABEL[site.category] || '';
  const eyebrow = [category, site.city].filter(Boolean).join(' · ');
  const actions = `<div class="actions">
      ${site.booking_enabled ? `<a class="btn" href="#agendar">${e(copy.cta)}</a>` : ''}
      ${site.whatsapp ? (site.is_demo ? '<a class="btn ghost" href="#contato">Falar no WhatsApp</a>' : `<a class="btn ghost" href="https://wa.me/${e(site.whatsapp)}" rel="noopener" target="_blank">Falar no WhatsApp</a>`) : ''}
    </div>`;
  const text = `${eyebrow ? `<span class="eyebrow">${e(eyebrow)}</span>` : ''}
      <h1>${e(copy.headline)}</h1>
      ${copy.subheadline ? `<p class="lead">${e(copy.subheadline)}</p>` : ''}
      ${actions}`;
  if (theme.hero_layout === 'banner') {
    return `<section class="hero banner" aria-label="Apresentação"><div class="cover">${heroImg ? `<img src="${heroImg}" alt="">` : ''}<div class="wrap">${text}</div></div></section>`;
  }
  const media = (cls) => `<div class="${cls}">${heroImg ? `<img src="${heroImg}" alt="Foto de ${e(site.name)}">` : ''}</div>`;
  if (theme.hero_layout === 'split' || theme.hero_layout === 'split_left') {
    return `<section class="hero ${theme.hero_layout}" aria-label="Apresentação"><div class="wrap"><div>${text}</div>
      ${media('hero-media')}</div></section>`;
  }
  if (theme.hero_layout === 'stacked') {
    return `<section class="hero stacked" aria-label="Apresentação"><div class="wrap">${text}${media('hero-wide')}</div></section>`;
  }
  return `<section class="hero ${theme.hero_layout}" aria-label="Apresentação"><div class="wrap">${text}</div></section>`;
}

/**
 * @param {object} d { site, theme, services, professionals, hours, gallery, nonce, preview }
 *   Modelos do catálogo (src/services/models.js) também passam:
 *   heroSrc (URL da capa), model { name, category_label } e demoData (agenda simulada no navegador)
 */
function renderSite(d) {
  const { site, theme, services, professionals, hours, gallery, nonce } = d;
  const c = theme.copy;
  const copy = {
    headline: c.headline || site.name,
    subheadline: c.subheadline || site.tagline || '',
    about: c.about || site.description || '',
    cta: c.cta || 'Agendar horário',
    services_title: c.services_title || 'Serviços',
    team_title: c.team_title || 'Equipe',
    booking_title: c.booking_title || 'Agende seu horário',
  };
  const img = (id) => (id ? `/img/${id}` : null);
  const heroSrc = d.heroSrc !== undefined ? d.heroSrc : img(site.hero_image_id);
  const agencyName = getSetting('agency_name');
  const agencyIg = getSetting('agency_instagram');
  const addressLine = [site.address, site.city && site.state ? `${site.city} - ${site.state}` : site.city, site.cep].filter(Boolean).join(', ');
  const mapsUrl = addressLine ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressLine)}` : null;
  const hourRows = groupHours(hours);
  const activeServices = services.filter((s) => s.active);
  const team = professionals.filter((p) => p.active);
  const description = (copy.subheadline || copy.about || site.name).slice(0, 160);
  // Conselhos de saúde (ex.: CFO) exigem nome e registro do responsável técnico na divulgação
  // Em demonstração os contatos são fictícios: aparecem, mas não levam a ninguém real
  const link = (href, text) => (site.is_demo
    ? `<span class="demo-link" title="Contato fictício (site de demonstração)">${e(text)}</span>`
    : `<a href="${e(href)}"${/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : ''}>${e(text)}</a>`);
  const responsible = site.responsible_name
    ? `Responsável técnico: ${site.responsible_name}${site.responsible_registration ? ' — ' + site.responsible_registration : ''}`
    : '';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(site.name)}${site.tagline ? ' — ' + e(site.tagline) : ''}</title>
<meta name="description" content="${e(description)}">
<meta property="og:title" content="${e(site.name)}">
<meta property="og:description" content="${e(description)}">
${site.hero_image_id ? `<meta property="og:image" content="${e(d.base || '')}/img/${site.hero_image_id}">` : ''}
<meta name="theme-color" content="${theme.palette.bg}">
${d.preview || site.is_demo ? '<meta name="robots" content="noindex">' : ''}
${site.logo_image_id ? `<link rel="icon" href="/img/${site.logo_image_id}">` : '<link rel="icon" href="data:,">'}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${e(googleFontsHref(theme))}">
${css(theme, nonce)}
</head>
<body>
<a class="skip" href="#conteudo">Pular para o conteúdo</a>
${d.preview ? '<div class="preview-bar">Pré-visualização — este site ainda não está publicado</div>' : ''}
${d.model ? `<div class="demo-bar">Modelo “${e(d.model.name)}” · ${e(d.model.category_label)} · negócio e dados fictícios · <a href="https://instagram.com/${e(agencyIg)}" target="_blank" rel="noopener">${e(agencyName)}</a> · <a href="/modelos">ver todos os modelos</a></div>`
    : site.is_demo ? `<div class="demo-bar">Site de demonstração · negócio e dados fictícios · criado pela <a href="https://instagram.com/${e(agencyIg)}" target="_blank" rel="noopener">${e(agencyName)}</a> · <a href="/exemplos">ver outros exemplos</a></div>` : ''}
<header class="top"><div class="wrap">
  <a class="brand" href="#inicio">${site.logo_image_id ? `<img src="/img/${site.logo_image_id}" alt="">` : ''}<span>${e(site.name)}</span></a>
  <nav class="links" aria-label="Seções">
    ${activeServices.length ? '<a href="#servicos">Serviços</a>' : ''}
    ${team.length ? '<a href="#equipe">Equipe</a>' : ''}
    <a href="#contato">Contato</a>
  </nav>
  ${site.booking_enabled ? `<a class="btn" href="#agendar">${e(copy.cta)}</a>` : ''}
</div></header>
<main id="conteudo">
<div id="inicio"></div>
${heroHtml(site, theme, copy, heroSrc)}
${copy.about ? `<section id="sobre"><div class="wrap about"><h2>Sobre</h2><div>${paragraphs(copy.about)}</div></div></section>` : ''}
${activeServices.length ? `<section id="servicos" class="alt"><div class="wrap">
  <div class="section-head"><h2>${e(copy.services_title)}</h2></div>
  <div class="cards">${activeServices.map((s) => `<article class="card"><h3>${e(s.name)}</h3>${s.description ? `<p>${e(s.description)}</p>` : ''}
    <div class="meta"><span class="tag">${duration(s.duration_min)}</span>${site.hide_prices ? '' : `<span class="price">${s.price_cents ? formatBRL(s.price_cents) : 'Consulte'}</span>`}</div></article>`).join('')}</div>
</div></section>` : ''}
${team.length ? `<section id="equipe" class="team"><div class="wrap">
  <div class="section-head"><h2>${e(copy.team_title)}</h2></div>
  <div class="cards">${team.map((p) => `<article class="card">${p.photo_image_id ? `<img class="avatar" src="/img/${p.photo_image_id}" alt="Foto de ${e(p.name)}" loading="lazy">` : `<span class="avatar" aria-hidden="true">${e(p.name.trim()[0] || '?')}</span>`}
    <h3>${e(p.name)}</h3>${p.title ? `<span class="tag">${e(p.title)}</span>` : ''}${p.registration ? `<span class="tag">${e(p.registration)}</span>` : ''}${p.bio ? `<p>${e(p.bio)}</p>` : ''}</article>`).join('')}</div>
</div></section>` : ''}
${gallery.length ? `<section id="galeria" class="alt"><div class="wrap"><div class="section-head"><h2>Galeria</h2></div>
  <div class="gallery">${gallery.map((g) => `<img src="/img/${g.id}" alt="Foto ${e(site.name)}" loading="lazy">`).join('')}</div></div></section>` : ''}
${site.booking_enabled && activeServices.length ? `<section id="agendar"><div class="wrap">
  <div class="section-head"><h2>${e(copy.booking_title)}</h2><span class="muted">Confirmação na hora</span></div>
  <div class="booking" id="booking" data-slug="${e(site.slug)}" data-has-team="${team.length ? '1' : '0'}">
    <noscript><p class="msg">Ative o JavaScript para agendar online${site.whatsapp ? ' ou chame no WhatsApp' : ''}.</p></noscript>
  </div>
</div></section>` : ''}
<section id="contato" class="alt"><div class="wrap info">
  <div><h2>Horários</h2><ul class="hours">${hourRows.map((h) => `<li class="${h.closed ? 'closed' : ''}"><span>${h.label}</span><span>${h.text}</span></li>`).join('')}</ul></div>
  <div class="contact"><h2>Contato</h2>
    ${addressLine ? `<p class="muted">${e(addressLine)}</p>` : ''}
    ${responsible ? `<p class="muted">${e(responsible)}</p>` : ''}
    ${mapsUrl ? link(mapsUrl, '📍 Ver no mapa') : ''}
    ${site.whatsapp ? link(`https://wa.me/${site.whatsapp}`, `💬 WhatsApp ${formatPhone(site.whatsapp)}`) : ''}
    ${site.phone ? link(`tel:+${site.phone}`, `📞 ${formatPhone(site.phone)}`) : ''}
    ${site.email ? link(`mailto:${site.email}`, `✉️ ${site.email}`) : ''}
    ${site.instagram ? link(`https://instagram.com/${site.instagram}`, `📷 @${site.instagram}`) : ''}
  </div>
</div></section>
</main>
<footer><div class="wrap">
  <span>© ${new Date().getFullYear()} ${e(site.name)}${site.cnpj ? ' · CNPJ ' + e(site.cnpj) : ''}${site.company_registration ? ' · ' + e(site.company_registration) : ''}${responsible ? ' · ' + e(responsible) : ''}</span>
  <span>Site por <a href="https://instagram.com/${e(agencyIg)}" target="_blank" rel="noopener">${e(agencyName)}</a></span>
</div></footer>
${site.booking_enabled && activeServices.length ? `<a class="btn fab" href="#agendar">${e(copy.cta)}</a>
${d.demoData ? `<script type="application/json" id="demo-data">${JSON.stringify(d.demoData).replace(/</g, '\\u003c')}</script>
<script src="/assets/demo-shim.js"></script>` : ''}<script src="/assets/booking.js" defer></script>` : ''}
</body>
</html>`;
}

function renderMessagePage({ title, body, site = null, nonce, theme = null, actionsHtml = '' }) {
  const p = theme?.palette || { bg: '#f6f0e6', surface: '#fffaf2', text: '#2a211b', muted: '#6f6257', primary: '#a8481f', on_primary: '#ffffff', accent: '#2f5d50' };
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${e(title)}</title><link rel="icon" href="data:,">
<style nonce="${nonce}">body{margin:0;min-height:100vh;display:grid;place-items:center;background:${p.bg};color:${p.text};font:17px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:20px}
main{max-width:520px;width:100%;background:${p.surface};padding:32px;border-radius:14px;box-shadow:0 20px 50px -30px rgba(0,0,0,.4)}
h1{font-size:1.6rem;margin:0 0 .5em;line-height:1.2}p{color:${p.muted}}a,button{display:inline-block;margin-top:12px;padding:12px 20px;border-radius:10px;background:${p.primary};color:${p.on_primary};text-decoration:none;border:0;font:inherit;font-weight:600;cursor:pointer}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:16px 0}dt{font-weight:600}dd{margin:0}</style></head>
<body><main><h1>${e(title)}</h1>${body}${actionsHtml}${site ? `<p><a href="/s/${e(site.slug)}">Voltar para ${e(site.name)}</a></p>` : ''}</main></body></html>`;
}

module.exports = { renderSite, renderMessagePage, formatPhone, duration };

/**
 * Portfólio da agência: vitrine dos sites de demonstração publicados.
 * @param {object} d { sites: Array<{site, theme}>, nonce }
 */
function renderPortfolio({ sites, nonce }) {
  const agencyName = getSetting('agency_name');
  const agencyIg = getSetting('agency_instagram');
  const families = new Map();
  for (const { theme } of sites) {
    families.set(theme.fonts.heading, HEADING_FONTS[theme.fonts.heading].weight);
    if (!families.has(theme.fonts.body)) families.set(theme.fonts.body, '400;600');
  }
  families.set('Fraunces', '600');
  families.set('Figtree', families.get('Figtree') || '400;600');
  const fontsHref = `https://fonts.googleapis.com/css2?${[...families].map(([f, w]) => `family=${f.replace(/ /g, '+')}:wght@${w}`).join('&')}&display=swap`;
  let cardCss = '';
  const cards = sites.map(({ site, theme }, i) => {
    const p = theme.palette;
    const hf = HEADING_FONTS[theme.fonts.heading];
    cardCss += `.c${i}{background:${p.bg};color:${p.text}}.c${i} p,.c${i} .cat{color:${p.muted}}`
      + `.h${i}{font-family:"${theme.fonts.heading}",${hf.fallback};font-weight:${hf.weight}}.b${i}{background:${p.primary};color:${p.on_primary}}`
      + ['bg', 'surface', 'primary', 'accent', 'text'].map((k) => `.c${i}-${k}{background:${p[k]}}`).join('')
      + `.g${i}{background:linear-gradient(135deg,${p.primary},${p.accent})}`;
    return `<a class="demo" href="/s/${e(site.slug)}">
      <div class="shot g${i}">${site.hero_image_id ? `<img src="/img/${site.hero_image_id}" alt="" loading="lazy">` : ''}
        <span class="sw">${['bg', 'surface', 'primary', 'accent', 'text'].map((k) => `<i class="c${i}-${k}"></i>`).join('')}</span></div>
      <div class="body c${i}">
        <span class="cat">${e(CATEGORY_LABEL[site.category] || 'Negócio local')}${site.city ? ' · ' + e(site.city) : ''}</span>
        <h2 class="h${i}">${e(site.name)}</h2>
        ${site.tagline ? `<p>${e(site.tagline)}</p>` : ''}
        <span class="go b${i}">Ver site de exemplo →</span>
      </div>
    </a>`;
  }).join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Exemplos de sites — ${e(agencyName)}</title>
<link rel="icon" href="data:,">
<meta name="description" content="Sites com agendamento online criados pela ${e(agencyName)} para barbearias, clínicas, salões, consultórios e outros negócios locais.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${e(fontsHref)}">
<style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;background:#16141b;color:#f3efe8;font:16px/1.6 "Figtree",system-ui,sans-serif}
a{color:inherit}.wrap{max-width:1160px;margin:0 auto;padding:0 20px}
header.wrap{padding:72px 20px 48px}header .brand{font:600 14px/1 "Figtree",sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#ffb38a}
h1{font:600 clamp(2.4rem,6vw,4.4rem)/1.05 "Fraunces",serif;margin:16px 0;max-width:16ch;letter-spacing:-.02em}
header p{color:#bdb6c6;max-width:58ch;font-size:1.1rem}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:22px;padding-bottom:64px}
.demo{display:flex;flex-direction:column;border-radius:18px;overflow:hidden;text-decoration:none;box-shadow:0 30px 60px -30px rgba(0,0,0,.6);transition:transform .2s ease}
.demo:hover{transform:translateY(-4px)}.demo:focus-visible{outline:3px solid #ffb38a;outline-offset:4px}
.shot{position:relative;aspect-ratio:16/9;background:linear-gradient(135deg,#2a2731,#3a3540)}.shot img{width:100%;height:100%;object-fit:cover;display:block}
.sw{position:absolute;left:14px;bottom:14px;display:flex;gap:6px}.sw i{width:22px;height:22px;border-radius:50%;border:2px solid rgba(255,255,255,.75)}
.body{padding:22px 22px 24px;display:flex;flex-direction:column;gap:6px;flex:1}
.cat{font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;font-weight:600}
.body h2{margin:0;font-size:1.9rem;line-height:1.1}.body p{margin:0 0 10px}
.go{margin-top:auto;align-self:flex-start;padding:10px 16px;border-radius:999px;font-weight:600;font-size:.92rem}
.note{color:#8f889a;font-size:.9rem;border-top:1px solid #2f2c36;padding:22px 0 40px}
.cta{display:inline-block;margin-top:10px;background:#ffb38a;color:#16141b;padding:12px 20px;border-radius:999px;font-weight:700;text-decoration:none}
${cardCss}
</style>
</head>
<body>
<header class="wrap">
  <div class="brand">${e(agencyName)}</div>
  <h1>Sites que enchem a agenda de negócios locais.</h1>
  <p>Exemplos de sites com agendamento online que criamos para diferentes tipos de negócio. Abra, navegue e teste o agendamento: tudo funciona como no site de verdade.</p>
  <a class="cta" href="https://instagram.com/${e(agencyIg)}" target="_blank" rel="noopener">Quero um site assim · @${e(agencyIg)}</a>
</header>
<main class="wrap">
  <div class="grid">${cards || '<p>Nenhum exemplo publicado ainda.</p>'}</div>
  <p class="note">Os negócios, pessoas e contatos destes exemplos são fictícios. Nos exemplos, o agendamento é simulado: nada é reservado e nenhum dado é guardado.</p>
</main>
</body>
</html>`;
}

module.exports.renderPortfolio = renderPortfolio;

/**
 * Galeria pública dos modelos de site (/modelos), agrupada por nicho.
 * @param {object} d { niches: Array<{category, label, models: summary[]}>, nonce }
 */
function renderModelGallery({ niches, nonce }) {
  const agencyName = getSetting('agency_name');
  const agencyIg = getSetting('agency_instagram');
  const all = niches.flatMap((n) => n.models);
  const families = new Map([['Fraunces', '600'], ['Figtree', '400;600']]);
  for (const m of all) if (!families.has(m.fonts.heading)) families.set(m.fonts.heading, HEADING_FONTS[m.fonts.heading].weight);
  const fontsHref = `https://fonts.googleapis.com/css2?${[...families].map(([f, w]) => `family=${f.replace(/ /g, '+')}:wght@${w}`).join('&')}&display=swap`;
  let cardCss = '';
  const sections = niches.map((n) => `<section id="${e(n.category)}" aria-labelledby="t-${e(n.category)}">
    <div class="sec-head"><h2 id="t-${e(n.category)}">${e(n.label)}</h2><span>${n.models.length} modelos</span></div>
    <div class="grid">${n.models.map((m) => {
    const p = m.palette;
    const k = m.id.replace(/[^a-z0-9]/g, '');
    const hf = HEADING_FONTS[m.fonts.heading];
    cardCss += `.c-${k}{background:${p.bg};color:${p.text}}.c-${k} .st{color:${p.muted}}.h-${k}{font-family:"${m.fonts.heading}",${hf.fallback};font-weight:${hf.weight}}`
      + `.b-${k}{background:${p.primary};color:${p.on_primary}}`
      + ['bg', 'surface', 'primary', 'accent', 'text'].map((x) => `.s-${k}-${x}{background:${p[x]}}`).join('');
    return `<a class="model" href="${e(m.preview_url)}">
        <div class="shot">${m.thumb_url ? `<img src="${e(m.thumb_url)}" alt="" loading="lazy">` : ''}
          <span class="sw">${['bg', 'surface', 'primary', 'accent', 'text'].map((x) => `<i class="s-${k}-${x}"></i>`).join('')}</span></div>
        <div class="body c-${k}">
          <span class="num">Modelo ${String(m.number).padStart(2, '0')}</span>
          <h3 class="h-${k}">${e(m.name)}</h3>
          <p class="st">${e(m.style)}</p>
          <span class="go b-${k}">Ver modelo →</span>
        </div></a>`;
  }).join('')}</div></section>`).join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Modelos de site — ${e(agencyName)}</title>
<link rel="icon" href="data:,">
<meta name="description" content="${all.length} modelos de site com agendamento online da ${e(agencyName)} para ${e(niches.map((n) => n.label.toLowerCase()).join(', '))}.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${e(fontsHref)}">
<style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;background:#16141b;color:#f3efe8;font:16px/1.6 "Figtree",system-ui,sans-serif}
a{color:inherit}.wrap{max-width:1200px;margin:0 auto;padding:0 20px}
header.wrap{padding:72px 20px 32px}header .brand{font:600 14px/1 "Figtree",sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#ffb38a}
h1{font:600 clamp(2.4rem,6vw,4.4rem)/1.05 "Fraunces",serif;margin:16px 0;max-width:18ch;letter-spacing:-.02em}
header p{color:#bdb6c6;max-width:60ch;font-size:1.1rem}
nav.niches{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}nav.niches a{padding:8px 14px;border:1px solid #3a3642;border-radius:999px;text-decoration:none;font-weight:600;font-size:.92rem}
nav.niches a:hover{border-color:#ffb38a}
.cta{display:inline-block;margin-top:18px;background:#ffb38a;color:#16141b;padding:12px 20px;border-radius:999px;font-weight:700;text-decoration:none}
section{padding:28px 0 36px}.sec-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;border-bottom:1px solid #2f2c36;margin-bottom:20px;padding-bottom:10px}
.sec-head h2{font:600 clamp(1.6rem,3.6vw,2.4rem)/1.1 "Fraunces",serif;margin:0}.sec-head span{color:#8f889a}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px}
.model{display:flex;flex-direction:column;border-radius:16px;overflow:hidden;text-decoration:none;box-shadow:0 24px 48px -28px rgba(0,0,0,.7);transition:transform .2s ease}
.model:hover{transform:translateY(-4px)}.model:focus-visible{outline:3px solid #ffb38a;outline-offset:4px}
.shot{position:relative;aspect-ratio:16/10;background:#2a2731}.shot img{width:100%;height:100%;object-fit:cover;object-position:top;display:block}
.sw{position:absolute;left:12px;bottom:12px;display:flex;gap:5px}.sw i{width:18px;height:18px;border-radius:50%;border:2px solid rgba(255,255,255,.8)}
.body{padding:16px 18px 18px;display:flex;flex-direction:column;gap:4px;flex:1}
.num{font-size:.74rem;letter-spacing:.14em;text-transform:uppercase;font-weight:700;opacity:.75}
.body h3{margin:0;font-size:1.6rem;line-height:1.1}.st{margin:0 0 10px;font-size:.92rem}
.go{margin-top:auto;align-self:flex-start;padding:8px 14px;border-radius:999px;font-weight:600;font-size:.88rem}
.note{color:#8f889a;font-size:.9rem;border-top:1px solid #2f2c36;padding:22px 0 40px}
${cardCss}
</style>
</head>
<body>
<header class="wrap">
  <div class="brand">${e(agencyName)}</div>
  <h1>${all.length} modelos de site com agendamento online.</h1>
  <p>Escolha um ponto de partida para o seu negócio. Todo modelo é adaptado com a sua marca, seus serviços, sua equipe e seus horários.</p>
  <nav class="niches" aria-label="Nichos">${niches.map((n) => `<a href="#${e(n.category)}">${e(n.label)}</a>`).join('')}</nav>
  <a class="cta" href="https://instagram.com/${e(agencyIg)}" target="_blank" rel="noopener">Quero o meu · @${e(agencyIg)}</a>
</header>
<main class="wrap">
  ${sections || '<p>Nenhum modelo disponível.</p>'}
  <p class="note">Os negócios, pessoas, contatos e registros profissionais destes modelos são fictícios. Na prévia, o agendamento é simulado: nada é reservado e nenhum dado é guardado.</p>
</main>
</body>
</html>`;
}

module.exports.renderModelGallery = renderModelGallery;
