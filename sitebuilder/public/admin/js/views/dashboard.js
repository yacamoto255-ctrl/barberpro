// views/dashboard.js — indicadores com atualização automática
import { get } from '../api.js';
import { h, clear, fmt, pill, pageHead, emptyState } from '../ui.js';
import { setUnread } from '../main.js';

const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function kpi(label, value, hint) {
  return h('div', { class: 'card kpi' }, h('div', { class: 'label', text: label }), h('div', { class: 'value', text: value }), hint ? h('div', { class: 'hint', text: hint }) : null);
}

function chart(daily) {
  const max = Math.max(1, ...daily.map((d) => d.count));
  return h('div', { class: 'chart', role: 'img', 'aria-label': `Agendamentos nos próximos 14 dias: ${daily.map((d) => `${fmt.date(d.date)} ${d.count}`).join(', ')}` },
    daily.map((d) => {
      const [y, m, dd] = d.date.split('-').map(Number);
      const wd = WD[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
      return h('div', { class: 'bar', title: `${fmt.date(d.date)}: ${d.count}` },
        h('span', { class: 'n', text: String(d.count) }),
        h('span', { class: 'fill', style: { height: `${Math.round((d.count / max) * 100)}%` } }),
        h('span', { class: 'd' }, wd, h('br'), String(dd).padStart(2, '0')));
    }));
}

export async function dashboardView(root) {
  const sites = (await get('/sites')).sites;
  const siteSel = h('select', { 'aria-label': 'Filtrar por site', class: 'btn ghost' },
    h('option', { value: '' }, 'Todos os sites'), sites.map((s) => h('option', { value: String(s.id) }, s.name)));
  const body = h('div');
  const updated = h('span', { class: 'small muted' });

  async function load() {
    const q = siteSel.value ? `?site_id=${siteSel.value}` : '';
    const d = await get(`/dashboard${q}`);
    setUnread(d.cards.unread_notifications);
    const c = d.cards;
    clear(body).append(
      !sites.length ? h('div', { class: 'alert info' }, 'Comece criando o primeiro site em ', h('a', { href: '#/sites/novo' }, 'Sites → Novo site'), '.') : null,
      h('div', { class: 'grid g4' },
        kpi('Hoje', String(c.today_bookings), 'agendamentos'),
        kpi('Próximos 7 dias', String(c.next7_bookings), 'pendentes e confirmados'),
        kpi('Previsto no mês', fmt.brl(c.month_revenue_expected), `${c.month_bookings} agendamentos`),
        kpi('Realizado no mês', fmt.brl(c.month_revenue_done), `${c.month_cancelled} cancelamento(s)`)),
      h('div', { class: 'grid g2', style: { marginTop: '16px' } },
        h('div', { class: 'card' }, h('h2', { text: 'Agenda dos próximos 14 dias' }), chart(d.daily)),
        h('div', { class: 'card' }, h('h2', { text: 'Próximos atendimentos' }),
          d.upcoming.length ? h('div', { class: 'list' }, d.upcoming.map((b) => h('div', { class: 'list-item' },
            h('div', {}, h('strong', { text: `${fmt.dt(b.starts_at)} · ${b.client_name}` }),
              h('div', { class: 'small muted', text: `${b.service_name}${b.professional_name ? ' com ' + b.professional_name : ''} — ${b.site_name}` })),
            pill(b.status)))) : emptyState('Sem atendimentos marcados', 'Os agendamentos feitos pelos sites aparecem aqui.'))),
      h('div', { class: 'grid g2', style: { marginTop: '16px' } },
        h('div', { class: 'card' }, h('h2', { text: 'Serviços mais agendados no mês' }),
          d.top_services.length ? h('div', { class: 'list' }, d.top_services.map((s) => h('div', { class: 'list-item' },
            h('span', { text: s.name }), h('strong', { text: `${s.count} · ${fmt.brl(s.revenue_cents)}` })))) : emptyState('Sem dados neste mês')),
        h('div', { class: 'card' }, h('h2', { text: 'Sites' }),
          h('p', {}, h('strong', { text: `${c.sites_published} publicado(s)` }), ` de ${c.sites_total} criado(s).`),
          h('a', { class: 'btn ghost', href: '#/sites' }, 'Gerenciar sites'))),
    );
    updated.textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · atualiza sozinho a cada minuto`;
  }

  siteSel.addEventListener('change', load);
  clear(root).append(pageHead('Painel', { actions: [siteSel] }), updated, h('div', { style: { height: '12px' } }), body);
  await load();
  const timer = setInterval(() => { if (navigator.onLine && document.visibilityState === 'visible') load().catch(() => {}); }, 60_000);
  return () => clearInterval(timer);
}
