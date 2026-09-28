'use strict';
// Testes do fluxo de apontamento: identificação, início, fim, rateio, duplicidade, praça, correções.
const { loginAll, as, ids, clock, getDb } = require('./_fixture');

beforeAll(loginAll);
afterEach(() => clock.setNow(null));

const at = (hhmm) => clock.setNow(`2026-09-10 ${hhmm}:00`);
const start = (role, body) => as(role).post('/api/operations/start').send(body);
const finish = (role, pid) => as(role).post(`/api/operations/participants/${pid}/finish`).send({});
const allocOf = (activityId) => getDb().prepare(`SELECT h.name, al.allocated_weight_kg w, al.allocated_volumes v, al.participants_count n
  FROM activity_allocations al JOIN helpers h ON h.id=al.helper_id WHERE al.activity_id=? ORDER BY al.allocated_weight_kg, h.name`).all(activityId)
  .map(r => ({ ...r }));

describe('Identificação pelo código de barras (código = SOMENTE o ajudante)', () => {
  test('001 identifica o Yago', async () => {
    const r = await as('operador').post('/api/operations/identify').send({ barcode: ' 001 ' });
    expect(r.status).toBe(200);
    expect(r.body.helper.name).toBe('Yago');
    expect(r.body.current).toBeNull();
  });
  test('código inexistente => 404 com mensagem clara', async () => {
    const r = await as('operador').post('/api/operations/identify').send({ barcode: '777' });
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/não pertence a nenhum ajudante/);
  });
  test('ajudante inativo não pode ser apontado', async () => {
    const r = await as('operador').post('/api/operations/identify').send({ barcode: '099' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('AJUDANTE_INATIVO');
    const s = await start('operador', { barcode: '099', load_id: ids.load4587, activity_type_id: ids.carregamento });
    expect(s.status).toBe(409);
  });
  test('código vazio => 400', async () => {
    expect((await as('operador').post('/api/operations/identify').send({ barcode: '' })).status).toBe(400);
  });
});

describe('Carregamento com 2 ajudantes (exemplo da operação: 1.000 kg)', () => {
  let actId, pYago, pCarlos;
  test('Yago inicia e Carlos entra na MESMA execução', async () => {
    at('08:00');
    const a = await start('operador', { barcode: '001', load_id: ids.load4587, activity_type_id: ids.carregamento });
    expect(a.status).toBe(201);
    expect(a.body.joined_existing).toBe(false);
    pYago = a.body.participant.id; actId = a.body.participant.activity_id;
    at('08:05');
    const b = await start('operador', { barcode: '003', load_id: ids.load4587, activity_type_id: ids.carregamento });
    expect(b.status).toBe(201);
    expect(b.body.joined_existing).toBe(true);
    expect(b.body.participant.activity_id).toBe(actId);
    pCarlos = b.body.participant.id;
  });
  test('identificar ajudante ocupado mostra a atividade atual', async () => {
    const r = await as('operador').post('/api/operations/identify').send({ barcode: '001' });
    expect(r.body.current.activity_type_name).toBe('Carregamento');
    expect(r.body.current.load_number).toBe('4587');
  });
  test('prévia do rateio enquanto em andamento', async () => {
    at('08:10');
    const r = await as('operador').get(`/api/loads/${ids.load4587}/activities`);
    const act = r.body.find(x => x.id === actId);
    expect(act.status).toBe('EM_ANDAMENTO');
    expect(act.allocations.map(x => x.allocated_weight_kg)).toEqual([500, 500]);
    expect(act.allocations[0].preview).toBe(true);
  });
  test('bipar de novo a mesma atividade não duplica (409 JA_PARTICIPANDO)', async () => {
    const r = await start('operador', { barcode: '001', load_id: ids.load4587, activity_type_id: ids.carregamento });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('JA_PARTICIPANDO');
  });
  test('ao finalizar ambos: 500 kg / 500 kg e 60 / 60 volumes', async () => {
    at('08:30');
    expect((await finish('operador', pCarlos)).body.activity_status).toBe('EM_ANDAMENTO');
    at('08:40');
    const r = await finish('operador', pYago);
    expect(r.status).toBe(200);
    expect(r.body.activity_status).toBe('FINALIZADA');
    expect(r.body.participant.duration_seconds).toBe(40 * 60);
    expect(allocOf(actId)).toEqual([
      { name: 'Carlos', w: 500, v: 60, n: 2 },
      { name: 'Yago', w: 500, v: 60, n: 2 },
    ]);
  });
  test('finalizar de novo => 409', async () => {
    expect((await finish('operador', pYago)).status).toBe(409);
  });
});

describe('Rateio entre 3 ajudantes e atividades diferentes', () => {
  test('3 ajudantes => 333,33 / 333,33 / 333,34', async () => {
    at('09:00');
    const ps = [];
    for (const code of ['001', '002', '003']) ps.push((await start('operador', { barcode: code, load_id: ids.load4588, activity_type_id: ids.carregamento })).body.participant);
    at('09:20');
    const r = await as('operador').post(`/api/operations/activities/${ps[0].activity_id}/finish`).send({});
    expect(r.status).toBe(200);
    expect(r.body.activity.status).toBe('FINALIZADA');
    const byHelper = Object.fromEntries(r.body.allocations.map(a => [a.helper_id, a.allocated_weight_kg]));
    expect(byHelper[ids.yago]).toBe(333.33);
    expect(byHelper[ids.joao]).toBe(333.33);
    expect(byHelper[ids.carlos]).toBe(333.34); // último a entrar recebe o centavo restante
    const vol = r.body.allocations.reduce((a, x) => a + x.allocated_volumes, 0);
    expect(Math.round(vol * 100) / 100).toBe(121);
  });

  test('Yago carregamento, Carlos arrumação, Marcos praça: registros separados, sem rateio cruzado', async () => {
    at('10:00');
    const y = await start('operador', { barcode: '001', load_id: ids.load4589, activity_type_id: ids.carregamento });
    const c = await start('operador', { barcode: '003', load_id: ids.load4589, activity_type_id: ids.arrumacao });
    const m = await start('operador', { barcode: '004', load_id: ids.load4589, activity_type_id: ids.praca });
    expect(new Set([y.body.participant.activity_id, c.body.participant.activity_id, m.body.participant.activity_id]).size).toBe(3);
    expect(m.body.participant.square_code).toBe('05'); // praça padrão da carga
    at('10:30');
    for (const p of [y, c, m]) await finish('operador', p.body.participant.id);
    for (const p of [y, c, m]) {
      const al = allocOf(p.body.participant.activity_id);
      expect(al).toHaveLength(1);
      expect(al[0].w).toBe(2000); // cada um recebe o peso integral da SUA atividade
    }
  });
});

describe('Duplicidade, simultaneidade e troca de atividade', () => {
  test('ajudante ocupado não inicia outra atividade sem confirmar troca', async () => {
    at('11:00');
    const a = await start('operador', { barcode: '002', load_id: ids.load4590, activity_type_id: ids.carregamento });
    expect(a.status).toBe(201);
    const b = await start('operador', { barcode: '002', load_id: ids.load4590, activity_type_id: ids.arrumacao });
    expect(b.status).toBe(409);
    expect(b.body.code).toBe('AJUDANTE_OCUPADO');
    expect(b.body.details.current.activity_type_name).toBe('Carregamento');
    at('11:15');
    const c = await start('operador', { barcode: '002', load_id: ids.load4590, activity_type_id: ids.arrumacao, switch: true });
    expect(c.status).toBe(201);
    const prev = getDb().prepare('SELECT status, left_at, duration_seconds FROM activity_participants WHERE id=?').get(a.body.participant.id);
    expect(prev.status).toBe('FINALIZADO');
    expect(prev.duration_seconds).toBe(15 * 60);
    at('11:30');
    await finish('operador', c.body.participant.id);
  });

  test('5 bipes simultâneos do mesmo ajudante => apenas 1 apontamento', async () => {
    at('12:00');
    const body = { barcode: '004', load_id: ids.load4590, activity_type_id: ids.descarga };
    const rs = await Promise.all(Array.from({ length: 5 }, () => start('operador', body)));
    expect(rs.filter(r => r.status === 201)).toHaveLength(1);
    expect(rs.filter(r => r.status === 409)).toHaveLength(4);
    const open = getDb().prepare(`SELECT COUNT(*) c FROM activity_participants WHERE helper_id=? AND status='ATIVO'`).get(ids.marcos).c;
    expect(open).toBe(1);
    at('12:10');
    await finish('operador', rs.find(r => r.status === 201).body.participant.id);
  });

  test('banco impede 2 participações abertas do mesmo ajudante (índice único)', () => {
    const db = getDb();
    const act = db.prepare('SELECT id FROM activities LIMIT 1').get().id;
    const ins = () => db.prepare(`INSERT INTO activity_participants (activity_id,helper_id,joined_at,status,created_at,updated_at) VALUES (?,?,?,'ATIVO',?,?)`)
      .run(act, ids.joao, '2026-09-10 13:00:00', '2026-09-10 13:00:00', '2026-09-10 13:00:00');
    ins();
    expect(ins).toThrow(/UNIQUE/);
    db.prepare(`DELETE FROM activity_participants WHERE helper_id=? AND status='ATIVO'`).run(ids.joao);
  });
});

describe('Movimentação para praça', () => {
  test('praça informada explicitamente, peso parcial e volumes', async () => {
    at('13:00');
    const r = await start('operador', { barcode: '001', load_id: ids.load4587, activity_type_id: ids.praca, square_id: ids.square7, reference_weight_kg: 400, reference_volumes: 50 });
    expect(r.status).toBe(201);
    expect(r.body.participant.square_code).toBe('07');
    expect(r.body.participant.reference_weight_kg).toBe(400);
    at('13:20');
    await finish('operador', r.body.participant.id);
    expect(allocOf(r.body.participant.activity_id)[0]).toMatchObject({ w: 400, v: 50 });
  });
  test('peso parcial maior que a carga => 400', async () => {
    const r = await start('operador', { barcode: '001', load_id: ids.load4587, activity_type_id: ids.praca, reference_weight_kg: 5000 });
    expect(r.status).toBe(400);
  });
  test('carga sem praça e sem praça informada => 400', async () => {
    const r = await start('operador', { barcode: '001', load_id: ids.loadNoSquare, activity_type_id: ids.praca });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/exige a praça/);
  });
  test('carga concluída não aceita apontamento', async () => {
    const r = await start('operador', { barcode: '001', load_id: ids.loadClosed, activity_type_id: ids.carregamento });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CARGA_FECHADA');
  });
  test('campos obrigatórios do início', async () => {
    expect((await start('operador', { load_id: ids.load4587, activity_type_id: ids.carregamento })).status).toBe(400);
    expect((await start('operador', { barcode: '001', activity_type_id: ids.carregamento })).status).toBe(400);
    expect((await start('operador', { barcode: '001', load_id: ids.load4587 })).status).toBe(400);
    expect((await start('operador', { barcode: '001', load_id: 99999, activity_type_id: ids.carregamento })).status).toBe(404);
  });
});

describe('Cancelamento e correção (com auditoria)', () => {
  test('cancelar um dos 3 participantes recalcula o rateio para 2', async () => {
    at('14:00');
    const ps = [];
    for (const code of ['001', '002', '003']) ps.push((await start('operador', { barcode: code, load_id: ids.load4590, activity_type_id: ids.descarga })).body.participant);
    at('14:30');
    await as('operador').post(`/api/operations/activities/${ps[0].activity_id}/finish`).send({});
    expect(allocOf(ps[0].activity_id).map(a => a.w)).toEqual([300, 300, 300]);
    // operador fora da janela não pode cancelar finalizado
    const op = await as('operador').post(`/api/operations/participants/${ps[2].id}/cancel`).send({ reason: 'bipe errado' });
    expect(op.status).toBe(403);
    // sem motivo => 400
    expect((await as('gestor').post(`/api/operations/participants/${ps[2].id}/cancel`).send({})).status).toBe(400);
    const g = await as('gestor').post(`/api/operations/participants/${ps[2].id}/cancel`).send({ reason: 'Carlos não participou' });
    expect(g.status).toBe(200);
    expect(allocOf(ps[0].activity_id).map(a => a.w)).toEqual([450, 450]);
    const audit = getDb().prepare(`SELECT * FROM audit_logs WHERE action='CANCELAR' AND entity_id=?`).get(ps[2].id);
    expect(audit.reason).toBe('Carlos não participou');
  });

  test('operador cancela bipe errado recém-iniciado (dentro da janela)', async () => {
    at('15:00');
    const p = (await start('operador', { barcode: '002', load_id: ids.load4589, activity_type_id: ids.descarga })).body.participant;
    at('15:03');
    const r = await as('operador').post(`/api/operations/participants/${p.id}/cancel`).send({ reason: 'bipe errado' });
    expect(r.status).toBe(200);
    const act = getDb().prepare('SELECT status FROM activities WHERE id=?').get(p.activity_id);
    expect(act.status).toBe('CANCELADA'); // ninguém participou de fato
  });

  test('gestor corrige horário; sobreposição e fim antes do início são rejeitados', async () => {
    at('16:00');
    const p = (await start('operador', { barcode: '004', load_id: ids.load4589, activity_type_id: ids.descarga })).body.participant;
    at('16:30');
    await finish('operador', p.id);
    at('18:00');
    const bad = await as('gestor').patch(`/api/operations/participants/${p.id}`).send({ joined_at: '2026-09-10 16:30', left_at: '2026-09-10 16:00', reason: 'ajuste' });
    expect(bad.status).toBe(400);
    const overlap = await as('gestor').patch(`/api/operations/participants/${p.id}`).send({ joined_at: '2026-09-10 11:50', left_at: '2026-09-10 16:30', reason: 'ajuste' });
    expect(overlap.status).toBe(409);
    expect(overlap.body.code).toBe('SOBREPOSICAO');
    const ok = await as('gestor').patch(`/api/operations/participants/${p.id}`).send({ joined_at: '2026-09-10T15:50', left_at: '2026-09-10T16:40', reason: 'Esqueceu de bipar no início' });
    expect(ok.status).toBe(200);
    expect(ok.body.participant.duration_seconds).toBe(50 * 60);
    expect((await as('operador').patch(`/api/operations/participants/${p.id}`).send({ reason: 'x' })).status).toBe(403);
    const audit = getDb().prepare(`SELECT old_values, new_values FROM audit_logs WHERE action='CORRIGIR' AND entity_id=?`).get(p.id);
    expect(JSON.parse(audit.old_values).joined_at).toBe('2026-09-10 16:00:00');
    expect(JSON.parse(audit.new_values).joined_at).toBe('2026-09-10 15:50:00');
  });
});

describe('Mudança de regra de rateio (histórico estável)', () => {
  test('nova regra vale para novas execuções; recalcular aplica e audita', async () => {
    at('17:00');
    const a = (await start('operador', { barcode: '001', load_id: ids.load4587, activity_type_id: ids.arrumacao })).body.participant;
    const b = (await start('operador', { barcode: '002', load_id: ids.load4587, activity_type_id: ids.arrumacao })).body.participant;
    at('17:10'); await finish('operador', b.id);
    at('17:40'); await finish('operador', a.id);
    expect(allocOf(a.activity_id).map(x => x.w)).toEqual([500, 500]);

    // ADMIN troca a regra da atividade "Arrumação" para proporcional ao tempo
    expect((await as('gestor').patch(`/api/activity-types/${ids.arrumacao}`).send({ rule_id: ids.ruleTime })).status).toBe(403);
    expect((await as('admin').patch(`/api/activity-types/${ids.arrumacao}`).send({ rule_id: ids.ruleTime })).status).toBe(200);
    // Execução antiga não muda sozinha
    expect(allocOf(a.activity_id).map(x => x.w)).toEqual([500, 500]);
    // Recalcular (ADMIN, com motivo) aplica a nova regra: 40 min x 10 min => 800 / 200
    expect((await as('gestor').post(`/api/operations/activities/${a.activity_id}/recalculate`).send({ reason: 'nova regra' })).status).toBe(403);
    const rc = await as('admin').post(`/api/operations/activities/${a.activity_id}/recalculate`).send({ reason: 'Aprovado pela gestão' });
    expect(rc.status).toBe(200);
    expect(allocOf(a.activity_id).map(x => x.w)).toEqual([200, 800]);
    expect(getDb().prepare(`SELECT COUNT(*) c FROM audit_logs WHERE action='RECALCULAR'`).get().c).toBe(1);
    await as('admin').patch(`/api/activity-types/${ids.arrumacao}`).send({ rule_id: ids.ruleEqual });
  });
});
