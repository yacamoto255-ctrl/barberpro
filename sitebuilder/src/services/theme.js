// src/services/theme.js — temas dos sites: modelos prontos, validação e geração com Claude
//
// Modelo híbrido: o Claude só devolve um JSON de tema (cores, fontes, estilo e textos),
// validado aqui. O HTML é montado pelo servidor com dados ao vivo e tudo escapado
// (src/render/site.js), então nada gerado pela IA vira código na página.
'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { HttpError, HEX_RE, clean } = require('../validators');
const { getSetting } = require('../settings');

const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.AI_EFFORT || 'medium';

// Fontes do Google Fonts liberadas (pesos conferidos: pedir peso inexistente quebra o CSS do Google)
const HEADING_FONTS = {
  'Fraunces': { weight: 700, fallback: 'serif' },
  'Playfair Display': { weight: 700, fallback: 'serif' },
  'DM Serif Display': { weight: 400, fallback: 'serif' },
  'Instrument Serif': { weight: 400, fallback: 'serif' },
  'Cormorant Garamond': { weight: 700, fallback: 'serif' },
  'Abril Fatface': { weight: 400, fallback: 'serif' },
  'Bricolage Grotesque': { weight: 700, fallback: 'sans-serif' },
  'Syne': { weight: 700, fallback: 'sans-serif' },
  'Unbounded': { weight: 700, fallback: 'sans-serif' },
  'Sora': { weight: 700, fallback: 'sans-serif' },
  'Josefin Sans': { weight: 700, fallback: 'sans-serif' },
  'Oswald': { weight: 600, fallback: 'sans-serif' },
  'Bebas Neue': { weight: 400, fallback: 'sans-serif' },
  'Archivo Black': { weight: 400, fallback: 'sans-serif' },
  'Anton': { weight: 400, fallback: 'sans-serif' },
  'Alfa Slab One': { weight: 400, fallback: 'serif' },
  'Shrikhand': { weight: 400, fallback: 'serif' },
  'Bodoni Moda': { weight: 700, fallback: 'serif' },
  'Italiana': { weight: 400, fallback: 'serif' },
  'Young Serif': { weight: 400, fallback: 'serif' },
  'Gloock': { weight: 400, fallback: 'serif' },
  'Zilla Slab': { weight: 700, fallback: 'serif' },
  'Newsreader': { weight: 600, fallback: 'serif' },
};
const BODY_FONTS = {
  'Manrope': 'sans-serif', 'DM Sans': 'sans-serif', 'Work Sans': 'sans-serif', 'Karla': 'sans-serif',
  'Outfit': 'sans-serif', 'Figtree': 'sans-serif', 'IBM Plex Sans': 'sans-serif', 'Source Sans 3': 'sans-serif',
  'Nunito Sans': 'sans-serif', 'Libre Franklin': 'sans-serif', 'Rubik': 'sans-serif', 'Public Sans': 'sans-serif',
  'Instrument Sans': 'sans-serif', 'Hanken Grotesk': 'sans-serif', 'Plus Jakarta Sans': 'sans-serif', 'Lexend': 'sans-serif',
  'Albert Sans': 'sans-serif', 'Lora': 'serif', 'Crimson Pro': 'serif',
};
// split_left: imagem à esquerda; stacked: texto centralizado com imagem larga embaixo
const HERO_LAYOUTS = ['centered', 'split', 'split_left', 'stacked', 'editorial', 'banner'];
const HEALTH_CATEGORIES = ['odontologia', 'clinica', 'psicologia', 'nutricao'];
const RADII = ['sharp', 'soft', 'round'];
const BACKGROUNDS = ['plain', 'gradient', 'grain', 'grid', 'dots'];
const PALETTE_KEYS = ['bg', 'surface', 'text', 'muted', 'primary', 'on_primary', 'accent'];
const COPY_LIMITS = {
  headline: 90, subheadline: 200, about: 900, cta: 40,
  services_title: 60, team_title: 60, booking_title: 60,
};

const PRESETS = {
  noite: {
    label: 'Noite', palette: { bg: '#111015', surface: '#1c1b22', text: '#f4efe6', muted: '#a8a296', primary: '#e0a43b', on_primary: '#111015', accent: '#3fb68b' },
    fonts: { heading: 'Bebas Neue', body: 'Manrope' }, hero_layout: 'banner', radius: 'sharp', background: 'grain',
  },
  areia: {
    label: 'Areia', palette: { bg: '#f6f0e6', surface: '#fffaf2', text: '#2a211b', muted: '#6f6257', primary: '#a8481f', on_primary: '#ffffff', accent: '#2f5d50' },
    fonts: { heading: 'Fraunces', body: 'Work Sans' }, hero_layout: 'editorial', radius: 'soft', background: 'plain',
  },
  oliva: {
    label: 'Oliva', palette: { bg: '#eef0e5', surface: '#f8f9f1', text: '#1f2618', muted: '#5b6450', primary: '#46642a', on_primary: '#ffffff', accent: '#b8721f' },
    fonts: { heading: 'DM Serif Display', body: 'Karla' }, hero_layout: 'split', radius: 'round', background: 'dots',
  },
  marinho: {
    label: 'Marinho', palette: { bg: '#0d1b2a', surface: '#15283d', text: '#e8eef5', muted: '#a3b3c5', primary: '#f2c14e', on_primary: '#0d1b2a', accent: '#4fb0c6' },
    fonts: { heading: 'Syne', body: 'DM Sans' }, hero_layout: 'centered', radius: 'soft', background: 'gradient',
  },
  rose: {
    label: 'Rosé', palette: { bg: '#fbf1f0', surface: '#ffffff', text: '#3a1f24', muted: '#7d5a60', primary: '#a8324a', on_primary: '#ffffff', accent: '#c9861a' },
    fonts: { heading: 'Cormorant Garamond', body: 'Figtree' }, hero_layout: 'centered', radius: 'round', background: 'plain',
  },
  concreto: {
    label: 'Concreto', palette: { bg: '#f2f2f0', surface: '#ffffff', text: '#121212', muted: '#5a5a5a', primary: '#121212', on_primary: '#f2f2f0', accent: '#e8461a' },
    fonts: { heading: 'Archivo Black', body: 'IBM Plex Sans' }, hero_layout: 'split', radius: 'sharp', background: 'grid',
  },
};

const CATEGORY_PRESET = {
  barbearia: 'noite', estudio_tatuagem: 'noite', fitness: 'marinho', consultoria: 'concreto', fotografia: 'concreto',
  salao: 'rose', estetica: 'rose', clinica: 'oliva', odontologia: 'marinho', psicologia: 'areia',
  nutricao: 'oliva', pet: 'areia', aulas: 'areia', outro: 'areia',
};

/* ── Contraste (WCAG 2.1) ──────────────────────────────── */
function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
function mix(a, b, t) {
  const ch = (h, i) => parseInt(h.slice(i, i + 2), 16);
  return '#' + [1, 3, 5].map((i) => Math.round(ch(a, i) * (1 - t) + ch(b, i) * t).toString(16).padStart(2, '0')).join('');
}
/** Aproxima `fg` de preto/branco até atingir o contraste mínimo contra `bg` */
function ensureContrast(fg, bg, min) {
  if (contrast(fg, bg) >= min) return fg;
  const target = luminance(bg) > 0.5 ? '#000000' : '#ffffff';
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const c = mix(fg, target, t);
    if (contrast(c, bg) >= min) return c;
  }
  return target;
}

function presetTheme(name) {
  const p = PRESETS[name] || PRESETS.areia;
  return {
    version: 1,
    preset: PRESETS[name] ? name : 'areia',
    palette: { ...p.palette },
    fonts: { ...p.fonts },
    hero_layout: p.hero_layout,
    radius: p.radius,
    background: p.background,
    copy: Object.fromEntries(Object.keys(COPY_LIMITS).map((k) => [k, ''])),
  };
}

function defaultThemeFor(site) {
  return presetTheme(CATEGORY_PRESET[site?.category] || 'areia');
}

/**
 * Valida e corrige um tema vindo do painel ou da IA.
 * Campos inválidos são substituídos pelo modelo base; contraste é corrigido automaticamente.
 */
function validateTheme(input, base = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'Tema inválido.');
  }
  const warnings = [];
  const ref = base || presetTheme(PRESETS[input.preset] ? input.preset : 'areia');
  const out = presetTheme(ref.preset);
  out.preset = ['ai', 'custom'].includes(input.preset) ? input.preset : (PRESETS[input.preset] ? input.preset : 'custom');

  for (const k of PALETTE_KEYS) {
    const v = input.palette?.[k];
    if (typeof v === 'string' && HEX_RE.test(v)) out.palette[k] = v.toLowerCase();
    else { out.palette[k] = ref.palette[k]; if (v !== undefined) warnings.push(`Cor "${k}" inválida; mantida a do modelo.`); }
  }
  out.fonts.heading = HEADING_FONTS[input.fonts?.heading] ? input.fonts.heading : ref.fonts.heading;
  out.fonts.body = BODY_FONTS[input.fonts?.body] ? input.fonts.body : ref.fonts.body;
  out.hero_layout = HERO_LAYOUTS.includes(input.hero_layout) ? input.hero_layout : ref.hero_layout;
  out.radius = RADII.includes(input.radius) ? input.radius : ref.radius;
  out.background = BACKGROUNDS.includes(input.background) ? input.background : ref.background;
  for (const [k, max] of Object.entries(COPY_LIMITS)) {
    const v = input.copy?.[k];
    out.copy[k] = typeof v === 'string' ? clean(v).slice(0, max) : '';
  }

  // Legibilidade garantida, venha a cor de onde vier
  const p = out.palette;
  const fixes = [
    ['text', p.bg, 7], ['muted', p.bg, 4.5], ['on_primary', p.primary, 4.5],
  ];
  for (const [key, against, min] of fixes) {
    const fixed = ensureContrast(p[key], against, min);
    if (fixed !== p[key]) { warnings.push(`Contraste de "${key}" ajustado para leitura.`); p[key] = fixed; }
  }
  if (contrast(p.text, p.surface) < 4.5) { p.surface = mix(p.bg, p.text, 0.06); warnings.push('Cor "surface" ajustada para leitura.'); }
  if (contrast(p.primary, p.bg) < 3) {
    const fixed = ensureContrast(p.primary, p.bg, 3);
    p.primary = fixed;
    p.on_primary = ensureContrast(p.on_primary, fixed, 4.5);
    warnings.push('Cor "primary" ajustada para aparecer sobre o fundo.');
  }
  return { theme: out, warnings };
}

function googleFontsHref(theme) {
  const h = theme.fonts.heading;
  const b = theme.fonts.body;
  const fam = (name, w) => `family=${name.replace(/ /g, '+')}:wght@${w}`;
  const parts = [fam(h, HEADING_FONTS[h].weight)];
  if (b !== h) parts.push(fam(b, '400;600'));
  return `https://fonts.googleapis.com/css2?${parts.join('&')}&display=swap`;
}

/* ── Geração com Claude ────────────────────────────────── */

// Orientação de estética adaptada do anthropics/claude-cookbooks
// (coding/prompting_for_frontend_aesthetics.ipynb), restrita às opções que o template aceita.
const SYSTEM_PROMPT = `You are the art director of Versal Estúdio, a Brazilian studio that builds websites with online booking for small local businesses (barbershops, salons, clinics, studios, pet shops and so on).

You design a visual theme as JSON. A fixed, accessible HTML template renders it with the business's live data (services, prices, team, hours, address), so you choose the look and write the marketing copy, nothing else.

<frontend_aesthetics>
You tend to converge toward generic, "on distribution" outputs, the "AI slop" aesthetic. Avoid it: make a theme that feels designed for this specific business, its category, city and audience.
- Typography: pick a heading/body pairing with real contrast (display serif + clean sans, condensed display + humanist sans, and so on). Choose only from the fonts the schema allows.
- Color: commit to a cohesive palette with one dominant color and a sharp accent. Timid, evenly distributed palettes and the cliché purple gradient on white are off the table. Draw on the business's world (materials, place, culture) and vary between light and dark themes.
- Background and layout: pick the hero layout, corner radius and background texture that best express the mood.
</frontend_aesthetics>

<palette_rules>
All colors are 6-digit hex (#rrggbb). "text" on "bg" and on "surface" must be comfortably readable, "on_primary" is the text color used on top of "primary" buttons, "muted" is for secondary text and must still be readable on "bg". "surface" is the card background, a subtle step from "bg".
</palette_rules>

<copy_rules>
Write all copy in Brazilian Portuguese, in the tone the business's clients expect. Be concrete and specific to the business; use the description and services you are given and invent no facts (no prices, awards, years of experience or guarantees that were not provided). Keep within the limits: headline up to 90 characters, subheadline up to 200, about up to 900 (2 short paragraphs separated by a blank line), cta up to 40 (an action like "Agendar horário"), section titles up to 60.
</copy_rules>`;

const THEME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['palette', 'fonts', 'hero_layout', 'radius', 'background', 'copy'],
  properties: {
    palette: {
      type: 'object',
      additionalProperties: false,
      required: PALETTE_KEYS,
      properties: Object.fromEntries(PALETTE_KEYS.map((k) => [k, { type: 'string', description: 'Hex color #rrggbb' }])),
    },
    fonts: {
      type: 'object',
      additionalProperties: false,
      required: ['heading', 'body'],
      properties: {
        heading: { type: 'string', enum: Object.keys(HEADING_FONTS) },
        body: { type: 'string', enum: Object.keys(BODY_FONTS) },
      },
    },
    hero_layout: { type: 'string', enum: HERO_LAYOUTS },
    radius: { type: 'string', enum: RADII },
    background: { type: 'string', enum: BACKGROUNDS },
    copy: {
      type: 'object',
      additionalProperties: false,
      required: Object.keys(COPY_LIMITS),
      properties: Object.fromEntries(Object.keys(COPY_LIMITS).map((k) => [k, { type: 'string' }])),
    },
  },
};

let clientFactory = (apiKey) => new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
function _setClientFactory(fn) { clientFactory = fn; }

function apiKey() {
  return getSetting('anthropic_api_key') || process.env.ANTHROPIC_API_KEY || null;
}

function buildUserPrompt(site, services, hint) {
  const lines = [
    `Business name: ${site.name}`,
    `Category: ${site.category}`,
    site.city ? `City: ${site.city}${site.state ? ' - ' + site.state : ''}` : null,
    site.tagline ? `Tagline: ${site.tagline}` : null,
    site.description ? `Description: ${site.description}` : null,
    services.length ? `Services: ${services.map((s) => `${s.name} (${s.duration_min} min)`).join('; ')}` : null,
    hint ? `Style direction from the agency: ${hint}` : null,
  ].filter(Boolean);
  const rules = [];
  if (site.hide_prices) rules.push('Do not mention prices, discounts, promotions, free services or payment terms anywhere in the copy.');
  if (HEALTH_CATEGORIES.includes(site.category)) {
    rules.push('This is a regulated health profession in Brazil (professional council advertising rules): keep the copy sober and informative; no promises or guarantees of results, no "sem dor" or "o melhor" style superlatives, no before/after claims, no sensationalism.');
  }
  return `Design the website theme for this business.\n\n<business>\n${lines.join('\n')}\n</business>`
    + (rules.length ? `\n\n<copy_constraints>\n${rules.join('\n')}\n</copy_constraints>` : '');
}

/**
 * Gera um tema com Claude. Lança HttpError com mensagem amigável em qualquer falha.
 * @returns {Promise<{theme:object, warnings:string[], model:string}>}
 */
async function generateTheme(site, services, hint = '') {
  const key = apiKey();
  if (!key) throw new HttpError(400, 'Configure a chave da API da Anthropic em Configurações para gerar com IA.', { code: 'NO_AI_KEY' });

  const client = clientFactory(key);
  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: EFFORT, format: { type: 'json_schema', schema: THEME_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(site, services, clean(hint || '').slice(0, 300)) }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      throw new HttpError(400, 'A chave da API da Anthropic é inválida ou sem permissão.', { code: 'AI_AUTH' });
    }
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'Limite de uso da IA atingido. Tente em alguns minutos.', { code: 'AI_RATE' });
    if (e instanceof Anthropic.BadRequestError) {
      console.error('[ai] requisição recusada:', e.message);
      throw new HttpError(502, 'A IA recusou a requisição. Veja o log do servidor.', { code: 'AI_BAD_REQUEST' });
    }
    if (e instanceof Anthropic.APIConnectionError) throw new HttpError(502, 'Não foi possível conectar à IA. Verifique a internet do servidor.', { code: 'AI_CONN' });
    if (e instanceof Anthropic.APIError) {
      console.error('[ai] erro da API:', e.status, e.message);
      throw new HttpError(502, `A IA está indisponível (erro ${e.status ?? '?'}). Tente novamente.`, { code: 'AI_API' });
    }
    throw e;
  }

  if (response.stop_reason === 'refusal') {
    throw new HttpError(422, 'A IA não gerou este tema. Ajuste a descrição ou a orientação de estilo e tente de novo.', { code: 'AI_REFUSAL' });
  }
  if (response.stop_reason === 'max_tokens') {
    throw new HttpError(502, 'A resposta da IA veio incompleta. Tente novamente.', { code: 'AI_TRUNCATED' });
  }
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    throw new HttpError(502, 'A IA devolveu um formato inesperado. Tente novamente.', { code: 'AI_FORMAT' });
  }
  const { theme, warnings } = validateTheme({ ...parsed, preset: 'ai' }, defaultThemeFor(site));
  return { theme, warnings, model: response.model };
}

module.exports = {
  PRESETS, HEADING_FONTS, BODY_FONTS, HERO_LAYOUTS, RADII, BACKGROUNDS, COPY_LIMITS, THEME_SCHEMA, SYSTEM_PROMPT,
  presetTheme, defaultThemeFor, validateTheme, googleFontsHref, generateTheme, contrast, ensureContrast, mix, luminance, apiKey, buildUserPrompt,
  _setClientFactory, MODEL,
};
