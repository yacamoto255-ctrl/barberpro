'use strict';
require('./helpers');
const v = require('../src/validators');
const slots = require('../src/services/slots');
const theme = require('../src/services/theme');

afterAll(require('./helpers').cleanup);

test('CNPJ numérico e alfanumérico (formato novo da Receita)', () => {
  expect(v.normalizeCnpj('11.222.333/0001-81')).toBe('11.222.333/0001-81');
  expect(v.normalizeCnpj('11222333000181')).toBe('11.222.333/0001-81');
  expect(v.normalizeCnpj('12.ABC.345/01DE-35')).toBe('12.ABC.345/01DE-35');
  expect(v.normalizeCnpj('12abc34501de35')).toBe('12.ABC.345/01DE-35');
  for (const bad of ['11.222.333/0001-82', '00.000.000/0000-00', '11111111111111', '123', '12.ABC.345/01DE-3X', '']) {
    expect(v.normalizeCnpj(bad)).toBeNull();
  }
});

test('telefone BR', () => {
  expect(v.normalizePhoneBR('(11) 98765-4321')).toBe('5511987654321');
  expect(v.normalizePhoneBR('+55 (41) 3333-4444')).toBe('554133334444');
  for (const bad of ['123', '(11) 88765-4321', '(01) 98765-4321', '(11) 99999-9999', '1198765432100', '']) {
    expect(v.normalizePhoneBR(bad)).toBeNull();
  }
});

test('CEP, e-mail, Instagram, slug, datas e dinheiro', () => {
  expect(v.normalizeCep('80010000')).toBe('80010-000');
  expect(v.normalizeCep('11111-111')).toBeNull();
  expect(v.normalizeCep('8001-000')).toBeNull();
  expect(v.isValidEmail('a.b+c@dominio.com.br')).toBe(true);
  for (const bad of ['a@b', 'a b@c.com', '<a>@b.com', '@b.com', 'a@b.c']) expect(v.isValidEmail(bad)).toBe(false);
  expect(v.normalizeInstagram('@Versal.Estudio')).toBe('versal.estudio');
  expect(v.normalizeInstagram('https://www.instagram.com/versal.estudio/?hl=pt')).toBe('versal.estudio');
  expect(v.normalizeInstagram('nome com espaço')).toBeNull();
  expect(v.slugify('  Ótica São João!! ')).toBe('otica-sao-joao');
  expect(v.isValidSlug('ab')).toBe(false);
  expect(v.isValidSlug('a--b')).toBe(false);
  expect(v.isValidSlug('-abc')).toBe(false);
  expect(v.isValidDate('2028-02-29')).toBe(true);
  expect(v.isValidDate('2027-02-29')).toBe(false);
  expect(v.isValidTime('23:59')).toBe(true);
  expect(v.isValidTime('24:00')).toBe(false);
  expect(v.parseMoneyToCents('R$ 1.234,56')).toBe(123456);
  expect(v.parseMoneyToCents('10.5')).toBe(1050);
  expect(v.parseMoneyToCents('-5')).toBeNull();
  expect(v.parseMoneyToCents('1,234')).toBeNull();
});

test('aritmética de datas da agenda', () => {
  expect(slots.addMinutes('2026-12-31 23:30', 45)).toBe('2027-01-01 00:15');
  expect(slots.addDays('2028-02-28', 1)).toBe('2028-02-29');
  expect(slots.weekdayOf('2026-10-06')).toBe(2); // terça
  expect(slots.nowLocal('America/Sao_Paulo', new Date('2026-10-06T23:30:00Z'))).toBe('2026-10-06 20:30');
  expect(slots.overlaps('2026-01-01 10:00', '2026-01-01 10:30', '2026-01-01 10:30', '2026-01-01 11:00')).toBe(false);
  expect(slots.overlaps('2026-01-01 10:00', '2026-01-01 10:31', '2026-01-01 10:30', '2026-01-01 11:00')).toBe(true);
});

test('todos os modelos prontos passam no contraste mínimo', () => {
  for (const name of Object.keys(theme.PRESETS)) {
    const { theme: t, warnings } = theme.validateTheme(theme.presetTheme(name));
    expect({ name, warnings }).toEqual({ name, warnings: [] });
    expect(theme.contrast(t.palette.text, t.palette.bg)).toBeGreaterThanOrEqual(7);
    expect(theme.contrast(t.palette.on_primary, t.palette.primary)).toBeGreaterThanOrEqual(4.5);
  }
});

test('URL do Google Fonts só pede pesos que existem', () => {
  const t = theme.presetTheme('noite');
  expect(theme.googleFontsHref(t)).toBe('https://fonts.googleapis.com/css2?family=Bebas+Neue:wght@400&family=Manrope:wght@400;600&display=swap');
});
