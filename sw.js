/**
 * Charter TI - Service Worker
 * -----------------------------------------------------------------------
 * Estrategia:
 *  - App shell (HTML/CSS/JS/íconos)  -> cache-first + actualización en 2do plano
 *  - Navegación (pasajero/admin.html) -> network-first con fallback a caché / offline.html
 *  - Supabase (auth/rest/realtime) y EasyTrack (GPS) -> SIEMPRE red, nunca se cachean.
 *    Son datos en vivo (posición, asistencia, despacho): servir una versión vieja
 *    desde caché sería directamente incorrecto para este sistema.
 * -----------------------------------------------------------------------
 */

const CACHE_VERSION = "charter-ti-v1"; // subir este número en cada release para invalidar caches viejas
const PRECACHE = `${CACHE_VERSION}-precache`;
const RUNTIME = `${CACHE_VERSION}-runtime`;

// Ajustar esta lista a medida que se generen los archivos reales del proyecto (Paso 3+).
// No pasa nada si alguna ruta todavía no existe: el catch de abajo evita que falle la instalación.
const PRECACHE_URLS = [
  "/",
  "/pasajero.html",
  "/admin.html",
  "/offline.html",
  "/manifest.json",
  "/assets/css/styles.css",
  "/assets/js/app.js",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
];

// Hosts que jamás deben pasar por caché: backend (Supabase) y GPS (EasyTrack)
const NETWORK_ONLY_HOSTS = [
  "supabase.co",
  "supabase.in",
  "easytrack.com.ar",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) =>
        cache.addAll(PRECACHE_URLS).catch((err) => {
          console.warn("[SW] Precache parcial (algún recurso no existía todavía):", err);
        })
      )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("charter-ti-") && key !== PRECACHE && key !== RUNTIME
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Permite que la app fuerce la activación de una nueva versión (ej. botón "Hay una actualización disponible")
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isNetworkOnly(url) {
  return NETWORK_ONLY_HOSTS.some((host) => url.hostname.endsWith(host));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return; // nunca interceptar POST/PATCH/DELETE (mutaciones)

  const url = new URL(request.url);

  // 1) Supabase / EasyTrack: dejar pasar directo a la red, sin caché.
  if (isNetworkOnly(url)) {
    return;
  }

  // 2) Navegación entre pantallas (HTML): network-first, con fallback offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(RUNTIME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match("/offline.html");
        })
    );
    return;
  }

  // 3) Assets estáticos propios (css/js/íconos/fuentes): cache-first + revalidación en 2do plano.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              const clone = response.clone();
              caches.open(RUNTIME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});
