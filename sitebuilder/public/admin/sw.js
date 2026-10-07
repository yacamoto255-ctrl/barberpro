// sw.js — mantém o "casco" do painel disponível sem internet.
// Rede primeiro (para pegar atualizações); cache só como reserva. A API nunca é cacheada.
const CACHE = 'versal-admin-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.json', 'icon.svg',
  'js/main.js', 'js/api.js', 'js/ui.js',
  'js/views/dashboard.js', 'js/views/sites.js', 'js/views/bookings.js', 'js/views/reports.js',
  'js/views/notifications.js', 'js/views/admin.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith('/admin/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('index.html'))),
  );
});
