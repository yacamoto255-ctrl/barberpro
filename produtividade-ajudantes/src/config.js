'use strict';
// Configuração centralizada. Todas as variáveis vêm do ambiente (.env opcional).
const path = require('path');

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';
const IS_TEST = NODE_ENV === 'test';

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (IS_PROD) {
    throw new Error('JWT_SECRET é obrigatório em produção.');
  }
  jwtSecret = 'dev-only-secret-troque-em-producao';
}

module.exports = {
  NODE_ENV,
  IS_PROD,
  IS_TEST,
  PORT: Number(process.env.PORT) || 3100,
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'logiponto.db'),
  JWT_SECRET: jwtSecret,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '10h', // cobre um turno
  // Fuso horário da operação. Todos os horários são gravados como hora local deste fuso.
  APP_TZ: process.env.APP_TZ || 'America/Sao_Paulo',
  // Chave para a API de integração com o TMS/ERP (desabilitada se vazia).
  INTEGRATION_API_KEY: process.env.INTEGRATION_API_KEY || '',
  // Operador pode cancelar o próprio apontamento até N minutos após o início.
  OPERATOR_CANCEL_WINDOW_MIN: Number(process.env.OPERATOR_CANCEL_WINDOW_MIN) || 10,
  // Tempo mínimo apontado para calcular kg/hora e volumes/hora. Abaixo disso a taxa
  // fica vazia, porque poucos segundos de apontamento geram valores absurdos.
  MIN_SECONDS_FOR_RATE: Number(process.env.MIN_SECONDS_FOR_RATE) || 300,
  LOGIN_MAX_ATTEMPTS: 5,
  LOGIN_LOCK_MINUTES: 15,
};
