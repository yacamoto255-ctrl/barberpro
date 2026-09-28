'use strict';
// Cadastros auxiliares: equipes, turnos, conferentes e praças.
const { crud } = require('./crudFactory');
const { badRequest } = require('../utils/errors');

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const teams = crud({
  table: 'teams',
  schema: { name: { type: 'string', required: true, max: 60, label: 'Nome' }, active: { type: 'bool' } },
});

const shifts = crud({
  table: 'shifts',
  orderBy: 'start_time',
  schema: {
    name: { type: 'string', required: true, max: 40, label: 'Nome' },
    start_time: { type: 'string', required: true, pattern: HHMM, patternMsg: 'Horário inicial inválido (HH:MM).', label: 'Início' },
    end_time: { type: 'string', required: true, pattern: HHMM, patternMsg: 'Horário final inválido (HH:MM).', label: 'Fim' },
    active: { type: 'bool' },
  },
  prepare(d, before) {
    const s = d.start_time ?? before?.start_time, e = d.end_time ?? before?.end_time;
    if (s && e && s === e) throw badRequest('Início e fim do turno não podem ser iguais.');
    return d;
  },
});

const checkers = crud({
  table: 'checkers',
  search: ['name', 'registration'],
  schema: {
    name: { type: 'string', required: true, max: 100, label: 'Nome' },
    registration: { type: 'string', max: 30, label: 'Matrícula' },
    active: { type: 'bool' },
  },
});

const squares = crud({
  table: 'squares',
  orderBy: 'code',
  search: ['code', 'name'],
  schema: {
    code: { type: 'string', required: true, max: 20, label: 'Código' },
    name: { type: 'string', required: true, max: 80, label: 'Nome' },
    active: { type: 'bool' },
  },
});

module.exports = { teams, shifts, checkers, squares };
