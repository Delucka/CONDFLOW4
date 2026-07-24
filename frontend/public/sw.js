// Service worker do CondoFlow — instalável + casca offline.
// SEGURO: nunca intercepta /api, auth ou domínios externos (Supabase, OCR).
const CACHE = 'condoflow-shell-v2';   // sobe a versão pra descartar bundle antigo em cache
const OFFLINE_FALLBACK = '/dashboard';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Só o próprio site. Nada de API/auth/Supabase/OCR passa por aqui.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api')) return;

  // Navegação (páginas): rede primeiro; se cair, usa cache/fallback.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch (e) {
        const cached = await caches.match(request);
        return cached || (await caches.match(OFFLINE_FALLBACK)) || Response.error();
      }
    })());
    return;
  }

  // Estáticos do próprio site (_next, ícones, fontes): cache + revalida em segundo plano.
  const isStatic = url.pathname.startsWith('/_next/') || /\.(?:png|svg|gif|ico|webp|woff2?|css|js)$/.test(url.pathname);
  if (isStatic) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      const network = fetch(request).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })());
  }
});
