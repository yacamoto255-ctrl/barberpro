// APONTAMENTO DE ATIVIDADES — tela do chão de operação.
// Leitores USB/Bluetooth funcionam como teclado: "digitam" o código e enviam Enter.
// O campo de leitura fica sempre focado; o código identifica SOMENTE o ajudante.
import { api } from '../api.js';
import { getMeta, hasRole } from '../app.js';
import { html, mount, toast, $, kg, int, dur, hhmm, num, reasonDialog, confirmDialog, statusBadge } from '../ui.js';

const PREF_KEY = 'logiponto.apontamento';
const DEBOUNCE_MS = 1500;      // ignora leitura duplicada do mesmo código (leitor "repetindo")
const CONFIRM_WINDOW_MS = 15000; // bipar de novo em até 15 s confirma a ação sugerida

export default async function (root) {
  const meta = await getMeta(true);
  const parseLocal = s => Date.parse(s.replace(' ', 'T') + 'Z');
  const offset = parseLocal(meta.now) - Date.now();
  const serverNowMs = () => Date.now() + offset;

  let prefs = {};
  try { prefs = JSON.parse(sessionStorage.getItem(PREF_KEY) || '{}'); } catch { prefs = {}; }
  const st = {
    load: null, typeId: prefs.typeId || null, squareId: null,
    helper: null, current: null, identifiedAt: 0, lastCode: null, lastScanAt: 0,
    autoStart: !!prefs.autoStart, busy: false, openLoads: [],
  };
  const savePrefs = () => { try { sessionStorage.setItem(PREF_KEY, JSON.stringify({ typeId: st.typeId, loadId: st.load?.id, autoStart: st.autoStart })); } catch { /* ignora */ } };

  mount(root, html`
    <div class="page-head">
      <div><h1>Apontamento de Atividades</h1><p class="muted">Bipe o crachá do ajudante, escolha a carga e a atividade, e inicie.</p></div>
      <div class="row no-print"><span class="badge b-info" id="clock"></span></div>
    </div>
    <div class="ap-grid">
      <div>
        <section class="card">
          <div class="scan-box" id="scan-box">
            <label for="scan">Código do ajudante (leitor ou digitação)</label>
            <input id="scan" class="scan-input" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="32" placeholder="Bipe o crachá…" aria-describedby="scan-result">
            <div class="scan-result" id="scan-result" aria-live="assertive"><span class="muted">Aguardando leitura…</span></div>
          </div>
          <div class="toggle-row no-print">
            <label class="check"><input type="checkbox" id="auto-start"> Iniciar automaticamente ao bipar (carga e atividade já selecionadas)</label>
          </div>
        </section>

        <section class="card">
          <div class="card-title"><h2>1. Carga</h2><span class="muted small">Leia ou digite o número e pressione Enter</span></div>
          <form class="row" id="load-form">
            <input id="load-number" class="grow" placeholder="Nº da carga (ex.: 4587)" autocomplete="off" maxlength="30" aria-label="Número da carga">
            <button class="btn-primary" type="submit">Buscar</button>
          </form>
          <div class="chips mt" id="load-chips"></div>
          <div class="mt" id="load-card"></div>
        </section>

        <section class="card">
          <div class="card-title"><h2>2. Atividade</h2></div>
          <div class="act-grid" id="act-grid"></div>
          <div class="grid g2 mt" id="act-extra"></div>
        </section>

        <section class="card">
          <div class="big-actions">
            <button class="btn-ok btn-xl" id="btn-start" disabled>▶ INICIAR</button>
            <button class="btn-danger btn-xl" id="btn-finish" disabled>■ FINALIZAR</button>
          </div>
          <div class="muted small mt" id="action-hint">Bipe um ajudante para começar.</div>
        </section>
      </div>

      <div>
        <section class="card">
          <div class="card-title"><h2 id="load-parts-title">Ajudantes na carga</h2></div>
          <div id="load-parts"><div class="muted">Selecione uma carga.</div></div>
        </section>
        <section class="card">
          <div class="card-title"><h2>Em andamento agora</h2><span class="badge b-warn" id="open-count">0</span></div>
          <div id="open-list"></div>
        </section>
      </div>
    </div>`);

  const scan = $('#scan', root);
  const focusScan = () => { if (!document.querySelector('.modal-back')) scan.focus(); };

  // ── Som de confirmação (feedback no chão de operação) ──
  let audio;
  function beep(ok = true) {
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(); const g = audio.createGain();
      o.frequency.value = ok ? 880 : 220; o.type = ok ? 'sine' : 'square';
      g.gain.value = 0.08; o.connect(g); g.connect(audio.destination);
      o.start(); o.stop(audio.currentTime + (ok ? 0.12 : 0.35));
    } catch { /* sem áudio */ }
  }

  // ── Atividades ──
  function renderActivities() {
    mount($('#act-grid', root), html`${meta.activity_types.map(t => html`
      <button type="button" class="act-btn ${st.typeId === t.id ? 'sel' : ''}" data-type="${t.id}" data-bg="${t.color}" aria-pressed="${st.typeId === t.id}">
        ${t.name}${t.requires_square ? html`<span class="tag">exige praça</span>` : ''}
      </button>`)}`);
    const type = meta.activity_types.find(t => t.id === st.typeId);
    const extra = $('#act-extra', root);
    if (type?.requires_square) {
      const def = st.squareId || st.load?.square_id || '';
      mount(extra, html`
        <div class="field"><label for="square">Praça de destino *</label>
          <select id="square"><option value="">Selecione…</option>${meta.squares.map(s => html`<option value="${s.id}" ${String(s.id) === String(def) ? 'selected' : ''}>${s.code} — ${s.name}</option>`)}</select></div>
        ${partialFields()}`);
      st.squareId = def ? Number(def) : null;
      $('#square', root).addEventListener('change', e => { st.squareId = Number(e.target.value) || null; updateButtons(); });
    } else {
      mount(extra, partialFields());
      st.squareId = null;
    }
  }
  function partialFields() {
    return html`<details class="field"><summary class="small">Movimentação parcial? (opcional)</summary>
      <div class="row mt"><div class="grow"><label for="pw">Peso parcial (kg)</label><input id="pw" type="number" min="0" step="0.01" inputmode="decimal"></div>
      <div class="grow"><label for="pv">Volumes parciais</label><input id="pv" type="number" min="0" step="1" inputmode="numeric"></div></div>
      <div class="muted small">Em branco = peso e volumes totais da carga. Só vale para a primeira pessoa que inicia a atividade.</div></details>`;
  }
  $('#act-grid', root).addEventListener('click', e => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    st.typeId = Number(b.dataset.type);
    savePrefs(); renderActivities(); updateButtons(); focusScan();
    if (st.autoStart && st.helper && !st.current) doStart();
  });

  // ── Cargas ──
  async function loadOpenLoads() {
    st.openLoads = await api.get('/loads', { status: 'ABERTA' });
    mount($('#load-chips', root), html`${st.openLoads.slice(0, 30).map(l => html`
      <button type="button" class="chip ${st.load?.id === l.id ? 'sel' : ''}" data-load="${l.id}" title="${kg(l.weight_kg)} • ${int(l.volumes)} vol.">
        ${l.load_number}${l.active_count ? html` <span class="badge b-warn">${l.active_count}</span>` : ''}</button>`)}
      ${st.openLoads.length ? '' : html`<span class="muted small">Nenhuma carga aberta.</span>`}`);
  }
  $('#load-chips', root).addEventListener('click', e => {
    const b = e.target.closest('[data-load]');
    if (b) selectLoad(Number(b.dataset.load));
  });
  $('#load-form', root).addEventListener('submit', async e => {
    e.preventDefault();
    const n = $('#load-number', root).value.trim();
    if (!n) return;
    try {
      const l = await api.get(`/loads/by-number/${encodeURIComponent(n)}`);
      if (l.status !== 'ABERTA') { toast(`Carga ${l.load_number} está ${l.status}.`, 'err'); beep(false); return; }
      await selectLoad(l.id);
      $('#load-number', root).value = '';
      focusScan();
    } catch (err) { toast(err.message, 'err'); beep(false); }
  });

  async function selectLoad(id) {
    st.load = await api.get(`/loads/${id}`);
    st.squareId = null;
    savePrefs();
    renderLoadCard(); renderActivities(); updateButtons();
    await Promise.all([loadOpenLoads(), refreshLoadParts()]);
    focusScan();
  }

  function renderLoadCard() {
    const l = st.load;
    if (!l) { mount($('#load-card', root), html`<div class="muted">Nenhuma carga selecionada.</div>`); return; }
    mount($('#load-card', root), html`<div class="load-card">
      <div><div class="k">Carga</div><div class="v big">${l.load_number}</div></div>
      <div><div class="k">Peso</div><div class="v">${kg(l.weight_kg)}</div></div>
      <div><div class="k">Volumes</div><div class="v">${int(l.volumes)}</div></div>
      <div><div class="k">Conferente</div><div class="v">${l.checker_name || '—'}</div></div>
      <div><div class="k">Praça</div><div class="v">${l.square_code ? `Praça ${l.square_code}` : '—'}</div></div>
      <div><div class="k">Ajudantes</div><div class="v">${int(l.helpers_count)}</div></div>
    </div>`);
    $('#load-parts-title', root).textContent = `Ajudantes na carga ${l.load_number}`;
  }

  // ── Leitura do código ──
  function setScanState(kind, content) {
    const box = $('#scan-box', root);
    box.classList.remove('ok', 'busy', 'err', 'flash');
    if (kind) { box.classList.add(kind); void box.offsetWidth; box.classList.add('flash'); }
    mount($('#scan-result', root), content);
  }

  async function processScan(raw) {
    const code = raw.trim().toUpperCase();
    scan.value = '';
    if (!code || st.busy) return;
    const now = Date.now();
    if (code === st.lastCode && now - st.lastScanAt < DEBOUNCE_MS) return; // leitura duplicada
    const confirming = st.helper && st.helper.barcode === code && now - st.identifiedAt < CONFIRM_WINDOW_MS;
    st.lastCode = code; st.lastScanAt = now;
    if (confirming) {
      if (st.current) return doFinish(st.current.id);
      if (canStart()) return doStart();
    }
    st.busy = true;
    try {
      const r = await api.post('/operations/identify', { barcode: code });
      st.helper = r.helper; st.current = r.current; st.identifiedAt = Date.now();
      beep(true);
      if (r.current) {
        const c = r.current;
        setScanState('busy', html`<div class="who busy">${r.helper.name}</div>
          <div><strong>Código ${r.helper.barcode}</strong> • em <strong>${c.activity_type_name}</strong> na carga <strong>${c.load_number}</strong>
          ${c.square_code ? html` • Praça ${c.square_code}` : ''} desde ${hhmm(c.joined_at)}</div>
          <div class="small">Bipe novamente para FINALIZAR.</div>`);
      } else {
        setScanState('ok', html`<div class="who ok">✓ ${r.helper.name} identificado</div>
          <div>Código <strong>${r.helper.barcode}</strong>${r.helper.team_name ? html` • ${r.helper.team_name}` : ''}${r.helper.shift_name ? html` • Turno ${r.helper.shift_name}` : ''}</div>`);
        if (st.autoStart && canStart()) { st.busy = false; await doStart(); return; }
      }
    } catch (e) {
      st.helper = null; st.current = null;
      beep(false);
      setScanState('err', html`<div class="who err">✕ ${e.status === 404 ? 'Código não cadastrado' : 'Não permitido'}</div><div>${e.message}</div>`);
    } finally {
      st.busy = false;
      updateButtons();
    }
  }

  scan.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); processScan(scan.value); }
  });

  // Se o foco sair do campo (clique em botão), teclas digitadas voltam para a leitura.
  const onKey = (e) => {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
    if (!typing && !document.querySelector('.modal-back') && e.key.length === 1 && /[0-9A-Za-z-]/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      scan.focus();
    }
  };
  document.addEventListener('keydown', onKey);

  $('#auto-start', root).checked = st.autoStart;
  $('#auto-start', root).addEventListener('change', e => { st.autoStart = e.target.checked; savePrefs(); focusScan(); });

  // ── Ações ──
  function canStart() {
    const type = meta.activity_types.find(t => t.id === st.typeId);
    return !!(st.helper && !st.current && st.load && type && (!type.requires_square || st.squareId));
  }

  function updateButtons() {
    const bs = $('#btn-start', root), bf = $('#btn-finish', root), hint = $('#action-hint', root);
    const type = meta.activity_types.find(t => t.id === st.typeId);
    bs.disabled = !canStart() && !(st.current && st.load && type);
    bf.disabled = !st.current;
    if (st.current) {
      bs.textContent = '⇄ TROCAR ATIVIDADE';
      hint.textContent = `${st.helper.name} está em atividade. FINALIZAR encerra; TROCAR finaliza a atual e inicia a selecionada.`;
    } else {
      bs.textContent = '▶ INICIAR';
      const missing = [];
      if (!st.helper) missing.push('bipe o ajudante');
      if (!st.load) missing.push('selecione a carga');
      if (!type) missing.push('escolha a atividade');
      else if (type.requires_square && !st.squareId) missing.push('escolha a praça');
      hint.textContent = missing.length ? `Falta: ${missing.join(', ')}.` : `Pronto: ${st.helper.name} → ${type.name} na carga ${st.load.load_number}. Pressione INICIAR ou bipe novamente.`;
    }
  }

  async function doStart(switchActivity = false) {
    if (st.busy) return;
    const type = meta.activity_types.find(t => t.id === st.typeId);
    if (!st.helper || !st.load || !type) return;
    st.busy = true;
    const body = {
      helper_id: st.helper.id, load_id: st.load.id, activity_type_id: type.id, square_id: st.squareId,
      reference_weight_kg: $('#pw', root)?.value || null, reference_volumes: $('#pv', root)?.value || null,
      switch: switchActivity,
    };
    try {
      const r = await api.post('/operations/start', body);
      beep(true);
      const p = r.participant;
      toast(`${p.helper_name} iniciou ${p.activity_type_name} — carga ${p.load_number}${r.joined_existing ? ' (entrou na equipe já em andamento)' : ''}`, 'ok');
      setScanState('ok', html`<div class="who ok">▶ ${p.helper_name}</div><div>${p.activity_type_name} • carga ${p.load_number}${p.square_code ? html` • Praça ${p.square_code}` : ''} • início ${hhmm(p.joined_at)}</div>`);
      resetHelper();
      await refreshAll();
    } catch (e) {
      beep(false);
      if (e.code === 'AJUDANTE_OCUPADO' && e.details?.current) {
        const c = e.details.current;
        st.busy = false;
        const ok = await confirmDialog(`${c.helper_name} está em ${c.activity_type_name} na carga ${c.load_number} desde ${hhmm(c.joined_at)}. Finalizar essa atividade e iniciar ${type.name}?`, { title: 'Trocar de atividade', okLabel: 'Finalizar e iniciar' });
        if (ok) { await doStart(true); return; }
      } else {
        toast(e.message, 'err', 5000);
        setScanState('err', html`<div class="who err">✕ Não iniciado</div><div>${e.message}</div>`);
      }
    } finally { st.busy = false; updateButtons(); focusScan(); }
  }

  async function doFinish(participantId, name) {
    if (st.busy) return;
    st.busy = true;
    try {
      const r = await api.post(`/operations/participants/${participantId}/finish`);
      beep(true);
      const p = r.participant;
      toast(`${p.helper_name} finalizou ${p.activity_type_name} — ${dur(p.duration_seconds)}${r.activity_status === 'FINALIZADA' ? ' • atividade encerrada e rateio calculado' : ''}`, 'ok', 4500);
      setScanState('ok', html`<div class="who ok">■ ${p.helper_name || name}</div><div>${p.activity_type_name} finalizada • ${hhmm(p.joined_at)}–${hhmm(p.left_at)} (${dur(p.duration_seconds)})</div>`);
      resetHelper();
      await refreshAll();
    } catch (e) {
      beep(false); toast(e.message, 'err');
    } finally { st.busy = false; updateButtons(); focusScan(); }
  }

  function resetHelper() { st.helper = null; st.current = null; st.identifiedAt = 0; }

  $('#btn-start', root).addEventListener('click', () => doStart(!!st.current));
  $('#btn-finish', root).addEventListener('click', () => st.current && doFinish(st.current.id));

  // ── Painéis laterais ──
  const elapsed = joined => Math.max(0, Math.round((serverNowMs() - parseLocal(joined)) / 1000));

  function partRow(p, { showLoad = false } = {}) {
    const active = p.status === 'ATIVO';
    return html`<div class="part ${active ? '' : p.status === 'CANCELADO' ? 'cancel' : 'done'}">
      <div class="grow">
        <div class="n">${p.helper_name} <span class="muted small">${p.helper_barcode}</span></div>
        <div class="d">${showLoad ? html`<a href="#" data-pick-load="${p.load_id}">Carga ${p.load_number}</a> • ` : ''}<span class="dot" data-bg="${p.activity_type_color}"></span>${p.activity_type_name}${p.square_code ? html` • Praça ${p.square_code}` : ''}
          • ${hhmm(p.joined_at)}${p.left_at ? html`–${hhmm(p.left_at)}` : ''}</div>
      </div>
      ${active ? html`<span class="timer" data-since="${p.joined_at}">${dur(elapsed(p.joined_at))}</span>
        <button class="btn-danger btn-sm" data-finish="${p.id}" data-name="${p.helper_name}">Finalizar</button>
        <button class="btn-ghost btn-sm" data-cancel="${p.id}" title="Cancelar apontamento (bipe errado)">✕</button>`
        : html`${statusBadge(p.status)}${p.duration_seconds != null ? html`<span class="small muted">${dur(p.duration_seconds)}</span>` : ''}`}
    </div>`;
  }

  async function refreshLoadParts() {
    const box = $('#load-parts', root);
    if (!st.load) return;
    const acts = await api.get(`/loads/${st.load.id}/activities`);
    if (!acts.length) { mount(box, html`<div class="muted">Nenhuma atividade registrada nesta carga.</div>`); return; }
    mount(box, html`${acts.map(a => html`
      <div class="card mb">
        <div class="row between">
          <div><span class="dot" data-bg="${a.activity_type_color}"></span><strong>${a.activity_type_name}</strong>${a.square_code ? html` • Praça ${a.square_code}` : ''} ${statusBadge(a.status)}</div>
          ${a.status === 'EM_ANDAMENTO' ? html`<button class="btn-sm" data-finish-act="${a.id}">Finalizar atividade</button>` : ''}
        </div>
        <div class="small muted">Peso de referência ${kg(a.reference_weight_kg)} • ${int(a.reference_volumes)} vol. • Regra: ${a.rule.name}</div>
        <div class="part-list mt">${a.participants.map(p => partRow(p))}</div>
        ${a.allocations.length ? html`<div class="small mt"><strong>${a.status === 'EM_ANDAMENTO' ? 'Rateio (prévia)' : 'Rateio'}:</strong>
          ${a.allocations.map(x => html`<span class="badge b-info">${a.participants.find(p => p.helper_id === x.helper_id)?.helper_name}: ${num(x.allocated_weight_kg)} kg / ${num(x.allocated_volumes)} vol.</span> `)}</div>` : ''}
      </div>`)}`);
  }

  async function refreshOpen() {
    const list = await api.get('/operations/open');
    $('#open-count', root).textContent = list.length;
    mount($('#open-list', root), list.length
      ? html`<div class="part-list">${list.map(p => partRow(p, { showLoad: true }))}</div>`
      : html`<div class="muted">Nenhum ajudante em atividade.</div>`);
  }

  async function refreshAll() {
    await Promise.all([refreshOpen(), refreshLoadParts(), loadOpenLoads()]);
    if (st.load) { st.load = await api.get(`/loads/${st.load.id}`); renderLoadCard(); }
  }

  root.addEventListener('click', async e => {
    const f = e.target.closest('[data-finish]');
    if (f) return doFinish(Number(f.dataset.finish), f.dataset.name);
    const pl = e.target.closest('[data-pick-load]');
    if (pl) { e.preventDefault(); return selectLoad(Number(pl.dataset.pickLoad)); }
    const fa = e.target.closest('[data-finish-act]');
    if (fa) {
      if (!(await confirmDialog('Finalizar a atividade para TODOS os ajudantes que ainda estão nela?', { okLabel: 'Finalizar todos', danger: true }))) return focusScan();
      try { await api.post(`/operations/activities/${fa.dataset.finishAct}/finish`); toast('Atividade finalizada e rateio calculado.', 'ok'); await refreshAll(); }
      catch (err) { toast(err.message, 'err'); }
      return focusScan();
    }
    const c = e.target.closest('[data-cancel]');
    if (c) {
      const r = await reasonDialog('Cancelar apontamento', 'Motivo (ex.: bipe errado)',
        hasRole('OPERADOR') ? html`<div class="note warn mb">Operador pode cancelar apenas apontamentos em andamento com poucos minutos. Depois disso, procure o gestor.</div>` : '');
      if (!r) return focusScan();
      try { await api.post(`/operations/participants/${c.dataset.cancel}/cancel`, { reason: r.reason }); toast('Apontamento cancelado.', 'ok'); await refreshAll(); }
      catch (err) { toast(err.message, 'err', 5000); }
      focusScan();
    }
  });

  // ── Timers e atualização periódica ──
  const tick = setInterval(() => {
    root.querySelectorAll('[data-since]').forEach(el => { el.textContent = dur(elapsed(el.dataset.since)); });
    const c = $('#clock', root);
    if (c) c.textContent = new Date(serverNowMs()).toISOString().slice(11, 16);
  }, 1000);
  const poll = setInterval(() => { if (!document.hidden) refreshAll().catch(() => {}); }, 20000);

  // ── Inicialização ──
  renderActivities(); renderLoadCard(); updateButtons();
  await Promise.all([loadOpenLoads(), refreshOpen()]);
  if (prefs.loadId && st.openLoads.some(l => l.id === prefs.loadId)) await selectLoad(prefs.loadId);
  focusScan();

  return () => { clearInterval(tick); clearInterval(poll); document.removeEventListener('keydown', onKey); };
}
