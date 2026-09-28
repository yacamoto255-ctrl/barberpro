'use strict';
/**
 * DADOS DE DEMONSTRAÇÃO (fictícios).
 * Uso: npm run seed            -> cria dados se o banco estiver vazio
 *      npm run seed -- --reset -> APAGA o banco e recria
 *
 * INTEGRAÇÃO FUTURA: cargas/conferentes/praças virão do TMS via /api/integration/*.
 * Os apontamentos são gerados chamando as MESMAS regras de negócio (services/operations),
 * com relógio simulado, para que o rateio e as validações sejam idênticos ao uso real.
 */
const fs = require('fs');
const bcrypt = require('bcryptjs');
const config = require('../src/config');

const reset = process.argv.includes('--reset');
if (reset && config.DB_PATH !== ':memory:') {
  for (const suf of ['', '-wal', '-shm']) fs.rmSync(config.DB_PATH + suf, { force: true });
}

const { getDb } = require('../src/db');
const clock = require('../src/utils/clock');
const ops = require('../src/services/operations');

function seed({ days = 7, quiet = false } = {}) {
  const db = getDb();
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) {
    if (!quiet) console.log('Banco já possui dados. Use "npm run seed -- --reset" para recriar.');
    return false;
  }
  const realNow = clock.now();
  const today = realNow.slice(0, 10);
  const ts = realNow;

  // PRNG determinístico para a demo ser reproduzível
  let s = 20260910;
  const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));

  db.exec('BEGIN');
  // ── Usuários de teste ────────────────────────────────────────────
  const users = [
    ['Administrador', 'admin@logiponto.com', 'Admin1234', 'ADMIN'],
    ['Gestora Operacional', 'gestor@logiponto.com', 'Gestor1234', 'GESTOR'],
    ['Operador do Turno', 'operador@logiponto.com', 'Operador1234', 'OPERADOR'],
  ];
  for (const [name, email, pw, role] of users) {
    db.prepare('INSERT INTO users (name,email,password_hash,role,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(name, email, bcrypt.hashSync(pw, 10), role, ts, ts);
  }

  // ── Turnos e equipes ─────────────────────────────────────────────
  for (const [n, a, b] of [['Manhã', '06:00', '14:00'], ['Tarde', '14:00', '22:00'], ['Noite', '22:00', '06:00']]) {
    db.prepare('INSERT INTO shifts (name,start_time,end_time,created_at,updated_at) VALUES (?,?,?,?,?)').run(n, a, b, ts, ts);
  }
  for (const n of ['Equipe A', 'Equipe B', 'Equipe C']) {
    db.prepare('INSERT INTO teams (name,created_at,updated_at) VALUES (?,?,?)').run(n, ts, ts);
  }

  // ── Regras de produtividade ──────────────────────────────────────
  const rule = (name, method, wf, vf, desc) => Number(db.prepare(`INSERT INTO productivity_rules
    (name,method,weight_factor,volume_factor,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`).run(name, method, wf, vf, desc, ts, ts).lastInsertRowid);
  const rEqual = rule('Rateio igual (padrão)', 'RATEIO_IGUAL', 1, 1, 'Peso de referência ÷ nº de ajudantes da mesma atividade.');
  rule('Proporcional ao tempo', 'PROPORCIONAL_TEMPO', 1, 1, 'Divide o peso conforme o tempo que cada ajudante ficou na atividade.');
  rule('Crédito integral', 'CREDITO_INTEGRAL', 1, 1, 'Cada participante recebe o peso de referência integral (usar com cautela).');

  // ── Tipos de atividade (8) — todos iniciam com rateio igual ─────
  const types = [
    ['CARREGAMENTO', 'Carregamento', 'Carregar a carga no veículo.', 0, '#1f6feb'],
    ['ARRUMACAO', 'Arrumação', 'Arrumar/organizar a carga.', 0, '#8250df'],
    ['SEPARACAO', 'Separação', 'Separar volumes por destino.', 0, '#bf8700'],
    ['MOV_INTERNA', 'Movimentação interna', 'Movimentar carga dentro do armazém.', 0, '#0a7ea4'],
    ['MOV_PRACA', 'Movimentação para praça', 'Levar a carga até a praça de destino.', 1, '#d1242f'],
    ['DESCARGA', 'Descarga', 'Descarregar veículo.', 0, '#1a7f37'],
    ['APOIO_CONFERENTE', 'Apoio ao conferente', 'Apoio na conferência da carga.', 0, '#57606a'],
    ['OUTRAS', 'Outras', 'Outras atividades operacionais ligadas à carga.', 0, '#6e7781'],
  ];
  const typeId = {};
  types.forEach(([code, name, desc, sq, color], i) => {
    typeId[code] = Number(db.prepare(`INSERT INTO activity_types (code,name,description,requires_square,rule_id,color,sort_order,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(code, name, desc, sq, rEqual, color, i + 1, ts, ts).lastInsertRowid);
  });

  // ── Conferentes (5) e praças (10) ────────────────────────────────
  const checkerIds = ['Pedro Almeida', 'Ana Ribeiro', 'Lucas Ferreira', 'Mariana Costa', 'Rafael Souza'].map((n, i) =>
    Number(db.prepare('INSERT INTO checkers (name,registration,external_id,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run(n, `CF${String(i + 1).padStart(3, '0')}`, `TMS-CONF-${i + 1}`, ts, ts).lastInsertRowid));
  const squareIds = [];
  for (let i = 1; i <= 10; i++) {
    squareIds.push(Number(db.prepare('INSERT INTO squares (code,name,external_id,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run(String(i).padStart(2, '0'), `Praça ${String(i).padStart(2, '0')}`, `TMS-PRACA-${i}`, ts, ts).lastInsertRowid));
  }

  // ── Ajudantes (12) — código de barras = identificação do ajudante ─
  const helpers = [
    ['001', 'Yago', 1, 1], ['002', 'João', 1, 1], ['003', 'Carlos', 1, 2], ['004', 'Marcos', 1, 2],
    ['005', 'Diego Martins', 2, 3], ['006', 'Felipe Araújo', 2, 3], ['007', 'Gustavo Lima', 2, 1],
    ['008', 'Henrique Rocha', 1, 2], ['009', 'Igor Nascimento', 2, 3], ['010', 'Leandro Pires', 1, 1],
    ['011', 'Otávio Mendes', 2, 2], ['012', 'Renato Dias', 1, 3],
  ];
  const helperIds = helpers.map(([code, name, shift, team], i) => Number(db.prepare(`INSERT INTO helpers
    (barcode,registration,name,sector,shift_id,team_id,status,admission_date,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(code, `M${1000 + i + 1}`, name, i % 3 === 0 ? 'Expedição' : 'Armazém', shift, team,
    'ATIVO', clock.addDays(today, -between(60, 900)), ts, ts).lastInsertRowid));
  // Um ajudante inativo para demonstrar o bloqueio
  db.prepare(`INSERT INTO helpers (barcode,registration,name,sector,shift_id,team_id,status,notes,created_at,updated_at)
    VALUES ('099','M1099','Paulo Inativo','Armazém',1,1,'INATIVO','Desligado — exemplo de ajudante inativo.',?,?)`).run(ts, ts);
  db.exec('COMMIT');

  // ── Cargas + apontamentos simulados ──────────────────────────────
  const req = { user: db.prepare(`SELECT id,name,role FROM users WHERE role='OPERADOR'`).get(), ip: 'seed' };
  let loadSeq = 4570;
  const newLoad = (date, status) => {
    const weight = between(300, 4500) + pick([0, 0.5]);
    const r = db.prepare(`INSERT INTO loads (load_number,weight_kg,volumes,checker_id,square_id,load_date,status,source,external_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'DEMO',?,?,?)`).run(String(loadSeq), weight, between(20, 260), pick(checkerIds), pick(squareIds), date, status, `TMS-CARGA-${loadSeq}`, ts, ts);
    loadSeq++;
    return Number(r.lastInsertRowid);
  };
  const at = (date, minutes) => `${date} ${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`;

  const flows = [
    ['CARREGAMENTO', 'ARRUMACAO', 'MOV_PRACA'],
    ['SEPARACAO', 'CARREGAMENTO', 'MOV_PRACA'],
    ['DESCARGA', 'MOV_INTERNA', 'APOIO_CONFERENTE'],
    ['APOIO_CONFERENTE', 'CARREGAMENTO', 'ARRUMACAO'],
    ['DESCARGA', 'SEPARACAO', 'MOV_PRACA', 'OUTRAS'],
  ];
  const nowMin = Number(realNow.slice(11, 13)) * 60 + Number(realNow.slice(14, 16));

  for (let d = days - 1; d >= 0; d--) {
    const date = clock.addDays(today, -d);
    const isToday = d === 0;
    const busy = new Map(helperIds.map(h => [h, 0]));
    const loadsToday = isToday ? 5 : between(5, 7);
    const limit = isToday ? nowMin - 5 : 21 * 60;
    let cursor = 7 * 60;
    for (let n = 0; n < loadsToday; n++) {
      const loadId = newLoad(date, isToday ? 'ABERTA' : 'CONCLUIDA');
      db.prepare(`UPDATE loads SET status='ABERTA' WHERE id=?`).run(loadId); // aberta durante a simulação
      let t = cursor;
      for (const code of pick(flows)) {
        const dur = between(15, 55);
        if (t + dur > limit) break;
        const free = helperIds.filter(h => busy.get(h) <= t);
        if (!free.length) break;
        const team = [];
        const size = Math.min(free.length, pick([1, 2, 2, 2, 3]));
        while (team.length < size) { const h = pick(free); if (!team.includes(h)) team.push(h); }
        // Primeiro ajudante fica o tempo todo; os demais podem entrar depois e/ou sair antes.
        const segs = team.map((h, i) => {
          const join = i === 0 ? t : t + between(0, Math.floor(dur / 3));
          const leave = i === 0 ? t + dur : Math.max(join + 5, t + dur - between(0, Math.floor(dur / 4)));
          return { h, join, leave };
        });
        const events = [];
        segs.forEach(sg => { events.push({ k: 'in', m: sg.join, sg }); events.push({ k: 'out', m: sg.leave, sg }); });
        events.sort((a, b) => a.m - b.m || (a.k === 'in' ? -1 : 1));
        for (const ev of events) {
          clock.setNow(at(date, ev.m));
          if (ev.k === 'in') ev.sg.pid = ops.start({ helper_id: ev.sg.h, load_id: loadId, activity_type_id: typeId[code] }, req).participant.id;
          else ops.finish(ev.sg.pid, req);
        }
        segs.forEach(sg => busy.set(sg.h, sg.leave + between(0, 10)));
        t += between(5, 25);
      }
      cursor += between(60, 140);
      if (!isToday) db.prepare(`UPDATE loads SET status='CONCLUIDA' WHERE id=?`).run(loadId);
    }
  }

  // Hoje: cargas abertas aguardando operação + 2 atividades em andamento (se já passou das 07:30)
  const openLoads = [];
  for (let i = 0; i < 6; i++) openLoads.push(newLoad(today, 'ABERTA'));
  if (nowMin > 7 * 60 + 30) {
    const busyNow = new Set(ops.listOpen().map(p => p.helper_id));
    const free = helperIds.filter(h => !busyNow.has(h));
    const lastEnd = db.prepare(`SELECT MAX(left_at) m FROM activity_participants WHERE joined_at >= ?`).get(today + ' 00:00:00').m;
    // Início depois de qualquer apontamento de hoje, para não sobrepor horários
    const startMin = Math.max(nowMin - 20, lastEnd ? Number(lastEnd.slice(11, 13)) * 60 + Number(lastEnd.slice(14, 16)) + 1 : 0);
    if (startMin < nowMin) {
      clock.setNow(at(today, startMin));
      ops.start({ helper_id: free[0], load_id: openLoads[0], activity_type_id: typeId.CARREGAMENTO }, req);
      ops.start({ helper_id: free[1], load_id: openLoads[0], activity_type_id: typeId.CARREGAMENTO }, req);
      ops.start({ helper_id: free[2], load_id: openLoads[1], activity_type_id: typeId.MOV_PRACA }, req);
    }
  }
  clock.setNow(null);

  if (!quiet) {
    const c = t => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
    console.log(`Seed concluído: ${c('helpers')} ajudantes, ${c('loads')} cargas, ${c('checkers')} conferentes, ${c('squares')} praças, ` +
      `${c('activity_types')} tipos de atividade, ${c('activities')} execuções, ${c('activity_participants')} apontamentos.`);
    console.log('Usuários: admin@logiponto.com / Admin1234 | gestor@logiponto.com / Gestor1234 | operador@logiponto.com / Operador1234');
  }
  return true;
}

if (require.main === module) seed();
module.exports = { seed };
