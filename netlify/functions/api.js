// netlify/functions/api.js
// Envolve o Express app como uma Netlify Function serverless
'use strict';

const serverless = require('serverless-http');
const app        = require('../../server');

// O banco SQLite fica em /tmp no ambiente serverless (Netlify)
// Variável DB_PATH é definida via Netlify Environment Variables
// Se não definida, usa /tmp/barberpro.db automaticamente
if (!process.env.DB_PATH) {
  process.env.DB_PATH = '/tmp/barberpro.db';
}

module.exports.handler = serverless(app);
