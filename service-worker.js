/* ═══════════════════════════════════════════════════════════════
   DocBook PWA — Service Worker
   استراتيجية: Cache First للأصول الثابتة، Network First لـ Firebase
   ═══════════════════════════════════════════════════════════════ */

const CACHE_NAME    = 'docbook-v2';
const CACHE_STATIC  = 'docbook-static-v2';
const CACHE_DYNAMIC = 'docbook-dynamic-v2';

/* الأصول الأساسية التي تُحفَظ عند التثبيت */
const PRECACHE_URLS = [
  './',
  './index.html',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://unpkg.com/lucide@latest/dist/umd/lucide.min.js',
  'https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800&family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap'
];

/* ── تثبيت: حفظ الأصول الأساسية ── */
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache =>
      Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(err => console.warn('[SW] تعذّر تخزين:', url, err))
        )
      )
    )
  );
});

/* ── تفعيل: حذف الكاش القديم ── */
self.addEventListener('activate', event => {
  const allowedCaches = [CACHE_STATIC, CACHE_DYNAMIC];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => !allowedCaches.includes(k))
          .map(k => { console.log('[SW] حذف كاش قديم:', k); return caches.delete(k); })
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch: اختر الاستراتيجية حسب نوع الطلب ── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  /* 1. Firebase / Firestore → Network First (البيانات تتغير دائماً) */
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase.googleapis.com') ||
    url.hostname.includes('firebasestorage.googleapis.com') ||
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('gstatic.com')
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  /* 2. خطوط Google Fonts → Stale While Revalidate */
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(staleWhileRevalidate(request, CACHE_DYNAMIC));
    return;
  }

  /* 3. CDN (Tailwind, FontAwesome, Lucide) → Cache First */
  if (
    url.hostname.includes('cdn.tailwindcss.com') ||
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('unpkg.com')
  ) {
    event.respondWith(cacheFirst(request, CACHE_STATIC));
    return;
  }

  /* 4. ملفات التطبيق المحلية → Cache First */
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, CACHE_STATIC));
    return;
  }

  /* 5. أي طلب آخر → Network مع Fallback */
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

/* ════════════════════════════════════
   استراتيجيات الكاش
   ════════════════════════════════════ */

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && request.method === 'GET') {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || fetchPromise;
}

/* ── رسائل من التطبيق ── */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'GET_VERSION') {
    event.source.postMessage({ type: 'VERSION', version: CACHE_NAME });
  }
});
