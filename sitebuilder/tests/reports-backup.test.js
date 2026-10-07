'use strict';
const H = require('./helpers');
const ExcelJS = require('exceljs');
const { request } = H;

let app; let admin; let auth; let site; let service;
const binary = (res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); };

beforeAll(async () => {
  app = H.makeApp();
  admin = await H.setupAdmin(app);
  auth = { Authorization: `Bearer ${admin}` };
  ({ site, service } = await H.createSite(app, admin));
  const d = H.futureDate(3);
  const mk = (time, phone, name = 'Cliente') => request(app).post('/api/bookings').set(auth)
    .send({ site_id: site.id, service_id: service.id, date: d, time, client_name: name, client_phone: phone });
  const a = (await mk('09:00', '11 91000-0001', '=HYPERLINK("http://mal")')).body.booking;
  const b = (await mk('10:00', '11 91000-0002', 'Bruna')).body.booking;
  const c = (await mk('11:00', '11 91000-0003', 'Caio')).body.booking;
  await mk('12:00', '11 91000-0004', 'Duda');
  await request(app).patch(`/api/bookings/${a.id}`).set(auth).send({ status: 'completed' });
  await request(app).patch(`/api/bookings/${b.id}`).set(auth).send({ status: 'cancelled' });
  await request(app).patch(`/api/bookings/${c.id}`).set(auth).send({ status: 'no_show' });
});
afterAll(H.cleanup);

describe('dashboard', () => {
  test('indicadores batem com o banco', async () => {
    const r = await request(app).get('/api/dashboard').set(auth);
    expect(r.status).toBe(200);
    const db = H.getDb();
    const expectedActive = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status IN ('pending','confirmed')").get().n;
    expect(r.body.cards.next7_bookings).toBe(expectedActive);
    expect(r.body.cards.sites_total).toBe(1);
    expect(r.body.daily).toHaveLength(14);
    expect(r.body.daily.reduce((s, d) => s + d.count, 0)).toBe(2); // concluído + confirmado (cancelado e no-show não contam)
    expect(r.body.upcoming.every((b) => ['pending', 'confirmed'].includes(b.status))).toBe(true);
    const filtered = await request(app).get('/api/dashboard?site_id=999').set(auth);
    expect(filtered.body.cards.next7_bookings).toBe(0);
  });
});

describe('relatórios', () => {
  test('totais e receitas corretos (JSON)', async () => {
    const r = await request(app).get(`/api/reports/bookings?site_id=${site.id}`).set(auth);
    expect(r.status).toBe(200);
    expect(r.body.totals).toMatchObject({
      count: 4,
      revenue_done_cents: 5000, // só o concluído
      revenue_expected_cents: 10000, // concluído + confirmado
      by_status: { completed: 1, cancelled: 1, no_show: 1, confirmed: 1, pending: 0 },
    });
    expect(r.body.totals.by_service[0]).toMatchObject({ label: 'Corte', count: 4 });
    const f = await request(app).get('/api/reports/bookings?status=cancelled').set(auth);
    expect(f.body.totals.count).toBe(1);
    const empty = await request(app).get('/api/reports/bookings?from=2001-01-01&to=2001-01-31').set(auth);
    expect(empty.body.totals.count).toBe(0);
    expect((await request(app).get('/api/reports/bookings?format=doc').set(auth)).status).toBe(400);
  });

  test('CSV: UTF-8 com BOM, ";" e proteção contra fórmula', async () => {
    const r = await request(app).get('/api/reports/bookings?format=csv').set(auth);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="agendamentos-.*\.csv"/);
    expect(r.text.charCodeAt(0)).toBe(0xfeff);
    const lines = r.text.slice(1).split('\r\n');
    expect(lines[0]).toBe('ID;Site;Data/hora;Serviço;Profissional;Cliente;WhatsApp;E-mail;Valor (R$);Status;Origem');
    expect(lines.filter((l) => /^"\d+"/.test(l))).toHaveLength(4);
    expect(r.text).toContain(`"'=HYPERLINK(""http://mal"")"`);
    expect(r.text).toContain('"50,00"');
    expect(r.text).toMatch(/Receita realizada.*"50,00"/);
  });

  test('Excel: abre e tem as linhas e o resumo', async () => {
    const r = await request(app).get('/api/reports/bookings?format=xlsx').set(auth).buffer(true).parse(binary);
    expect(r.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body);
    const ws = wb.getWorksheet('Agendamentos');
    expect(ws.rowCount).toBe(5); // cabeçalho + 4
    expect(ws.getRow(2).getCell(9).value).toBe(50);
    expect(String(ws.getRow(2).getCell(6).value)).toMatch(/^'=/);
    const sum = wb.getWorksheet('Resumo');
    expect(sum.getRow(1).getCell(2).value).toBe(4);
    expect(sum.getRow(2).getCell(2).value).toBe(50);
  });

  test('PDF: arquivo válido', async () => {
    const r = await request(app).get('/api/reports/bookings?format=pdf').set(auth).buffer(true).parse(binary);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.body.slice(0, 5).toString()).toBe('%PDF-');
    expect(r.body.slice(-6).toString()).toMatch(/%%EOF/);
    expect(r.body.length).toBeGreaterThan(1500);
  });

  test('exportações ficam na auditoria', () => {
    const n = H.getDb().prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'report.export'").get().n;
    expect(n).toBe(3);
  });
});

describe('backup e restauração', () => {
  let backupName;
  test('backup manual, lista e download íntegro', async () => {
    const c = await request(app).post('/api/backups').set(auth);
    expect(c.status).toBe(201);
    backupName = c.body.backup.name;
    expect(backupName).toMatch(/^manual-\d{8}-\d{6}(-\d+)?\.db$/);
    const list = await request(app).get('/api/backups').set(auth);
    expect(list.body.backups.map((b) => b.name)).toContain(backupName);
    const dl = await request(app).get(`/api/backups/${backupName}/download`).set(auth).buffer(true).parse(binary);
    expect(dl.status).toBe(200);
    expect(dl.body.slice(0, 15).toString()).toBe('SQLite format 3');
    expect(dl.body.length).toBe(c.body.backup.size);
  });

  test('restauração completa volta os dados ao ponto do backup', async () => {
    const before = H.getDb().prepare('SELECT COUNT(*) AS n FROM bookings').get().n;
    await request(app).post('/api/sites').set(auth).send({ name: 'Criado depois do backup' });
    await request(app).delete(`/api/bookings/${H.getDb().prepare('SELECT id FROM bookings LIMIT 1').get().id}`).set(auth);
    expect(H.getDb().prepare('SELECT COUNT(*) AS n FROM bookings').get().n).toBe(before - 1);

    const r = await request(app).post(`/api/backups/${backupName}/restore`).set(auth);
    expect(r.status).toBe(200);
    expect(r.body.safety_backup).toMatch(/^pre-restore-/);
    expect(H.getDb().prepare('SELECT COUNT(*) AS n FROM bookings').get().n).toBe(before);
    expect(H.getDb().prepare("SELECT COUNT(*) AS n FROM sites WHERE name = 'Criado depois do backup'").get().n).toBe(0);
    // o mesmo token continua válido (o segredo do JWT veio junto no backup)
    expect((await request(app).get('/api/auth/me').set(auth)).status).toBe(200);
    // e dá para voltar atrás com o backup de segurança
    const back = await request(app).post(`/api/backups/${r.body.safety_backup}/restore`).set(auth);
    expect(back.status).toBe(200);
    expect(H.getDb().prepare("SELECT COUNT(*) AS n FROM sites WHERE name = 'Criado depois do backup'").get().n).toBe(1);
  });

  test('upload de backup valida o arquivo', async () => {
    const bad = await request(app).post('/api/backups/upload').set(auth).set('Content-Type', 'application/octet-stream').send(Buffer.alloc(500, 1));
    expect(bad.status).toBe(400);
    const dl = await request(app).get(`/api/backups/${backupName}/download`).set(auth).buffer(true).parse(binary);
    const ok = await request(app).post('/api/backups/upload').set(auth).set('Content-Type', 'application/octet-stream').send(dl.body);
    expect(ok.status).toBe(201);
    expect(ok.body.backup.name).toMatch(/^upload-/);
  });

  test('nomes maliciosos são recusados (path traversal)', async () => {
    expect((await request(app).get('/api/backups/..%2F..%2Fetc%2Fpasswd/download').set(auth)).status).toBe(400);
    expect((await request(app).post('/api/backups/test.db/restore').set(auth)).status).toBe(400);
    expect((await request(app).delete('/api/backups/manual-20990101-000000.db').set(auth)).status).toBe(404);
  });

  test('backup automático mantém só os N mais recentes', () => {
    const backup = require('../src/services/backup');
    for (let i = 0; i < 4; i++) backup.createBackup('auto');
    backup.pruneAuto(2);
    expect(backup.listBackups().filter((b) => b.kind === 'auto')).toHaveLength(2);
  });

  test('excluir backup', async () => {
    expect((await request(app).delete(`/api/backups/${backupName}`).set(auth)).status).toBe(200);
  });
});

describe('auditoria', () => {
  test('registra login, criação, alteração, exclusão e restauração', async () => {
    const r = await request(app).get('/api/audit?limit=500').set(auth);
    const actions = new Set(r.body.logs.map((l) => l.action));
    for (const a of ['setup.admin_created', 'site.create', 'booking.create', 'booking.update', 'booking.delete', 'backup.create', 'backup.restore', 'report.export']) {
      expect(actions).toContain(a);
    }
    const f = await request(app).get('/api/audit?action=backup.').set(auth);
    expect(f.body.logs.every((l) => l.action.startsWith('backup.'))).toBe(true);
    expect(f.body.logs[0].user_email).toBe(H.ADMIN.email);
  });
});
