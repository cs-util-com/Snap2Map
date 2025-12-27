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

async function fetchAndUpdate(request, cache) {
  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

async function getNavigationFallback(cache) {
  const fallback = (await cache.match('/index.html')) || (await cache.match('/'));
  return fallback || null;
}

async function handleShellOrNavigation(request, cache, cached) {
  const isNavigation = request.mode === 'navigate';
  try {
    const response = await fetchAndUpdate(request, cache);
    if (response && response.ok) {
      return response;
    }
  } catch {
    // network request failed, fall back to cache if possible
  }

  if (cached) {
    return cached;
  }

  if (isNavigation) {
    const fallback = await getNavigationFallback(cache);
    if (fallback) {
      return fallback;
    }
  }

  return Response.error();
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  if (!isSameOrigin) {
    return;
  }

  const isNavigation = event.request.mode === 'navigate';
  const isShellResource = SHELL_ASSETS.includes(url.pathname);

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);

      if (isNavigation || isShellResource) {
        return handleShellOrNavigation(event.request, cache, cached);
      }

      if (cached) {
        fetchAndUpdate(event.request, cache).catch(() => null);
        return cached;
      }

      try {
        return await fetchAndUpdate(event.request, cache);
      } catch {
        return cached || Response.error();
      }
    }),
  );
});
