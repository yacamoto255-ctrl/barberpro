'use strict';
/**
 * Teste de carga simples (sem dependências): simula N usuários simultâneos fazendo
 * identificação de ajudante, consulta do dashboard e histórico. Mede tempo de resposta,
 * erros, memória e CPU do processo servidor.
 * Uso: npm run loadtest -- 10,100,1000     (servidor e seed criados automaticamente em banco temporário)
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');

const levels = (process.argv[2] || '10,100,1000').split(',').map(Number);
const PORT = 3218, BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `logiponto-load-${Date.now()}.db`);
const env = { ...process.env, DB_PATH: DB, PORT: String(PORT), NODE_ENV: 'production', JWT_SECRET: 'load-test-secret-0123456789' };

const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];

(async () => {
  execFileSync(process.execPath, ['--no-warnings', 'scripts/seed.js'], { cwd: path.join(__dirname, '..'), env, stdio: 'ignore' });
  const srv = spawn(process.execPath, ['--no-warnings', 'server.js'], { cwd: path.join(__dirname, '..'), env: { ...env, LOADTEST_NO_LIMIT: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('rodando')) r(); }));
  const login = await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'gestor@logiponto.com', password: 'Gestor1234' }) })).json();
  const H = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' };
  const reqs = [
    () => fetch(`${BASE}/api/operations/identify`, { method: 'POST', headers: H, body: JSON.stringify({ barcode: '001' }) }),
    () => fetch(`${BASE}/api/dashboard?date_from=2026-01-01&date_to=2026-12-31`, { headers: H }),
    () => fetch(`${BASE}/api/history`, { headers: H }),
    () => fetch(`${BASE}/api/operations/open`, { headers: H }),
  ];
  const cpu0 = () => { try { return fs.readFileSync(`/proc/${srv.pid}/stat`, 'utf8').split(' ').slice(13, 15).reduce((a, b) => a + Number(b), 0); } catch { return null; } };
  const rss = () => { try { return Number(fs.readFileSync(`/proc/${srv.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1]) / 1024; } catch { return null; } };
  console.log('usuários | requisições | erros | média ms | p95 ms | máx ms | req/s | RSS MB | CPU s');
  for (const n of levels) {
    const times = []; let errors = 0;
    const c0 = cpu0(); const t0 = Date.now();
    await Promise.all(Array.from({ length: n }, async (_, i) => {
      for (let k = 0; k < 4; k++) {
        const s = performance.now();
        try { const r = await reqs[(i + k) % reqs.length](); await r.arrayBuffer(); if (!r.ok) errors++; } catch { errors++; }
        times.push(performance.now() - s);
      }
    }));
    const el = (Date.now() - t0) / 1000;
    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const c1 = cpu0();
    console.log(`${String(n).padStart(8)} | ${String(times.length).padStart(11)} | ${String(errors).padStart(5)} | ${avg.toFixed(0).padStart(8)} | ${pct(times, 0.95).toFixed(0).padStart(6)} | ${times[times.length - 1].toFixed(0).padStart(6)} | ${(times.length / el).toFixed(0).padStart(5)} | ${rss()?.toFixed(0).padStart(6)} | ${c0 !== null ? ((c1 - c0) / 100).toFixed(2) : '?'}`);
  }
  srv.kill();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(DB + s, { force: true });
})();
