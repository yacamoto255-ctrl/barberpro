'use strict';
const { AppError } = require('../utils/errors');
const { IS_TEST } = require('../config');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido.', code: 'JSON_INVALIDO' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Conteúdo muito grande.', code: 'MUITO_GRANDE' });
  }
  // Violações de UNIQUE do SQLite viram 409 com mensagem amigável
  const msg = String(err.message || '');
  if (msg.includes('UNIQUE constraint failed')) {
    return res.status(409).json({ error: 'Registro duplicado: já existe um cadastro com esse valor.', code: 'DUPLICADO' });
  }
  if (msg.includes('NOT NULL constraint failed') || msg.includes('CHECK constraint failed')) {
    return res.status(400).json({ error: 'Dados inválidos: campo obrigatório ausente ou valor fora do permitido.', code: 'VALIDACAO' });
  }
  if (msg.includes('FOREIGN KEY constraint failed')) {
    return res.status(400).json({ error: 'Referência inválida (registro relacionado não existe).', code: 'REFERENCIA' });
  }
  if (!IS_TEST || process.env.DEBUG_ERR) console.error('[ERRO]', req.method, req.originalUrl, err);
  res.status(500).json({ error: 'Erro interno. Tente novamente.', code: 'ERRO_INTERNO' });
}

module.exports = { errorHandler };
