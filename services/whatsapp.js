'use strict';
// Shared WhatsApp trigger logic (used by appointments, cashflow, etc.)

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

/**
 * Dispara uma automação WhatsApp se configurada e ativa.
 * @param {object} db - instância do SQLite
 * @param {number} bsId - barbershop_id
 * @param {string} triggerType - ex: 'after_appointment', 'reminder_24h', 'birthday'
 * @param {object} vars - { client_id, barber_name, service_name, date, time }
 */
async function triggerAutomation(db, bsId, triggerType, vars = {}) {
  try {
    // Carrega config
    const rows = db.prepare(
      "SELECT key, value FROM settings WHERE barbershop_id=? AND key IN ('evolution_url','evolution_apikey','evolution_instance')"
    ).all(bsId);
    const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]));
    if (!cfg.evolution_url || !cfg.evolution_apikey || !cfg.evolution_instance) return;

    // Busca automação ativa
    const automation = db.prepare(
      `SELECT a.*, t.template FROM automations a
       LEFT JOIN whatsapp_templates t ON a.template_id = t.id
       WHERE a.barbershop_id=? AND a.trigger_type=? AND a.active=1`
    ).get(bsId, triggerType);
    if (!automation?.template) return;

    // Busca cliente
    const user = db.prepare(
      `SELECT u.name, u.phone FROM clients c
       JOIN users u ON c.user_id = u.id
       WHERE c.id=? AND c.barbershop_id=?`
    ).get(vars.client_id, bsId);
    if (!user?.phone) return;

    const phone = user.phone.replace(/\D/g, '');
    if (phone.length < 10) return;

    const text = automation.template
      .replace(/\{\{nome\}\}/g,     user.name || '')
      .replace(/\{\{data\}\}/g,     vars.date || '')
      .replace(/\{\{horario\}\}/g,  vars.time || '')
      .replace(/\{\{barbeiro\}\}/g, vars.barber_name || '')
      .replace(/\{\{servico\}\}/g,  vars.service_name || '');

    const delayMs = (automation.delay_hours || 0) * 3_600_000;
    const send = () => evFetch(cfg.evolution_url, cfg.evolution_apikey,
      `/message/sendText/${cfg.evolution_instance}`, 'POST',
      { number: phone, text }).catch(() => {});

    if (delayMs > 0) setTimeout(send, delayMs);
    else await send();
  } catch {
    // Nunca bloqueia o fluxo principal
  }
}

module.exports = { triggerAutomation };
