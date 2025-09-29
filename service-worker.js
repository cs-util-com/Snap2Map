const CACHE_NAME = 'snap2map-shell-v2';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/src/index.js',
  '/service-worker.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => null)
      .finally(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isNavigation = event.request.mode === 'navigate';
  const isShellResource = isSameOrigin && SHELL_ASSETS.includes(url.pathname);

  if (!isSameOrigin) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);

      const fetchAndUpdate = async () => {
        const response = await fetch(event.request);
        if (response && response.ok) {
          cache.put(event.request, response.clone());
        }
        return response;
      };

      const getNavigationFallback = async () => {
        const fallback = (await cache.match('/index.html')) || (await cache.match('/'));
        return fallback || null;
      };

      if (isNavigation || isShellResource) {
        try {
          const response = await fetchAndUpdate();
          if (response) {
            return response;
          }
        } catch (error) {
          // network request failed, fall back to cache if possible
        }

        if (cached) {
          return cached;
        }

        if (isNavigation) {
          const fallback = await getNavigationFallback();
          if (fallback) {
            return fallback;
          }
        }

        return Response.error();
      }

      if (cached) {
        fetchAndUpdate().catch(() => null);
        return cached;
      }

      try {
        return await fetchAndUpdate();
      } catch (error) {
        if (cached) {
          return cached;
        }
        return Response.error();
      }
    }),
  );
});
