'use strict';
// Dashboard, ranking, relatórios (CSV/XLSX), histórico, auditoria, integração e segurança.
const ExcelJS = require('exceljs');
const { app, request, loginAll, as, ids, clock, getDb } = require('./_fixture');

beforeAll(async () => {
  await loginAll();
  const go = (t) => clock.setNow(`2026-09-10 ${t}:00`);
  const start = (b) => as('operador').post('/api/operations/start').send(b);
  const fin = (id) => as('operador').post(`/api/operations/participants/${id}/finish`).send({});
  // Carga 4587 (1.000 kg / 120 vol): Yago+Carlos carregam 60 min; Marcos leva para praça 30 min.
  go('08:00');
  const y = (await start({ barcode: '001', load_id: ids.load4587, activity_type_id: ids.carregamento })).body.participant;
  const c = (await start({ barcode: '003', load_id: ids.load4587, activity_type_id: ids.carregamento })).body.participant;
  go('09:00'); await fin(y.id); await fin(c.id);
  go('09:05');
  const m = (await start({ barcode: '004', load_id: ids.load4587, activity_type_id: ids.praca })).body.participant;
  go('09:35'); await fin(m.id);
  // Carga 4589 (2.000 kg / 60 vol): Yago sozinho arruma 30 min
  go('10:00');
  const y2 = (await start({ barcode: '001', load_id: ids.load4589, activity_type_id: ids.arrumacao })).body.participant;
  go('10:30'); await fin(y2.id);
  // João em andamento (não conta na produtividade até finalizar)
  go('11:00');
  await start({ barcode: '002', load_id: ids.load4590, activity_type_id: ids.descarga });
  go('11:30');
});
afterAll(() => clock.setNow(null));

const F = '?date_from=2026-09-10&date_to=2026-09-10';

describe('Dashboard', () => {
  test('totais separam peso físico (sem duplicar) de peso atribuído', async () => {
    const r = await as('gestor').get(`/api/dashboard${F}`);
    expect(r.status).toBe(200);
    const t = r.body.totals;
    expect(t.loads).toBe(2);
    expect(t.physical_kg).toBe(3000);            // 1.000 + 2.000
    expect(t.allocated_kg).toBe(4000);           // 500+500 (carreg.) + 1.000 (praça) + 2.000 (arrumação)
    expect(t.activities).toBe(3);
    expect(t.seconds).toBe((60 + 60 + 30 + 30) * 60);
    expect(t.in_progress_now).toBe(1);
    expect(t.active_helpers).toBe(4);
  });
  test('indicadores individuais: Yago', async () => {
    const r = await as('gestor').get(`/api/dashboard${F}`);
    const y = r.body.helpers.find(h => h.helper_barcode === '001');
    expect(y).toMatchObject({ kg: 2500, volumes: 120, loads: 2, activities: 2, seconds: 5400 });
    expect(y.kg_per_hour).toBeCloseTo(2500 / 1.5, 2);
    const cargasCarregadas = r.body.helper_type.find(x => x.helper_id === ids.yago && x.activity_type_id === ids.carregamento);
    expect(cargasCarregadas.loads).toBe(1);
  });
  test('praças e filtros', async () => {
    const r = await as('gestor').get(`/api/dashboard${F}`);
    expect(r.body.by_square).toEqual([expect.objectContaining({ code: '05', kg: 1000, volumes: 120, loads: 1 })]);
    const f = await as('gestor').get(`/api/dashboard${F}&activity_type_id=${ids.praca}`);
    expect(f.body.totals.allocated_kg).toBe(1000);
    const h = await as('gestor').get(`/api/dashboard${F}&helper_id=${ids.carlos}`);
    expect(h.body.totals.allocated_kg).toBe(500);
    const outro = await as('gestor').get('/api/dashboard?date_from=2026-01-01&date_to=2026-01-02');
    expect(outro.body.totals.allocated_kg).toBe(0);
  });
  test('período inválido => 400', async () => {
    expect((await as('gestor').get('/api/dashboard?date_from=2026-13-01')).status).toBe(400);
    expect((await as('gestor').get('/api/dashboard?date_from=2026-09-10&date_to=2026-09-01')).status).toBe(400);
    expect((await as('gestor').get('/api/dashboard?date_from=2020-01-01&date_to=2026-01-01')).status).toBe(400);
  });
  test('operador não acessa dashboard', async () => {
    expect((await as('operador').get('/api/dashboard')).status).toBe(403);
  });
});

describe('Ranking', () => {
  test('ordena pelo indicador escolhido', async () => {
    const kg = await as('gestor').get(`/api/dashboard/ranking${F}&metric=kg`);
    expect(kg.body.rows.map(r => r.helper_barcode)).toEqual(['001', '004', '003']);
    const kgh = await as('gestor').get(`/api/dashboard/ranking${F}&metric=kg_per_hour`);
    // Marcos 1.000 kg em 0,5 h = 2.000 kg/h > Yago 2.500 kg em 1,5 h = 1.666,67 > Carlos 500 kg/h
    expect(kgh.body.rows.map(r => r.helper_barcode)).toEqual(['004', '001', '003']);
    expect(kgh.body.rows.map(r => r.kg_per_hour)).toEqual([2000, 1666.67, 500]);
    expect((await as('gestor').get('/api/dashboard/ranking?metric=hack')).status).toBe(400);
  });
});

describe('Relatórios', () => {
  test('individual JSON com peso da carga e peso atribuído separados', async () => {
    const r = await as('gestor').get(`/api/reports/individual${F}`);
    expect(r.body.rows).toHaveLength(4);
    const row = r.body.rows.find(x => x.helper_barcode === '003');
    expect(row).toMatchObject({ load_number: '4587', activity: 'Carregamento', load_weight_kg: 1000, allocated_weight_kg: 500, participants_count: 2, start: '08:00', end: '09:00', duration_seconds: 3600 });
    expect(r.body.note).toMatch(/Não representa peso carregado fisicamente/);
  });
  test('CSV padrão Excel pt-BR (BOM, ;, vírgula decimal)', async () => {
    const r = await as('gestor').get(`/api/reports/consolidated${F}&format=csv`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.headers['content-disposition']).toMatch(/consolidated_2026-09-10_a_2026-09-10\.csv/);
    expect(r.text.charCodeAt(0)).toBe(0xFEFF);
    const lines = r.text.slice(1).split('\r\n'); // remove o BOM (trim() também o removeria)
    expect(lines[0]).toMatch(/^Ajudante;Código;Total de cargas/);
    expect(lines.find(l => l.startsWith('Yago'))).toBe('Yago;001;2;120,00;2500,00;2;01:30;1666,67;80,00');
  });
  test('XLSX válido e com os mesmos totais', async () => {
    const r = await as('gestor').get(`/api/reports/individual${F}&format=xlsx`).buffer(true).parse((res, cb) => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.headers['content-type']).toMatch(/spreadsheetml/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body);
    const ws = wb.worksheets[0];
    const header = ws.getRow(5).values.slice(1);
    expect(header[0]).toBe('Data');
    let total = 0;
    ws.eachRow((row, n) => { if (n > 5) total += Number(row.getCell(16).value); });
    expect(total).toBe(4000);
  });
  test('proteção contra injeção de fórmula no CSV', async () => {
    getDb().prepare(`UPDATE helpers SET name='=HYPERLINK("http://x")' WHERE id=?`).run(ids.carlos);
    const r = await as('gestor').get(`/api/reports/consolidated${F}&format=csv`);
    expect(r.text).toMatch(/"'=HYPERLINK\(""http:\/\/x""\)"/);
    getDb().prepare(`UPDATE helpers SET name='Carlos' WHERE id=?`).run(ids.carlos);
  });
  test('formato inválido => 400', async () => {
    expect((await as('gestor').get(`/api/reports/individual${F}&format=pdf`)).status).toBe(400);
  });
});

describe('Histórico', () => {
  test('lista apontamentos com filtro, busca e paginação', async () => {
    const r = await as('gestor').get(`/api/history${F}`);
    expect(r.body.total).toBe(5);
    expect(r.body.rows[0].status).toBe('ATIVO'); // mais recente primeiro (João 11:00)
    expect((await as('gestor').get(`/api/history${F}&q=Yago`)).body.total).toBe(2);
    expect((await as('gestor').get(`/api/history${F}&q=4589`)).body.total).toBe(1);
    expect((await as('gestor').get(`/api/history${F}&status=ATIVO`)).body.total).toBe(1);
    expect((await as('gestor').get(`/api/history${F}&q=${encodeURIComponent("' OR 1=1 --")}`)).body.total).toBe(0);
    const p = await as('gestor').get(`/api/history${F}&page_size=10&page=2`);
    expect(p.body.rows).toHaveLength(0);
  });
});

describe('Auditoria', () => {
  test('registros de apontamento existem e são imutáveis', async () => {
    const r = await as('gestor').get('/api/audit?entity=activity_participants&action=INICIAR');
    expect(r.body.total).toBeGreaterThanOrEqual(5);
    expect(r.body.rows[0].user_name).toBe('Operador');
    const db = getDb();
    expect(() => db.prepare('UPDATE audit_logs SET action=? WHERE id=1').run('X')).toThrow(/somente inserção/);
    expect(() => db.prepare('DELETE FROM audit_logs').run()).toThrow(/somente inserção/);
    expect((await as('operador').get('/api/audit')).status).toBe(403);
  });
  test('auditoria não grava hash de senha', async () => {
    const rows = getDb().prepare(`SELECT old_values, new_values FROM audit_logs WHERE entity='users'`).all();
    expect(JSON.stringify(rows)).not.toMatch(/password_hash|\$2[aby]\$/);
  });
});

describe('API de integração (TMS/ERP)', () => {
  const key = { 'X-API-Key': 'chave-teste-123' };
  const loads = [{ external_id: 'TMS-1', load_number: '9001', weight_kg: 1500, volumes: 80, load_date: '2026-09-10', square_code: '05' }];
  test('sem chave ou chave errada => 401', async () => {
    expect((await request(app).post('/api/integration/loads').send(loads)).status).toBe(401);
    expect((await request(app).post('/api/integration/loads').set('X-API-Key', 'errada').send(loads)).status).toBe(401);
  });
  test('upsert idempotente por external_id (reenvio não duplica)', async () => {
    const a = await request(app).post('/api/integration/loads').set(key).send(loads);
    expect(a.status).toBe(200);
    expect(a.body.results[0].action).toBe('created');
    const b = await request(app).post('/api/integration/loads').set(key).send([{ ...loads[0], weight_kg: 1600 }]);
    expect(b.body.results[0].action).toBe('updated');
    const rows = getDb().prepare(`SELECT weight_kg, source, square_id FROM loads WHERE external_id='TMS-1'`).all();
    expect(rows).toEqual([{ weight_kg: 1600, source: 'INTEGRACAO', square_id: ids.square5 }].map(o => expect.objectContaining(o)));
  });
  test('item inválido não derruba o lote (207)', async () => {
    const r = await request(app).post('/api/integration/loads').set(key).send([{ external_id: 'TMS-2', load_number: '9002', weight_kg: 10, volumes: 1, load_date: '2026-09-10' }, { load_number: 'X' }]);
    expect(r.status).toBe(207);
    expect(r.body.failed).toBe(1);
    expect(r.body.results[1].errors).toContain('external_id obrigatório');
  });
  test('exporta produtividade consolidada', async () => {
    const r = await request(app).get(`/api/integration/productivity${F}`).set(key);
    expect(r.status).toBe(200);
    expect(r.body.rows.find(x => x.helper_barcode === '001').kg).toBe(2500);
  });
});

describe('Segurança da API', () => {
  test('cabeçalhos de segurança e CSP', async () => {
    const r = await request(app).get('/api/health');
    expect(r.headers['content-security-policy']).toMatch(/script-src 'self'/);
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });
  test('JSON inválido => 400; payload grande => 413; rota inexistente => 404', async () => {
    const t = (await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":'));
    expect(t.status).toBe(400);
    const big = await as('gestor').post('/api/squares').send({ code: '1', name: 'x'.repeat(3 * 1024 * 1024) });
    expect(big.status).toBe(413);
    expect((await as('gestor').get('/api/nao-existe')).status).toBe(404);
  });
  test('operador vê lista de ajudantes sem dados pessoais', async () => {
    const r = await as('operador').get('/api/helpers');
    expect(r.body[0].cpf).toBeUndefined();
    expect(r.body[0].notes).toBeUndefined();
  });
  test('SPA é servida e rotas desconhecidas caem no index', async () => {
    const r = await request(app).get('/qualquer/rota');
    expect(r.status).toBe(200);
    expect(r.text).toMatch(/LogiPonto/);
    expect((await request(app).get('/vendor/jsbarcode.min.js')).status).toBe(200);
  });
});

describe('Kg/hora com tempo mínimo', () => {
  test('apontamento de segundos não gera kg/h distorcido', async () => {
    clock.setNow('2026-09-11 08:00:00');
    const p = (await as('operador').post('/api/operations/start').send({ barcode: '004', load_id: ids.load4588, activity_type_id: ids.carregamento })).body.participant;
    clock.setNow('2026-09-11 08:00:20');
    await as('operador').post(`/api/operations/participants/${p.id}/finish`).send({});
    const r = await as('gestor').get('/api/dashboard?date_from=2026-09-11&date_to=2026-09-11');
    const m = r.body.helpers.find(h => h.helper_barcode === '004');
    expect(m.kg).toBe(1000);
    expect(m.seconds).toBe(20);
    expect(m.kg_per_hour).toBeNull();
    clock.setNow('2026-09-10 11:30:00');
  });
});
