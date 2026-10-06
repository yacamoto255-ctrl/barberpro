// views/reports.js — relatório com filtros, totais e exportação
import { get, download } from '../api.js';
import { h, clear, toast, field, formValues, fmt, table, pageHead } from '../ui.js';

function monthRange() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return { from: `${d.getFullYear()}-${p(d.getMonth() + 1)}-01`, to: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(last)}` };
}

export async function reportsView(root) {
  const { sites } = await get('/sites');
  const m = monthRange();
  const filters = h('form', { class: 'filters' },
    field({ label: 'Site', name: 'site_id', type: 'select', options: [['', 'Todos'], ...sites.map((s) => [s.id, s.name])] }),
    field({ label: 'De', name: 'from', type: 'date', value: m.from }),
    field({ label: 'Até', name: 'to', type: 'date', value: m.to }),
    field({ label: 'Status', name: 'status', type: 'select', options: [['', 'Todos'], ...Object.entries(fmt.status)] }),
    h('button', { class: 'btn', type: 'submit' }, 'Aplicar'));
  const out = h('div');
  const query = () => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(formValues(filters))) if (v) q.set(k, v);
    return q;
  };

  async function load() {
    clear(out).append(h('p', { class: 'muted', text: 'Carregando…' }));
    let r;
    try { r = await get(`/reports/bookings?${query()}`); } catch (e) { clear(out).append(h('div', { class: 'alert err', text: e.message })); return; }
    const t = r.totals;
    const agg = (rows) => table([
      { label: 'Nome', key: 'label' }, { label: 'Qtde', key: 'count', num: true },
      { label: 'Realizado', num: true, render: (x) => fmt.brl(x.revenue_done_cents) },
      { label: 'Previsto', num: true, render: (x) => fmt.brl(x.revenue_expected_cents) },
    ], rows, { empty: 'Sem dados.' });
    clear(out).append(
      h('div', { class: 'grid g4' },
        h('div', { class: 'card kpi' }, h('div', { class: 'label', text: 'Agendamentos' }), h('div', { class: 'value', text: String(t.count) })),
        h('div', { class: 'card kpi' }, h('div', { class: 'label', text: 'Realizado' }), h('div', { class: 'value', text: fmt.brl(t.revenue_done_cents) }), h('div', { class: 'hint', text: 'status concluído' })),
        h('div', { class: 'card kpi' }, h('div', { class: 'label', text: 'Previsto' }), h('div', { class: 'value', text: fmt.brl(t.revenue_expected_cents) }), h('div', { class: 'hint', text: 'pendente + confirmado + concluído' })),
        h('div', { class: 'card kpi' }, h('div', { class: 'label', text: 'Cancelados' }), h('div', { class: 'value', text: String(t.by_status.cancelled) }), h('div', { class: 'hint', text: `${t.by_status.no_show} não compareceram` }))),
      h('div', { class: 'grid g2', style: { marginTop: '16px' } },
        h('div', { class: 'card' }, h('h2', { text: 'Por serviço' }), agg(t.by_service)),
        h('div', { class: 'card' }, h('h2', { text: 'Por profissional' }), agg(t.by_professional))),
      h('div', { class: 'card' }, h('h2', { text: 'Por site' }), agg(t.by_site)),
      h('div', { class: 'card' }, h('h2', { text: `Agendamentos${r.rows_total > r.rows.length ? ` (primeiros ${r.rows.length} de ${r.rows_total} — exporte para ver todos)` : ''}` }),
        table([
          { label: 'Data/hora', render: (x) => fmt.dt(x.starts_at) }, { label: 'Site', key: 'site_name' }, { label: 'Serviço', key: 'service_name' },
          { label: 'Profissional', render: (x) => x.professional_name || '—' }, { label: 'Cliente', key: 'client_name' },
          { label: 'Valor', num: true, render: (x) => fmt.brl(x.price_cents) }, { label: 'Status', render: (x) => fmt.status[x.status] },
        ], r.rows, { empty: 'Nenhum agendamento no período.' })),
    );
  }

  const exportBtn = (label, format) => h('button', { class: 'btn ghost', type: 'button', onclick: async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { const q = query(); q.set('format', format); const f = await download(`/reports/bookings?${q}`, `agendamentos.${format}`); toast(`Arquivo ${f.name} baixado.`, 'ok'); } catch (err) { toast(err.message, 'err'); } finally { b.disabled = false; }
  } }, label);

  filters.addEventListener('submit', (e) => { e.preventDefault(); load(); });
  clear(root).append(pageHead('Relatórios', { actions: [exportBtn('CSV', 'csv'), exportBtn('Excel', 'xlsx'), exportBtn('PDF', 'pdf')] }), filters, out);
  await load();
}
