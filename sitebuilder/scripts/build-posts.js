// scripts/build-posts.js — posts de Instagram (4:5, 1080×1350) dos modelos de site, com mockup
// de notebook + celular, e as miniaturas da galeria (sites/modelos/img/thumbs/<id>.jpg).
//   node scripts/build-posts.js [pasta-de-saida]          (padrão: data/posts)
//   node scripts/build-posts.js data/posts pet-03         (só um modelo; não gera capas/legendas)
// Ferramenta de desenvolvimento: precisa do playwright-core (devDependency), de um Chromium
// (CHROMIUM_PATH ou o do ambiente) e de internet para as fontes do Google.
// Saída por nicho: 00-capa.png (capa do carrossel), 01..10 (um post por modelo) e 11-cta.png,
// mais legendas.txt com textos sugeridos.
'use strict';

const fs = require('fs');
const path = require('path');

const emitWarning = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w).includes('SQLite is an experimental') ? undefined : emitWarning.call(process, w, ...a));
try { process.loadEnvFile?.(); } catch (_) { /* sem .env */ }

const { createApp } = require('../src/app');
const { closeDb } = require('../src/db');
const { getSetting } = require('../src/settings');
const { load, IMG_DIR } = require('../src/services/models');
const { HEADING_FONTS, contrast, ensureContrast, mix } = require('../src/services/theme');

const CHROMIUM = process.env.CHROMIUM_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
const off = (req, res, next) => next();
const W = 1080;
const H = 1350;
const UPPER = ['Bebas Neue', 'Oswald', 'Archivo Black', 'Unbounded', 'Anton'];
const NICHE_COPY = {
  barbearia: { emoji: '💈', nome: 'barbearia', seu: 'a sua barbearia', tags: '#barbearia #barbershop #barbeiro' },
  odontologia: { emoji: '🦷', nome: 'dentista', seu: 'o seu consultório', tags: '#dentista #odontologia #consultorioodontologico' },
  pet: { emoji: '🐾', nome: 'pet shop', seu: 'o seu pet shop', tags: '#petshop #banhoetosa #pets' },
  psicologia: { emoji: '🌿', nome: 'psicólogo', seu: 'o seu consultório', tags: '#psicologia #psicologo #consultorio' },
  salao: { emoji: '💇‍♀️', nome: 'salão de beleza', seu: 'o seu salão', tags: '#salaodebeleza #cabeleireira #beleza' },
};
const HEALTH_NOTE = {
  odontologia: 'Seguindo as regras de publicidade do CFO: sem preços no site e com o CRO do responsável técnico.',
  psicologia: 'Sem preços no site e com o CRP de cada profissional, como pede o Código de Ética do Psicólogo.',
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'e').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const dataUri = (buf, type = 'image/png') => `data:${type};base64,${buf.toString('base64')}`;
const fontsHref = (fams) => `https://fonts.googleapis.com/css2?${fams.map(([f, w]) => `family=${f.replace(/ /g, '+')}:wght@${w}`).join('&')}&display=block`;

async function settle(page, fonts = []) {
  await page.evaluate(async (fams) => {
    await document.fonts.ready;
    await Promise.all(fams.map((f) => document.fonts.load(`40px "${f}"`)));
    await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))));
  }, fonts);
}

/* ── Post de um modelo ───────────────────────────────────── */
function postHtml(m, total, desk, phone, brand) {
  const p = m.theme.palette;
  const hf = HEADING_FONTS[m.theme.fonts.heading];
  const upper = UPPER.includes(m.theme.fonts.heading);
  const bezel = '#18181c';
  const stage = [p.primary, p.accent, mix(p.bg, p.text, 0.18)].find((c) => contrast(c, bezel) >= 2.4) || mix(p.bg, '#ffffff', 0.5);
  const eyebrow = ensureContrast(p.accent, p.bg, 4.5);
  const len = m.name.length;
  const size = len <= 11 ? 108 : len <= 16 ? 92 : 76;
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${fontsHref([[m.theme.fonts.heading, hf.weight], [m.theme.fonts.body, '400;600'], ['Figtree', '500;700']])}">
<style>
*{box-sizing:border-box}html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden}
body{background:${p.bg};color:${p.text};font-family:"${m.theme.fonts.body}",sans-serif;position:relative}
.top{position:absolute;left:72px;right:72px;top:60px;display:flex;justify-content:space-between;font:700 20px/1 "Figtree",sans-serif;letter-spacing:.18em;text-transform:uppercase;color:${p.muted}}
.top b{color:${p.text}}
.head{position:absolute;left:72px;right:72px;top:132px}
.eyebrow{font:700 22px/1 "Figtree",sans-serif;letter-spacing:.16em;text-transform:uppercase;color:${eyebrow}}
h1{margin:18px 0 14px;font-family:"${m.theme.fonts.heading}",${hf.fallback};font-weight:${hf.weight};font-size:${size}px;line-height:.98;letter-spacing:${upper ? '.01em' : '-.02em'};${upper ? 'text-transform:uppercase;' : ''}}
.style{font-size:28px;line-height:1.3;color:${p.muted};max-width:46ch;margin:0}
.stage{position:absolute;left:-60px;right:-60px;top:${size > 100 ? 560 : 548}px;bottom:0;background:${stage};border-radius:50% 50% 0 0 / 22% 22% 0 0}
.laptop{position:absolute;left:58px;top:${size > 100 ? 470 : 458}px;width:850px;filter:drop-shadow(0 40px 50px rgba(0,0,0,.35))}
.lid{background:${bezel};border-radius:24px 24px 8px 8px;padding:16px 16px 20px;position:relative}
.lid::before{content:"";position:absolute;top:6px;left:50%;width:6px;height:6px;margin-left:-3px;border-radius:50%;background:#3a3a40}
.lid img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;object-position:top;border-radius:4px}
.base{height:24px;margin:0 -54px;background:linear-gradient(#e4e4e8,#a7a7ae);border-radius:2px 2px 22px 22px;position:relative}
.base::before{content:"";display:block;width:150px;height:9px;margin:0 auto;background:#8e8e95;border-radius:0 0 10px 10px}
.phone{position:absolute;right:66px;top:${size > 100 ? 610 : 598}px;width:262px;padding:11px;background:${bezel};border-radius:46px;filter:drop-shadow(0 40px 50px rgba(0,0,0,.4))}
.screen{border-radius:36px;overflow:hidden;background:${p.bg}}
.status{height:34px;display:flex;justify-content:space-between;align-items:center;padding:4px 22px 0 26px;font:700 13px/1 "Figtree",sans-serif;color:${p.text}}
.status i{display:inline-block;width:22px;height:10px;border:2px solid ${p.text};border-radius:3px;opacity:.85}
.phone img{display:block;width:100%;aspect-ratio:390/810;object-fit:cover;object-position:top}
.phone::before{content:"";position:absolute;top:21px;left:50%;width:78px;height:22px;margin-left:-39px;border-radius:14px;background:${bezel};z-index:2}
.foot{position:absolute;left:72px;right:72px;bottom:54px;display:flex;justify-content:space-between;align-items:flex-end;gap:20px}
.chips{display:flex;flex-wrap:wrap;gap:10px;max-width:640px}
.chip{background:${p.surface};color:${p.text};font:600 20px/1 "Figtree",sans-serif;padding:12px 16px;border-radius:999px;box-shadow:0 6px 18px -8px rgba(0,0,0,.35)}
.handle{text-align:right;font:700 30px/1.1 "Figtree",sans-serif;color:${p.text};background:${p.surface};padding:14px 18px;border-radius:16px;box-shadow:0 6px 18px -8px rgba(0,0,0,.35)}
.handle small{display:block;font:500 15px/1.4 "Figtree",sans-serif;color:${p.muted};margin-top:4px}
</style></head><body>
<div class="top"><b>${esc(brand.name)}</b><span>Modelo ${String(m.number).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span></div>
<div class="head">
  <div class="eyebrow">Site para ${esc(m.category_label.toLowerCase())}</div>
  <h1>${esc(m.name)}</h1>
  <p class="style">${esc(m.style)}</p>
</div>
<div class="stage"></div>
<div class="laptop"><div class="lid"><img src="${desk}" alt=""></div><div class="base"></div></div>
<div class="phone"><div class="screen"><div class="status"><span>9:41</span><i></i></div><img src="${phone}" alt=""></div></div>
<div class="foot">
  <div class="chips"><span class="chip">Agendamento online</span><span class="chip">WhatsApp</span><span class="chip">Feito para celular</span></div>
  <div class="handle">@${esc(brand.ig)}<small>Modelo ilustrativo · negócio fictício</small></div>
</div>
</body></html>`;
}

/* ── Capa do carrossel e CTA (marca Versal) ──────────────── */
const BRAND_CSS = `*{box-sizing:border-box}html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden}
body{background:#16141b;color:#f3efe8;font-family:"Figtree",sans-serif;position:relative}
.brand{position:absolute;left:72px;top:64px;font:700 22px/1 "Figtree",sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#ffb38a}
h1{font:600 104px/1 "Fraunces",serif;letter-spacing:-.025em;margin:0}
.lead{font-size:34px;line-height:1.35;color:#bdb6c6;margin:22px 0 0}
.handle{font:700 34px/1 "Figtree",sans-serif;color:#16141b;background:#ffb38a;padding:18px 26px;border-radius:999px;display:inline-block}`;

function coverHtml(niche, thumbs, brand) {
  const nc = NICHE_COPY[niche.category];
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${fontsHref([['Fraunces', '600'], ['Figtree', '500;700']])}">
<style>${BRAND_CSS}
.head{position:absolute;left:72px;right:72px;top:150px}
.wall{position:absolute;left:-80px;top:590px;width:1240px;display:grid;gap:18px;transform:rotate(-6deg);transform-origin:center}
.row{display:flex;gap:18px}.row:nth-child(2){margin-left:150px}.row:nth-child(3){margin-left:30px}
.row img{width:256px;height:160px;flex:none;object-fit:cover;object-position:top;border-radius:12px;display:block;box-shadow:0 22px 34px -18px rgba(0,0,0,.85)}
.foot{position:absolute;left:72px;right:72px;bottom:64px;display:flex;justify-content:space-between;align-items:center}
.swipe{font:600 30px/1 "Figtree",sans-serif;color:#f3efe8}
</style></head><body>
<div class="brand">${esc(brand.name)}</div>
<div class="head"><h1${nc.nome.length > 10 ? ' style="font-size:88px"' : ''}>${niche.models.length} modelos de site para ${esc(nc.nome)}</h1>
<p class="lead">Todos com agendamento online: o cliente escolhe o serviço, o profissional e o horário.</p></div>
<div class="wall">${[thumbs.slice(0, 4), thumbs.slice(4, 7), thumbs.slice(7)].map((row) => `<div class="row">${row.map((t) => `<img src="${t}" alt="">`).join('')}</div>`).join('')}</div>
<div class="foot"><span class="swipe">Arraste para ver →</span><span class="handle">@${esc(brand.ig)}</span></div>
</body></html>`;
}

function ctaHtml(niche, brand) {
  const nc = NICHE_COPY[niche.category];
  const health = HEALTH_NOTE[niche.category];
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${fontsHref([['Fraunces', '600'], ['Figtree', '500;700']])}">
<style>${BRAND_CSS}
.head{position:absolute;left:72px;right:72px;top:220px}
ul{list-style:none;padding:0;margin:56px 0 0;display:grid;gap:22px}
li{font-size:34px;line-height:1.3;padding-left:52px;position:relative}
li::before{content:"";position:absolute;left:0;top:10px;width:26px;height:26px;border-radius:50%;background:#ffb38a}
.note{font-size:24px;color:#8f889a;margin-top:36px;max-width:36ch;line-height:1.4}
.foot{position:absolute;left:72px;right:72px;bottom:72px}
.foot p{font-size:30px;margin:0 0 22px;color:#bdb6c6}
</style></head><body>
<div class="brand">${esc(brand.name)}</div>
<div class="head"><h1>Quer um site assim para ${esc(nc.seu)}?</h1>
<ul><li>Agenda online 24 horas, sem ligação</li><li>Aviso de cada agendamento no WhatsApp</li><li>Seu visual, seus serviços, sua equipe</li><li>Painel para acompanhar tudo</li></ul>
${health ? `<p class="note">${esc(health)}</p>` : ''}</div>
<div class="foot"><p>Chama no direct ou comenta o número do modelo favorito.</p><span class="handle">@${esc(brand.ig)}</span></div>
</body></html>`;
}

function captions(niches, brand) {
  const out = [`LEGENDAS SUGERIDAS — ${brand.name} (@${brand.ig})`, 'Revise antes de postar. Os negócios dos modelos são fictícios.', ''];
  for (const n of niches) {
    const nc = NICHE_COPY[n.category];
    out.push('='.repeat(70), `${n.label.toUpperCase()} — carrossel (00-capa, 01 a ${String(n.models.length).padStart(2, '0')}, ${String(n.models.length + 1).padStart(2, '0')}-cta)`, '='.repeat(70), '',
      `${n.models.length} modelos de site para ${nc.nome} ${nc.emoji}`, '',
      'Todos com agendamento online: o cliente escolhe o serviço, o profissional e o horário, e você recebe o aviso na hora no WhatsApp.',
      ...(HEALTH_NOTE[n.category] ? ['', HEALTH_NOTE[n.category]] : []), '',
      'Qual é o seu favorito? Comenta o número 👇', 'Quer um desses com a sua marca? Chama no direct.', '',
      `#site #sitecomagendamento #agendamentoonline #criacaodesites ${nc.tags}`, '');
    out.push('-- Posts individuais --', '');
    for (const m of n.models) {
      out.push(`[${String(m.number).padStart(2, '0')}-${slug(m.name)}.png]`,
        `Modelo ${String(m.number).padStart(2, '0')} · ${m.name} ${nc.emoji}`,
        `Site para ${nc.nome} com agendamento online. ${m.style}.`,
        `Negócio fictício, criado para mostrar o modelo. Quer o seu? Chama a @${brand.ig} no direct.`,
        `#site #agendamentoonline ${nc.tags}`, '');
    }
  }
  return out.join('\n');
}

async function main() {
  if (!CHROMIUM) throw new Error('Chromium não encontrado. Defina CHROMIUM_PATH.');
  const { chromium } = require('playwright-core');
  const outDir = process.argv[2] || path.join(__dirname, '..', 'data', 'posts');
  const only = process.argv[3];
  const brand = { name: getSetting('agency_name'), ig: getSetting('agency_instagram') };
  const niches = load().niches.map((n) => ({ ...n, total: n.models.length, models: n.models.filter((m) => !only || m.id === only) })).filter((n) => n.models.length);
  if (!niches.length) throw new Error(`Modelo não encontrado: ${only}`);

  const server = createApp({ limits: { login: off, publicWrite: off, publicRead: off, ai: off } }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const problems = [];
  try {
    const ctxOpts = { locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', reducedMotion: 'reduce', bypassCSP: true };
    const desk = await (await browser.newContext({ ...ctxOpts, viewport: { width: 1440, height: 900 } })).newPage();
    const phone = await (await browser.newContext({ ...ctxOpts, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
    const comp = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
    for (const pg of [desk, phone]) {
      pg.on('pageerror', (e) => problems.push(`erro de script: ${e.message}`));
    }
    fs.mkdirSync(path.join(IMG_DIR, 'thumbs'), { recursive: true });

    for (const n of niches) {
      const dir = path.join(outDir, n.category);
      fs.mkdirSync(dir, { recursive: true });
      const thumbs = [];
      for (const m of n.models) {
        const url = `${base}/modelos/${m.id}`;
        const shots = {};
        for (const [name, pg] of [['desk', desk], ['phone', phone]]) {
          const res = await pg.goto(url, { waitUntil: 'networkidle' });
          if (res.status() !== 200) problems.push(`${m.id}: HTTP ${res.status()}`);
          // A faixa "modelo · negócio fictício" é para quem visita a prévia; no post o aviso vai no rodapé
          await pg.addStyleTag({ content: '.demo-bar{display:none!important}' });
          await settle(pg, [m.theme.fonts.heading, m.theme.fonts.body]);
          const ok = await pg.evaluate((f) => document.fonts.check(`40px "${f}"`), m.theme.fonts.heading);
          if (!ok) problems.push(`${m.id}: fonte ${m.theme.fonts.heading} não carregou`);
          const overflow = await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          if (overflow > 1) problems.push(`${m.id} (${name}): rolagem horizontal de ${overflow}px`);
          if (!(await pg.locator('#booking .slot').count())) problems.push(`${m.id} (${name}): agenda simulada não carregou`);
          shots[name] = await pg.screenshot();
        }
        // miniatura para a galeria e o painel
        await comp.setViewportSize({ width: 640, height: 400 });
        await comp.setContent(`<body style="margin:0"><img src="${dataUri(shots.desk)}" style="width:640px;height:400px;object-fit:cover;object-position:top;display:block"></body>`);
        const thumbFile = path.join(IMG_DIR, 'thumbs', `${m.id}.jpg`);
        await comp.screenshot({ path: thumbFile, type: 'jpeg', quality: 82 });
        thumbs.push(dataUri(fs.readFileSync(thumbFile), 'image/jpeg'));

        await comp.setViewportSize({ width: W, height: H });
        await comp.setContent(postHtml(m, n.total, dataUri(shots.desk), dataUri(shots.phone), brand), { waitUntil: 'networkidle' });
        await settle(comp, [m.theme.fonts.heading, 'Figtree']);
        const file = path.join(dir, `${String(m.number).padStart(2, '0')}-${slug(m.name)}.png`);
        await comp.screenshot({ path: file });
        console.log(`✔ ${m.id} → ${path.relative(outDir, file)}`);
      }
      if (!only) {
        await comp.setContent(coverHtml(n, thumbs, brand), { waitUntil: 'networkidle' });
        await settle(comp, ['Fraunces', 'Figtree']);
        await comp.screenshot({ path: path.join(dir, '00-capa.png') });
        await comp.setContent(ctaHtml(n, brand), { waitUntil: 'networkidle' });
        await settle(comp, ['Fraunces', 'Figtree']);
        await comp.screenshot({ path: path.join(dir, `${String(n.models.length + 1).padStart(2, '0')}-cta.png`) });
        console.log(`✔ ${n.category}: capa e CTA`);
      }
    }
    if (!only) fs.writeFileSync(path.join(outDir, 'legendas.txt'), captions(niches, brand));
  } finally {
    await browser.close();
    server.close();
  }
  if (problems.length) {
    console.error(`\n⚠ ${problems.length} problema(s):\n  ${problems.join('\n  ')}`);
    process.exitCode = 2;
  }
}

if (require.main === module) {
  main().then(() => { closeDb(); process.exit(process.exitCode || 0); })
    .catch((e) => { console.error(`✘ ${e.message}`); closeDb(); process.exit(1); });
}

module.exports = { postHtml, coverHtml, ctaHtml, captions };
