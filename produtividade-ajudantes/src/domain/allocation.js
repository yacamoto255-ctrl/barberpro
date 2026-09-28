'use strict';
/**
 * MOTOR DE RATEIO DE PRODUTIVIDADE (função pura, sem acesso a banco).
 *
 * "Peso de produtividade" = peso da carga ATRIBUÍDO ao ajudante pela regra.
 * NÃO significa que o ajudante carregou fisicamente aquele peso sozinho.
 *
 * Entrada:
 *   rule: { method, weight_factor, volume_factor }
 *   reference: { weight_kg, volumes }       -> peso/volumes de referência da execução
 *   participants: [{ helper_id, worked_seconds }] em ordem de entrada (1º a entrar primeiro)
 *
 * Métodos implementados:
 *   RATEIO_IGUAL        -> (peso × fator) ÷ nº de ajudantes. Centavos restantes vão para os últimos
 *                          (1.000 kg / 3 = 333,33 + 333,33 + 333,34).
 *   PROPORCIONAL_TEMPO  -> (peso × fator) proporcional ao tempo trabalhado de cada um.
 *   CREDITO_INTEGRAL    -> cada ajudante recebe (peso × fator) integral (ex.: apoio/supervisão).
 *
 * Para criar novos métodos (percentual por função, peso fixo por atividade, regra por operação),
 * basta adicionar um caso em computeShares() e o valor no CHECK da tabela productivity_rules.
 */

const METHODS = {
  RATEIO_IGUAL: 'Rateio igual entre os participantes',
  PROPORCIONAL_TEMPO: 'Proporcional ao tempo trabalhado',
  CREDITO_INTEGRAL: 'Crédito integral para cada participante',
};

/**
 * Distribui um total inteiro (em centésimos) segundo pesos, pelo método do maior resto.
 * Empates no resto favorecem os participantes que entraram por último — assim
 * o rateio igual fica 333,33 / 333,33 / 333,34, como definido pela operação.
 */
function distributeCents(totalCents, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || totalCents === 0) return weights.map(() => 0);
  const exact = weights.map(w => (totalCents * w) / sum);
  const floors = exact.map(Math.floor);
  let rest = totalCents - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => (b.frac - a.frac) || (b.i - a.i));
  for (let k = 0; k < order.length && rest > 0; k++, rest--) floors[order[k].i] += 1;
  return floors;
}

function computeShares(method, participants) {
  const n = participants.length;
  switch (method) {
    case 'RATEIO_IGUAL':
      return participants.map(() => 1);
    case 'PROPORCIONAL_TEMPO': {
      const total = participants.reduce((a, p) => a + Math.max(0, p.worked_seconds || 0), 0);
      // Sem tempo registrado (ex.: todos com 0s) => cai para rateio igual.
      if (total === 0) return participants.map(() => 1);
      return participants.map(p => Math.max(0, p.worked_seconds || 0));
    }
    case 'CREDITO_INTEGRAL':
      return participants.map(() => n); // cada um recebe o total (tratado abaixo)
    default:
      throw new Error(`Método de rateio desconhecido: ${method}`);
  }
}

function toCents(v) { return Math.round(Number(v) * 100); }

function allocate(rule, reference, participants) {
  if (!participants.length) return [];
  const weightFactor = rule.weight_factor ?? 1;
  const volumeFactor = rule.volume_factor ?? 1;
  const weightCents = toCents(reference.weight_kg * weightFactor);
  const volumeCents = toCents(reference.volumes * volumeFactor);
  const n = participants.length;

  let weights, volumes, shares;
  if (rule.method === 'CREDITO_INTEGRAL') {
    weights = participants.map(() => weightCents);
    volumes = participants.map(() => volumeCents);
    shares = participants.map(() => 1);
  } else {
    const w = computeShares(rule.method, participants);
    const sum = w.reduce((a, b) => a + b, 0);
    weights = distributeCents(weightCents, w);
    volumes = distributeCents(volumeCents, w);
    shares = w.map(x => (sum ? x / sum : 0));
  }

  return participants.map((p, i) => ({
    helper_id: p.helper_id,
    worked_seconds: p.worked_seconds || 0,
    participants_count: n,
    share: Math.round(shares[i] * 1e6) / 1e6,
    allocated_weight_kg: weights[i] / 100,
    allocated_volumes: volumes[i] / 100,
    method: rule.method,
  }));
}

module.exports = { allocate, distributeCents, METHODS };
