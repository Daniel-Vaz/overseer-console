/*
 * Service worker: makes the console work offline and start fast.
 *
 * The game data already lives on the device, so once the pages and an engine
 * are cached nothing needs the network. Three kinds of request:
 *   - pages and engine descriptors: network first, so a new deploy is picked
 *     up, with the cached copy as the offline fallback;
 *   - files whose name or query carries a content hash: cache first, they
 *     never change;
 *   - everything else: cached copy now, refreshed in the background.
 *
 * A new version waits until every page of the old one is closed, so a page
 * never mixes files from two deploys.
 */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const SHELL = `overseer-shell-${VERSION}`;
const RUNTIME = 'overseer-runtime';
const SCOPE = new URL(self.registration.scope).pathname;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE.map((file) => SCOPE + file))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('overseer-shell-') && name !== SHELL) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

// Servers add "Vary" headers (encoding, origin) that would make a cached file
// miss for a request that differs only in those. The files here do not vary.
const ANY = { ignoreVary: true };

async function fromCache(request, options) {
  return (await caches.match(request, { ...ANY, ...options })) ?? Response.error();
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(SHELL)).put(request, response.clone());
    return response;
  } catch {
    // Offline: the page as last seen. Queries (?game=fo2) do not change the document.
    return fromCache(request, { ignoreSearch: true });
  }
}

async function cacheFirst(request, url) {
  const cached = await caches.match(request, ANY);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(RUNTIME);
    // An engine file is replaced by its newer build rather than kept beside it.
    for (const old of await cache.keys()) {
      if (new URL(old.url).pathname === url.pathname) await cache.delete(old);
    }
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME);
  const cached = await caches.match(request, ANY);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) void cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached ?? Response.error());
  return cached ?? refresh;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;

  const path = url.pathname.slice(SCOPE.length);
  if (request.mode === 'navigate' || path === '' || path.endsWith('.html') || path.endsWith('engine.json')) {
    event.respondWith(networkFirst(request));
  } else if (path.startsWith('assets/') || url.searchParams.has('v')) {
    event.respondWith(cacheFirst(request, url));
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});
