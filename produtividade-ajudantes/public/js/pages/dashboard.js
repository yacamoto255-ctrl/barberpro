// DASHBOARD GERENCIAL
import { api } from '../api.js';
import { filterBar } from '../filters.js';
import { html, mount, $, kg, int, num, dur, hbars, vbars, table, modal } from '../ui.js';

export default async function (root) {
  mount(root, html`
    <div class="page-head"><div><h1>Dashboard de Produtividade</h1>
      <p class="muted">Indicadores dos apontamentos finalizados no período.</p></div>
      <label class="check no-print"><input type="checkbox" id="auto"> Atualizar a cada 60 s</label></div>
    <div id="flt"></div>
    <div class="note mt">⚠ <strong>Kg atribuídos</strong> = peso de referência de cada atividade rateado entre os ajudantes que participaram dela (regra configurável).
      Não é o peso carregado fisicamente por uma pessoa. Como uma carga passa por várias atividades, o total atribuído pode ser maior que o <strong>peso físico das cargas</strong>.</div>
    <div id="body" class="mt"><div class="boot">Carregando…</div></div>`);

  let current = {};
  let last = null;
  const load = async (f = current) => {
    current = f;
    const d = await api.get('/dashboard', f);
    last = d;
    render(d);
  };
  await filterBar($('#flt', root), f => load(f).catch(e => mount($('#body', root), html`<div class="card err">${e.message}</div>`)));

  function render(d) {
    const t = d.totals;
    const multiDay = d.filters.date_from !== d.filters.date_to;
    mount($('#body', root), html`
      <div class="kpis">
        <div class="kpi"><div class="label">Ajudantes ativos</div><div class="value">${int(t.active_helpers)}</div><div class="hint">${int(t.helpers_with_activity)} com apontamento no período</div></div>
        <div class="kpi"><div class="label">Cargas movimentadas</div><div class="value">${int(t.loads)}</div><div class="hint">cargas distintas</div></div>
        <div class="kpi"><div class="label">Peso físico das cargas</div><div class="value">${num(t.physical_kg, 0)} kg</div><div class="hint">${int(t.physical_volumes)} volumes (sem duplicar)</div></div>
        <div class="kpi amber"><div class="label">Kg atribuídos</div><div class="value">${num(t.allocated_kg, 0)} kg</div><div class="hint">produtividade (rateio)</div></div>
        <div class="kpi amber"><div class="label">Volumes atribuídos</div><div class="value">${num(t.allocated_volumes, 0)}</div><div class="hint">produtividade (rateio)</div></div>
        <div class="kpi"><div class="label">Atividades</div><div class="value">${int(t.activities)}</div><div class="hint">execuções finalizadas</div></div>
        <div class="kpi"><div class="label">Horas apontadas</div><div class="value">${dur(t.seconds)}</div><div class="hint">soma do tempo dos ajudantes</div></div>
        <div class="kpi green"><div class="label">Kg/hora (equipe)</div><div class="value">${num(t.kg_per_hour, 0)}</div><div class="hint">${num(t.volumes_per_hour, 1)} volumes/hora</div></div>
        <div class="kpi red"><div class="label">Em andamento agora</div><div class="value">${int(t.in_progress_now)}</div><div class="hint">ajudantes em atividade</div></div>
      </div>

      <div class="grid g2 mt">
        <div class="card"><div class="card-title"><h2>Kg atribuídos por atividade</h2></div>
          ${hbars(d.by_type, { value: x => x.kg, label: x => x.name, fmt: v => `${num(v, 0)} kg`, color: x => x.color })}</div>
        <div class="card"><div class="card-title"><h2>${multiDay ? 'Kg atribuídos por dia' : 'Kg atribuídos por hora do dia'}</h2></div>
          ${multiDay ? vbars(d.by_day, { value: x => x.kg, label: x => x.day.slice(8, 10) + '/' + x.day.slice(5, 7) })
            : vbars(d.by_hour, { value: x => x.kg, label: x => `${x.hour}h` })}</div>
      </div>

      <div class="card mt"><div class="card-title"><h2>Produtividade individual</h2><span class="muted small">Clique no ajudante para ver o detalhe • "—" em kg/h = menos de 5 min apontados</span></div>
        ${table([
          { label: 'Ajudante', render: r => html`<strong>${r.helper_name}</strong> <span class="muted small">${r.helper_barcode}</span>` },
          { label: 'Kg atribuídos', num: true, render: r => num(r.kg) },
          { label: 'Volumes', num: true, render: r => num(r.volumes) },
          { label: 'Cargas', num: true, render: r => int(r.loads) },
          { label: 'Atividades', num: true, render: r => int(r.activities) },
          { label: 'Tempo', num: true, render: r => dur(r.seconds) },
          { label: 'Kg/hora', num: true, render: r => num(r.kg_per_hour, 0) },
          { label: 'Vol./hora', num: true, render: r => num(r.volumes_per_hour, 1) },
        ], d.helpers, { rowAttrs: r => html`class="clickable" data-helper="${r.helper_id}" tabindex="0"` })}
      </div>

      <div class="grid g2 mt">
        <div class="card"><div class="card-title"><h2>Movimentação para praças</h2></div>
          ${table([
            { label: 'Praça', render: r => `${r.code} — ${r.name}` },
            { label: 'Cargas', num: true, render: r => int(r.loads) },
            { label: 'Kg atribuídos', num: true, render: r => num(r.kg) },
            { label: 'Volumes', num: true, render: r => num(r.volumes) },
            { label: 'Tempo', num: true, render: r => dur(r.seconds) },
          ], d.by_square, { empty: 'Nenhuma movimentação para praça no período.' })}</div>
        <div class="card"><div class="card-title"><h2>Resumo por atividade</h2></div>
          ${table([
            { label: 'Atividade', cls: 'nowrap', render: r => html`<span class="dot" data-bg="${r.color}"></span>${r.name}` },
            { label: 'Execuções', num: true, render: r => int(r.activities) },
            { label: 'Cargas', num: true, render: r => int(r.loads) },
            { label: 'Ajudantes', num: true, render: r => int(r.helpers) },
            { label: 'Tempo', num: true, render: r => dur(r.seconds) },
            { label: 'Kg/h', num: true, render: r => num(r.kg_per_hour, 0) },
          ], d.by_type)}</div>
      </div>`);
  }

  function helperDetail(id) {
    const h = last.helpers.find(x => x.helper_id === id);
    const rows = last.helper_type.filter(x => x.helper_id === id);
    modal({
      title: `${h.helper_name} (${h.helper_barcode})`, wide: true,
      body: html`<div class="kpis">
          <div class="kpi amber"><div class="label">Kg atribuídos</div><div class="value">${num(h.kg, 0)}</div></div>
          <div class="kpi"><div class="label">Volumes</div><div class="value">${num(h.volumes, 0)}</div></div>
          <div class="kpi"><div class="label">Cargas</div><div class="value">${int(h.loads)}</div></div>
          <div class="kpi"><div class="label">Atividades</div><div class="value">${int(h.activities)}</div></div>
          <div class="kpi"><div class="label">Tempo</div><div class="value">${dur(h.seconds)}</div></div>
          <div class="kpi green"><div class="label">Kg/hora</div><div class="value">${num(h.kg_per_hour, 0)}</div></div>
        </div>
        <h3 class="mt">Participação por atividade</h3>
        ${table([
          { label: 'Atividade', key: 'type_name' },
          { label: 'Cargas', num: true, render: r => int(r.loads) },
          { label: 'Kg atribuídos', num: true, render: r => num(r.kg) },
          { label: 'Volumes', num: true, render: r => num(r.volumes) },
          { label: 'Tempo', num: true, render: r => dur(r.seconds) },
        ], rows)}
        <p class="muted small mt">Ex.: "Cargas" na linha Carregamento = quantas cargas ele ajudou a carregar no período.</p>`,
      actions: [{ label: 'Fechar' }],
    });
  }
  root.addEventListener('click', e => { const r = e.target.closest('[data-helper]'); if (r) helperDetail(Number(r.dataset.helper)); });
  root.addEventListener('keydown', e => { const r = e.target.closest('[data-helper]'); if (r && e.key === 'Enter') helperDetail(Number(r.dataset.helper)); });

  await load({});
  let timer = null;
  $('#auto', root).addEventListener('change', e => {
    clearInterval(timer);
    if (e.target.checked) timer = setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 60000);
  });
  return () => clearInterval(timer);
}
