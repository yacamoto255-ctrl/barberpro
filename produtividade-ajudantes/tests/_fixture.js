'use strict';
// Fixture compartilhado: banco em memória com dados mínimos e determinísticos.
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.INTEGRATION_API_KEY = process.env.INTEGRATION_API_KEY ?? 'chave-teste-123';

const request = require('supertest');
const bcrypt = require('bcryptjs');
const { createApp } = require('../src/app');
const { getDb } = require('../src/db');
const clock = require('../src/utils/clock');

const app = createApp();
const TS = '2026-09-10 06:00:00';

function build() {
  const db = getDb();
  const ins = (sql, ...p) => Number(db.prepare(sql).run(...p).lastInsertRowid);
  const hash = bcrypt.hashSync('Senha1234', 4);
  const ids = {};
  ids.admin = ins(`INSERT INTO users (name,email,password_hash,role,created_at,updated_at) VALUES ('Admin','admin@t.com',?,'ADMIN',?,?)`, hash, TS, TS);
  ids.gestor = ins(`INSERT INTO users (name,email,password_hash,role,created_at,updated_at) VALUES ('Gestor','gestor@t.com',?,'GESTOR',?,?)`, hash, TS, TS);
  ids.operador = ins(`INSERT INTO users (name,email,password_hash,role,created_at,updated_at) VALUES ('Operador','op@t.com',?,'OPERADOR',?,?)`, hash, TS, TS);
  ids.inactiveUser = ins(`INSERT INTO users (name,email,password_hash,role,active,created_at,updated_at) VALUES ('Inativo','inativo@t.com',?,'OPERADOR',0,?,?)`, hash, TS, TS);
  ids.shift = ins(`INSERT INTO shifts (name,start_time,end_time,created_at,updated_at) VALUES ('Manhã','06:00','14:00',?,?)`, TS, TS);
  ids.team = ins(`INSERT INTO teams (name,created_at,updated_at) VALUES ('Equipe A',?,?)`, TS, TS);
  ids.ruleEqual = ins(`INSERT INTO productivity_rules (name,method,created_at,updated_at) VALUES ('Igual','RATEIO_IGUAL',?,?)`, TS, TS);
  ids.ruleTime = ins(`INSERT INTO productivity_rules (name,method,created_at,updated_at) VALUES ('Tempo','PROPORCIONAL_TEMPO',?,?)`, TS, TS);
  const type = (code, name, sq = 0) => ins(`INSERT INTO activity_types (code,name,requires_square,rule_id,created_at,updated_at) VALUES (?,?,?,?,?,?)`, code, name, sq, ids.ruleEqual, TS, TS);
  ids.carregamento = type('CARREGAMENTO', 'Carregamento');
  ids.arrumacao = type('ARRUMACAO', 'Arrumação');
  ids.praca = type('MOV_PRACA', 'Movimentação para praça', 1);
  ids.descarga = type('DESCARGA', 'Descarga');
  ids.checker = ins(`INSERT INTO checkers (name,created_at,updated_at) VALUES ('Pedro',?,?)`, TS, TS);
  ids.square5 = ins(`INSERT INTO squares (code,name,created_at,updated_at) VALUES ('05','Praça 05',?,?)`, TS, TS);
  ids.square7 = ins(`INSERT INTO squares (code,name,created_at,updated_at) VALUES ('07','Praça 07',?,?)`, TS, TS);
  const helper = (code, name, status = 'ATIVO') => ins(`INSERT INTO helpers (barcode,name,shift_id,team_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, code, name, ids.shift, ids.team, status, TS, TS);
  ids.yago = helper('001', 'Yago');
  ids.joao = helper('002', 'João');
  ids.carlos = helper('003', 'Carlos');
  ids.marcos = helper('004', 'Marcos');
  ids.inativo = helper('099', 'Paulo Inativo', 'INATIVO');
  const load = (n, w, v, sq = ids.square5, status = 'ABERTA') => ins(`INSERT INTO loads (load_number,weight_kg,volumes,checker_id,square_id,load_date,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`, n, w, v, ids.checker, sq, '2026-09-10', status, TS, TS);
  ids.load4587 = load('4587', 1000, 120);
  ids.load4588 = load('4588', 1000, 121);
  ids.load4589 = load('4589', 2000, 60);
  ids.load4590 = load('4590', 900, 30);
  ids.loadNoSquare = load('5000', 500, 10, null);
  ids.loadClosed = load('6000', 700, 10, ids.square5, 'CONCLUIDA');
  return ids;
}

const ids = build();
const tokens = {};

async function login(email, password = 'Senha1234') {
  const r = await request(app).post('/api/auth/login').send({ email, password });
  if (r.status !== 200) throw new Error(`login falhou ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token;
}

async function loginAll() {
  tokens.admin = await login('admin@t.com');
  tokens.gestor = await login('gestor@t.com');
  tokens.operador = await login('op@t.com');
  return tokens;
}

/** Atalhos autenticados: as('gestor').get('/api/...') */
function as(role) {
  const t = tokens[role];
  const wrap = (m) => (url) => request(app)[m](url).set('Authorization', `Bearer ${t}`);
  return { get: wrap('get'), post: wrap('post'), patch: wrap('patch'), put: wrap('put'), delete: wrap('delete') };
}

module.exports = { app, request, ids, tokens, login, loginAll, as, clock, getDb };
