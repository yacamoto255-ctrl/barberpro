'use strict';
// Migrações versionadas. Cada migração roda uma única vez (tabela schema_migrations).
// O SQL foi escrito de forma portável: para migrar para PostgreSQL basta trocar
// INTEGER PRIMARY KEY AUTOINCREMENT por BIGSERIAL, TEXT de datas por TIMESTAMP
// e os índices parciais permanecem iguais (Postgres também suporta WHERE em índice).

const MIGRATIONS = [
  {
    name: '001_schema_inicial',
    sql: `
    -- Usuários do sistema (quem opera/gerencia). Ajudantes NÃO são usuários.
    CREATE TABLE users (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT    NOT NULL,
      email           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      password_hash   TEXT    NOT NULL,
      role            TEXT    NOT NULL CHECK (role IN ('ADMIN','GESTOR','OPERADOR')),
      active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      token_version   INTEGER NOT NULL DEFAULT 0,   -- incrementa para invalidar sessões
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until    TEXT,
      last_login_at   TEXT,
      created_at      TEXT    NOT NULL,
      updated_at      TEXT    NOT NULL
    );

    CREATE TABLE teams (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    );

    CREATE TABLE shifts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      start_time  TEXT    NOT NULL,  -- HH:MM
      end_time    TEXT    NOT NULL,  -- HH:MM (pode ser menor que start_time = vira o dia)
      active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    );

    -- Ajudante: o código de barras identifica EXCLUSIVAMENTE o ajudante.
    CREATE TABLE helpers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode         TEXT    NOT NULL UNIQUE,          -- ex.: 001 = Yago
      registration    TEXT    UNIQUE,                   -- matrícula
      name            TEXT    NOT NULL,
      cpf             TEXT    UNIQUE,                   -- opcional, só dígitos
      sector          TEXT,
      shift_id        INTEGER REFERENCES shifts(id),
      team_id         INTEGER REFERENCES teams(id),
      status          TEXT    NOT NULL DEFAULT 'ATIVO' CHECK (status IN ('ATIVO','INATIVO')),
      admission_date  TEXT,
      notes           TEXT,
      external_id     TEXT    UNIQUE,                   -- id no ERP/RH (integração futura)
      created_at      TEXT    NOT NULL,
      updated_at      TEXT    NOT NULL
    );
    CREATE INDEX ix_helpers_name   ON helpers(name);
    CREATE INDEX ix_helpers_status ON helpers(status);

    -- Conferentes (hoje medidos pelo sistema da transportadora)
    CREATE TABLE checkers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      registration TEXT    UNIQUE,
      active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      external_id  TEXT    UNIQUE,
      created_at   TEXT    NOT NULL,
      updated_at   TEXT    NOT NULL
    );

    -- Praças (destinos internos da carga)
    CREATE TABLE squares (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      code        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      name        TEXT    NOT NULL,
      active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      external_id TEXT    UNIQUE,
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    );

    -- Cargas. Futuramente virão do TMS/ERP (source='INTEGRACAO', external_id).
    CREATE TABLE loads (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      load_number  TEXT    NOT NULL UNIQUE,
      weight_kg    REAL    NOT NULL CHECK (weight_kg >= 0),
      volumes      INTEGER NOT NULL CHECK (volumes >= 0),
      checker_id   INTEGER REFERENCES checkers(id),
      square_id    INTEGER REFERENCES squares(id),   -- praça de destino padrão
      load_date    TEXT    NOT NULL,
      status       TEXT    NOT NULL DEFAULT 'ABERTA' CHECK (status IN ('ABERTA','CONCLUIDA','CANCELADA')),
      source       TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','DEMO','INTEGRACAO')),
      external_id  TEXT    UNIQUE,
      notes        TEXT,
      created_at   TEXT    NOT NULL,
      updated_at   TEXT    NOT NULL
    );
    CREATE INDEX ix_loads_date ON loads(load_date);

    -- Regras de produtividade (rateio). Nada de regra fixa no código:
    -- o método e os fatores ficam aqui e são "fotografados" em cada atividade.
    CREATE TABLE productivity_rules (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      method         TEXT    NOT NULL CHECK (method IN ('RATEIO_IGUAL','PROPORCIONAL_TEMPO','CREDITO_INTEGRAL')),
      weight_factor  REAL    NOT NULL DEFAULT 1 CHECK (weight_factor >= 0),
      volume_factor  REAL    NOT NULL DEFAULT 1 CHECK (volume_factor >= 0),
      description    TEXT,
      active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      created_at     TEXT    NOT NULL,
      updated_at     TEXT    NOT NULL
    );

    CREATE TABLE activity_types (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      code             TEXT    NOT NULL UNIQUE,
      name             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      description      TEXT,
      requires_square  INTEGER NOT NULL DEFAULT 0 CHECK (requires_square IN (0,1)),
      rule_id          INTEGER NOT NULL REFERENCES productivity_rules(id),
      color            TEXT    NOT NULL DEFAULT '#1f6feb',
      sort_order       INTEGER NOT NULL DEFAULT 0,
      active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      created_at       TEXT    NOT NULL,
      updated_at       TEXT    NOT NULL
    );

    -- Execução de uma atividade sobre uma carga (ex.: Carregamento da carga 4587).
    -- Vários ajudantes participam da MESMA execução => rateio entre eles.
    CREATE TABLE activities (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      load_id              INTEGER NOT NULL REFERENCES loads(id),
      activity_type_id     INTEGER NOT NULL REFERENCES activity_types(id),
      square_id            INTEGER REFERENCES squares(id),
      reference_weight_kg  REAL    NOT NULL CHECK (reference_weight_kg >= 0), -- peso de referência (padrão: peso da carga)
      reference_volumes    INTEGER NOT NULL CHECK (reference_volumes >= 0),
      status               TEXT    NOT NULL DEFAULT 'EM_ANDAMENTO' CHECK (status IN ('EM_ANDAMENTO','FINALIZADA','CANCELADA')),
      started_at           TEXT    NOT NULL,
      ended_at             TEXT,
      rule_id              INTEGER NOT NULL REFERENCES productivity_rules(id),
      rule_snapshot        TEXT    NOT NULL,  -- JSON da regra vigente no início (histórico estável)
      started_by           INTEGER REFERENCES users(id),
      ended_by             INTEGER REFERENCES users(id),
      notes                TEXT,
      created_at           TEXT    NOT NULL,
      updated_at           TEXT    NOT NULL
    );
    CREATE INDEX ix_activities_load    ON activities(load_id);
    CREATE INDEX ix_activities_started ON activities(started_at);
    CREATE INDEX ix_activities_type    ON activities(activity_type_id);
    -- Anti-duplicidade: só pode existir UMA execução aberta da mesma atividade
    -- para a mesma carga e praça. Novos ajudantes entram nela.
    CREATE UNIQUE INDEX ux_activity_open
      ON activities(load_id, activity_type_id, IFNULL(square_id, 0))
      WHERE status = 'EM_ANDAMENTO';

    -- Participação (segmento de tempo) do ajudante em uma execução.
    CREATE TABLE activity_participants (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id      INTEGER NOT NULL REFERENCES activities(id),
      helper_id        INTEGER NOT NULL REFERENCES helpers(id),
      shift_id         INTEGER REFERENCES shifts(id),  -- turno do ajudante no momento (fotografia)
      team_id          INTEGER REFERENCES teams(id),   -- equipe do ajudante no momento (fotografia)
      joined_at        TEXT    NOT NULL,
      left_at          TEXT,
      duration_seconds INTEGER,
      status           TEXT    NOT NULL DEFAULT 'ATIVO' CHECK (status IN ('ATIVO','FINALIZADO','CANCELADO')),
      cancel_reason    TEXT,
      started_by       INTEGER REFERENCES users(id),
      ended_by         INTEGER REFERENCES users(id),
      created_at       TEXT    NOT NULL,
      updated_at       TEXT    NOT NULL,
      CHECK (left_at IS NULL OR left_at >= joined_at)
    );
    CREATE INDEX ix_part_activity ON activity_participants(activity_id);
    CREATE INDEX ix_part_helper   ON activity_participants(helper_id, joined_at);
    -- Anti-duplicidade: um ajudante só pode estar em UMA atividade aberta por vez.
    CREATE UNIQUE INDEX ux_part_helper_open
      ON activity_participants(helper_id) WHERE status = 'ATIVO';

    -- Crédito de produtividade por ajudante em cada execução (resultado do rateio).
    -- Recalculado ao finalizar/corrigir; nunca somado duas vezes (UNIQUE).
    CREATE TABLE activity_allocations (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id          INTEGER NOT NULL REFERENCES activities(id),
      helper_id            INTEGER NOT NULL REFERENCES helpers(id),
      participants_count   INTEGER NOT NULL,
      share                REAL    NOT NULL,     -- fração do peso de referência
      allocated_weight_kg  REAL    NOT NULL,
      allocated_volumes    REAL    NOT NULL,
      worked_seconds       INTEGER NOT NULL,
      method               TEXT    NOT NULL,
      calculated_at        TEXT    NOT NULL,
      UNIQUE (activity_id, helper_id)
    );
    CREATE INDEX ix_alloc_helper ON activity_allocations(helper_id);

    -- Auditoria somente-inserção.
    CREATE TABLE audit_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER REFERENCES users(id),
      user_name   TEXT,
      action      TEXT    NOT NULL,     -- CRIAR, EDITAR, INATIVAR, INICIAR, FINALIZAR, CANCELAR, LOGIN...
      entity      TEXT    NOT NULL,     -- helpers, loads, activities...
      entity_id   INTEGER,
      old_values  TEXT,                 -- JSON
      new_values  TEXT,                 -- JSON
      reason      TEXT,
      ip          TEXT,
      created_at  TEXT    NOT NULL
    );
    CREATE INDEX ix_audit_entity  ON audit_logs(entity, entity_id);
    CREATE INDEX ix_audit_created ON audit_logs(created_at);
    CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_logs
      BEGIN SELECT RAISE(ABORT, 'audit_logs é somente inserção'); END;
    CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_logs
      BEGIN SELECT RAISE(ABORT, 'audit_logs é somente inserção'); END;
    `,
  },
];

function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name));
  for (const m of MIGRATIONS) {
    if (done.has(m.name)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(m.name);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Falha na migração ${m.name}: ${e.message}`);
    }
  }
}

module.exports = { runMigrations };
