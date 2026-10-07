// views/bookings.js — agenda: filtros, status, remarcação e lançamento manual
import { get, post, patch, del } from '../api.js';
import {
  h, clear, toast, field, dialog, confirmDialog, formValues, showFieldErrors, fmt, pill, table, pageHead, debounce,
} from '../ui.js';
import { session } from '../main.js';

const STATUS_OPTS = Object.entries(fmt.status);

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function bookingDialog(sites, onDone, booking = null) {
  const siteSel = field({ label: 'Site', name: 'site_id', type: 'select', required: true, options: sites.map((s) => [s.id, s.name]), value: booking?.site_id });
  const svcWrap = h('div');
  const profWrap = h('div');
  const form = h('form', { class: 'form', novalidate: true },
    booking ? null : siteSel,
    h('div', { class: 'row' }, svcWrap, profWrap),
    h('div', { class: 'row' },
      field({ label: 'Data', name: 'date', type: 'date', required: true, value: booking ? booking.starts_at.slice(0, 10) : today() }),
      field({ label: 'Horário', name: 'time', type: 'time', required: true, value: booking ? booking.starts_at.slice(11, 16) : '09:00', step: 300 })),
    booking ? null : h('div', { class: 'row' },
      field({ label: 'Nome do cliente', name: 'client_name', required: true, maxlength: 120 }),
      field({ label: 'WhatsApp do cliente', name: 'client_phone', type: 'tel', required: true })),
    booking ? null : field({ label: 'E-mail do cliente', name: 'client_email', type: 'email' }),
    booking ? null : field({ label: 'Observações', name: 'notes', type: 'textarea', rows: 2, maxlength: 500 }),
    booking ? null : field({ label: 'Enviar confirmação por WhatsApp ao cliente', name: 'notify_client', type: 'checkbox', value: false }),
    h('p', { class: 'small muted', text: 'Pelo painel é possível marcar fora do expediente, mas nunca em cima de outro horário ou bloqueio.' }));

  async function loadSite(siteId) {
    const d = await get(`/sites/${siteId}`);
    clear(svcWrap).append(field({ label: 'Serviço', name: 'service_id', type: 'select', required: true,
      options: d.services.map((s) => [s.id, `${s.name}${s.active ? '' : ' (inativo)'} · ${s.duration_min} min`]), value: booking?.service_id }));
    clear(profWrap).append(field({ label: 'Profissional', name: 'professional_id', type: 'select',
      options: [['', d.professionals.length ? 'Qualquer livre' : 'Sem equipe cadastrada'], ...d.professionals.filter((p) => p.active).map((p) => [p.id, p.name])], value: booking?.professional_id ?? '' }));
  }
  if (!booking) siteSel.querySelector('select').addEventListener('change', (e) => loadSite(e.target.value));
  await loadSite(booking ? booking.site_id : sites[0].id);

  return dialog({
    title: booking ? `Remarcar — ${booking.client_name}` : 'Novo agendamento', body: form,
    actions: [{ label: 'Cancelar', value: false }, { label: booking ? 'Remarcar' : 'Agendar', class: 'primary', handler: async () => {
      const v = formValues(form);
      const body = { ...v, service_id: Number(v.service_id) };
      if (v.professional_id) body.professional_id = Number(v.professional_id); else delete body.professional_id;
      try {
        if (booking) {
          await patch(`/bookings/${booking.id}`, { date: v.date, time: v.time, service_id: body.service_id, professional_id: body.professional_id });
        } else {
          body.site_id = Number(v.site_id);
          if (!body.client_email) delete body.client_email;
          if (!body.notes) delete body.notes;
          await post('/bookings', body);
        }
        toast(booking ? 'Agendamento remarcado.' : 'Agendamento criado.', 'ok'); onDone(); return true;
      } catch (e) { if (!showFieldErrors(form, e)) toast(e.message, 'err'); return false; }
    } }],
  });
}

export async function bookingsView(root) {
  const { sites } = await get('/sites');
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const state = { site_id: params.get('site') || '', from: today(), to: '', status: '', q: '', page: 1 };

  const filters = h('form', { class: 'filters', role: 'search' },
    field({ label: 'Site', name: 'site_id', type: 'select', options: [['', 'Todos'], ...sites.map((s) => [s.id, s.name])], value: state.site_id }),
    field({ label: 'De', name: 'from', type: 'date', value: state.from }),
    field({ label: 'Até', name: 'to', type: 'date' }),
    field({ label: 'Status', name: 'status', type: 'select', options: [['', 'Todos'], ...STATUS_OPTS] }),
    field({ label: 'Cliente (nome ou telefone)', name: 'q', maxlength: 80 }));
  filters.addEventListener('submit', (e) => e.preventDefault());
  const list = h('div');

  async function load() {
    const q = new URLSearchParams();
    for (const k of ['site_id', 'from', 'to', 'status', 'q']) if (state[k]) q.set(k, state[k]);
    q.set('page', state.page); q.set('limit', 50);
    let d;
    try { d = await get(`/bookings?${q}`); } catch (e) { clear(list).append(h('div', { class: 'alert err', text: e.message })); return; }
    const pages = Math.max(1, Math.ceil(d.total / d.limit));
    clear(list).append(
      h('p', { class: 'small muted', text: `${d.total} agendamento(s) encontrado(s)` }),
      table([
        { label: 'Quando', render: (b) => h('strong', { class: 'nowrap', text: fmt.dt(b.starts_at) }) },
        { label: 'Cliente', render: (b) => h('div', {}, b.client_name, h('div', { class: 'small' }, h('a', { href: `https://wa.me/${b.client_phone}`, target: '_blank', rel: 'noopener', text: fmt.phone(b.client_phone) }))) },
        { label: 'Serviço', render: (b) => h('div', {}, b.service_name, h('div', { class: 'small muted', text: [b.professional_name, b.site_name].filter(Boolean).join(' · ') })) },
        { label: 'Valor', num: true, render: (b) => (b.price_cents ? fmt.brl(b.price_cents) : '—') },
        { label: 'Status', render: (b) => {
          const sel = h('select', { 'aria-label': `Status de ${b.client_name}`, class: 'btn sm ghost' }, STATUS_OPTS.map(([v, l]) => h('option', { value: v }, l)));
          sel.value = b.status;
          sel.addEventListener('change', async () => {
            try { await patch(`/bookings/${b.id}`, { status: sel.value }); toast('Status atualizado.', 'ok'); load(); } catch (e) { toast(e.message, 'err'); sel.value = b.status; }
          });
          return h('div', {}, pill(b.status), ' ', sel);
        } },
        { label: 'Ações', render: (b) => h('div', { class: 'cell-actions' },
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => bookingDialog(sites, load, b) }, 'Remarcar'),
          b.notes ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => dialog({ title: 'Observações', body: h('p', { text: b.notes }), actions: [{ label: 'Fechar' }] }) }, 'Obs.') : null,
          session.user.role === 'admin' ? h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => {
            if (!(await confirmDialog('Excluir agendamento', 'Excluir definitivamente? Para o dia a dia, prefira o status "Cancelado".', { danger: true, ok: 'Excluir' }))) return;
            try { await del(`/bookings/${b.id}`); toast('Agendamento excluído.', 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
          } }, 'Excluir') : null) },
      ], d.bookings, { empty: 'Nenhum agendamento com estes filtros.' }),
      pages > 1 ? h('div', { class: 'pager' },
        h('button', { class: 'btn sm ghost', type: 'button', disabled: state.page <= 1 ? true : null, onclick: () => { state.page--; load(); } }, '← Anterior'),
        h('span', { class: 'small', text: `Página ${state.page} de ${pages}` }),
        h('button', { class: 'btn sm ghost', type: 'button', disabled: state.page >= pages ? true : null, onclick: () => { state.page++; load(); } }, 'Próxima →')) : null);
  }

  const onChange = debounce(() => { Object.assign(state, formValues(filters), { page: 1 }); load(); }, 250);
  filters.addEventListener('input', onChange);
  filters.addEventListener('change', onChange);

  clear(root).append(
    pageHead('Agenda', { actions: [h('button', { class: 'btn primary', type: 'button', disabled: sites.length ? null : true, onclick: () => bookingDialog(sites, load) }, '+ Novo agendamento')] }),
    filters, list);
  await load();
  const timer = setInterval(() => { if (navigator.onLine && document.visibilityState === 'visible' && !document.querySelector('dialog[open]')) load(); }, 60_000);
  return () => clearInterval(timer);
}
