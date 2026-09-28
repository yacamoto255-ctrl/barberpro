'use strict';
/**
 * Regras de negócio do APONTAMENTO (início/fim/cancelamento/correção de atividades).
 *
 * Garantias:
 *  - Um ajudante só pode estar em UMA atividade aberta por vez (índice único parcial).
 *  - Só existe UMA execução aberta por (carga, tipo de atividade, praça). Um segundo ajudante
 *    que inicia a mesma atividade na mesma carga ENTRA na execução existente (rateio entre eles).
 *  - Atividades diferentes na mesma carga ficam em execuções separadas (sem rateio cruzado).
 *  - O rateio é calculado com a regra "fotografada" no início da execução e gravado em
 *    activity_allocations (1 linha por ajudante por execução — nunca conta duas vezes).
 *  - Horários vêm do servidor (não do dispositivo), evitando apontamento retroativo indevido.
 */
const { getDb, tx } = require('../db');
const clock = require('../utils/clock');
const audit = require('./audit');
const { allocate } = require('../domain/allocation');
const { badRequest, notFound, conflict, forbidden } = require('../utils/errors');
const { normalizeBarcode } = require('../utils/validate');
const config = require('../config');

const PARTICIPANT_VIEW = `
  SELECT p.id, p.activity_id, p.helper_id, p.joined_at, p.left_at, p.duration_seconds, p.status,
         p.cancel_reason, p.started_by,
         h.name AS helper_name, h.barcode AS helper_barcode,
         a.status AS activity_status, a.reference_weight_kg, a.reference_volumes, a.started_at AS activity_started_at,
         t.id AS activity_type_id, t.name AS activity_type_name, t.color AS activity_type_color,
         l.id AS load_id, l.load_number, l.weight_kg AS load_weight_kg, l.volumes AS load_volumes,
         s.id AS square_id, s.code AS square_code, s.name AS square_name
    FROM activity_participants p
    JOIN helpers h        ON h.id = p.helper_id
    JOIN activities a     ON a.id = p.activity_id
    JOIN activity_types t ON t.id = a.activity_type_id
    JOIN loads l          ON l.id = a.load_id
    LEFT JOIN squares s   ON s.id = a.square_id`;

function getParticipant(id) {
  return getDb().prepare(`${PARTICIPANT_VIEW} WHERE p.id = ?`).get(id);
}

function openParticipationOfHelper(helperId) {
  return getDb().prepare(`${PARTICIPANT_VIEW} WHERE p.helper_id = ? AND p.status = 'ATIVO'`).get(helperId);
}

/** Identifica o ajudante pelo código de barras (código = SOMENTE o ajudante). */
function identify(barcodeRaw) {
  const barcode = normalizeBarcode(barcodeRaw);
  if (!barcode) throw badRequest('Informe o código do ajudante.');
  const helper = getDb().prepare(`SELECT h.id, h.barcode, h.name, h.registration, h.status, h.sector,
      s.name AS shift_name, t.name AS team_name
      FROM helpers h LEFT JOIN shifts s ON s.id=h.shift_id LEFT JOIN teams t ON t.id=h.team_id
      WHERE h.barcode = ?`).get(barcode);
  if (!helper) throw notFound(`Código ${barcode} não pertence a nenhum ajudante cadastrado.`);
  if (helper.status !== 'ATIVO') {
    throw conflict(`${helper.name} (${helper.barcode}) está INATIVO e não pode ser apontado.`, { helper }, 'AJUDANTE_INATIVO');
  }
  return { helper, current: openParticipationOfHelper(helper.id) || null };
}

/** Recalcula e grava o rateio de uma execução finalizada. */
function computeAllocations(db, activityId) {
  const act = db.prepare('SELECT * FROM activities WHERE id=?').get(activityId);
  db.prepare('DELETE FROM activity_allocations WHERE activity_id=?').run(activityId);
  if (!act || act.status !== 'FINALIZADA') return [];
  const participants = db.prepare(`
    SELECT helper_id, SUM(COALESCE(duration_seconds,0)) AS worked_seconds, MIN(joined_at) AS first_join
      FROM activity_participants
     WHERE activity_id = ? AND status = 'FINALIZADO'
     GROUP BY helper_id
     ORDER BY first_join, MIN(id)`).all(activityId);
  const rule = JSON.parse(act.rule_snapshot);
  const rows = allocate(rule, { weight_kg: act.reference_weight_kg, volumes: act.reference_volumes }, participants);
  const ins = db.prepare(`INSERT INTO activity_allocations
    (activity_id, helper_id, participants_count, share, allocated_weight_kg, allocated_volumes, worked_seconds, method, calculated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  const ts = clock.now();
  for (const r of rows) {
    ins.run(activityId, r.helper_id, r.participants_count, r.share, r.allocated_weight_kg, r.allocated_volumes, r.worked_seconds, r.method, ts);
  }
  return rows;
}

/** Prévia do rateio de uma execução em andamento (não grava). */
function previewAllocation(activityId) {
  const db = getDb();
  const act = db.prepare('SELECT * FROM activities WHERE id=?').get(activityId);
  if (!act) return [];
  const now = clock.now();
  const segs = db.prepare(`SELECT helper_id, joined_at, left_at, duration_seconds, status FROM activity_participants
      WHERE activity_id=? AND status IN ('ATIVO','FINALIZADO') ORDER BY joined_at, id`).all(activityId);
  const byHelper = new Map();
  for (const s of segs) {
    const secs = s.status === 'ATIVO' ? Math.max(0, clock.diffSeconds(s.joined_at, now)) : (s.duration_seconds || 0);
    byHelper.set(s.helper_id, (byHelper.get(s.helper_id) || 0) + secs);
  }
  const participants = [...byHelper].map(([helper_id, worked_seconds]) => ({ helper_id, worked_seconds }));
  return allocate(JSON.parse(act.rule_snapshot), { weight_kg: act.reference_weight_kg, volumes: act.reference_volumes }, participants);
}

/** Fecha a execução se não houver mais ninguém ativo nela. */
function closeActivityIfEmpty(db, activityId, userId) {
  const act = db.prepare('SELECT * FROM activities WHERE id=?').get(activityId);
  if (!act || act.status !== 'EM_ANDAMENTO') return act;
  const open = db.prepare(`SELECT COUNT(*) c FROM activity_participants WHERE activity_id=? AND status='ATIVO'`).get(activityId).c;
  if (open > 0) return act;
  const finished = db.prepare(`SELECT MIN(joined_at) s, MAX(left_at) e, COUNT(*) c FROM activity_participants
      WHERE activity_id=? AND status='FINALIZADO'`).get(activityId);
  const ts = clock.now();
  if (finished.c === 0) {
    // Ninguém efetivamente participou (todos cancelados) => execução cancelada.
    db.prepare(`UPDATE activities SET status='CANCELADA', ended_at=?, ended_by=?, updated_at=? WHERE id=?`)
      .run(ts, userId, ts, activityId);
  } else {
    db.prepare(`UPDATE activities SET status='FINALIZADA', started_at=?, ended_at=?, ended_by=?, updated_at=? WHERE id=?`)
      .run(finished.s, finished.e, userId, ts, activityId);
    computeAllocations(db, activityId);
  }
  return db.prepare('SELECT * FROM activities WHERE id=?').get(activityId);
}

function endSegment(db, participant, userId, at) {
  const ts = at || clock.now();
  const secs = Math.max(0, clock.diffSeconds(participant.joined_at, ts));
  db.prepare(`UPDATE activity_participants SET left_at=?, duration_seconds=?, status='FINALIZADO', ended_by=?, updated_at=?
      WHERE id=? AND status='ATIVO'`).run(ts, secs, userId, clock.now(), participant.id);
}

/**
 * Inicia a participação de um ajudante em uma atividade.
 * body: { barcode | helper_id, load_id, activity_type_id, square_id?, reference_weight_kg?, reference_volumes?, switch? }
 */
function start(input, req) {
  const user = req.user;
  return tx((db) => {
    let helper;
    if (input.barcode) helper = identify(input.barcode).helper;
    else helper = db.prepare('SELECT * FROM helpers WHERE id=?').get(input.helper_id);
    if (!helper) throw notFound('Ajudante não encontrado.');
    if (helper.status !== 'ATIVO') throw conflict(`${helper.name} está INATIVO.`, null, 'AJUDANTE_INATIVO');
    helper = db.prepare('SELECT * FROM helpers WHERE id=?').get(helper.id);

    const load = db.prepare('SELECT * FROM loads WHERE id=?').get(input.load_id);
    if (!load) throw notFound('Carga não encontrada.');
    if (load.status !== 'ABERTA') throw conflict(`A carga ${load.load_number} está ${load.status} e não aceita novos apontamentos.`, null, 'CARGA_FECHADA');

    const type = db.prepare('SELECT t.*, r.method, r.weight_factor, r.volume_factor, r.name AS rule_name, r.active AS rule_active FROM activity_types t JOIN productivity_rules r ON r.id=t.rule_id WHERE t.id=?').get(input.activity_type_id);
    if (!type || !type.active) throw notFound('Atividade não encontrada ou inativa.');

    let squareId = null;
    if (type.requires_square) {
      squareId = input.square_id || load.square_id;
      if (!squareId) throw badRequest(`A atividade "${type.name}" exige a praça de destino.`);
      const sq = db.prepare('SELECT id, active FROM squares WHERE id=?').get(squareId);
      if (!sq || !sq.active) throw badRequest('Praça inválida ou inativa.');
    }

    // Ajudante já está em alguma atividade?
    const current = db.prepare(`SELECT p.*, a.load_id, a.activity_type_id, a.square_id FROM activity_participants p
        JOIN activities a ON a.id=p.activity_id WHERE p.helper_id=? AND p.status='ATIVO'`).get(helper.id);
    if (current) {
      const same = current.load_id === load.id && current.activity_type_id === type.id && (current.square_id || 0) === (squareId || 0);
      if (same) {
        throw conflict(`${helper.name} já está nesta atividade (desde ${current.joined_at.slice(11, 16)}).`,
          { current: getParticipant(current.id) }, 'JA_PARTICIPANDO');
      }
      if (!input.switch) {
        throw conflict(`${helper.name} já está em outra atividade. Finalize-a antes ou confirme a troca.`,
          { current: getParticipant(current.id) }, 'AJUDANTE_OCUPADO');
      }
      endSegment(db, current, user.id);
      audit.log({ req, action: 'FINALIZAR', entity: 'activity_participants', entityId: current.id,
        after: { helper_id: helper.id, motivo: 'troca de atividade' } });
      closeActivityIfEmpty(db, current.activity_id, user.id);
    }

    const ts = clock.now();
    let activity = db.prepare(`SELECT * FROM activities WHERE load_id=? AND activity_type_id=? AND IFNULL(square_id,0)=?
        AND status='EM_ANDAMENTO'`).get(load.id, type.id, squareId || 0);
    let joined = true;
    if (!activity) {
      joined = false;
      if (!type.rule_active) throw conflict(`A regra de produtividade "${type.rule_name}" está inativa. Procure o administrador.`);
      let refW = load.weight_kg, refV = load.volumes;
      if (input.reference_weight_kg !== undefined && input.reference_weight_kg !== null && input.reference_weight_kg !== '') {
        refW = Number(input.reference_weight_kg);
        if (!Number.isFinite(refW) || refW < 0 || refW > load.weight_kg) throw badRequest(`Peso parcial deve estar entre 0 e ${load.weight_kg} kg.`);
      }
      if (input.reference_volumes !== undefined && input.reference_volumes !== null && input.reference_volumes !== '') {
        refV = Number(input.reference_volumes);
        if (!Number.isInteger(refV) || refV < 0 || refV > load.volumes) throw badRequest(`Volumes parciais devem estar entre 0 e ${load.volumes}.`);
      }
      const snapshot = JSON.stringify({ id: type.rule_id, name: type.rule_name, method: type.method, weight_factor: type.weight_factor, volume_factor: type.volume_factor });
      const r = db.prepare(`INSERT INTO activities (load_id, activity_type_id, square_id, reference_weight_kg, reference_volumes,
          status, started_at, rule_id, rule_snapshot, started_by, created_at, updated_at)
          VALUES (?,?,?,?,?,'EM_ANDAMENTO',?,?,?,?,?,?)`)
        .run(load.id, type.id, squareId, refW, refV, ts, type.rule_id, snapshot, user.id, ts, ts);
      activity = db.prepare('SELECT * FROM activities WHERE id=?').get(r.lastInsertRowid);
      audit.log({ req, action: 'CRIAR', entity: 'activities', entityId: activity.id,
        after: { load: load.load_number, atividade: type.name, praca_id: squareId, peso_ref: refW, volumes_ref: refV, regra: type.rule_name } });
    }

    const pr = db.prepare(`INSERT INTO activity_participants (activity_id, helper_id, shift_id, team_id, joined_at, status, started_by, created_at, updated_at)
        VALUES (?,?,?,?,?,'ATIVO',?,?,?)`).run(activity.id, helper.id, helper.shift_id, helper.team_id, ts, user.id, ts, ts);
    audit.log({ req, action: 'INICIAR', entity: 'activity_participants', entityId: Number(pr.lastInsertRowid),
      after: { ajudante: `${helper.barcode} - ${helper.name}`, carga: load.load_number, atividade: type.name, execucao: activity.id } });

    return { participant: getParticipant(Number(pr.lastInsertRowid)), joined_existing: joined };
  });
}

function finish(participantId, req) {
  return tx((db) => {
    const p = db.prepare('SELECT * FROM activity_participants WHERE id=?').get(participantId);
    if (!p) throw notFound('Apontamento não encontrado.');
    if (p.status !== 'ATIVO') throw conflict('Este apontamento já foi finalizado ou cancelado.', null, 'JA_FINALIZADO');
    endSegment(db, p, req.user.id);
    const act = closeActivityIfEmpty(db, p.activity_id, req.user.id);
    const after = getParticipant(p.id);
    audit.log({ req, action: 'FINALIZAR', entity: 'activity_participants', entityId: p.id,
      after: { ajudante: after.helper_name, duracao_seg: after.duration_seconds, execucao_status: act.status } });
    return { participant: after, activity_status: act.status };
  });
}

/** Finaliza a execução inteira (todos os ajudantes ainda ativos nela). */
function finishActivity(activityId, req) {
  return tx((db) => {
    const act = db.prepare('SELECT * FROM activities WHERE id=?').get(activityId);
    if (!act) throw notFound('Atividade não encontrada.');
    if (act.status !== 'EM_ANDAMENTO') throw conflict('Esta atividade já foi encerrada.', null, 'JA_FINALIZADO');
    const ts = clock.now();
    const open = db.prepare(`SELECT * FROM activity_participants WHERE activity_id=? AND status='ATIVO'`).all(activityId);
    for (const p of open) endSegment(db, p, req.user.id, ts);
    const closed = closeActivityIfEmpty(db, activityId, req.user.id);
    audit.log({ req, action: 'FINALIZAR', entity: 'activities', entityId: activityId,
      after: { status: closed.status, ajudantes_finalizados: open.length } });
    return { activity: closed, allocations: db.prepare('SELECT * FROM activity_allocations WHERE activity_id=?').all(activityId) };
  });
}

function cancel(participantId, reason, req) {
  if (!reason || String(reason).trim().length < 3) throw badRequest('Informe o motivo do cancelamento (mínimo 3 caracteres).');
  return tx((db) => {
    const p = db.prepare('SELECT * FROM activity_participants WHERE id=?').get(participantId);
    if (!p) throw notFound('Apontamento não encontrado.');
    if (p.status === 'CANCELADO') throw conflict('Este apontamento já está cancelado.');
    if (req.user.role === 'OPERADOR') {
      const ageMin = clock.diffSeconds(p.joined_at, clock.now()) / 60;
      if (p.status !== 'ATIVO' || ageMin > config.OPERATOR_CANCEL_WINDOW_MIN) {
        throw forbidden(`Operador só pode cancelar apontamentos em andamento com até ${config.OPERATOR_CANCEL_WINDOW_MIN} minutos. Procure o gestor.`);
      }
    }
    const ts = clock.now();
    db.prepare(`UPDATE activity_participants SET status='CANCELADO', cancel_reason=?, left_at=COALESCE(left_at, ?),
        duration_seconds=NULL, ended_by=?, updated_at=? WHERE id=?`).run(String(reason).trim(), ts, req.user.id, ts, p.id);
    const act = db.prepare('SELECT * FROM activities WHERE id=?').get(p.activity_id);
    if (act.status === 'EM_ANDAMENTO') closeActivityIfEmpty(db, act.id, req.user.id);
    else if (act.status === 'FINALIZADA') recloseFinished(db, act.id, req.user.id);
    audit.log({ req, action: 'CANCELAR', entity: 'activity_participants', entityId: p.id,
      before: { status: p.status }, after: { status: 'CANCELADO' }, reason: String(reason).trim() });
    return { participant: getParticipant(p.id) };
  });
}

/** Após correção/cancelamento em execução já finalizada: ajusta limites e recalcula rateio. */
function recloseFinished(db, activityId, userId) {
  const agg = db.prepare(`SELECT MIN(joined_at) s, MAX(left_at) e, COUNT(*) c FROM activity_participants
      WHERE activity_id=? AND status='FINALIZADO'`).get(activityId);
  const ts = clock.now();
  if (agg.c === 0) {
    db.prepare(`UPDATE activities SET status='CANCELADA', ended_by=?, updated_at=? WHERE id=?`).run(userId, ts, activityId);
    db.prepare('DELETE FROM activity_allocations WHERE activity_id=?').run(activityId);
    return;
  }
  db.prepare(`UPDATE activities SET started_at=?, ended_at=?, updated_at=? WHERE id=?`).run(agg.s, agg.e, ts, activityId);
  computeAllocations(db, activityId);
}

/** Correção de horários por GESTOR/ADMIN (com motivo e auditoria). */
function correct(participantId, { joined_at, left_at, reason }, req) {
  if (!reason || String(reason).trim().length < 3) throw badRequest('Informe o motivo da correção (mínimo 3 caracteres).');
  return tx((db) => {
    const p = db.prepare('SELECT * FROM activity_participants WHERE id=?').get(participantId);
    if (!p) throw notFound('Apontamento não encontrado.');
    if (p.status !== 'FINALIZADO') throw conflict('Só é possível corrigir apontamentos finalizados.');
    const j = joined_at ? clock.normalize(joined_at) : p.joined_at;
    const l = left_at ? clock.normalize(left_at) : p.left_at;
    if (!clock.isValidTimestamp(j) || !clock.isValidTimestamp(l)) throw badRequest('Data/hora inválida.');
    if (l < j) throw badRequest('O horário final não pode ser anterior ao inicial.');
    if (l > clock.now()) throw badRequest('O horário final não pode estar no futuro.');
    // Impede sobreposição: o mesmo ajudante não pode estar em dois lugares ao mesmo tempo.
    const overlap = db.prepare(`SELECT p.id FROM activity_participants p WHERE p.helper_id=? AND p.id<>? AND p.status<>'CANCELADO'
        AND p.joined_at < ? AND COALESCE(p.left_at, '9999-12-31') > ?`).get(p.helper_id, p.id, l, j);
    if (overlap) throw conflict(`O novo horário se sobrepõe a outro apontamento do mesmo ajudante (#${overlap.id}).`, null, 'SOBREPOSICAO');
    const secs = clock.diffSeconds(j, l);
    db.prepare(`UPDATE activity_participants SET joined_at=?, left_at=?, duration_seconds=?, updated_at=? WHERE id=?`)
      .run(j, l, secs, clock.now(), p.id);
    recloseFinished(db, p.activity_id, req.user.id);
    audit.log({ req, action: 'CORRIGIR', entity: 'activity_participants', entityId: p.id,
      before: { joined_at: p.joined_at, left_at: p.left_at, duration_seconds: p.duration_seconds },
      after: { joined_at: j, left_at: l, duration_seconds: secs }, reason: String(reason).trim() });
    return { participant: getParticipant(p.id) };
  });
}

/** Reaplica a regra ATUAL do tipo de atividade em uma execução finalizada (mudança de regra retroativa). */
function reapplyRule(activityId, reason, req) {
  if (!reason || String(reason).trim().length < 3) throw badRequest('Informe o motivo do recálculo.');
  return tx((db) => {
    const act = db.prepare('SELECT * FROM activities WHERE id=?').get(activityId);
    if (!act) throw notFound('Atividade não encontrada.');
    if (act.status !== 'FINALIZADA') throw conflict('Só é possível recalcular atividades finalizadas.');
    const r = db.prepare(`SELECT r.* FROM activity_types t JOIN productivity_rules r ON r.id=t.rule_id WHERE t.id=?`).get(act.activity_type_id);
    const snapshot = JSON.stringify({ id: r.id, name: r.name, method: r.method, weight_factor: r.weight_factor, volume_factor: r.volume_factor });
    const before = db.prepare('SELECT helper_id, allocated_weight_kg, allocated_volumes FROM activity_allocations WHERE activity_id=?').all(activityId);
    db.prepare('UPDATE activities SET rule_id=?, rule_snapshot=?, updated_at=? WHERE id=?').run(r.id, snapshot, clock.now(), activityId);
    const after = computeAllocations(db, activityId);
    audit.log({ req, action: 'RECALCULAR', entity: 'activities', entityId: activityId,
      before: { regra: act.rule_snapshot, rateio: before }, after: { regra: snapshot, rateio: after.map(a => ({ helper_id: a.helper_id, allocated_weight_kg: a.allocated_weight_kg, allocated_volumes: a.allocated_volumes })) },
      reason: String(reason).trim() });
    return { allocations: after };
  });
}

function listOpen({ loadId } = {}) {
  const db = getDb();
  const where = [`p.status = 'ATIVO'`];
  const params = [];
  if (loadId) { where.push('a.load_id = ?'); params.push(loadId); }
  return db.prepare(`${PARTICIPANT_VIEW} WHERE ${where.join(' AND ')} ORDER BY p.joined_at`).all(...params);
}

function activitiesOfLoad(loadId) {
  const db = getDb();
  const acts = db.prepare(`SELECT a.*, t.name AS activity_type_name, t.color AS activity_type_color, s.code AS square_code, s.name AS square_name
      FROM activities a JOIN activity_types t ON t.id=a.activity_type_id LEFT JOIN squares s ON s.id=a.square_id
      WHERE a.load_id=? ORDER BY a.started_at DESC`).all(loadId);
  for (const a of acts) {
    a.participants = db.prepare(`${PARTICIPANT_VIEW} WHERE p.activity_id=? ORDER BY p.joined_at`).all(a.id);
    a.allocations = a.status === 'EM_ANDAMENTO'
      ? previewAllocation(a.id).map(x => ({ ...x, preview: true }))
      : db.prepare('SELECT * FROM activity_allocations WHERE activity_id=?').all(a.id);
    a.rule = JSON.parse(a.rule_snapshot);
  }
  return acts;
}

module.exports = {
  identify, start, finish, finishActivity, cancel, correct, reapplyRule,
  listOpen, activitiesOfLoad, previewAllocation, computeAllocations, getParticipant, PARTICIPANT_VIEW,
};
