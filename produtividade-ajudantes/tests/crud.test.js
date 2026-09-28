'use strict';
// CRUD de ajudantes, cargas e cadastros auxiliares + validações de formulário.
const { loginAll, as, ids, getDb, clock } = require('./_fixture');

beforeAll(loginAll);
afterEach(() => clock.setNow(null));

describe('Ajudantes', () => {
  let id;
  test('criar com código normalizado, CPF válido e dados completos', async () => {
    const r = await as('gestor').post('/api/helpers').send({ barcode: ' ab-12 ', name: '  Novo   Ajudante ', cpf: '529.982.247-25', registration: 'M9', sector: 'Armazém', shift_id: ids.shift, team_id: ids.team, admission_date: '2025-01-15' });
    expect(r.status).toBe(201);
    expect(r.body.barcode).toBe('AB-12');
    expect(r.body.name).toBe('Novo Ajudante');
    expect(r.body.cpf).toBe('52998224725');
    expect(r.body.status).toBe('ATIVO');
    expect(r.body.shift_name).toBe('Manhã');
    id = r.body.id;
  });
  test('código duplicado => 409 com o nome do dono', async () => {
    const r = await as('gestor').post('/api/helpers').send({ barcode: '001', name: 'Outro' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Yago/);
  });
  test('validações: obrigatórios, caracteres, CPF, datas, turno inexistente', async () => {
    const bad = async (body) => (await as('gestor').post('/api/helpers').send(body)).status;
    expect(await bad({})).toBe(400);
    expect(await bad({ barcode: '12 34', name: 'X Y' })).toBe(400);
    expect(await bad({ barcode: '<script>', name: 'X Y' })).toBe(400);
    expect(await bad({ barcode: '1'.repeat(33), name: 'X Y' })).toBe(400);
    expect(await bad({ barcode: '5001', name: 'X' })).toBe(400);
    expect(await bad({ barcode: '5001', name: 'X Y', cpf: '111.111.111-11' })).toBe(400);
    expect(await bad({ barcode: '5001', name: 'X Y', cpf: '123' })).toBe(400);
    expect(await bad({ barcode: '5001', name: 'X Y', admission_date: '2026-02-30' })).toBe(400);
    expect(await bad({ barcode: '5001', name: 'X Y', admission_date: '2999-01-01' })).toBe(400);
    expect(await bad({ barcode: '5001', name: 'X Y', shift_id: 999 })).toBe(400);
    expect(await bad({ barcode: '5001', name: 'X Y', status: 'QUALQUER' })).toBe(400);
    expect(await bad({ barcode: '5001', name: 'X Y', cpf: '529.982.247-25' })).toBe(409);
  });
  test('nome com HTML é armazenado como texto (o front escapa na exibição)', async () => {
    const r = await as('gestor').post('/api/helpers').send({ barcode: 'XSS1', name: '<img src=x onerror=alert(1)>' });
    expect(r.status).toBe(201);
    expect(r.body.name).toBe('<img src=x onerror=alert(1)>');
  });
  test('editar, pesquisar e filtrar', async () => {
    const r = await as('gestor').patch(`/api/helpers/${id}`).send({ name: 'Ajudante Editado', barcode: 'AB-12' });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('Ajudante Editado');
    expect((await as('gestor').get('/api/helpers?q=Editado')).body).toHaveLength(1);
    expect((await as('gestor').get('/api/helpers?q=ab-12')).body[0].id).toBe(id);
    expect((await as('gestor').get('/api/helpers?status=INATIVO')).body.every(h => h.status === 'INATIVO')).toBe(true);
    expect((await as('gestor').patch(`/api/helpers/${id}`).send({ name: '' })).status).toBe(400);
    expect((await as('gestor').patch('/api/helpers/99999').send({ name: 'Z Z' })).status).toBe(404);
  });
  test('inativar/ativar gera auditoria com valor anterior e novo', async () => {
    expect((await as('gestor').patch(`/api/helpers/${id}`).send({ status: 'INATIVO' })).body.status).toBe('INATIVO');
    expect((await as('gestor').patch(`/api/helpers/${id}`).send({ status: 'ATIVO' })).body.status).toBe('ATIVO');
    const logs = getDb().prepare(`SELECT action, old_values, new_values FROM audit_logs WHERE entity='helpers' AND entity_id=? ORDER BY id`).all(id);
    expect(logs.map(l => l.action)).toEqual(['CRIAR', 'EDITAR', 'INATIVAR', 'ATIVAR']);
    expect(JSON.parse(logs[2].old_values)).toEqual({ status: 'ATIVO' });
    expect(JSON.parse(logs[2].new_values)).toEqual({ status: 'INATIVO' });
  });
  test('não inativa ajudante em atividade', async () => {
    clock.setNow('2026-09-10 20:00:00');
    const p = await as('operador').post('/api/operations/start').send({ helper_id: id, load_id: ids.load4587, activity_type_id: ids.carregamento });
    expect(p.status).toBe(201);
    const r = await as('gestor').patch(`/api/helpers/${id}`).send({ status: 'INATIVO' });
    expect(r.status).toBe(409);
    clock.setNow('2026-09-10 20:10:00');
    await as('operador').post(`/api/operations/participants/${p.body.participant.id}/finish`).send({});
  });
  test('excluir: bloqueado com apontamentos; permitido sem; só ADMIN', async () => {
    expect((await as('admin').delete(`/api/helpers/${id}`)).status).toBe(409);
    const n = await as('gestor').post('/api/helpers').send({ barcode: 'DEL1', name: 'Para Excluir' });
    expect((await as('gestor').delete(`/api/helpers/${n.body.id}`)).status).toBe(403);
    expect((await as('admin').delete(`/api/helpers/${n.body.id}`)).status).toBe(204);
    expect((await as('admin').get(`/api/helpers/${n.body.id}`)).status).toBe(404);
  });
  test('gerar próximo código', async () => {
    const r = await as('gestor').get('/api/helpers/next-code');
    expect(r.body.code).toBe('100'); // maior numérico = 099
  });
});

describe('Cargas', () => {
  let id;
  test('criar e buscar pelo número', async () => {
    const r = await as('gestor').post('/api/loads').send({ load_number: 'c-100', weight_kg: '1.250,5'.replace('.', ''), volumes: 30, load_date: '2026-09-10', checker_id: ids.checker, square_id: ids.square5 });
    expect(r.status).toBe(201);
    expect(r.body.load_number).toBe('C-100');
    expect(r.body.weight_kg).toBe(1250.5);
    id = r.body.id;
    expect((await as('operador').get('/api/loads/by-number/c-100')).body.id).toBe(id);
    expect((await as('operador').get('/api/loads/by-number/NAOEXISTE')).status).toBe(404);
  });
  test('validações e duplicidade', async () => {
    const bad = async b => (await as('gestor').post('/api/loads').send(b)).status;
    expect(await bad({})).toBe(400);
    expect(await bad({ load_number: 'X1', weight_kg: -1, volumes: 1, load_date: '2026-09-10' })).toBe(400);
    expect(await bad({ load_number: 'X1', weight_kg: 10, volumes: 1.5, load_date: '2026-09-10' })).toBe(400);
    expect(await bad({ load_number: 'X1', weight_kg: 'abc', volumes: 1, load_date: '2026-09-10' })).toBe(400);
    expect(await bad({ load_number: 'X 1', weight_kg: 10, volumes: 1, load_date: '2026-09-10' })).toBe(400);
    expect(await bad({ load_number: 'X1', weight_kg: 10, volumes: 1, load_date: '10/09/2026' })).toBe(400);
    expect(await bad({ load_number: '4587', weight_kg: 10, volumes: 1, load_date: '2026-09-10' })).toBe(409);
    expect((await as('operador').post('/api/loads').send({ load_number: 'Z9', weight_kg: 1, volumes: 1, load_date: '2026-09-10' })).status).toBe(403);
  });
  test('alterar peso de carga com atividades exige motivo', async () => {
    expect((await as('gestor').patch(`/api/loads/${ids.load4587}`).send({ weight_kg: 1100 })).status).toBe(400);
    const ok = await as('gestor').patch(`/api/loads/${ids.load4587}`).send({ weight_kg: 1100, reason: 'Peso corrigido pelo TMS' });
    expect(ok.status).toBe(200);
    // atividades antigas mantêm o peso de referência (histórico estável)
    const ref = getDb().prepare('SELECT DISTINCT reference_weight_kg r FROM activities WHERE load_id=? AND activity_type_id=?').all(ids.load4587, ids.carregamento);
    expect(ref.map(x => x.r)).toEqual([1000]);
    await as('gestor').patch(`/api/loads/${ids.load4587}`).send({ weight_kg: 1000, reason: 'volta' });
  });
  test('excluir carga com atividades => 409; sem atividades => 204', async () => {
    expect((await as('gestor').delete(`/api/loads/${ids.load4587}`)).status).toBe(409);
    expect((await as('gestor').delete(`/api/loads/${id}`)).status).toBe(204);
  });
  test('detalhe mostra quantos ajudantes participaram da carga', async () => {
    const r = await as('gestor').get(`/api/loads/${ids.load4587}`);
    expect(r.body.helpers_count).toBeGreaterThanOrEqual(1);
  });
});

describe('Cadastros auxiliares', () => {
  test('praças: criar, duplicar, editar, inativar, excluir em uso', async () => {
    const r = await as('gestor').post('/api/squares').send({ code: '99', name: 'Praça 99' });
    expect(r.status).toBe(201);
    expect((await as('gestor').post('/api/squares').send({ code: '99', name: 'Dup' })).status).toBe(409);
    expect((await as('gestor').patch(`/api/squares/${r.body.id}`).send({ name: 'Praça Noventa e Nove' })).body.name).toBe('Praça Noventa e Nove');
    expect((await as('gestor').patch(`/api/squares/${r.body.id}`).send({ active: 0 })).body.active).toBe(0);
    expect((await as('gestor').delete(`/api/squares/${r.body.id}`)).status).toBe(204);
    expect((await as('gestor').delete(`/api/squares/${ids.square5}`)).status).toBe(409);
    expect((await as('operador').post('/api/squares').send({ code: '98', name: 'x' })).status).toBe(403);
  });
  test('turnos validam horário', async () => {
    expect((await as('gestor').post('/api/shifts').send({ name: 'T', start_time: '25:00', end_time: '10:00' })).status).toBe(400);
    expect((await as('gestor').post('/api/shifts').send({ name: 'T', start_time: '10:00', end_time: '10:00' })).status).toBe(400);
    expect((await as('gestor').post('/api/shifts').send({ name: 'Noite', start_time: '22:00', end_time: '06:00' })).status).toBe(201);
  });
  test('tipos de atividade e regras: somente ADMIN altera', async () => {
    expect((await as('gestor').post('/api/activity-types').send({ code: 'NOVA', name: 'Nova', rule_id: ids.ruleEqual })).status).toBe(403);
    const r = await as('admin').post('/api/activity-types').send({ code: 'nova', name: 'Nova atividade', rule_id: ids.ruleEqual, sort_order: '', color: '' });
    expect(r.status).toBe(201);
    expect(r.body.code).toBe('NOVA');
    expect(r.body.color).toBe('#1f6feb');
    expect((await as('admin').post('/api/activity-types').send({ code: 'N2', name: 'N2', rule_id: 999 })).status).toBe(400);
    expect((await as('admin').post('/api/rules').send({ name: 'Meio', method: 'RATEIO_IGUAL', weight_factor: 0.5 })).status).toBe(201);
    expect((await as('admin').post('/api/rules').send({ name: 'Ruim', method: 'INVENTADO' })).status).toBe(400);
    expect((await as('admin').post('/api/rules').send({ name: 'Neg', method: 'RATEIO_IGUAL', weight_factor: -1 })).status).toBe(400);
    expect((await as('admin').patch(`/api/rules/${ids.ruleEqual}`).send({ active: 0 })).status).toBe(409); // em uso
    expect((await as('operador').get('/api/rules')).status).toBe(403);
  });
});

describe('Usuários (ADMIN)', () => {
  test('criar, e-mail duplicado, senha fraca, último admin', async () => {
    const r = await as('admin').post('/api/users').send({ name: 'Novo Op', email: 'novo@t.com', role: 'OPERADOR', password: 'Senha9999' });
    expect(r.status).toBe(201);
    expect(r.body.password_hash).toBeUndefined();
    expect((await as('admin').post('/api/users').send({ name: 'Dup', email: 'NOVO@t.com', role: 'OPERADOR', password: 'Senha9999' })).status).toBe(409);
    expect((await as('admin').post('/api/users').send({ name: 'Fraca', email: 'f@t.com', role: 'OPERADOR', password: '123' })).status).toBe(400);
    expect((await as('admin').post('/api/users').send({ name: 'Mail', email: 'invalido', role: 'OPERADOR', password: 'Senha9999' })).status).toBe(400);
    expect((await as('admin').post('/api/users').send({ name: 'Role', email: 'r@t.com', role: 'ROOT', password: 'Senha9999' })).status).toBe(400);
    expect((await as('admin').patch(`/api/users/${ids.admin}`).send({ role: 'GESTOR' })).status).toBe(409);
    expect((await as('gestor').get('/api/users')).status).toBe(403);
  });
});
