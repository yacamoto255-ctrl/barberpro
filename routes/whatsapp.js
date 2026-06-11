'use strict';
const router = require('express').Router();
const { getDb } = require('../db');
const { requireAuth, requireRole, getBsId } = require('../middleware/auth');

/* ── helpers ─────────────────────────────────────────────────── */
function getCfg(db, bsId) {
  const rows = db.prepare(
    "SELECT key, value FROM settings WHERE barbershop_id=? AND key IN ('evolution_url','evolution_apikey','evolution_instance')"
  ).all(bsId);
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

async function evFetch(url, apikey, path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'apikey': apikey },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${url.replace(/\/$/, '')}${path}`, opts);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function fmtPhone(phone) {
  return (phone || '').replace(/\D/g, '');
}

/* ── config ──────────────────────────────────────────────────── */
router.get('/config', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const cfg = getCfg(db, bsId);
  if (cfg.evolution_apikey?.length > 4)
    cfg.evolution_apikey = cfg.evolution_apikey.slice(0, 4) + '****';
  res.json(cfg);
});

router.put('/config', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const { evolution_url, evolution_apikey, evolution_instance } = req.body;
  if (!evolution_url || !evolution_apikey || !evolution_instance)
    return res.status(400).json({ error: 'URL, chave API e nome da instância são obrigatórios.' });
  const upsert = db.prepare("INSERT OR REPLACE INTO settings (barbershop_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))");
  db.exec('BEGIN');
  try {
    upsert.run(bsId, 'evolution_url',      evolution_url.trim().replace(/\/$/, ''));
    // Only overwrite apikey if not masked
    if (!evolution_apikey.includes('****'))
      upsert.run(bsId, 'evolution_apikey', evolution_apikey.trim());
    upsert.run(bsId, 'evolution_instance', evolution_instance.trim());
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json({ message: 'Configuração salva.' });
});

/* ── status ──────────────────────────────────────────────────── */
router.get('/status', requireAuth, requireRole('owner'), async (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const cfg = getCfg(db, bsId);
  if (!cfg.evolution_url || !cfg.evolution_apikey || !cfg.evolution_instance)
    return res.json({ state: 'not_configured' });
  try {
    const data = await evFetch(cfg.evolution_url, cfg.evolution_apikey,
      `/instance/connectionState/${cfg.evolution_instance}`);
    const state = data?.instance?.state || data?.state || 'unknown';
    res.json({ state, instance: cfg.evolution_instance });
  } catch (e) {
    res.json({ state: 'error', error: e.message });
  }
});

/* ── connect (create instance + get QR) ──────────────────────── */
router.post('/connect', requireAuth, requireRole('owner'), async (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const cfg = getCfg(db, bsId);
  if (!cfg.evolution_url || !cfg.evolution_apikey || !cfg.evolution_instance)
    return res.status(400).json({ error: 'Configure a Evolution API primeiro.' });
  try {
    const base = cfg.evolution_url.replace(/\/$/, '');
    const headers = { 'Content-Type': 'application/json', 'apikey': cfg.evolution_apikey };

    // 1. Tenta criar a instância (ignora erro 409 = já existe)
    await fetch(`${base}/instance/create`, {
      method: 'POST', headers,
      body: JSON.stringify({ instanceName: cfg.evolution_instance, qrcode: true, integration: 'WHATSAPP-BAILEYS' }),
    }).catch(() => {});

    // 2. Pequeno delay para a instância inicializar
    await new Promise(r => setTimeout(r, 1500));

    // 3. Obtém QR code
    const connRes = await fetch(`${base}/instance/connect/${cfg.evolution_instance}`, { headers });
    const data = await connRes.json();

    // 4. Se ainda "not found", tenta fetch sem versão (algumas instâncias Evolution v1)
    if (data?.code === 404 || data?.message === 'Application not found') {
      // Tenta endpoint alternativo do Evolution API v1
      const alt = await fetch(`${base}/instance/qrcode/${cfg.evolution_instance}`, { headers })
        .then(r => r.json()).catch(() => null);
      if (alt && !alt.error) return res.json(alt);
      return res.status(404).json({
        error: `Instância "${cfg.evolution_instance}" não encontrada. Verifique se a Evolution API está acessível e a API Key está correta.`,
        detail: data,
      });
    }

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: `Erro ao conectar: ${e.message}` });
  }
});

/* ── disconnect ──────────────────────────────────────────────── */
router.delete('/disconnect', requireAuth, requireRole('owner'), async (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const cfg = getCfg(db, bsId);
  if (!cfg.evolution_url || !cfg.evolution_apikey || !cfg.evolution_instance)
    return res.status(400).json({ error: 'Não configurado.' });
  try {
    await evFetch(cfg.evolution_url, cfg.evolution_apikey,
      `/instance/logout/${cfg.evolution_instance}`, 'DELETE');
    res.json({ message: 'WhatsApp desconectado.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── send single message ─────────────────────────────────────── */
router.post('/send', requireAuth, requireRole('owner'), async (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const cfg = getCfg(db, bsId);
  if (!cfg.evolution_url || !cfg.evolution_apikey || !cfg.evolution_instance)
    return res.status(400).json({ error: 'WhatsApp não configurado.' });
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'phone e message são obrigatórios.' });
  try {
    const data = await evFetch(cfg.evolution_url, cfg.evolution_apikey,
      `/message/sendText/${cfg.evolution_instance}`, 'POST',
      { number: fmtPhone(phone), text: message });
    res.json({ message: 'Mensagem enviada.', data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── send campaign ───────────────────────────────────────────── */
router.post('/send-campaign/:id', requireAuth, requireRole('owner'), async (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const cfg = getCfg(db, bsId);
  if (!cfg.evolution_url || !cfg.evolution_apikey || !cfg.evolution_instance)
    return res.status(400).json({ error: 'WhatsApp não configurado.' });

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id=? AND barbershop_id=?')
    .get(req.params.id, bsId);
  if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada.' });

  // Busca destinatários com telefone — JOIN via users.barbershop_id (clients não tem barbershop_id)
  let sql = `SELECT u.phone, u.name, u.birth_date, c.last_visit, c.loyalty_points
    FROM clients c JOIN users u ON c.user_id=u.id
    WHERE u.barbershop_id=? AND u.phone IS NOT NULL AND u.phone != ''`;
  const p = [bsId];
  if (campaign.target === 'inactive')
    sql += ' AND (c.last_visit IS NULL OR julianday("now") - julianday(c.last_visit) > 30)';
  else if (campaign.target === 'vip')
    sql += ' AND c.loyalty_points > 500';
  else if (campaign.target === 'birthday')
    sql += ` AND strftime('%m-%d', u.birth_date) = strftime('%m-%d', 'now')`;
  const clients = db.prepare(sql).all(...p);

  let sent = 0, failed = 0;
  for (const c of clients) {
    const phone = fmtPhone(c.phone);
    if (phone.length < 10) { failed++; continue; }
    const text = campaign.message
      .replace(/\{\{nome\}\}/g, c.name || '')
      .replace(/\{\{data\}\}/g,    new Date().toLocaleDateString('pt-BR'))
      .replace(/\{\{horario\}\}/g, '')
      .replace(/\{\{barbeiro\}\}/g,'')
      .replace(/\{\{servico\}\}/g, '');
    try {
      await evFetch(cfg.evolution_url, cfg.evolution_apikey,
        `/message/sendText/${cfg.evolution_instance}`, 'POST',
        { number: phone, text });
      sent++;
    } catch { failed++; }
    await new Promise(r => setTimeout(r, 300));
  }
  db.prepare("UPDATE campaigns SET status='sent', sent_at=datetime('now'), sent_count=? WHERE id=?")
    .run(sent, campaign.id);
  res.json({ sent, failed, total: clients.length });
});

/* ── trigger automation (called internally) ──────────────────── */
router.post('/trigger', requireAuth, async (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const cfg = getCfg(db, bsId);
  if (!cfg.evolution_url || !cfg.evolution_apikey || !cfg.evolution_instance)
    return res.json({ skipped: true, reason: 'not_configured' });

  const { trigger_type, client_id, barber_name, service_name, date, time } = req.body;
  const automation = db.prepare(
    `SELECT a.*, t.template FROM automations a
     LEFT JOIN whatsapp_templates t ON a.template_id=t.id
     WHERE a.barbershop_id=? AND a.trigger_type=? AND a.active=1`
  ).get(bsId, trigger_type);
  if (!automation?.template) return res.json({ skipped: true, reason: 'no_active_automation' });

  const user = db.prepare(
    'SELECT u.name, u.phone FROM clients c JOIN users u ON c.user_id=u.id WHERE c.id=? AND c.barbershop_id=?'
  ).get(client_id, bsId);
  if (!user?.phone) return res.json({ skipped: true, reason: 'no_phone' });

  const phone = fmtPhone(user.phone);
  if (phone.length < 10) return res.json({ skipped: true, reason: 'invalid_phone' });

  const text = automation.template
    .replace(/\{\{nome\}\}/g,     user.name || '')
    .replace(/\{\{data\}\}/g,     date || '')
    .replace(/\{\{horario\}\}/g,  time || '')
    .replace(/\{\{barbeiro\}\}/g, barber_name || '')
    .replace(/\{\{servico\}\}/g,  service_name || '');

  const delayMs = (automation.delay_hours || 0) * 3600 * 1000;
  if (delayMs > 0) {
    setTimeout(async () => {
      await evFetch(cfg.evolution_url, cfg.evolution_apikey,
        `/message/sendText/${cfg.evolution_instance}`, 'POST',
        { number: phone, text }).catch(() => {});
    }, delayMs);
    return res.json({ queued: true, delay_hours: automation.delay_hours });
  }

  try {
    await evFetch(cfg.evolution_url, cfg.evolution_apikey,
      `/message/sendText/${cfg.evolution_instance}`, 'POST', { number: phone, text });
    res.json({ sent: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── reminders manual dispatch ───────────────────────────────── */
router.post('/reminders', requireAuth, requireRole('owner'), async (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const cfg = getCfg(db, bsId);
  if (!cfg.evolution_url || !cfg.evolution_apikey || !cfg.evolution_instance)
    return res.status(400).json({ error: 'WhatsApp não configurado. Configure a Evolution API primeiro.' });

  const date = req.body.date || new Date().toISOString().slice(0, 10);

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
  `).all(bsId, date);

  if (!appts.length) return res.json({ sent: 0, message: 'Nenhum agendamento com telefone para este dia.' });

  let sent = 0, failed = 0;
  for (const appt of appts) {
    const phone = appt.phone.replace(/\D/g, '');
    if (phone.length < 10) { failed++; continue; }
    const text = `Olá ${appt.name}! 💈 Lembrando que hoje você tem horário na barbearia às ${appt.time} para ${appt.service_name} com ${appt.barber_name}. Te esperamos! ✂️`;
    try {
      const r = await fetch(`${cfg.evolution_url.replace(/\/$/, '')}/message/sendText/${cfg.evolution_instance}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': cfg.evolution_apikey },
        body: JSON.stringify({ number: phone, text }),
      });
      if (r.ok) sent++; else failed++;
    } catch { failed++; }
    await new Promise(r => setTimeout(r, 400));
  }
  res.json({ sent, failed, total: appts.length, date });
});

module.exports = router;
