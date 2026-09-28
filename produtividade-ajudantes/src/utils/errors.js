'use strict';

class AppError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code || 'ERRO';
    this.details = details;
  }
}

const badRequest = (msg, details) => new AppError(400, msg, 'VALIDACAO', details);
const notFound = (msg) => new AppError(404, msg || 'Registro não encontrado.', 'NAO_ENCONTRADO');
const conflict = (msg, details, code) => new AppError(409, msg, code || 'CONFLITO', details);
const forbidden = (msg) => new AppError(403, msg || 'Acesso negado para o seu perfil.', 'PROIBIDO');

module.exports = { AppError, badRequest, notFound, conflict, forbidden };
