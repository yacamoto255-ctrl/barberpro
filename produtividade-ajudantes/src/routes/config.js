'use strict';
// Tipos de atividade e regras de produtividade (somente ADMIN altera).
const { crud } = require('./crudFactory');
const { getDb } = require('../db');
const { badRequest, conflict } = require('../utils/errors');
const { METHODS } = require('../domain/allocation');

const activityTypes = crud({
  table: 'activity_types',
  orderBy: 'sort_order, name',
  search: ['name', 'code'],
  write: ['ADMIN'],
  select: `SELECT t.*, r.name AS rule_name, r.method AS rule_method, r.weight_factor, r.volume_factor
             FROM activity_types t JOIN productivity_rules r ON r.id=t.rule_id`,
  schema: {
    code: { type: 'string', required: true, max: 30, label: 'Código', pattern: /^[A-Za-z0-9_]+$/, patternMsg: 'Código: use letras, números e "_".' },
    name: { type: 'string', required: true, max: 60, label: 'Nome' },
    description: { type: 'string', max: 300, label: 'Descrição' },
    requires_square: { type: 'bool' },
    rule_id: { type: 'int', required: true, min: 1, label: 'Regra de produtividade' },
    color: { type: 'string', max: 7, pattern: /^#[0-9a-fA-F]{6}$/, patternMsg: 'Cor inválida (use #RRGGBB).', label: 'Cor', default: '#1f6feb' },
    sort_order: { type: 'int', min: 0, max: 999, label: 'Ordem', default: 0 },
    active: { type: 'bool' },
  },
  prepare(d) {
    if (d.code) d.code = d.code.toUpperCase();
    if (d.rule_id) {
      const r = getDb().prepare('SELECT active FROM productivity_rules WHERE id=?').get(d.rule_id);
      if (!r) throw badRequest('Regra de produtividade inexistente.');
      if (!r.active) throw badRequest('Regra de produtividade inativa.');
    }
    if ('rule_id' in d && d.rule_id === null) throw badRequest('Regra de produtividade é obrigatória.');
    return d;
  },
});

const rules = crud({
  table: 'productivity_rules',
  write: ['ADMIN'],
  read: ['ADMIN', 'GESTOR'],
  schema: {
    name: { type: 'string', required: true, max: 80, label: 'Nome' },
    method: { type: 'enum', required: true, values: Object.keys(METHODS), label: 'Método' },
    weight_factor: { type: 'number', min: 0, max: 10, label: 'Fator de peso', default: 1 },
    volume_factor: { type: 'number', min: 0, max: 10, label: 'Fator de volumes', default: 1 },
    description: { type: 'string', max: 300, label: 'Descrição' },
    active: { type: 'bool' },
  },
  prepare(d, before) {
    if (before && d.active === 0) {
      const used = getDb().prepare('SELECT COUNT(*) c FROM activity_types WHERE rule_id=? AND active=1').get(before.id).c;
      if (used) throw conflict('Regra em uso por atividades ativas. Troque a regra das atividades antes de inativar.', null, 'EM_USO');
    }
    return d;
  },
});

module.exports = { activityTypes, rules, METHODS };
