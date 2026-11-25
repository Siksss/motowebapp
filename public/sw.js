const CACHE = 'motowebapp-v1'
const TILES_CACHE = 'motowebapp-tiles-v1'
const MAX_TILES = 250

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== TILES_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

async function trimTilesCache(cache) {
  const keys = await cache.keys()
  const excess = keys.length - MAX_TILES
  for (let i = 0; i < excess; i++) {
    await cache.delete(keys[i])
  }
}

async function handleTile(req) {
  const cache = await caches.open(TILES_CACHE)
  const cached = await cache.match(req)
  const update = fetch(req)
    .then(async (res) => {
      if (res && (res.ok || res.type === 'opaque')) {
        await cache.put(req, res.clone())
        await trimTilesCache(cache)
      }
      return res
    })
    .catch(() => null)
  if (cached) return cached
  const fresh = await update
  return fresh || Response.error()
}

async function handleApp(req) {
  const cache = await caches.open(CACHE)
  try {
    const res = await fetch(req)
    if (res && res.ok) await cache.put(req, res.clone())
    return res
  } catch {
    const cached = await cache.match(req)
    if (cached) return cached
    if (req.mode === 'navigate') {
      return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error()
    }
    return Response.error()
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(handleTile(req))
    return
  }
  if (url.origin === self.location.origin) {
    event.respondWith(handleApp(req))
  }
})
