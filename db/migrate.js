// db/migrate.js — Migração de single-tenant → multi-tenant SaaS
'use strict';

module.exports = function runMigrations(db) {
  // Migration tracking
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name    TEXT PRIMARY KEY,
    ran_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const ran  = new Set(db.prepare('SELECT name FROM _migrations').all().map(r => r.name));
  const mark = name => db.prepare('INSERT OR IGNORE INTO _migrations (name) VALUES (?)').run(name);

  function run(name, fn) {
    if (ran.has(name)) return;
    try {
      fn();
      mark(name);
      console.log(`  ✓ ${name}`);
    } catch (e) {
      console.error(`  ✗ ${name}: ${e.message}`);
      throw e;
    }
  }

  /* ─────────────────────────────────────────────────────────────
     M001 — Criar tabela barbershops
  ───────────────────────────────────────────────────────────── */
  run('M001_barbershops_table', () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS barbershops (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        slug       TEXT    UNIQUE,
        phone      TEXT,
        address    TEXT,
        plan       TEXT    NOT NULL DEFAULT 'basic',
        active     INTEGER NOT NULL DEFAULT 1,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Cria barbearia padrão (id=1) para dados existentes
    const n = db.prepare('SELECT COUNT(*) AS n FROM barbershops').get().n;
    if (n === 0) {
      db.prepare(`INSERT INTO barbershops (id, name, slug, plan)
                  VALUES (1, 'Barbearia Padrão', 'default', 'pro')`).run();
    }
  });

  /* ─────────────────────────────────────────────────────────────
     M002 — Adicionar barbershop_id na tabela users
  ───────────────────────────────────────────────────────────── */
  run('M002_users_barbershop_id', () => {
    try { db.exec('ALTER TABLE users ADD COLUMN barbershop_id INTEGER REFERENCES barbershops(id)'); } catch (_) {}
    // Associa todos os usuários existentes (não super_admin) à barbearia 1
    db.exec(`UPDATE users SET barbershop_id = 1 WHERE barbershop_id IS NULL AND role != 'super_admin'`);
  });

  /* ─────────────────────────────────────────────────────────────
     M003 — Atualizar role CHECK para incluir super_admin
             (SQLite não permite ALTER COLUMN, então recriamos)
  ───────────────────────────────────────────────────────────── */
  run('M003_users_super_admin_role', () => {
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users_new (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          barbershop_id  INTEGER REFERENCES barbershops(id) ON DELETE CASCADE,
          name           TEXT    NOT NULL,
          email          TEXT    NOT NULL UNIQUE,
          password       TEXT    NOT NULL,
          role           TEXT    NOT NULL CHECK(role IN ('super_admin','owner','barber','client')),
          avatar         TEXT,
          phone          TEXT,
          active         INTEGER NOT NULL DEFAULT 1,
          created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`INSERT OR IGNORE INTO users_new SELECT id, barbershop_id, name, email, password, role, avatar, phone, active, created_at, updated_at FROM users`);
      db.exec('DROP TABLE IF EXISTS users');
      db.exec('ALTER TABLE users_new RENAME TO users');
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  });

  /* ─────────────────────────────────────────────────────────────
     M004 — Adicionar barbershop_id nas tabelas principais
  ───────────────────────────────────────────────────────────── */
  run('M004_barbershop_id_columns', () => {
    const cols = [
      ['services',             'ALTER TABLE services ADD COLUMN barbershop_id INTEGER NOT NULL DEFAULT 1 REFERENCES barbershops(id)'],
      ['appointments',         'ALTER TABLE appointments ADD COLUMN barbershop_id INTEGER NOT NULL DEFAULT 1 REFERENCES barbershops(id)'],
      ['financial_categories', 'ALTER TABLE financial_categories ADD COLUMN barbershop_id INTEGER NOT NULL DEFAULT 1 REFERENCES barbershops(id)'],
      ['financial_entries',    'ALTER TABLE financial_entries ADD COLUMN barbershop_id INTEGER NOT NULL DEFAULT 1 REFERENCES barbershops(id)'],
      ['inventory',            'ALTER TABLE inventory ADD COLUMN barbershop_id INTEGER NOT NULL DEFAULT 1 REFERENCES barbershops(id)'],
    ];
    for (const [, sql] of cols) {
      try { db.exec(sql); } catch (_) { /* coluna já existe */ }
    }
  });

  /* ─────────────────────────────────────────────────────────────
     M005 — Recriar tabela settings com PK composta (barbershop_id, key)
  ───────────────────────────────────────────────────────────── */
  run('M005_settings_composite_pk', () => {
    // Verifica se settings já tem barbershop_id como PK composta
    const info = db.prepare("PRAGMA table_info(settings)").all();
    const hasBsId = info.some(c => c.name === 'barbershop_id');
    if (hasBsId) return; // já migrado

    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings_new (
          barbershop_id INTEGER NOT NULL DEFAULT 1 REFERENCES barbershops(id) ON DELETE CASCADE,
          key           TEXT    NOT NULL,
          value         TEXT    NOT NULL,
          updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (barbershop_id, key)
        )
      `);
      // Copia dados existentes para a barbershop 1
      const old = db.prepare('SELECT key, value, updated_at FROM settings').all();
      const ins = db.prepare('INSERT OR IGNORE INTO settings_new (barbershop_id, key, value, updated_at) VALUES (1, ?, ?, ?)');
      for (const r of old) ins.run(r.key, r.value, r.updated_at);

      db.exec('DROP TABLE IF EXISTS settings');
      db.exec('ALTER TABLE settings_new RENAME TO settings');
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  });

  /* ─────────────────────────────────────────────────────────────
     M006 — Criar índices novos (se não existirem)
  ───────────────────────────────────────────────────────────── */
  run('M006_indexes', () => {
    const idxs = [
      'CREATE INDEX IF NOT EXISTS idx_users_barbershop ON users(barbershop_id)',
      'CREATE INDEX IF NOT EXISTS idx_appointments_bs  ON appointments(barbershop_id)',
      'CREATE INDEX IF NOT EXISTS idx_financial_bs     ON financial_entries(barbershop_id)',
      'CREATE INDEX IF NOT EXISTS idx_inventory_bs     ON inventory(barbershop_id)',
      'CREATE INDEX IF NOT EXISTS idx_services_bs      ON services(barbershop_id)',
    ];
    for (const sql of idxs) { try { db.exec(sql); } catch (_) {} }
  });

  /* ─────────────────────────────────────────────────────────────
     M007 — Avaliações
  ───────────────────────────────────────────────────────────── */
  run('M007_reviews', () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS reviews (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        barbershop_id  INTEGER NOT NULL DEFAULT 1 REFERENCES barbershops(id) ON DELETE CASCADE,
        appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
        client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        barber_id      INTEGER NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
        service_id     INTEGER REFERENCES services(id) ON DELETE SET NULL,
        rating         INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
        comment        TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_reviews_bs     ON reviews(barbershop_id);
      CREATE INDEX IF NOT EXISTS idx_reviews_barber ON reviews(barber_id);
    `);
  });

  /* ─────────────────────────────────────────────────────────────
     M008 — Assinaturas
  ───────────────────────────────────────────────────────────── */
  run('M008_subscriptions', () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS subscription_plans (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        barbershop_id INTEGER NOT NULL DEFAULT 1 REFERENCES barbershops(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        price         REAL NOT NULL DEFAULT 0,
        benefits      TEXT DEFAULT '[]',
        discount_pct  REAL NOT NULL DEFAULT 0,
        loyalty_mult  REAL NOT NULL DEFAULT 1,
        active        INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS subscriptions (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        barbershop_id  INTEGER NOT NULL DEFAULT 1 REFERENCES barbershops(id) ON DELETE CASCADE,
        client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        plan_id        INTEGER NOT NULL REFERENCES subscription_plans(id),
        status         TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','canceled','expired')),
        start_date     TEXT NOT NULL DEFAULT (date('now')),
        next_billing   TEXT,
        canceled_at    TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_subs_bs     ON subscriptions(barbershop_id);
      CREATE INDEX IF NOT EXISTS idx_subs_client ON subscriptions(client_id);
    `);
    // Planos padrão Bronze/Prata/Ouro
    const bs = db.prepare('SELECT id FROM barbershops').all();
    const ins = db.prepare('INSERT OR IGNORE INTO subscription_plans (barbershop_id,name,price,benefits,discount_pct,loyalty_mult) VALUES (?,?,?,?,?,?)');
    for (const b of bs) {
      ins.run(b.id,'Bronze', 29.90, JSON.stringify(['Fila prioritária','5% desconto']),   5,  1.0);
      ins.run(b.id,'Prata',  59.90, JSON.stringify(['Fila prioritária','10% desconto','Cashback 1%']), 10, 1.5);
      ins.run(b.id,'Ouro',  99.90,  JSON.stringify(['Fila prioritária','15% desconto','Cashback 2%','Produto grátis/mês']), 15, 2.0);
    }
  });

  /* ─────────────────────────────────────────────────────────────
     M009 — Fornecedores e Pedidos de Compra
  ───────────────────────────────────────────────────────────── */
  run('M009_suppliers', () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        barbershop_id  INTEGER NOT NULL DEFAULT 1 REFERENCES barbershops(id) ON DELETE CASCADE,
        name           TEXT NOT NULL,
        contact        TEXT,
        phone          TEXT,
        email          TEXT,
        discount_pct   REAL NOT NULL DEFAULT 0,
        notes          TEXT,
        active         INTEGER NOT NULL DEFAULT 1,
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        barbershop_id  INTEGER NOT NULL DEFAULT 1 REFERENCES barbershops(id) ON DELETE CASCADE,
        supplier_id    INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        status         TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','received','canceled')),
        total          REAL NOT NULL DEFAULT 0,
        notes          TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        received_at    TEXT
      );
      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id     INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        inventory_id INTEGER REFERENCES inventory(id) ON DELETE SET NULL,
        item_name    TEXT NOT NULL,
        quantity     REAL NOT NULL,
        unit_cost    REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_suppliers_bs ON suppliers(barbershop_id);
      CREATE INDEX IF NOT EXISTS idx_po_bs        ON purchase_orders(barbershop_id);
    `);
  });

  /* ─────────────────────────────────────────────────────────────
     M010 — Metas
  ───────────────────────────────────────────────────────────── */
  run('M010_goals', () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS goals (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        barbershop_id        INTEGER NOT NULL DEFAULT 1 REFERENCES barbershops(id) ON DELETE CASCADE,
        month                TEXT NOT NULL,
        revenue_goal         REAL NOT NULL DEFAULT 0,
        appointments_goal    INTEGER NOT NULL DEFAULT 0,
        new_clients_goal     INTEGER NOT NULL DEFAULT 0,
        avg_rating_goal      REAL NOT NULL DEFAULT 4.5,
        created_at           TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(barbershop_id, month)
      );
      CREATE TABLE IF NOT EXISTS barber_goals (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        barbershop_id INTEGER NOT NULL DEFAULT 1 REFERENCES barbershops(id) ON DELETE CASCADE,
        barber_id     INTEGER NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
        month         TEXT NOT NULL,
        revenue_goal  REAL NOT NULL DEFAULT 0,
        appointments_goal INTEGER NOT NULL DEFAULT 0,
        UNIQUE(barbershop_id, barber_id, month)
      );
      CREATE INDEX IF NOT EXISTS idx_goals_bs ON goals(barbershop_id);
    `);
  });

  /* ─────────────────────────────────────────────────────────────
     M011 — Marketing & WhatsApp
  ───────────────────────────────────────────────────────────── */
  run('M011_marketing', () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        barbershop_id  INTEGER NOT NULL DEFAULT 1 REFERENCES barbershops(id) ON DELETE CASCADE,
        name           TEXT NOT NULL,
        channel        TEXT NOT NULL DEFAULT 'whatsapp' CHECK(channel IN ('whatsapp','email','sms')),
        target         TEXT NOT NULL DEFAULT 'all' CHECK(target IN ('all','inactive','vip','birthday')),
        message        TEXT NOT NULL DEFAULT '',
        status         TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','scheduled','sent','canceled')),
        sent_count     INTEGER NOT NULL DEFAULT 0,
        scheduled_at   TEXT,
        sent_at        TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS whatsapp_templates (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        barbershop_id  INTEGER NOT NULL DEFAULT 1 REFERENCES barbershops(id) ON DELETE CASCADE,
        type           TEXT NOT NULL,
        name           TEXT NOT NULL,
        template       TEXT NOT NULL,
        active         INTEGER NOT NULL DEFAULT 1,
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(barbershop_id, type)
      );
      CREATE TABLE IF NOT EXISTS automations (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        barbershop_id  INTEGER NOT NULL DEFAULT 1 REFERENCES barbershops(id) ON DELETE CASCADE,
        trigger_type   TEXT NOT NULL,
        delay_hours    INTEGER NOT NULL DEFAULT 0,
        template_id    INTEGER REFERENCES whatsapp_templates(id) ON DELETE SET NULL,
        active         INTEGER NOT NULL DEFAULT 1,
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(barbershop_id, trigger_type)
      );
      CREATE INDEX IF NOT EXISTS idx_campaigns_bs ON campaigns(barbershop_id);
    `);
    // Templates padrão por barbearia
    const bs = db.prepare('SELECT id FROM barbershops').all();
    const ins = db.prepare('INSERT OR IGNORE INTO whatsapp_templates (barbershop_id,type,name,template) VALUES (?,?,?,?)');
    for (const b of bs) {
      ins.run(b.id,'confirmation','Confirmação de Agendamento','Olá *{{nome}}*! 👋\n\nSeu agendamento está confirmado:\n✂️ *Serviço:* {{servico}}\n📅 *Data:* {{data}}\n🕐 *Horário:* {{horario}}\n💈 *Barbeiro:* {{barbeiro}}\n\nAguardamos você! 🙌');
      ins.run(b.id,'reminder','Lembrete 24h','Olá *{{nome}}*! ⏰\n\nLembrando do seu agendamento *amanhã*:\n✂️ {{servico}} às {{horario}} com {{barbeiro}}\n\nAté lá! 💈');
      ins.run(b.id,'review_request','Pós-Atendimento','Olá *{{nome}}*! Esperamos que tenha gostado do atendimento! 🌟\n\nAvalie seu barbeiro {{barbeiro}}: {{link_avaliacao}}');
      ins.run(b.id,'reactivation','Campanha de Retorno','Sentimos sua falta, *{{nome}}*! 😢\n\nFaz {{dias}} dias que você não nos visita. Que tal agendar? Temos novidades esperando por você! 💈');
      ins.run(b.id,'birthday','Aniversário','Feliz aniversário, *{{nome}}*! 🎉🎂\n\nPara celebrar, ganhe *10% de desconto* no seu próximo atendimento!\n\nUse o código: *ANIVER10*');
    }
    const insA = db.prepare('INSERT OR IGNORE INTO automations (barbershop_id,trigger_type,delay_hours) VALUES (?,?,?)');
    for (const b of bs) {
      insA.run(b.id,'after_appointment', 2);
      insA.run(b.id,'reminder_24h', -24);
      insA.run(b.id,'inactive_30d', 0);
      insA.run(b.id,'inactive_60d', 0);
      insA.run(b.id,'birthday', 0);
    }
  });
};
