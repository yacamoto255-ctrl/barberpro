// server.js — BarberPro Express server
'use strict';

// Load .env if present (never crash if file missing)
try { require('dotenv').config(); } catch (_) {}

const path    = require('path');
const fs      = require('fs');
const express = require('express');
const cors    = require('cors');
const morgan  = require('morgan');

const app = express();

/* ── SECURITY HEADERS ──────────────────────────────────────── */
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

/* ── CORS ───────────────────────────────────────────────────── */
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : true; // dev: allow all

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET','POST','PATCH','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

/* ── MIDDLEWARE ─────────────────────────────────────────────── */
const IS_PROD = process.env.NODE_ENV === 'production';
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
if (!IS_PROD) app.use(morgan('dev'));
else          app.use(morgan('combined'));

/* ── STATIC FILES ───────────────────────────────────────────── */
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: IS_PROD ? '1d' : 0,
}));

/* ── API ROUTES ─────────────────────────────────────────────── */
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/clients',      require('./routes/clients'));
app.use('/api/barbers',      require('./routes/barbers'));
app.use('/api/services',     require('./routes/services'));
app.use('/api/financial',    require('./routes/financial'));
app.use('/api/inventory',    require('./routes/inventory'));
app.use('/api/dashboard',    require('./routes/dashboard'));
app.use('/api/settings',     require('./routes/settings'));
app.use('/api/super-admin',  require('./routes/superadmin'));
app.use('/api/schedule-blocks', require('./routes/scheduleBlocks'));
app.use('/api/cashflow',        require('./routes/cashflow'));
app.use('/api/reviews',         require('./routes/reviews'));
app.use('/api/subscriptions',   require('./routes/subscriptions'));
app.use('/api/suppliers',       require('./routes/suppliers'));
app.use('/api/goals',           require('./routes/goals'));
app.use('/api/marketing',       require('./routes/marketing'));
app.use('/api/reports',         require('./routes/reports'));
app.use('/api/ai',              require('./routes/ai'));
app.use('/api/whatsapp',        require('./routes/whatsapp'));

/* ── BACKUP DOWNLOAD (super-admin only) ─────────────────────── */
app.get('/api/backup/download', (req, res) => {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token obrigatório.' });
  try {
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'barberpro-secret-key-change-in-production';
    const user = jwt.verify(token, JWT_SECRET);
    if (user.role !== 'super_admin' && user.role !== 'owner')
      return res.status(403).json({ error: 'Acesso negado.' });
  } catch { return res.status(401).json({ error: 'Token inválido.' }); }
  const dbPath = path.join(__dirname, 'db', 'barberpro.db');
  if (!fs.existsSync(dbPath)) return res.status(404).json({ error: 'Banco não encontrado.' });
  const date = new Date().toISOString().slice(0,10);
  res.download(dbPath, `barberpro_backup_${date}.db`);
});

/* ── HEALTH CHECK ───────────────────────────────────────────── */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString(), version: '1.0.0' });
});

/* ── API 404 — must come before SPA fallback ─────────────────── */
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` });
});

/* ── SPA FALLBACK (non-API routes only) ──────────────────────── */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ── ERROR HANDLER ──────────────────────────────────────────── */
app.use((err, req, res, _next) => {
  if (!IS_PROD) console.error('[ERROR]', err.stack || err.message);
  else          console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({ error: IS_PROD ? 'Erro interno do servidor.' : (err.message || 'Erro interno.') });
});

module.exports = app; // export first (for tests)

/* ── START — only when run directly ────────────────────────── */
if (require.main === module) {
  const PORT = process.env.PORT || 3000;

  if (!process.env.JWT_SECRET) {
    if (IS_PROD) {
      console.error('FATAL: JWT_SECRET não definido em produção. Encerrando por segurança.');
      process.exit(1);
    }
    console.warn('⚠️  JWT_SECRET não definido. Use variável de ambiente em produção.');
  }

  // Auto-seed on first run
  try {
    const { getDb } = require('./db');
    const db    = getDb();
    const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    if (count === 0) {
      console.log('🌱 Banco vazio detectado. Executando seed automático...');
      require('./db/seed');
    }
  } catch (e) {
    console.error('Seed error:', e.message);
  }

  app.listen(PORT, () => {
    console.log(`\n🚀 BarberPro rodando em http://localhost:${PORT}`);
    console.log(`   API: http://localhost:${PORT}/api/health`);
    console.log(`   Modo: ${IS_PROD ? 'produção' : 'desenvolvimento'}\n`);
  });

  // Backup diário às 02h
  scheduleDailyBackup();

  // Lembrete diário: envia WhatsApp para todos os clientes com agendamento no dia (roda às 8h)
  scheduleDailyReminders();
}

function scheduleDailyBackup() {
  const BACKUP_DIR  = path.join(__dirname, 'backups');
  const DB_PATH     = path.join(__dirname, 'db', 'barberpro.db');
  const KEEP_DAYS   = 7;

  function runBackup() {
    try {
      if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);
      const date   = new Date().toISOString().slice(0, 10);
      const dest   = path.join(BACKUP_DIR, `barberpro_${date}.db`);
      fs.copyFileSync(DB_PATH, dest);
      console.log(`[Backup] Salvo em backups/barberpro_${date}.db`);

      // Remove backups mais antigos que KEEP_DAYS
      const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('barberpro_') && f.endsWith('.db'))
        .sort();
      while (files.length > KEEP_DAYS) {
        const old = files.shift();
        fs.unlinkSync(path.join(BACKUP_DIR, old));
        console.log(`[Backup] Removido backup antigo: ${old}`);
      }
    } catch (e) {
      console.error('[Backup] Erro:', e.message);
    }
  }

  function msUntil2am() {
    const now  = new Date();
    const next = new Date(now);
    next.setHours(2, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next - now;
  }

  function schedule() { setTimeout(() => { runBackup(); schedule(); }, msUntil2am()); }

  // Faz um backup imediato na inicialização (se o db existir)
  if (fs.existsSync(DB_PATH)) runBackup();

  schedule();
  console.log('   💾 Backup automático agendado para às 02:00 (últimos 7 dias)');
}

function scheduleDailyReminders() {
  function msUntil8am() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(8, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next - now;
  }

  async function sendDailyReminders() {
    const { getDb } = require('./db');
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);

    // Busca todas as barbearias com WhatsApp configurado
    const shops = db.prepare("SELECT DISTINCT barbershop_id FROM settings WHERE key='evolution_url'").all();

    for (const { barbershop_id: bsId } of shops) {
      try {
        const cfg = Object.fromEntries(
          db.prepare("SELECT key,value FROM settings WHERE barbershop_id=? AND key IN ('evolution_url','evolution_apikey','evolution_instance')")
            .all(bsId).map(r => [r.key, r.value])
        );
        if (!cfg.evolution_url || !cfg.evolution_apikey || !cfg.evolution_instance) continue;

        // Agendamentos de hoje com telefone do cliente
        const appts = db.prepare(`
          SELECT a.time, u.name, u.phone, s.name service_name, bu.name barber_name
          FROM appointments a
          JOIN clients cl ON cl.id = a.client_id
          JOIN users u    ON u.id  = cl.user_id
          JOIN services s ON s.id  = a.service_id
          JOIN barbers b  ON b.id  = a.barber_id
          JOIN users bu   ON bu.id = b.user_id
          WHERE a.barbershop_id=? AND a.date=? AND a.status NOT IN ('cancelled','no_show')
            AND u.phone IS NOT NULL AND u.phone != ''
          ORDER BY a.time ASC
        `).all(bsId, today);

        for (const appt of appts) {
          const phone = appt.phone.replace(/\D/g, '');
          if (phone.length < 10) continue;
          const text = `Olá ${appt.name}! 💈 Lembrando que hoje você tem horário na barbearia às ${appt.time} para ${appt.service_name} com ${appt.barber_name}. Te esperamos! ✂️`;
          try {
            await fetch(`${cfg.evolution_url.replace(/\/$/, '')}/message/sendText/${cfg.evolution_instance}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'apikey': cfg.evolution_apikey },
              body: JSON.stringify({ number: phone, text }),
            });
            await new Promise(r => setTimeout(r, 500));
          } catch (_) {}
        }
        if (appts.length > 0)
          console.log(`[Lembrete diário] Barbearia ${bsId}: ${appts.length} mensagem(ns) enviada(s) para ${today}`);
      } catch (e) {
        console.error(`[Lembrete diário] Erro barbearia ${bsId}:`, e.message);
      }
    }

    // Agenda próxima execução (amanhã às 8h)
    setTimeout(sendDailyReminders, msUntil8am());
  }

  // Primeira execução às 8h
  setTimeout(sendDailyReminders, msUntil8am());
  console.log(`   📅 Lembrete diário agendado para às 08:00\n`);
}
