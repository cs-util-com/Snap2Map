const CACHE_NAME = 'snap2map-shell-v1';

const urlsToCache = [
  // App Shell
  '/',
  '/index.html',
  '/manifest.json',

  // Core JS Modules
  '/src/index.js',
  '/src/calib/model.js',
  '/src/calib/robust.js',
  '/src/calib/tps.js',
  '/src/calib/transforms.js',
  '/src/data/db.js',
  '/src/gps/gps.js',
  '/src/leaflet/map.js',
  '/src/ui/ui.js',
  '/src/util/coords.js',
  '/src/util/image.js',

  // External Libraries (must be requested with CORS enabled)
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/exifreader@4.21.1/dist/exifreader.min.js',
  'https://cdn.jsdelivr.net/npm/mathjs@12.4.2/lib/browser/math.min.js'
];

// Install event: cache all the app shell files
self.addEventListener('install', event => {
  console.log('Service Worker: Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Caching app shell');
        // Create a new Request object with 'cors' mode for CDN assets
        const cachePromises = urlsToCache.map(url => {
          const request = new Request(url, { mode: 'cors' });
          return fetch(request).then(response => {
            if (!response.ok) {
              throw new TypeError(`Bad response status ${response.status} for ${url}`);
            }
            return cache.put(request, response);
          });
        });
        return Promise.all(cachePromises);
      })
      .then(() => self.skipWaiting()) // Activate the new SW immediately
  );
});

// Activate event: clean up old caches
self.addEventListener('activate', event => {
  console.log('Service Worker: Activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('Service Worker: Clearing old cache', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim()) // Take control of open clients
  );
});

// Fetch event: serve from cache first, then network
self.addEventListener('fetch', event => {
  // We only want to cache GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        // Not in cache - fetch from network
        return fetch(event.request);
      }
    )
  );
});
