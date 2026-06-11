// routes/auth.js — Login, logout, me, change-password
'use strict';

const router  = require('express').Router();

/* ── Rate limiting simples para login (sem dependência externa) ── */
const _loginAttempts = new Map();
const LOGIN_RATE = { windowMs: 15 * 60 * 1000, max: 10 };
function loginRateLimit(req, res, next) {
  const ip  = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  let   rec = _loginAttempts.get(ip);
  if (!rec || now > rec.resetAt) rec = { count: 0, resetAt: now + LOGIN_RATE.windowMs };
  rec.count++;
  _loginAttempts.set(ip, rec);
  if (rec.count > LOGIN_RATE.max) {
    const retryAfter = Math.ceil((rec.resetAt - now) / 1000);
    res.setHeader('Retry-After', retryAfter);
    return res.status(429).json({ error: `Muitas tentativas de login. Tente novamente em ${Math.ceil(retryAfter/60)} minuto(s).` });
  }
  next();
}
const bcrypt  = require('bcryptjs');
const { body } = require('express-validator');
const { getDb }       = require('../db');
const { requireAuth, signToken } = require('../middleware/auth');
const { validate }    = require('../middleware/validate');

/* POST /api/auth/login */
router.post('/login',
  loginRateLimit,
  body('email').isEmail().withMessage('E-mail inválido.'),
  body('password').notEmpty().withMessage('Senha obrigatória.'),
  validate,
  (req, res) => {
    const db   = getDb();
    const { email, password } = req.body;

    // Busca o usuário independente de active para dar feedback específico
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    // Usuário existe mas está inativo — verifica se é por suspensão da barbearia
    if (!user.active) {
      if (user.barbershop_id) {
        const bs = db.prepare('SELECT active, name FROM barbershops WHERE id = ?').get(user.barbershop_id);
        if (bs && !bs.active) {
          return res.status(403).json({
            error: `A barbearia "${bs.name}" está suspensa. Entre em contato com o administrador do sistema.`,
            code: 'BARBERSHOP_SUSPENDED'
          });
        }
      }
      return res.status(403).json({ error: 'Sua conta está desativada. Entre em contato com o administrador.' });
    }

    const token = signToken(user);
    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, barbershop_id: user.barbershop_id ?? null }
    });
  }
);

/* GET /api/auth/me */
router.get('/me', requireAuth, (req, res) => {
  const db   = getDb();
  const user = db.prepare('SELECT id, name, email, role, phone, avatar FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  res.json(user);
});

/* POST /api/auth/change-password */
router.post('/change-password',
  requireAuth,
  body('current_password').notEmpty(),
  body('new_password').isLength({ min: 6 }).withMessage('Mínimo 6 caracteres.'),
  validate,
  (req, res) => {
    const db   = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

    if (!bcrypt.compareSync(req.body.current_password, user.password)) {
      return res.status(400).json({ error: 'Senha atual incorreta.' });
    }

    const hash = bcrypt.hashSync(req.body.new_password, 10);
    db.prepare("UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?")
      .run(hash, req.user.id);

    res.json({ message: 'Senha alterada com sucesso.' });
  }
);

/* PATCH /api/auth/profile — update own name/email/phone */
router.patch('/profile', requireAuth, (req, res) => {
  const db = getDb();
  const { name, email, phone } = req.body;
  if (!name && !email && !phone) return res.status(400).json({ error: 'Nenhum campo para atualizar.' });
  const fields = []; const vals = [];
  if (name)  { fields.push('name=?');  vals.push(name); }
  if (email) { fields.push('email=?'); vals.push(email); }
  if (phone) { fields.push('phone=?'); vals.push(phone); }
  vals.push(req.user.id);
  db.prepare(`UPDATE users SET ${fields.join(',')} WHERE id=?`).run(...vals);
  const updated = db.prepare('SELECT id,name,email,role,phone,avatar FROM users WHERE id=?').get(req.user.id);
  res.json(updated);
});

/* POST /api/auth/forgot-password  (demo — real app sends e-mail) */
router.post('/forgot-password',
  body('email').isEmail(),
  validate,
  (req, res) => {
    const db   = getDb();
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(req.body.email);
    // Security: always return success so we don't leak e-mail existence
    if (user) {
      // In production: generate token, store in DB, send e-mail
      console.log(`[forgot-password] Would send reset e-mail to ${req.body.email}`);
    }
    res.json({ message: 'Se o e-mail existir, você receberá um link de redefinição em breve.' });
  }
);

module.exports = router;
