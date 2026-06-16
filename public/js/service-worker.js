// Service Worker para Puro Sabor - Soporte Offline

const CACHE_NAME = 'puro-sabor-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/mesa',
  '/admin',
  '/manifest.json',
  '/css/styles.css',
  '/js/main.js',
  '/js/api.js',
  '/assets/images/default-food.jpg'
];

const API_CACHE = 'puro-sabor-api-v1';
const IMAGE_CACHE = 'puro-sabor-images-v1';

// Instalar Service Worker
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Instalando...');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Cacheando assets estáticos');
        // No cachear todos para evitar timeout, solo los críticos
        return cache.addAll([
          '/',
          '/index.html',
          '/manifest.json'
        ]).catch((err) => {
          console.warn('[Service Worker] Error cacheando assets:', err);
        });
      })
      .then(() => {
        console.log('[Service Worker] Saltando el service worker anterior');
        return self.skipWaiting();
      })
  );
});

// Activar Service Worker
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activando...');

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => {
              // Eliminar caches antiguos
              return cacheName !== CACHE_NAME &&
                     cacheName !== API_CACHE &&
                     cacheName !== IMAGE_CACHE;
            })
            .map((cacheName) => {
              console.log('[Service Worker] Eliminando cache antiguo:', cacheName);
              return caches.delete(cacheName);
            })
        );
      })
      .then(() => {
        console.log('[Service Worker] Tomando control de todas las páginas');
        return self.clients.claim();
      })
  );
});

// Interceptar requests
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar requests no-GET
  if (request.method !== 'GET') {
    return;
  }

  // API requests - Network first, fallback to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstStrategy(request, API_CACHE));
    return;
  }

  // Imagen requests - Cache first, fallback to network
  if (request.destination === 'image') {
    event.respondWith(cacheFirstStrategy(request, IMAGE_CACHE));
    return;
  }

  // HTML/JS/CSS - Stale while revalidate
  if (request.destination === 'document' ||
      request.destination === 'script' ||
      request.destination === 'style') {
    event.respondWith(staleWhileRevalidateStrategy(request, CACHE_NAME));
    return;
  }

  // Default - Cache first
  event.respondWith(cacheFirstStrategy(request, CACHE_NAME));
});

/**
 * Network First Strategy
 * Intenta red primero, fallback a caché
 */
function networkFirstStrategy(request, cacheName) {
  return fetch(request)
    .then((response) => {
      if (!response || response.status !== 200 || response.type === 'error') {
        return response;
      }

      // Guardar en caché
      const clonedResponse = response.clone();
      caches.open(cacheName)
        .then((cache) => {
          cache.put(request, clonedResponse);
        });

      return response;
    })
    .catch(() => {
      // Fallback a caché
      return caches.match(request)
        .then((response) => {
          return response || createOfflineResponse();
        });
    });
}

/**
 * Cache First Strategy
 * Intenta caché primero, fallback a red
 */
function cacheFirstStrategy(request, cacheName) {
  return caches.match(request)
    .then((response) => {
      if (response) {
        return response;
      }

      return fetch(request)
        .then((response) => {
          if (!response || response.status !== 200) {
            return response;
          }

          const clonedResponse = response.clone();
          caches.open(cacheName)
            .then((cache) => {
              cache.put(request, clonedResponse);
            });

          return response;
        })
        .catch(() => {
          return createOfflineResponse();
        });
    });
}

/**
 * Stale While Revalidate Strategy
 * Retorna caché inmediatamente, actualiza en background
 */
function staleWhileRevalidateStrategy(request, cacheName) {
  return caches.match(request)
    .then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((response) => {
          if (!response || response.status !== 200) {
            return response;
          }

          const clonedResponse = response.clone();
          caches.open(cacheName)
            .then((cache) => {
              cache.put(request, clonedResponse);
            });

          return response;
        })
        .catch(() => {
          return cachedResponse || createOfflineResponse();
        });

      return cachedResponse || fetchPromise;
    });
}

/**
 * Crear respuesta offline
 */
function createOfflineResponse() {
  return new Response(
    '<h1>Modo Offline</h1><p>No hay conexión a internet. Por favor, intenta más tarde.</p>',
    {
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers({
        'Content-Type': 'text/html; charset=utf-8'
      })
    }
  );
}

// Manejar mensajes del cliente
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => caches.delete(cacheName))
        );
      })
      .then(() => {
        event.ports[0].postMessage({ success: true });
      });
  }
});
