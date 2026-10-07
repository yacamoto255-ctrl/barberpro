// scripts/build-model-art.js — gera as capas ilustradas dos modelos (sites/modelos/img/<id>.png).
//   node scripts/build-model-art.js            todas
//   node scripts/build-model-art.js pet-03     só uma
// Ferramenta de desenvolvimento: precisa do playwright-core (devDependency) e de um Chromium
// (CHROMIUM_PATH ou o do ambiente). A arte é vetorial (SVG), com as cores do tema de cada modelo,
// e sai no formato do layout do topo: 4:5 (split), 16:9 (banner), 21:9 (stacked) ou 16:10.
'use strict';

const fs = require('fs');
const path = require('path');

const emitWarning = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w).includes('SQLite is an experimental') ? undefined : emitWarning.call(process, w, ...a));

const { load, IMG_DIR } = require('../src/services/models');
const { mix, luminance, contrast } = require('../src/services/theme');

const CHROMIUM = process.env.CHROMIUM_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));

const SIZES = {
  split: [1200, 1500], split_left: [1200, 1500], banner: [1800, 1000], stacked: [2100, 900], centered: [1600, 1000], editorial: [1600, 1000],
};

/* ── Ícones (caixa 600×600) ─────────────────────────────────
   c = { f: preenchimento, s: traço, a: detalhe 1, b: detalhe 2, l: claro, d: escuro } */
const SW = 18;
const ICONS = {
  razor: (c) => `<g transform="rotate(-24 300 300)">
    <path d="M30 262 L380 248 L380 338 L70 352 Q30 352 30 312 Z" fill="${c.l}" stroke="${c.s}" stroke-width="${SW}" stroke-linejoin="round"/>
    <path d="M70 330 L370 318" stroke="${c.a}" stroke-width="10" stroke-linecap="round"/>
    <rect x="360" y="270" width="230" height="56" rx="28" fill="${c.f}" stroke="${c.s}" stroke-width="${SW}"/>
    <circle cx="388" cy="298" r="14" fill="${c.s}"/></g>`,
  scissors: (c) => `<g>
    <path d="M292 300 L212 48 L248 40 L326 282 Z" fill="${c.l}" stroke="${c.s}" stroke-width="${SW}" stroke-linejoin="round"/>
    <path d="M308 300 L388 48 L352 40 L274 282 Z" fill="${c.l}" stroke="${c.s}" stroke-width="${SW}" stroke-linejoin="round"/>
    <path d="M292 304 L238 404 M308 304 L362 404" stroke="${c.s}" stroke-width="30" stroke-linecap="round"/>
    <circle cx="214" cy="468" r="72" fill="none" stroke="${c.a}" stroke-width="30"/>
    <circle cx="386" cy="468" r="72" fill="none" stroke="${c.a}" stroke-width="30"/>
    <circle cx="300" cy="292" r="16" fill="${c.s}"/></g>`,
  comb: (c) => `<g transform="rotate(-14 300 300)">
    <rect x="70" y="190" width="460" height="92" rx="26" fill="${c.f}" stroke="${c.s}" stroke-width="${SW}"/>
    ${Array.from({ length: 13 }, (_, i) => `<rect x="${92 + i * 33}" y="270" width="17" height="${i % 2 ? 130 : 160}" rx="8" fill="${c.f}" stroke="${c.s}" stroke-width="8"/>`).join('')}
    <circle cx="120" cy="236" r="12" fill="${c.a}"/></g>`,
  pole: (c) => `<g>
    <defs><clipPath id="pc"><rect x="225" y="110" width="150" height="380" rx="20"/></clipPath></defs>
    <rect x="225" y="110" width="150" height="380" fill="${c.l}"/>
    <g clip-path="url(#pc)">${Array.from({ length: 9 }, (_, i) => `<rect x="150" y="${40 + i * 70}" width="300" height="30" fill="${i % 2 ? c.b : c.a}" transform="rotate(-30 300 ${55 + i * 70})"/>`).join('')}</g>
    <rect x="225" y="110" width="150" height="380" rx="20" fill="none" stroke="${c.s}" stroke-width="${SW}"/>
    <path d="M205 112 Q300 10 395 112 Z" fill="${c.f}" stroke="${c.s}" stroke-width="${SW}" stroke-linejoin="round"/>
    <rect x="200" y="488" width="200" height="56" rx="14" fill="${c.f}" stroke="${c.s}" stroke-width="${SW}"/></g>`,
  mustache: (c) => `<path d="M300 318 C262 254 190 246 140 290 C110 316 76 322 40 300 C62 372 140 404 204 384 C254 368 282 350 300 344 C318 350 346 368 396 384 C460 404 538 372 560 300 C524 322 490 316 460 290 C410 246 338 254 300 318 Z" fill="${c.f}" stroke="${c.s}" stroke-width="${SW}" stroke-linejoin="round"/>
    <path d="M150 316 C190 300 230 310 260 330" stroke="${c.a}" stroke-width="10" fill="none" stroke-linecap="round"/>`,
  tooth: (c) => `<g transform="translate(127 37) scale(.75)">
    <path d="M230 0 C330 0 460 30 460 170 C460 290 410 360 395 470 C380 590 360 700 300 700 C245 700 260 520 230 520 C200 520 215 700 160 700 C100 700 80 590 65 470 C50 360 0 290 0 170 C0 30 130 0 230 0 Z"
      fill="${c.l}" stroke="${c.s}" stroke-width="22" stroke-linejoin="round"/>
    <path d="M110 130 C150 92 214 88 252 112" stroke="${c.a}" stroke-width="20" fill="none" stroke-linecap="round"/></g>`,
  toothbrush: (c) => `<g transform="rotate(-32 300 300)">
    <rect x="20" y="300" width="400" height="46" rx="23" fill="${c.f}" stroke="${c.s}" stroke-width="${SW}"/>
    <rect x="410" y="290" width="160" height="64" rx="20" fill="${c.f}" stroke="${c.s}" stroke-width="${SW}"/>
    ${Array.from({ length: 6 }, (_, i) => `<rect x="${424 + i * 23}" y="${196 + (i % 2) * 10}" width="14" height="${96 - (i % 2) * 10}" rx="6" fill="${c.l}" stroke="${c.s}" stroke-width="6"/>`).join('')}
    <circle cx="70" cy="323" r="10" fill="${c.a}"/></g>`,
  smile: (c) => `<g>
    <path d="M90 240 Q300 330 510 240 Q490 480 300 492 Q110 480 90 240 Z" fill="${c.l}" stroke="${c.s}" stroke-width="${SW}" stroke-linejoin="round"/>
    <path d="M120 300 Q300 372 480 300" stroke="${c.s}" stroke-width="10" fill="none"/>
    ${[190, 245, 300, 355, 410].map((x) => `<path d="M${x} ${x === 300 ? 286 : 280} L${x} ${x === 300 ? 335 : 330 - Math.abs(300 - x) / 9}" stroke="${c.s}" stroke-width="8"/>`).join('')}
    <circle cx="470" cy="150" r="22" fill="${c.a}"/><circle cx="520" cy="200" r="12" fill="${c.a}"/></g>`,
  mirror: (c) => `<g>
    <rect x="276" y="380" width="48" height="190" rx="22" fill="${c.f}" stroke="${c.s}" stroke-width="${SW}"/>
    <ellipse cx="300" cy="230" rx="160" ry="180" fill="${c.f}" stroke="${c.s}" stroke-width="${SW}"/>
    <ellipse cx="300" cy="230" rx="118" ry="138" fill="${c.l}" stroke="${c.s}" stroke-width="8"/>
    <path d="M230 150 Q260 110 310 108" stroke="${c.a}" stroke-width="16" fill="none" stroke-linecap="round"/></g>`,
  paw: (c) => `<g fill="${c.f}" stroke="${c.s}" stroke-width="${SW}">
    <path d="M300 250 C390 250 470 330 470 410 C470 480 410 500 360 488 C330 480 320 470 300 470 C280 470 270 480 240 488 C190 500 130 480 130 410 C130 330 210 250 300 250 Z"/>
    <ellipse cx="112" cy="232" rx="58" ry="78" transform="rotate(-22 112 232)"/>
    <ellipse cx="226" cy="118" rx="60" ry="82" transform="rotate(-6 226 118)"/>
    <ellipse cx="374" cy="118" rx="60" ry="82" transform="rotate(6 374 118)"/>
    <ellipse cx="488" cy="232" rx="58" ry="78" transform="rotate(22 488 232)"/></g>`,
  bone: (c) => `<g transform="rotate(-28 300 300)" fill="${c.f}" stroke="${c.s}" stroke-width="6">
    <rect x="150" y="252" width="300" height="96" rx="20"/>
    <circle cx="146" cy="246" r="64"/><circle cx="146" cy="354" r="64"/><circle cx="454" cy="246" r="64"/><circle cx="454" cy="354" r="64"/>
    <path d="M190 300 L410 300" stroke="${c.a}" stroke-width="12" stroke-linecap="round" stroke-dasharray="2 34"/></g>`,
  dog: (c) => `<g>
    <ellipse cx="128" cy="270" rx="72" ry="150" transform="rotate(18 128 270)" fill="${c.a}" stroke="${c.s}" stroke-width="${SW}"/>
    <ellipse cx="472" cy="270" rx="72" ry="150" transform="rotate(-18 472 270)" fill="${c.a}" stroke="${c.s}" stroke-width="${SW}"/>
    <ellipse cx="300" cy="320" rx="172" ry="186" fill="${c.f}" stroke="${c.s}" stroke-width="${SW}"/>
    <ellipse cx="300" cy="410" rx="98" ry="74" fill="${c.l}" stroke="${c.s}" stroke-width="10"/>
    <ellipse cx="300" cy="372" rx="40" ry="28" fill="${c.d}"/>
    <circle cx="232" cy="292" r="17" fill="${c.d}"/><circle cx="368" cy="292" r="17" fill="${c.d}"/>
    <path d="M300 400 L300 428 M268 436 Q300 458 332 436" stroke="${c.d}" stroke-width="10" fill="none" stroke-linecap="round"/></g>`,
  cat: (c) => `<g>
    <path d="M128 268 L140 60 L290 190 Z M472 268 L460 60 L310 190 Z" fill="${c.f}" stroke="${c.s}" stroke-width="${SW}" stroke-linejoin="round"/>
    <path d="M162 224 L168 116 L244 188 Z M438 224 L432 116 L356 188 Z" fill="${c.a}"/>
    <ellipse cx="300" cy="350" rx="196" ry="168" fill="${c.f}" stroke="${c.s}" stroke-width="${SW}"/>
    <ellipse cx="228" cy="330" rx="20" ry="30" fill="${c.d}"/><ellipse cx="372" cy="330" rx="20" ry="30" fill="${c.d}"/>
    <path d="M282 390 L318 390 L300 412 Z" fill="${c.a}"/>
    <path d="M300 412 Q280 440 256 430 M300 412 Q320 440 344 430" stroke="${c.d}" stroke-width="8" fill="none" stroke-linecap="round"/>
    <path d="M200 400 L90 384 M200 420 L96 436 M400 400 L510 384 M400 420 L504 436" stroke="${c.d}" stroke-width="7" stroke-linecap="round"/></g>`,
  ball: (c) => `<g>
    <circle cx="300" cy="300" r="210" fill="${c.f}" stroke="${c.s}" stroke-width="${SW}"/>
    <path d="M150 150 C262 230 262 370 150 450 M450 150 C338 230 338 370 450 450" stroke="${c.l}" stroke-width="20" fill="none" stroke-linecap="round"/>
    <path d="M232 128 Q300 108 368 128" stroke="${c.a}" stroke-width="14" fill="none" stroke-linecap="round"/></g>`,
  circles: (c) => `<g>
    <circle cx="232" cy="300" r="176" fill="${c.a}" opacity=".92"/>
    <circle cx="368" cy="300" r="176" fill="${c.f}" opacity=".88" style="mix-blend-mode:multiply"/>
    <circle cx="232" cy="300" r="176" fill="none" stroke="${c.s}" stroke-width="10"/>
    <circle cx="368" cy="300" r="176" fill="none" stroke="${c.s}" stroke-width="10"/></g>`,
  sprout: (c) => `<g>
    <path d="M300 540 C300 450 300 380 300 300" stroke="${c.s}" stroke-width="${SW}" fill="none" stroke-linecap="round"/>
    <path d="M300 340 C214 344 158 286 146 206 C232 202 296 254 300 340 Z" fill="${c.a}" stroke="${c.s}" stroke-width="${SW}" stroke-linejoin="round"/>
    <path d="M300 300 C316 196 392 128 484 124 C486 226 410 296 300 300 Z" fill="${c.f}" stroke="${c.s}" stroke-width="${SW}" stroke-linejoin="round"/>
    <path d="M150 548 Q300 500 450 548" stroke="${c.s}" stroke-width="${SW}" fill="none" stroke-linecap="round"/></g>`,
  chair: (c) => `<g stroke="${c.s}" stroke-width="${SW}" stroke-linejoin="round">
    <rect x="168" y="120" width="264" height="270" rx="70" fill="${c.f}"/>
    <rect x="100" y="250" width="92" height="210" rx="44" fill="${c.a}"/>
    <rect x="408" y="250" width="92" height="210" rx="44" fill="${c.a}"/>
    <rect x="170" y="330" width="260" height="110" rx="30" fill="${c.l}"/>
    <path d="M150 460 L140 540 M450 460 L460 540" stroke-linecap="round"/></g>`,
  moon: (c) => `<g>
    <path d="M360 90 A220 220 0 1 0 500 420 A170 170 0 1 1 360 90 Z" fill="${c.f}" stroke="${c.s}" stroke-width="${SW}" stroke-linejoin="round"/>
    <path d="M470 140 l12 30 30 12 -30 12 -12 30 -12 -30 -30 -12 30 -12 Z" fill="${c.a}"/>
    <circle cx="430" cy="290" r="10" fill="${c.a}"/><circle cx="520" cy="250" r="7" fill="${c.a}"/></g>`,
  leaf: (c) => `<g>
    <path d="M100 500 C100 270 250 100 500 100 C500 340 340 500 100 500 Z" fill="${c.f}" stroke="${c.s}" stroke-width="${SW}" stroke-linejoin="round"/>
    <path d="M120 480 Q300 310 470 130" stroke="${c.l}" stroke-width="12" fill="none" stroke-linecap="round"/>
    ${[[220, 360, 200, 250], [290, 290, 290, 190], [360, 220, 380, 150], [250, 330, 350, 350], [320, 260, 420, 270]].map(([x1, y1, x2, y2]) => `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${c.l}" stroke-width="8" stroke-linecap="round"/>`).join('')}</g>`,
  bubbles: (c) => `<g stroke="${c.s}" stroke-width="${SW}" stroke-linejoin="round">
    <path d="M90 110 H360 Q400 110 400 150 V290 Q400 330 360 330 H190 L120 390 L132 330 H90 Q50 330 50 290 V150 Q50 110 90 110 Z" fill="${c.a}"/>
    <path d="M250 250 H510 Q550 250 550 290 V420 Q550 460 510 460 H470 L482 520 L410 460 H250 Q210 460 210 420 V290 Q210 250 250 250 Z" fill="${c.f}"/>
    <path d="M270 330 H490 M270 380 H430" stroke="${c.l}" stroke-width="16" stroke-linecap="round"/></g>`,
  flower: (c) => `<g transform="translate(300 300)">
    ${[0, 60, 120, 180, 240, 300].map((a, i) => `<ellipse cx="0" cy="-150" rx="78" ry="150" fill="${i % 2 ? c.f : c.a}" stroke="${c.s}" stroke-width="10" transform="rotate(${a})"/>`).join('')}
    <circle r="86" fill="${c.l}" stroke="${c.s}" stroke-width="${SW}"/><circle r="36" fill="${c.a}"/></g>`,
  lips: (c) => `<g stroke="${c.s}" stroke-width="${SW}" stroke-linejoin="round">
    <path d="M70 300 C150 200 230 182 300 236 C370 182 450 200 530 300 C450 334 380 348 300 348 C220 348 150 334 70 300 Z" fill="${c.f}"/>
    <path d="M70 300 C150 334 220 348 300 348 C380 348 450 334 530 300 C470 430 380 470 300 470 C220 470 130 430 70 300 Z" fill="${c.a}"/>
    <path d="M220 400 Q260 420 300 420" stroke="${c.l}" stroke-width="12" fill="none" stroke-linecap="round"/></g>`,
  polish: (c) => `<g stroke="${c.s}" stroke-width="${SW}" stroke-linejoin="round">
    <rect x="236" y="60" width="128" height="200" rx="18" fill="${c.d}"/>
    <rect x="252" y="250" width="96" height="48" fill="${c.l}"/>
    <rect x="170" y="290" width="260" height="260" rx="48" fill="${c.f}"/>
    <path d="M214 340 Q214 320 236 318" stroke="${c.l}" stroke-width="16" fill="none" stroke-linecap="round"/></g>`,
  drop: (c) => `<g>
    <path d="M300 60 C300 60 476 270 476 384 C476 482 398 552 300 552 C202 552 124 482 124 384 C124 270 300 60 300 60 Z" fill="${c.f}" stroke="${c.s}" stroke-width="${SW}" stroke-linejoin="round"/>
    <path d="M196 400 C196 460 236 494 284 500" stroke="${c.l}" stroke-width="20" fill="none" stroke-linecap="round"/>
    <circle cx="430" cy="140" r="26" fill="${c.a}"/></g>`,
};

/* ── Composições ─────────────────────────────────────────── */
function rnd(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
function seedOf(id) { return [...id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 2147483647, 7) || 1; }

function iconColors(p, on) {
  // `on` = cor do fundo onde o ícone fica; cada papel pega a primeira cor da lista que aparece sobre ela
  const dark = luminance(p.text) < luminance(p.bg) ? p.text : p.bg;
  const lite = luminance(p.text) < luminance(p.bg) ? p.bg : p.text;
  const pick = (list, min, not = []) => list.find((c) => !not.includes(c) && contrast(c, on) >= min) || list[list.length - 1];
  const f = pick([p.primary, p.accent, p.surface, lite, dark], 2.6);
  const a = pick([p.accent, p.primary, lite, dark], 1.8, [f]);
  const b = pick([p.primary, p.accent, lite, dark], 1.6, [a]);
  return { s: dark, f, a, b, l: lite, d: dark };
}

// Ponto focal: no banner o texto fica embaixo à esquerda, então a arte se concentra à direita
function focus(W, H, layout) { return layout === 'banner' ? [W * 0.7, H * 0.42] : [W / 2, H / 2]; }

const COMPS = {
  stripes(W, H, p, r, fx, fy) {
    const field = mix(p.bg, p.text, 0.06);
    const w = 70;
    const stripes = Array.from({ length: Math.ceil((W + H) / w) + 4 }, (_, i) => `<rect x="${-H + i * w * 1.6}" y="-200" width="${w * (i % 3 === 0 ? 0.55 : 0.9)}" height="${H + 400}" fill="${i % 3 === 0 ? p.accent : p.primary}" opacity="${i % 3 === 0 ? 0.9 : 0.75}"/>`).join('');
    return { field, on: field, body: `<rect width="${W}" height="${H}" fill="${field}"/>
      <g transform="rotate(-34 ${W / 2} ${H / 2})"><clipPath id="band"><rect x="-500" y="${H / 2 - H * 0.18}" width="${W + 1000}" height="${H * 0.36}"/></clipPath><g clip-path="url(#band)">${stripes}</g></g>
      <circle cx="${W * 0.18}" cy="${H * 0.2}" r="${Math.min(W, H) * 0.09}" fill="none" stroke="${p.primary}" stroke-width="16"/>
      <circle cx="${W * 0.85}" cy="${H * 0.85}" r="${Math.min(W, H) * 0.05}" fill="${p.accent}"/>`, back: field };
  },
  arch(W, H, p, r, fx, fy) {
    const field = p.primary;
    const u = Math.min(W, H);
    return { field, on: mix(p.primary, p.bg, 0.0), body: `<rect width="${W}" height="${H}" fill="${field}"/>
      <path d="M${fx - u * 0.42} ${H} V${fy} A${u * 0.42} ${u * 0.42} 0 0 1 ${fx + u * 0.42} ${fy} V${H} Z" fill="${p.bg}" opacity=".95"/>
      <path d="M${fx - u * 0.30} ${H} V${fy + u * 0.05} A${u * 0.30} ${u * 0.30} 0 0 1 ${fx + u * 0.30} ${fy + u * 0.05} V${H} Z" fill="${p.accent}" opacity=".9"/>
      <circle cx="${W * 0.14}" cy="${H * 0.16}" r="${u * 0.07}" fill="${p.accent}"/>
      <rect x="${W * 0.8}" y="${H * 0.1}" width="${u * 0.14}" height="${u * 0.14}" fill="none" stroke="${p.on_primary}" stroke-width="10" transform="rotate(12 ${W * 0.87} ${H * 0.17})"/>`, iconOn: p.accent, center: [fx, fy + u * 0.12], scale: 0.5 };
  },
  grid(W, H, p, r, fx, fy) {
    const field = p.surface;
    const cols = W > H * 1.4 ? 5 : 3;
    const rows = 3;
    const cw = W / cols;
    const ic = Math.min(cols - 1, Math.floor((fx / W) * cols));
    const ch = H / rows;
    const cols2 = [p.primary, p.accent, p.bg, p.text, mix(p.primary, p.bg, 0.5)];
    let tiles = '';
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (x === ic && y === 1) continue;
        const c1 = cols2[Math.floor(r() * cols2.length)];
        const c2 = cols2[Math.floor(r() * cols2.length)];
        const kind = Math.floor(r() * 4);
        const X = x * cw; const Y = y * ch; const m = Math.min(cw, ch);
        tiles += `<rect x="${X}" y="${Y}" width="${cw}" height="${ch}" fill="${c1}"/>`;
        if (c2 === c1) continue;
        if (kind === 0) tiles += `<circle cx="${X + cw / 2}" cy="${Y + ch / 2}" r="${m * 0.32}" fill="${c2}"/>`;
        else if (kind === 1) tiles += `<path d="M${X} ${Y + ch} A${m} ${m} 0 0 1 ${X + m} ${Y + ch - m} V${Y + ch} Z" fill="${c2}"/>`;
        else if (kind === 2) tiles += `<path d="M${X} ${Y} L${X + cw} ${Y + ch} L${X} ${Y + ch} Z" fill="${c2}"/>`;
        else tiles += `<rect x="${X + cw * 0.25}" y="${Y + ch * 0.25}" width="${cw * 0.5}" height="${ch * 0.5}" fill="${c2}"/>`;
      }
    }
    const cx = ic * cw;
    return { field, on: p.bg, body: `<rect width="${W}" height="${H}" fill="${field}"/>${tiles}<rect x="${cx}" y="${ch}" width="${cw}" height="${ch}" fill="${p.bg}"/>`, scale: Math.min(cw, ch) / Math.min(W, H) * 1.15, center: [cx + cw / 2, ch * 1.5] };
  },
  sun(W, H, p, r, fx, fy) {
    const field = mix(p.accent, p.bg, 0.72);
    const cx = fx; const cy = H * 0.62;
    const rays = Array.from({ length: 18 }, (_, i) => {
      const a1 = (i / 18) * Math.PI * 2; const a2 = a1 + Math.PI / 36; const R = Math.max(W, H);
      return `<path d="M${cx} ${cy} L${cx + Math.cos(a1) * R} ${cy + Math.sin(a1) * R} L${cx + Math.cos(a2) * R} ${cy + Math.sin(a2) * R} Z" fill="${p.primary}" opacity=".16"/>`;
    }).join('');
    const u = Math.min(W, H);
    return { field, on: p.primary, body: `<rect width="${W}" height="${H}" fill="${field}"/>${rays}
      <circle cx="${cx}" cy="${cy}" r="${u * 0.4}" fill="${p.primary}"/>
      <rect x="0" y="${H * 0.86}" width="${W}" height="${H * 0.14}" fill="${p.accent}"/>
      <rect x="0" y="${H * 0.86}" width="${W}" height="14" fill="${p.text}" opacity=".85"/>`, center: [cx, cy - u * 0.02] };
  },
  blobs(W, H, p, r, fx, fy) {
    const field = mix(p.bg, p.primary, 0.08);
    return { field, on: field, body: `<rect width="${W}" height="${H}" fill="${field}"/>
      <path d="M${W * 0.1} ${H * 0.3} C${W * 0.25} ${H * 0.02} ${W * 0.62} ${H * 0.1} ${W * 0.6} ${H * 0.4} C${W * 0.58} ${H * 0.68} ${W * 0.22} ${H * 0.75} ${W * 0.12} ${H * 0.58} C${W * 0.05} ${H * 0.46} ${W * 0.02} ${H * 0.4} ${W * 0.1} ${H * 0.3} Z" fill="${p.primary}" opacity=".85"/>
      <path d="M${W * 0.55} ${H * 0.62} C${W * 0.7} ${H * 0.45} ${W * 0.98} ${H * 0.55} ${W * 0.94} ${H * 0.8} C${W * 0.9} ${H * 1.02} ${W * 0.6} ${H * 1.0} ${W * 0.52} ${H * 0.86} C${W * 0.47} ${H * 0.78} ${W * 0.48} ${H * 0.7} ${W * 0.55} ${H * 0.62} Z" fill="${p.accent}" opacity=".8"/>
      <circle cx="${W * 0.86}" cy="${H * 0.18}" r="${Math.min(W, H) * 0.045}" fill="${p.accent}"/>
      <circle cx="${W * 0.78}" cy="${H * 0.26}" r="${Math.min(W, H) * 0.022}" fill="${p.primary}"/>`, iconOn: p.surface };
  },
  waves(W, H, p, r, fx, fy) {
    const field = p.primary;
    const waves = Array.from({ length: 7 }, (_, i) => {
      const y = H * (0.18 + i * 0.13); const a = H * 0.035;
      let d = `M0 ${y}`;
      for (let x = 0; x <= W; x += W / 8) d += ` Q${x + W / 32} ${y - a} ${x + W / 16} ${y} T${x + W / 8} ${y}`;
      return `<path d="${d}" stroke="${i % 2 ? p.accent : p.bg}" stroke-width="${i % 2 ? 10 : 22}" fill="none" opacity="${i % 2 ? 0.9 : 0.35}"/>`;
    }).join('');
    return { field, on: p.primary, body: `<rect width="${W}" height="${H}" fill="${field}"/>${waves}`, iconBg: p.bg };
  },
  checker(W, H, p, r, fx, fy) {
    const field = p.bg;
    const s = Math.min(W, H) / 9;
    let cells = '';
    for (let y = 0; y < H / s + 1; y++) for (let x = 0; x < W / s + 1; x++) if ((x + y) % 2 === 0) cells += `<rect x="${x * s}" y="${y * s}" width="${s}" height="${s}"/>`;
    const u = Math.min(W, H);
    return { field, on: p.accent, body: `<rect width="${W}" height="${H}" fill="${field}"/>
      <g fill="${p.primary}" opacity=".9">${cells}</g>
      <circle cx="${fx}" cy="${fy}" r="${u * 0.40}" fill="${p.accent}" stroke="${p.bg}" stroke-width="22"/>`, center: [fx, fy], scale: 0.56 };
  },
  halftone(W, H, p, r, fx, fy) {
    const field = luminance(p.bg) > 0.35 ? mix(p.text, p.primary, 0.25) : mix(p.bg, '#000000', 0.15);
    const step = 34;
    let dots = '';
    for (let y = 0; y < H + step; y += step) {
      for (let x = 0; x < W + step; x += step) {
        const t = Math.max(0, 1 - Math.hypot(x - fx, y - fy) / (Math.max(W, H) * 0.75));
        if (t > 0.04) dots += `<circle cx="${x + ((y / step) % 2) * step / 2}" cy="${y}" r="${(step / 2) * t}"/>`;
      }
    }
    return { field, on: field, body: `<rect width="${W}" height="${H}" fill="${field}"/>
      <g fill="${p.primary}">${dots}</g>
      <circle cx="${W * 0.16}" cy="${H * 0.78}" r="${Math.min(W, H) * 0.12}" fill="${p.accent}" opacity=".9"/>`, iconOn: field };
  },
  frame(W, H, p, r, fx, fy) {
    const field = mix(p.bg, p.text, 0.04);
    const cx = fx; const u = Math.min(W, H);
    const arches = [0.46, 0.4, 0.34].map((k, i) => `<path d="M${cx - u * k} ${H} V${H * 0.52} A${u * k} ${u * k} 0 0 1 ${cx + u * k} ${H * 0.52} V${H}" fill="none" stroke="${i === 1 ? p.primary : p.accent}" stroke-width="${i === 1 ? 14 : 6}"/>`).join('');
    const fan = Array.from({ length: 13 }, (_, i) => {
      const a = Math.PI + (i / 12) * Math.PI;
      return `<path d="M${cx} ${H * 0.52} L${cx + Math.cos(a) * u * 0.30} ${H * 0.52 + Math.sin(a) * u * 0.30}" stroke="${p.accent}" stroke-width="4" opacity=".7"/>`;
    }).join('');
    return { field, on: field, body: `<rect width="${W}" height="${H}" fill="${field}"/>
      <rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="none" stroke="${p.accent}" stroke-width="6"/>
      <rect x="64" y="64" width="${W - 128}" height="${H - 128}" fill="none" stroke="${p.accent}" stroke-width="2"/>
      ${arches}${fan}`, center: [cx, H * 0.6], scale: 0.55 };
  },
  collage(W, H, p, r, fx, fy) {
    const field = p.surface;
    const u = Math.min(W, H);
    return { field, on: field, body: `<rect width="${W}" height="${H}" fill="${field}"/>
      <rect x="${fx - u * 0.62}" y="${H * 0.1}" width="${u * 0.55}" height="${u * 0.72}" fill="${p.primary}" transform="rotate(-8 ${fx - u * 0.35} ${H * 0.45})"/>
      <rect x="${fx + u * 0.08}" y="${H * 0.16}" width="${u * 0.45}" height="${u * 0.52}" fill="${p.accent}" transform="rotate(10 ${fx + u * 0.3} ${H * 0.4})"/>
      <circle cx="${fx}" cy="${H * 0.52}" r="${u * 0.38}" fill="${p.bg}" stroke="${p.text}" stroke-width="10"/>
      <rect x="${fx + u * 0.1}" y="${H * 0.8}" width="${u * 0.34}" height="${u * 0.08}" fill="${p.text}" transform="rotate(-6 ${fx + u * 0.27} ${H * 0.84})"/>`, iconOn: p.bg, center: [fx, H * 0.52], scale: 0.62 };
  },
};

function svgFor(model) {
  const t = model.theme;
  const p = t.palette;
  const [W, H] = SIZES[t.hero_layout] || SIZES.centered;
  const comp = COMPS[model.art.composicao] || COMPS.blobs;
  const icon = ICONS[model.art.icone];
  if (!icon) throw new Error(`${model.id}: ícone desconhecido "${model.art.icone}"`);
  const r = rnd(seedOf(model.id));
  const [fx, fy] = focus(W, H, t.hero_layout);
  const c = comp(W, H, p, r, fx, fy);
  const size = Math.min(W, H) * (c.scale || 0.72);
  const [x, y] = c.center || [fx, fy];
  const k = size / 600;
  const colors = iconColors(p, c.iconBg || c.iconOn || c.on);
  const iconBg = c.iconBg ? `<circle cx="${x}" cy="${y}" r="${size * 0.6}" fill="${c.iconBg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${c.body}${iconBg}
    <g transform="translate(${x - 300 * k} ${y - 300 * k}) scale(${k})">${icon(colors)}</g></svg>`;
}

async function main() {
  if (!CHROMIUM) throw new Error('Chromium não encontrado. Defina CHROMIUM_PATH.');
  const { chromium } = require('playwright-core');
  const only = process.argv[2];
  const models = load().niches.flatMap((n) => n.models).filter((m) => !only || m.id === only);
  if (!models.length) throw new Error(`Modelo não encontrado: ${only}`);
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  try {
    const page = await browser.newPage();
    for (const m of models) {
      const [W, H] = SIZES[m.theme.hero_layout] || SIZES.centered;
      await page.setViewportSize({ width: W, height: H });
      await page.setContent(`<html><body style="margin:0">${svgFor(m)}</body></html>`);
      const file = path.join(IMG_DIR, `${m.id}.png`);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: W, height: H } });
      console.log(`✔ ${m.id} ${W}×${H} ${Math.round(fs.statSync(file).size / 1024)} KB`);
    }
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(`✘ ${e.message}`); process.exit(1); });
}

module.exports = { svgFor, SIZES, ICONS, COMPS };
