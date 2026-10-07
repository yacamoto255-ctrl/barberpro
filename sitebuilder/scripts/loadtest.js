// scripts/loadtest.js — teste de carga: sobe o servidor num banco temporário e mede
// tempo de resposta, vazão, erros, memória (RSS) e CPU do processo do servidor.
//   npm run loadtest                 (10, 100, 1000 e 10000 conexões simultâneas)
//   npm run loadtest -- 10 100       (só os níveis escolhidos)
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const autocannon = require('autocannon');

const LEVELS = process.argv.slice(2).map(Number).filter(Boolean);
const levels = LEVELS.length ? LEVELS : [10, 100, 1000, 10000];
const PORT = 3990;
const BASE = `http://127.0.0.1:${PORT}`;
const DURATION = Number(process.env.LOAD_DURATION) || 10;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitebuilder-load-'));

function procStats(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const rssKb = Number((status.match(/VmRSS:\s+(\d+)/) || [])[1] || 0);
    return { cpuTicks: Number(stat[11]) + Number(stat[12]), rssMb: rssKb / 1024 };
  } catch {
    return null; // fora do Linux não há /proc
  }
}

async function api(method, p, body, token) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${JSON.stringify(data)}`);
  return data;
}

function run(opts) {
  return new Promise((resolve, reject) => {
    const inst = autocannon({ duration: DURATION, timeout: 30, ...opts }, (err, res) => (err ? reject(err) : resolve(res)));
    autocannon.track(inst, { renderProgressBar: false, renderResultsTable: false, renderLatencyTable: false });
  });
}

(async () => {
  const server = fork(path.join(__dirname, '..', 'server.js'), [], {
    env: {
      ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, 'load.db'), BACKUP_DIR: path.join(dir, 'b'),
      BCRYPT_ROUNDS: '4', LOG_REQUESTS: '0', BACKUP_INTERVAL_HOURS: '0',
      RATE_LIMIT_PUBLIC_READ: '0', RATE_LIMIT_PUBLIC_WRITE: '0', RATE_LIMIT_LOGIN: '0',
    },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${BASE}/api/health`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }

  // Dados: um site publicado com 3 serviços, 3 profissionais e agenda aberta
  const { token } = await api('POST', '/api/auth/setup', { name: 'Carga', email: 'carga@teste.com', password: 'Senha123' });
  const { site } = await api('POST', '/api/sites', { name: 'Barbearia Carga', category: 'barbearia', published: true, min_notice_min: 0, whatsapp: '11987654321' }, token);
  await api('PUT', `/api/sites/${site.id}/hours`, { hours: Array.from({ length: 7 }, (_, wd) => ({ weekday: wd, open_time: '07:00', close_time: '22:00' })) }, token);
  const svc = await api('POST', `/api/sites/${site.id}/services`, { name: 'Corte', duration_min: 30, price: 50 }, token);
  await api('POST', `/api/sites/${site.id}/services`, { name: 'Barba', duration_min: 20, price: 35 }, token);
  for (const n of ['Ana', 'Beto', 'Caio']) await api('POST', `/api/sites/${site.id}/professionals`, { name: n }, token);
  const d = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

  const scenarios = [
    { name: 'Página pública do site (HTML)', url: `${BASE}/s/${site.slug}` },
    { name: 'API de horários livres', url: `${BASE}/api/public/sites/${site.slug}/availability?service_id=${svc.service.id}&date=${d}` },
    { name: 'Painel: dashboard (autenticado)', url: `${BASE}/api/dashboard`, headers: { Authorization: `Bearer ${token}` } },
  ];

  const results = [];
  const hz = 100; // ticks por segundo do kernel (padrão Linux)
  for (const level of levels) {
    for (const sc of scenarios) {
      const before = procStats(server.pid);
      const t0 = Date.now();
      let peakRss = before?.rssMb || 0;
      const sampler = setInterval(() => { const s = procStats(server.pid); if (s) peakRss = Math.max(peakRss, s.rssMb); }, 200);
      const res = await run({ url: sc.url, headers: sc.headers, connections: level, pipelining: 1 });
      clearInterval(sampler);
      const after = procStats(server.pid);
      const secs = (Date.now() - t0) / 1000;
      const row = {
        conexoes: level,
        cenario: sc.name,
        req_s: Math.round(res.requests.average),
        total: res.requests.total,
        lat_media_ms: Math.round(res.latency.average),
        lat_p50_ms: res.latency.p50,
        lat_p99_ms: res.latency.p99,
        erros: res.errors + res.timeouts,
        nao_2xx: res.non2xx,
        cpu_pct: before && after ? Math.round(((after.cpuTicks - before.cpuTicks) / hz / secs) * 100) : null,
        rss_pico_mb: Math.round(peakRss),
      };
      results.push(row);
      console.log(JSON.stringify(row));
    }
  }

  // Escrita concorrente: 200 agendamentos disputando 20 horários (deve gravar só 60 = 20 × 3 profissionais)
  const times = Array.from({ length: 20 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
  const posts = await Promise.all(Array.from({ length: 200 }, (_, i) => fetch(`${BASE}/api/public/sites/${site.slug}/bookings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service_id: svc.service.id, date: d, time: times[i % 20], client_name: `Cliente ${i}`, client_phone: `119${String(10000000 + i)}` }),
  }).then((r) => r.status)));
  const created = posts.filter((s) => s === 201).length;
  console.log(JSON.stringify({ escrita_concorrente: { pedidos: 200, criados: created, conflitos_409: posts.filter((s) => s === 409).length, outros: posts.filter((s) => ![201, 409].includes(s)).length, esperado: 60 } }));

  const out = path.join(__dirname, '..', 'docs', 'loadtest-result.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ data: new Date().toISOString(), duracao_s: DURATION, maquina: { cpus: os.cpus().length, mem_gb: Math.round(os.totalmem() / 1e9), node: process.version }, results, escrita: { pedidos: 200, criados: created, esperado: 60 } }, null, 2));
  console.log(`\nResultado salvo em ${out}`);
  server.kill('SIGTERM');
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(created === 60 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
