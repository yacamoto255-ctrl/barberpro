'use strict';
const router = require('express').Router();
const { getDb } = require('../db');
const { requireAuth, requireRole, getBsId } = require('../middleware/auth');

// Templates WhatsApp
router.get('/templates', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  res.json(db.prepare('SELECT * FROM whatsapp_templates WHERE barbershop_id=? ORDER BY type').all(bsId));
});

router.put('/templates/:id', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const { name, template, active } = req.body;
  db.prepare('UPDATE whatsapp_templates SET name=?,template=?,active=? WHERE id=? AND barbershop_id=?')
    .run(name, template, active===false?0:1, req.params.id, bsId);
  res.json({ message: 'Template atualizado.' });
});

// Automações
router.get('/automations', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  res.json(db.prepare(`
    SELECT a.*, t.name template_name FROM automations a
    LEFT JOIN whatsapp_templates t ON a.template_id=t.id
    WHERE a.barbershop_id=? ORDER BY a.trigger_type`).all(bsId));
});

router.patch('/automations/:id', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const { active, delay_hours, template_id } = req.body;
  db.prepare('UPDATE automations SET active=?,delay_hours=?,template_id=? WHERE id=? AND barbershop_id=?')
    .run(active===false?0:1, delay_hours??0, template_id||null, req.params.id, bsId);
  res.json({ message: 'Automação atualizada.' });
});

// Campanhas
router.get('/campaigns', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  res.json(db.prepare('SELECT * FROM campaigns WHERE barbershop_id=? ORDER BY created_at DESC LIMIT 50').all(bsId));
});

router.post('/campaigns', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const { name, channel, target, message, scheduled_at } = req.body;
  if (!name || !message) return res.status(400).json({ error: 'name e message são obrigatórios.' });
  const r = db.prepare('INSERT INTO campaigns (barbershop_id,name,channel,target,message,scheduled_at) VALUES (?,?,?,?,?,?)')
    .run(bsId, name, channel||'whatsapp', target||'all', message, scheduled_at||null);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.patch('/campaigns/:id', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const { name, channel, target, message, status, scheduled_at } = req.body;
  db.prepare('UPDATE campaigns SET name=?,channel=?,target=?,message=?,status=?,scheduled_at=? WHERE id=? AND barbershop_id=?')
    .run(name, channel||'whatsapp', target||'all', message, status||'draft', scheduled_at||null, req.params.id, bsId);
  res.json({ message: 'Campanha atualizada.' });
});

router.post('/campaigns/:id/send', requireAuth, requireRole('owner'), async (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id=? AND barbershop_id=?').get(req.params.id, bsId);
  if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada.' });

  // Busca clientes com telefone via JOIN users (clients não tem barbershop_id direto)
  let sql = `SELECT u.name, u.phone, c.loyalty_points, c.last_visit, u.birth_date
    FROM clients c JOIN users u ON c.user_id = u.id
    WHERE u.barbershop_id=? AND u.phone IS NOT NULL AND u.phone != ''`;
  const p = [bsId];
  if (campaign.target === 'inactive')
    sql += ' AND (c.last_visit IS NULL OR julianday("now") - julianday(c.last_visit) > 30)';
  else if (campaign.target === 'vip')
    sql += ' AND c.loyalty_points > 500';
  else if (campaign.target === 'birthday')
    sql += ` AND strftime('%m-%d', u.birth_date) = strftime('%m-%d', 'now')`;

  const clients = db.prepare(sql).all(...p);

  // Tenta enviar via WhatsApp se configurado
  const waCfg = Object.fromEntries(
    db.prepare("SELECT key,value FROM settings WHERE barbershop_id=? AND key IN ('evolution_url','evolution_apikey','evolution_instance')").all(bsId).map(r=>[r.key,r.value])
  );
  const hasWA = waCfg.evolution_url && waCfg.evolution_apikey && waCfg.evolution_instance;

  let sent = 0, failed = 0;
  for (const c of clients) {
    const phone = (c.phone||'').replace(/\D/g,'');
    if (phone.length < 10) { failed++; continue; }
    const text = campaign.message
      .replace(/\{\{nome\}\}/g, c.name||'')
      .replace(/\{\{data\}\}/g, new Date().toLocaleDateString('pt-BR'))
      .replace(/\{\{horario\}\}/g,'').replace(/\{\{barbeiro\}\}/g,'').replace(/\{\{servico\}\}/g,'');
    if (hasWA) {
      try {
        const r = await fetch(`${waCfg.evolution_url.replace(/\/$/,'')}/message/sendText/${waCfg.evolution_instance}`, {
          method: 'POST',
          headers: { 'Content-Type':'application/json', 'apikey': waCfg.evolution_apikey },
          body: JSON.stringify({ number: phone, text }),
        });
        if (r.ok) sent++; else failed++;
      } catch { failed++; }
      await new Promise(r => setTimeout(r, 300));
    } else {
      sent++; // conta como "enviado" mesmo sem WA (campanha salva)
    }
  }

  db.prepare("UPDATE campaigns SET status='sent', sent_at=datetime('now'), sent_count=? WHERE id=?").run(sent, campaign.id);
  res.json({ message: `Campanha enviada para ${sent} contatos.`, sent, sent_count: sent, failed, total: clients.length, whatsapp: hasWA });
});

router.delete('/campaigns/:id', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  db.prepare('DELETE FROM campaigns WHERE id=? AND barbershop_id=?').run(req.params.id, bsId);
  res.json({ message: 'Campanha excluída.' });
});

// Público-alvo preview — corrigido: JOIN via users.barbershop_id
router.get('/audience-count', requireAuth, requireRole('owner'), (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const { target } = req.query;
  let sql = `SELECT COUNT(*) n FROM clients c JOIN users u ON c.user_id=u.id
    WHERE u.barbershop_id=? AND u.phone IS NOT NULL AND u.phone != ''`;
  const p = [bsId];
  if (target === 'inactive') sql += ' AND (c.last_visit IS NULL OR julianday("now") - julianday(c.last_visit) > 30)';
  else if (target === 'vip')  sql += ' AND c.loyalty_points > 500';
  else if (target === 'birthday') sql += ` AND strftime('%m-%d', u.birth_date) = strftime('%m-%d', 'now')`;
  res.json({ count: db.prepare(sql).get(...p).n });
});

module.exports = router;
