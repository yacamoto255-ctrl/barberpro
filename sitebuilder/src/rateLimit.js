// src/rateLimit.js — limitador de requisições em memória (janela fixa por chave)
'use strict';

const buckets = new Map();

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * @param {object} o
 * @param {string} o.name     prefixo do bucket
 * @param {number} o.windowMs janela em ms
 * @param {number} o.max      máximo de requisições na janela
 * @param {string} o.message  mensagem de erro
 */
function rateLimit({ name, windowMs, max, message }) {
  return (req, res, next) => {
    if (!max || max <= 0) return next(); // desabilitado
    const key = `${name}:${clientIp(req)}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    if (b.count > max) {
      res.setHeader('Retry-After', Math.ceil((b.resetAt - now) / 1000));
      return res.status(429).json({ error: message || 'Muitas requisições. Tente novamente em instantes.' });
    }
    next();
  };
}

// Limpeza periódica para não crescer sem limite
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}, 60_000);
sweeper.unref();

function resetRateLimits() { buckets.clear(); }

module.exports = { rateLimit, resetRateLimits, clientIp };
