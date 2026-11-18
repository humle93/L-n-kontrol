// LønKontrol service worker: offline + modtag delte PDF'er (Web Share Target).
const VERSION = '1.0.0';
const CACHE = `lk-app-${VERSION}`;
const ASSETS = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'js/app.js', 'js/parse.js', 'js/checks.js', 'js/store.js', 'js/pdf-text.js', 'js/version.js',
  'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('lk-app-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const files = form.getAll('file').filter((f) => f && typeof f !== 'string');
        const inbox = await caches.open('lk-inbox');
        let i = 0;
        for (const f of files) {
          await inbox.put(new Request(`./inbox/${Date.now()}-${i++}`), new Response(f, {
            headers: { 'content-type': f.type || 'application/pdf', 'x-filename': encodeURIComponent(f.name || 'lønseddel.pdf') },
          }));
        }
      } catch (err) { /* vis bare forsiden */ }
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Netværk først for HTML (så opdateringer kommer hurtigt), cache først for resten
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then((r) => {
      const copy = r.clone(); caches.open(CACHE).then((c) => c.put('index.html', copy)); return r;
    }).catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
