// scripts/reset-password.js — redefine a senha de um usuário pelo terminal do servidor
// (para quando o único administrador esquece a senha e não há WhatsApp configurado).
//   npm run reset-password -- email@exemplo.com NovaSenha123
'use strict';

const emitWarning = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w).includes('SQLite is an experimental') ? undefined : emitWarning.call(process, w, ...a));
try { process.loadEnvFile?.(); } catch (_) { /* sem .env */ }

const { getDb, getDbPath, closeDb } = require('../src/db');
const { hashPassword } = require('../src/auth');
const { Checker } = require('../src/validators');

const [email, password] = process.argv.slice(2);
const c = new Checker({ email, password });
c.email('email', 'E-mail', { required: true });
c.password('password', 'Nova senha');
try {
  c.done();
} catch (e) {
  console.error(`Erro: ${e.message}\nUso: npm run reset-password -- email@exemplo.com NovaSenha123`);
  process.exit(1);
}

const db = getDb();
const user = db.prepare('SELECT id, name, role FROM users WHERE email = ?').get(email);
if (!user) {
  console.error(`Nenhum usuário com o e-mail ${email} em ${getDbPath()}.`);
  process.exit(1);
}
db.prepare(`UPDATE users SET password_hash = ?, password_changed_at = ?, failed_logins = 0, locked_until = NULL, active = 1,
  updated_at = datetime('now') WHERE id = ?`).run(hashPassword(password), Math.floor(Date.now() / 1000), user.id);
db.prepare(`INSERT INTO audit_logs (user_id, user_email, action, entity, entity_id, details, ip)
  VALUES (?, ?, 'auth.password_reset_cli', 'user', ?, 'redefinida pelo terminal', 'local')`).run(user.id, email, user.id);
closeDb();
console.log(`Senha de ${user.name} (${user.role}) redefinida. Sessões antigas foram encerradas e a conta foi desbloqueada.`);
