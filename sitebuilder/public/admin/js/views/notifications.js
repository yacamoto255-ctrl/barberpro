// views/notifications.js — alertas internos
import { get, post } from '../api.js';
import { h, clear, toast, fmt, pageHead, emptyState } from '../ui.js';
import { setUnread } from '../main.js';

export async function notificationsView(root) {
  const list = h('div', { class: 'list' });
  async function load() {
    const d = await get('/notifications?limit=100');
    setUnread(d.unread);
    clear(list).append(...(d.notifications.length ? d.notifications.map((n) => h('div', { class: `list-item ${n.read_at ? '' : 'unread'}` },
      h('div', {}, h('strong', { text: n.title }), h('div', { text: n.message }), h('div', { class: 'small muted', text: fmt.utc(n.created_at) })),
      h('div', { class: 'cell-actions' },
        n.booking_id ? h('a', { class: 'btn sm ghost', href: `#/agenda?site=${n.site_id}` }, 'Ver agenda') : null,
        n.read_at ? null : h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => {
          try { const r = await post(`/notifications/${n.id}/read`); setUnread(r.unread); load(); } catch (e) { toast(e.message, 'err'); }
        } }, 'Marcar como lida')))) : [emptyState('Nenhuma notificação', 'Novos agendamentos e cancelamentos aparecem aqui.')]));
  }
  clear(root).append(pageHead('Notificações', { actions: [h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
    try { await post('/notifications/read-all'); setUnread(0); load(); } catch (e) { toast(e.message, 'err'); }
  } }, 'Marcar todas como lidas')] }), list);
  await load();
  const timer = setInterval(() => { if (navigator.onLine && document.visibilityState === 'visible') load().catch(() => {}); }, 30_000);
  return () => clearInterval(timer);
}
