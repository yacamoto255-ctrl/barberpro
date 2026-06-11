// db/seed.js — Seed multi-tenant: super_admin + 2 barbearias demo
'use strict';

const bcrypt = require('bcryptjs');
const { getDb } = require('./index');
const db = getDb();

function seed() {
  const existing = db.prepare('SELECT COUNT(*) as n FROM users').get();
  if (existing.n > 0) { console.log('✓ Banco já populado.'); return; }

  console.log('🌱 Populando banco multi-tenant...');
  const HASH = p => bcrypt.hashSync(p, 10);

  /* ── SUPER ADMIN ─────────────────────────────────────────── */
  db.prepare(`INSERT INTO users (barbershop_id, name, email, password, role)
              VALUES (NULL, 'Super Admin', 'admin@barberpro.com.br', ?, 'super_admin')`)
    .run(HASH('admin123'));

  /* ── BARBEARIA 1 ─────────────────────────────────────────── */
  const bs1 = db.prepare(`INSERT INTO barbershops (name, slug, phone, address, plan)
                          VALUES ('Barbearia do Roberto', 'roberto', '(11) 3333-1111',
                                  'Av. Paulista, 1000 — São Paulo/SP', 'pro')`).run();
  const b1id = bs1.lastInsertRowid;
  seedBarbearia(db, b1id, HASH, {
    ownerName: 'Roberto Alves', ownerEmail: 'roberto@barberpro.com.br',
    barbers: [
      { name:'Carlos Silva',    email:'carlos@barberpro.com.br',  specialty:'Degradê & Barba', commission_rate:45 },
      { name:'Marcus Oliveira', email:'marcus@barberpro.com.br',  specialty:'Corte Clássico',  commission_rate:40 },
      { name:'André Lima',      email:'andre@barberpro.com.br',   specialty:'Coloração',       commission_rate:40 },
    ],
    clients: [
      { name:'João Santos',    email:'joao@gmail.com',    phone:'(11) 98888-0001', plan:'Ouro',   points:1240, cashback:62 },
      { name:'Pedro Alves',    email:'pedro@gmail.com',   phone:'(11) 98888-0002', plan:'Prata',  points:890,  cashback:44.5 },
      { name:'Lucas Costa',    email:'lucas@gmail.com',   phone:'(11) 98888-0003', plan:'Bronze', points:450,  cashback:22.5 },
      { name:'Rafael Souza',   email:'rafael@gmail.com',  phone:'(11) 98888-0004', plan:'Ouro',   points:2100, cashback:105 },
      { name:'Gabriel Mendes', email:'gabriel@gmail.com', phone:'(11) 98888-0005', plan:'Prata',  points:680,  cashback:34 },
    ],
  });

  /* ── BARBEARIA 2 ─────────────────────────────────────────── */
  const bs2 = db.prepare(`INSERT INTO barbershops (name, slug, phone, address, plan)
                          VALUES ('Cortes & Style', 'cortes-style', '(21) 4444-2222',
                                  'Rua das Flores, 500 — Rio de Janeiro/RJ', 'basic')`).run();
  const b2id = bs2.lastInsertRowid;
  seedBarbearia(db, b2id, HASH, {
    ownerName: 'Fernanda Costa',  ownerEmail: 'fernanda@cortestyle.com.br',
    barbers: [
      { name:'Bruno Mendes',  email:'bruno@cortestyle.com.br',  specialty:'Barba Artística', commission_rate:40 },
      { name:'Thiago Nunes',  email:'thiago@cortestyle.com.br', specialty:'Degradê Afro',    commission_rate:35 },
    ],
    clients: [
      { name:'Diego Ferreira', email:'diego@hotmail.com',  phone:'(21) 97777-0001', plan:'Prata',  points:320, cashback:16 },
      { name:'Mateus Barbosa', email:'mateus@hotmail.com', phone:'(21) 97777-0002', plan:'Bronze', points:150, cashback:7.5 },
      { name:'Renata Lima',    email:'renata@hotmail.com', phone:'(21) 97777-0003', plan:'Bronze', points:80,  cashback:4 },
    ],
  });

  console.log('\n✅ Seed concluído!\n');
  console.log('  Super Admin:    admin@barberpro.com.br  / admin123');
  console.log('  Dono Barbearia 1: roberto@barberpro.com.br  / 123456');
  console.log('  Dono Barbearia 2: fernanda@cortestyle.com.br / 123456\n');
}

/* ── Semente de uma barbearia ─────────────────────────────── */
function seedBarbearia(db, bsId, HASH, { ownerName, ownerEmail, barbers, clients }) {
  const now   = new Date();
  const month = m => { const d = new Date(now.getFullYear(), now.getMonth() - m, 1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };
  const fmt   = d => d.toISOString().split('T')[0];

  // Owner
  db.prepare(`INSERT INTO users (barbershop_id, name, email, password, role, phone)
              VALUES (?, ?, ?, ?, 'owner', '(00) 00000-0000')`)
    .run(bsId, ownerName, ownerEmail, HASH('123456'));

  // Barbeiros
  const bIds = barbers.map(b => {
    const u = db.prepare(`INSERT INTO users (barbershop_id, name, email, password, role, phone)
                          VALUES (?, ?, ?, ?, 'barber', '')`)
                .run(bsId, b.name, b.email, HASH('123456'));
    const br = db.prepare(`INSERT INTO barbers (user_id, specialty, commission_rate, hire_date)
                           VALUES (?, ?, ?, ?)`)
                 .run(u.lastInsertRowid, b.specialty, b.commission_rate, '2023-01-01');
    return br.lastInsertRowid;
  });

  // Clientes
  const cIds = clients.map(c => {
    const u = db.prepare(`INSERT INTO users (barbershop_id, name, email, password, role, phone)
                          VALUES (?, ?, ?, ?, 'client', ?)`)
                .run(bsId, c.name, c.email, HASH('123456'), c.phone);
    const cl = db.prepare(`INSERT INTO clients (user_id, phone, points, cashback, plan)
                           VALUES (?, ?, ?, ?, ?)`)
                 .run(u.lastInsertRowid, c.phone, c.points, c.cashback, c.plan);
    return cl.lastInsertRowid;
  });

  // Serviços
  const svcs = [
    { name:'Corte Degradê',      category:'Corte',     duration:45, price:55 },
    { name:'Barba Completa',     category:'Barba',     duration:30, price:40 },
    { name:'Corte + Barba',      category:'Combo',     duration:75, price:85 },
    { name:'Hidratação Capilar', category:'Tratamento',duration:40, price:60 },
    { name:'Sobrancelha',        category:'Estética',  duration:15, price:20 },
  ].map(s => db.prepare(`INSERT INTO services (barbershop_id, name, category, duration, price)
                         VALUES (?, ?, ?, ?, ?)`)
              .run(bsId, s.name, s.category, s.duration, s.price).lastInsertRowid);

  // Agendamentos (hoje e últimos 7 dias)
  const today = fmt(now);
  const dm1   = fmt(new Date(+now - 86400000));
  const dm2   = fmt(new Date(+now - 2*86400000));
  const dm7   = fmt(new Date(+now - 7*86400000));
  const c = i => cIds[i % cIds.length];
  const b = i => bIds[i % bIds.length];
  const appts = [
    [c(0), b(0), svcs[2], today, '09:00','10:15','confirmed', 85],
    [c(1), b(0), svcs[0], today, '10:30','11:15','confirmed', 55],
    [c(2), b(1), svcs[1], today, '11:00','11:30','pending',   40],
    [c(3), b(1), svcs[2], today, '14:00','15:15','confirmed', 85],
    [c(0), b(0), svcs[0], dm1,   '09:00','09:45','completed', 55],
    [c(1), b(1), svcs[2], dm1,   '10:00','11:15','completed', 85],
    [c(2), b(0), svcs[2], dm2,   '09:00','10:15','completed', 85],
    [c(3), b(1), svcs[1], dm7,   '10:00','10:30','completed', 40],
  ];
  appts.forEach(([cid,bid,sid,date,time,et,status,price]) =>
    db.prepare(`INSERT INTO appointments (barbershop_id, client_id, barber_id, service_id, date, time, end_time, status, price)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(bsId, cid, bid, sid, date, time, et, status, price));

  // Categorias financeiras
  const catInc = db.prepare(`INSERT INTO financial_categories (barbershop_id, name, type, color) VALUES (?, ?, ?, ?)`);
  const catExp = db.prepare(`INSERT INTO financial_categories (barbershop_id, name, type, color) VALUES (?, ?, ?, ?)`);
  const fc1 = catInc.run(bsId,'Serviços','income','#22c55e').lastInsertRowid;
  const fc4 = catExp.run(bsId,'Salários','expense','#ef4444').lastInsertRowid;
  const fc5 = catExp.run(bsId,'Aluguel', 'expense','#f97316').lastInsertRowid;
  const fc6 = catExp.run(bsId,'Produtos/Estoque','expense','#eab308').lastInsertRowid;
  const fc7 = catExp.run(bsId,'Marketing','expense','#ec4899').lastInsertRowid;
  const fc9 = catExp.run(bsId,'Utilidades','expense','#14b8a6').lastInsertRowid;

  // Lançamentos financeiros (3 meses)
  const months = [month(2), month(1), month(0)];
  months.forEach((m, idx) => {
    const isCurrentMonth = idx === 2;
    const maxDay = isCurrentMonth ? now.getDate() : 28;
    for (let d = 1; d <= maxDay; d++) {
      const dd = `${m}-${String(d).padStart(2,'0')}`;
      if (d % 7 !== 0)
        db.prepare(`INSERT INTO financial_entries (barbershop_id, type, category_id, description, amount, date, payment_method)
                    VALUES (?, 'income', ?, 'Serviços do dia', ?, ?, ?)`)
          .run(bsId, fc1, Math.round((800 + Math.random()*600)*100)/100, dd, ['pix','credit','cash'][d%3]);
    }
    const addExp = (day, catId, desc, amount, method) => {
      if (!isCurrentMonth || now.getDate() >= day)
        db.prepare(`INSERT INTO financial_entries (barbershop_id, type, category_id, description, amount, date, payment_method)
                    VALUES (?, 'expense', ?, ?, ?, ?, ?)`)
          .run(bsId, catId, desc, amount, `${m}-${String(day).padStart(2,'0')}`, method);
    };
    addExp(1,  fc7, 'Instagram Ads',        350,  'credit');
    addExp(5,  fc5, 'Aluguel',              3500, 'transfer');
    addExp(10, fc4, 'Salários',             5400, 'transfer');
    addExp(15, fc9, 'Energia + Água',        600, 'debit');
    addExp(20, fc6, 'Reposição de estoque', Math.round((600+Math.random()*400)*100)/100, 'pix');
  });

  // Estoque
  [
    ['Pomada Matte','Finalizadores',24,5,'un',28.5],
    ['Lâminas',    'Navalhas',     180,50,'cx',1.5],
    ['Óleo Barba', 'Tratamento',   8,10,'un',45],
    ['Toalhas',    'Higiene',      45,20,'un',8.5],
    ['Shampoo',    'Shampoo',      18,5,'un',32],
  ].forEach(([name,cat,qty,min,unit,cost]) =>
    db.prepare(`INSERT INTO inventory (barbershop_id, name, category, qty, min_qty, unit, unit_cost)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(bsId, name, cat, qty, min, unit, cost));

  // Configurações
  [
    ['barbearia_nome',            ownerName.split(' ')[0] + "'s Barbearia"],
    ['horario_abertura',          '09:00'],
    ['horario_fechamento',        '20:00'],
    ['intervalo_agenda',          '30'],
    ['fidelidade_pontos_por_real','10'],
    ['fidelidade_cashback_pct',   '5'],
  ].forEach(([k,v]) =>
    db.prepare('INSERT OR REPLACE INTO settings (barbershop_id, key, value) VALUES (?, ?, ?)')
      .run(bsId, k, v));

  // Bloqueios de agenda de exemplo
  const todayBlocks = new Date().toISOString().split('T')[0];
  const jun12 = todayBlocks.slice(0,5) + '06-12';
  const jun07 = todayBlocks.slice(0,5) + '06-07';
  const jun10 = todayBlocks.slice(0,5) + '06-10';
  const jun12e = todayBlocks.slice(0,5) + '06-12';
  try {
    db.prepare(`INSERT INTO schedule_blocks (barbershop_id,barber_id,title,start_date,end_date,start_time,end_time,repeat_type,color) VALUES (?,NULL,?,?,?,?,?,?,?)`).run(bsId,'Almoço (todos)',todayBlocks,todayBlocks,'12:00','13:00','daily','#f97316');
    db.prepare(`INSERT INTO schedule_blocks (barbershop_id,barber_id,title,start_date,end_date,start_time,end_time,repeat_type,color) VALUES (?,NULL,?,?,?,NULL,NULL,?,?)`).run(bsId,'Corpus Christi',jun12,jun12e,'none','#22c55e');
    // Bloqueios individuais (barbeiro 1 e 2 da barbearia)
    const bar1 = db.prepare('SELECT b.id FROM barbers b JOIN users u ON u.id=b.user_id WHERE u.barbershop_id=? LIMIT 1').get(bsId);
    const bar2 = db.prepare('SELECT b.id FROM barbers b JOIN users u ON u.id=b.user_id WHERE u.barbershop_id=? LIMIT 1 OFFSET 1').get(bsId);
    if(bar1) db.prepare(`INSERT INTO schedule_blocks (barbershop_id,barber_id,title,start_date,end_date,start_time,end_time,repeat_type,color) VALUES (?,?,?,?,?,NULL,NULL,?,?)`).run(bsId,bar1.id,'Férias',jun10,jun12,'none','#a855f7');
    if(bar2) db.prepare(`INSERT INTO schedule_blocks (barbershop_id,barber_id,title,start_date,end_date,start_time,end_time,repeat_type,color) VALUES (?,?,?,?,?,NULL,NULL,?,?)`).run(bsId,bar2.id,'Folga',jun07,jun07,'none','#ef4444');
  } catch(e) { /* ignore if table doesn't exist yet */ }

  // Notificação de boas-vindas
  const ownerUser = db.prepare('SELECT id FROM users WHERE email = ?').get(ownerEmail);
  if (ownerUser)
    db.prepare(`INSERT INTO notifications (user_id, title, body, type)
                VALUES (?, 'Bem-vindo ao BarberPro!', 'Seu sistema está pronto. Configure sua barbearia em Configurações.', 'success')`)
      .run(ownerUser.id);
}

seed();
