import test from 'node:test'
import assert from 'node:assert/strict'
import { createStorage } from './storage.js'

function createMockLS(initial = {}, { throwOnSet = false } = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (throwOnSet) throw new Error('QuotaExceededError')
      map.set(k, String(v))
    },
    removeItem: (k) => map.delete(k),
    _map: map,
  }
}

function createMockIDB() {
  const stores = new Map()
  const storeNames = { contains: (n) => stores.has(n) }
  const db = {
    objectStoreNames: storeNames,
    createObjectStore: (name, { keyPath }) => {
      stores.set(name, { keyPath, data: new Map() })
    },
    transaction: (names) => {
      const list = Array.isArray(names) ? names : [names]
      const tx = { oncomplete: null, onerror: null, onabort: null }
      let pending = 0
      const scheduleComplete = () => {
        if (pending === 0) queueMicrotask(() => tx.oncomplete?.())
      }
      const makeReq = (fn) => {
        pending++
        const req = { result: undefined, error: null, onsuccess: null, onerror: null }
        queueMicrotask(() => {
          try {
            req.result = fn()
            req.onsuccess?.()
          } catch (e) {
            req.error = e
            req.onerror?.()
          } finally {
            pending--
            scheduleComplete()
          }
        })
        return req
      }
      tx.objectStore = (name) => {
        if (!list.includes(name)) throw new Error('Unknown store ' + name)
        const s = stores.get(name)
        return {
          put: (val) => makeReq(() => s.data.set(val[s.keyPath], structuredClone(val))),
          get: (key) => makeReq(() => (s.data.has(key) ? structuredClone(s.data.get(key)) : undefined)),
          getAll: () => makeReq(() => [...s.data.values()].map((v) => structuredClone(v))),
          delete: (key) => makeReq(() => s.data.delete(key)),
        }
      }
      scheduleComplete()
      return tx
    },
  }
  return {
    open: () => {
      const req = { result: db, onupgradeneeded: null, onsuccess: null, onerror: null }
      queueMicrotask(() => {
        if (!stores.size) req.onupgradeneeded?.()
        req.onsuccess?.()
      })
      return req
    },
    _stores: stores,
  }
}

test('storage : migration localStorage -> IndexedDB sans perte et tri décroissant', async () => {
  const legacy = [
    { id: 1, date: 1000, points: [], stats: {} },
    { id: 2, date: 3000, points: [], stats: {} },
  ]
  const ls = createMockLS({ 'moto.trips': JSON.stringify(legacy) })
  const idb = createMockIDB()
  const store = createStorage({ idb, ls })

  const loaded = await store.loadTrips()
  assert.deepEqual(
    loaded.map((t) => t.id),
    [2, 1]
  )
  // Ancienne clé nettoyée uniquement après migration réussie
  assert.equal(ls.getItem('moto.trips'), null)
  assert.equal(idb._stores.get('trips').data.size, 2)
})

test('storage : addTrip, updateTrip (renommage) et deleteTrip', async () => {
  const store = createStorage({ idb: createMockIDB(), ls: createMockLS() })
  await store.addTrip({ id: 10, date: 2000, points: [], stats: {} })
  await store.addTrip({ id: 20, date: 5000, points: [], stats: {} })

  const renamed = await store.updateTrip({ id: 10, date: 2000, name: 'Col du Galibier', points: [], stats: {} })
  assert.equal(renamed.find((t) => t.id === 10).name, 'Col du Galibier')
  assert.deepEqual(
    renamed.map((t) => t.id),
    [20, 10]
  )

  const afterDel = await store.deleteTrip(20)
  assert.deepEqual(
    afterDel.map((t) => t.id),
    [10]
  )
})

test('storage : saveCurrent / loadCurrent / clearCurrent résiste à QuotaExceededError', async () => {
  const ls = createMockLS({}, { throwOnSet: true })
  const store = createStorage({ idb: createMockIDB(), ls })
  const pts = [
    { lat: 45, lon: 6, t: 1000 },
    { lat: 45.01, lon: 6.01, t: 2000 },
  ]

  await store.saveCurrent(pts)
  assert.deepEqual(await store.loadCurrent(), pts)

  await store.addTrip({ id: 99, date: 1000, points: pts, stats: {} })
  assert.equal(await store.loadCurrent(), null)

  await store.saveCurrent(pts)
  await store.clearCurrent()
  assert.equal(await store.loadCurrent(), null)
})

test('storage : repli localStorage quand IndexedDB est indisponible', async () => {
  const ls = createMockLS()
  const store = createStorage({ idb: null, ls })
  await store.addTrip({ id: 1, date: 100, points: [], stats: {} })
  await store.updateTrip({ id: 1, date: 100, name: 'Test repli', points: [], stats: {} })
  const all = await store.loadTrips()
  assert.equal(all.length, 1)
  assert.equal(all[0].name, 'Test repli')
  await store.deleteTrip(1)
  assert.deepEqual(await store.loadTrips(), [])
})
