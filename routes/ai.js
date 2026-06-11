'use strict';
const router = require('express').Router();
const { getDb } = require('../db');
const { requireAuth, requireRole, getBsId } = require('../middleware/auth');

/* ── helpers ─────────────────────────────────────────────────── */
async function callAnthropic(apiKey, systemPrompt, userPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

function getAnthropicKey(db, bsId) {
  const row = db.prepare("SELECT value FROM settings WHERE barbershop_id=? AND key='anthropic_key'").get(bsId);
  return row?.value || null;
}

/* ── /analyze ────────────────────────────────────────────────── */
router.post('/analyze', requireAuth, requireRole('owner'), async (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const apiKey = getAnthropicKey(db, bsId);
  const context = req.body.context || '';

  if (apiKey) {
    try {
      const text = await callAnthropic(apiKey,
        'Você é um consultor especialista em barbearias brasileiras. Responda em português, de forma direta e prática.',
        `Analise os dados desta barbearia e forneça 5 insights acionáveis:\n\n${context}`
      );
      return res.json({ insight: text, real: true });
    } catch (e) {
      // cai no stub se a chave for inválida
    }
  }

  res.json({
    insight:
      `📊 Análise do negócio:\n\n${context}\n\n` +
      `• Foco em dias de baixo movimento para promoções relâmpago\n` +
      `• Clientes recorrentes representam a maior parte da receita — priorize fidelização\n` +
      `• Avalie abrir horários extras nos horários de pico identificados\n` +
      `• Implemente programa de indicação: cada cliente traz um amigo ganha desconto\n` +
      `• Combos de serviços (corte + barba) aumentam o ticket médio em até 40%\n\n` +
      `⚡ Para análises personalizadas com IA real, configure sua chave Anthropic nas Configurações.`,
  });
});

/* ── /content ────────────────────────────────────────────────── */
router.post('/content', requireAuth, requireRole('owner'), async (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const apiKey = getAnthropicKey(db, bsId);
  const { type, context } = req.body;

  if (apiKey) {
    try {
      const text = await callAnthropic(apiKey,
        'Você cria mensagens de marketing para barbearias brasileiras. Respostas curtas, diretas, em português informal.',
        `Crie uma mensagem de WhatsApp para: tipo=${type}, contexto=${context || 'sem contexto adicional'}. Use {{nome}} para personalizar.`
      );
      return res.json({ content: text, real: true });
    } catch (e) {}
  }

  const samples = {
    promo:   '🔥 Ei {{nome}}! Promoção especial hoje! Agende agora e ganhe 10% de desconto. Vagas limitadas — responda essa mensagem!',
    recover: '😊 Oi {{nome}}, sentimos sua falta! Faz um tempo que não te vemos por aqui. Que tal agendar um horário essa semana? Temos horários disponíveis para você!',
    birth:   '🎂 Feliz aniversário, {{nome}}! 🎉 Para comemorar com você, preparamos um presente especial: 20% de desconto no seu próximo serviço. Válido este mês!',
    review:  '⭐ Oi {{nome}}! Esperamos que tenha gostado do atendimento. Sua opinião é muito importante para nós — pode nos avaliar com uma estrelinhas? Obrigado!',
  };
  res.json({ content: samples[type] || `Olá {{nome}}! ${context || 'Temos uma novidade especial para você. Entre em contato!'}\n\n⚡ Configure sua chave Anthropic para conteúdo 100% personalizado.` });
});

/* ── /campaign — gerador de campanha completo ────────────────── */
router.post('/campaign', requireAuth, requireRole('owner'), async (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const apiKey = getAnthropicKey(db, bsId);
  const { objective, tone, target, context, bsName, stats } = req.body;

  const toneMap = {
    amigavel: 'amigável e descontraído',
    urgente:  'urgente e persuasivo',
    formal:   'profissional e elegante',
    festivo:  'animado e comemorativo',
  };
  const targetMap = {
    all:      'todos os clientes',
    inactive: 'clientes inativos há mais de 30 dias',
    vip:      'clientes VIP com mais de 500 pontos',
    birthday: 'clientes aniversariantes',
  };
  const objectiveMap = {
    reconquistar: 'reconquistar clientes que não vêm há algum tempo',
    promocao:     'divulgar uma promoção ou desconto',
    fidelizar:    'fidelizar e recompensar clientes frequentes',
    novidade:     'apresentar um novo serviço ou produto',
    aniversario:  'parabenizar aniversariantes com oferta especial',
    evento:       'convidar para um evento ou data especial',
  };

  const toneLabel    = toneMap[tone]     || tone     || 'amigável';
  const targetLabel  = targetMap[target] || target   || 'todos os clientes';
  const objectLabel  = objectiveMap[objective] || objective || 'engajar clientes';

  if (apiKey) {
    try {
      const prompt =
        `Você é um especialista em marketing para barbearias brasileiras.\n` +
        `Barbearia: ${bsName || 'sem nome'}\n` +
        `Dados: ${stats || 'não informado'}\n` +
        `Objetivo: ${objectLabel}\n` +
        `Tom: ${toneLabel}\n` +
        `Público: ${targetLabel}\n` +
        `Contexto extra: ${context || 'nenhum'}\n\n` +
        `Crie uma campanha de WhatsApp. Responda SOMENTE em JSON válido neste formato:\n` +
        `{"name":"<nome da campanha>","message":"<mensagem com {{nome}}>","subject":"<assunto curto para e-mail>","tip":"<dica de 1 frase sobre este tipo de campanha>"}\n` +
        `A mensagem deve ter no máximo 300 caracteres, usar emojis, ser em português BR informal e incluir {{nome}}.`;

      const text = await callAnthropic(apiKey,
        'Você é um especialista em marketing para barbearias. Responda SOMENTE com JSON válido, sem markdown.',
        prompt
      );
      const clean = text.replace(/```json|```/g,'').trim();
      const parsed = JSON.parse(clean);
      return res.json({ ...parsed, real: true });
    } catch (e) {
      // cai no stub
    }
  }

  // Stub inteligente por objetivo
  const stubs = {
    reconquistar: {
      name:    `Reconquista ${new Date().toLocaleDateString('pt-BR',{month:'long'})}`,
      message: `😊 Oi {{nome}}! Sentimos sua falta na ${bsName||'barbearia'}! Faz tempo que não te vemos. Que tal agendar essa semana? Temos horários disponíveis e um mimo especial esperando por você! 🎁`,
      subject: `${bsName||'Barbearia'} sente sua falta!`,
      tip:     'Clientes inativos têm 3x mais chance de retornar com uma mensagem personalizada.',
    },
    promocao: {
      name:    `Promoção ${context || new Date().toLocaleDateString('pt-BR',{month:'long'})}`,
      message: `🔥 Oi {{nome}}! Aproveite: ${context||'promoção especial'} só essa semana na ${bsName||'barbearia'}! Vagas limitadas — responda agora para garantir o seu horário. ✂️`,
      subject: `Promoção exclusiva para você!`,
      tip:     'Promoções com prazo curto (3-5 dias) geram 40% mais conversão.',
    },
    fidelizar: {
      name:    `Fidelidade VIP ${new Date().toLocaleDateString('pt-BR',{month:'long'})}`,
      message: `⭐ {{nome}}, você é um dos nossos clientes especiais! Seu nível VIP na ${bsName||'barbearia'} te garante benefícios exclusivos. Venha aproveitar! 💈`,
      subject: `Você é VIP na ${bsName||'barbearia'}!`,
      tip:     'Clientes VIP gastam 5x mais quando reconhecidos por sua fidelidade.',
    },
    novidade: {
      name:    `Novidade: ${context||'Novo Serviço'}`,
      message: `🆕 Oi {{nome}}! Temos uma novidade incrível na ${bsName||'barbearia'}: ${context||'novo serviço'}! Seja dos primeiros a experimentar com condição especial de lançamento. 🚀`,
      subject: `Novidade exclusiva na ${bsName||'barbearia'}!`,
      tip:     'Lançamentos com early-bird geram expectativa e engajamento imediato.',
    },
    aniversario: {
      name:    'Parabéns Aniversariantes',
      message: `🎂 Parabéns, {{nome}}! 🎉 A equipe da ${bsName||'barbearia'} deseja um feliz aniversário! Preparamos um presente especial: 20% de desconto válido esse mês. Você merece! 🥳`,
      subject: `Feliz aniversário, {{nome}}!`,
      tip:     'Campanhas de aniversário têm taxa de abertura 5x maior que campanhas comuns.',
    },
    evento: {
      name:    `Evento Especial — ${context||'Em Breve'}`,
      message: `🎉 {{nome}}, você está convidado! ${context||'Temos um evento especial'} na ${bsName||'barbearia'}. Reserve seu horário com antecedência — vagas limitadas! 📅`,
      subject: `Convite exclusivo para você!`,
      tip:     'Eventos criam senso de comunidade e aumentam a frequência de visitas.',
    },
  };

  const stub = stubs[objective] || {
    name:    `Campanha ${new Date().toLocaleDateString('pt-BR',{month:'long'})}`,
    message: `Oi {{nome}}! ${context||'Temos algo especial para você'} na ${bsName||'barbearia'}. Entre em contato! 😊`,
    subject: 'Mensagem especial para você!',
    tip:     'Personalize a mensagem com o contexto da sua barbearia para melhores resultados.',
  };

  res.json({ ...stub, real: false });
});

/* ── /campaign/variations — gera variações de uma mensagem ─────── */
router.post('/campaign/variations', requireAuth, requireRole('owner'), async (req, res) => {
  const db = getDb(); const bsId = getBsId(req);
  const apiKey = getAnthropicKey(db, bsId);
  const { message, count = 3 } = req.body;
  if (!message) return res.status(400).json({ error: 'message é obrigatório.' });

  if (apiKey) {
    try {
      const text = await callAnthropic(apiKey,
        'Crie variações de mensagens de WhatsApp para barbearias. Responda SOMENTE com JSON válido.',
        `Crie ${count} variações desta mensagem para WhatsApp, mantendo o objetivo mas com texto diferente. Use {{nome}}.\nOriginal: "${message}"\nResposta: {"variations":["variação 1","variação 2","variação 3"]}`
      );
      const clean = text.replace(/```json|```/g,'').trim();
      const parsed = JSON.parse(clean);
      return res.json(parsed);
    } catch (e) {}
  }

  // Stub: pequenas variações
  const variations = [
    message.replace('!','! 🔥').replace('{{nome}}','{{nome}}, tudo bem?'),
    `👋 ${message}`,
    message + '\n\nResponda essa mensagem para garantir seu horário! ✂️',
  ].slice(0, count);
  res.json({ variations, real: false });
});

module.exports = router;
