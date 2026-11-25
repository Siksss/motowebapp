const DB_NAME = 'motowebapp-db'
const DB_VER = 1
const TRIPS_STORE = 'trips'
const META_STORE = 'meta'
const KEY = 'moto.trips'
const CURRENT = 'moto.current'

function sortTrips(trips) {
  return [...trips].sort((a, b) => (b.date ?? b.id ?? 0) - (a.date ?? a.id ?? 0))
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error || new Error('Transaction annulée'))
  })
}

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export function createStorage({ idb, ls } = {}) {
  let dbPromise = null
  let migrated = false
  let migratePromise = null

  function openDb() {
    if (!idb) return Promise.resolve(null)
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        try {
          const req = idb.open(DB_NAME, DB_VER)
          req.onupgradeneeded = () => {
            const db = req.result
            if (!db.objectStoreNames.contains(TRIPS_STORE)) {
              db.createObjectStore(TRIPS_STORE, { keyPath: 'id' })
            }
            if (!db.objectStoreNames.contains(META_STORE)) {
              db.createObjectStore(META_STORE, { keyPath: 'key' })
            }
          }
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(null)
        } catch {
          resolve(null)
        }
      })
    }
    return dbPromise
  }

  async function ensureMigrated(db) {
    if (migrated || !db || !ls) return
    if (!migratePromise) {
      migratePromise = (async () => {
        const legacy = safeParse(ls.getItem(KEY), null)
        if (Array.isArray(legacy) && legacy.length > 0) {
          const tx = db.transaction(TRIPS_STORE, 'readwrite')
          const store = tx.objectStore(TRIPS_STORE)
          for (const t of legacy) {
            if (t && t.id != null) store.put(t)
          }
          await txDone(tx)
          ls.removeItem(KEY)
        }
        migrated = true
      })().catch((e) => {
        migratePromise = null
        throw e
      })
    }
    await migratePromise
  }

  async function readAllTrips(db) {
    const tx = db.transaction(TRIPS_STORE, 'readonly')
    const all = await reqP(tx.objectStore(TRIPS_STORE).getAll())
    await txDone(tx)
    return sortTrips(all || [])
  }

  async function loadTrips() {
    const db = await openDb()
    if (db) {
      await ensureMigrated(db)
      return readAllTrips(db)
    }
    return sortTrips(safeParse(ls?.getItem(KEY), []))
  }

  async function addTrip(trip) {
    const db = await openDb()
    if (db) {
      await ensureMigrated(db)
      const tx = db.transaction([TRIPS_STORE, META_STORE], 'readwrite')
      tx.objectStore(TRIPS_STORE).put(trip)
      tx.objectStore(META_STORE).delete('current')
      await txDone(tx)
      try {
        ls?.removeItem(CURRENT)
      } catch {
        /* ignore */
      }
      return readAllTrips(db)
    }
    const trips = sortTrips([trip, ...safeParse(ls?.getItem(KEY), [])])
    ls?.setItem(KEY, JSON.stringify(trips))
    ls?.removeItem(CURRENT)
    return trips
  }

  async function updateTrip(trip) {
    const db = await openDb()
    if (db) {
      await ensureMigrated(db)
      const tx = db.transaction(TRIPS_STORE, 'readwrite')
      tx.objectStore(TRIPS_STORE).put(trip)
      await txDone(tx)
      return readAllTrips(db)
    }
    const trips = sortTrips(
      safeParse(ls?.getItem(KEY), []).map((t) => (t.id === trip.id ? trip : t))
    )
    ls?.setItem(KEY, JSON.stringify(trips))
    return trips
  }

  async function deleteTrip(id) {
    const db = await openDb()
    if (db) {
      await ensureMigrated(db)
      const tx = db.transaction(TRIPS_STORE, 'readwrite')
      tx.objectStore(TRIPS_STORE).delete(id)
      await txDone(tx)
      return readAllTrips(db)
    }
    const trips = sortTrips(safeParse(ls?.getItem(KEY), []).filter((t) => t.id !== id))
    ls?.setItem(KEY, JSON.stringify(trips))
    return trips
  }

  async function saveCurrent(points) {
    try {
      ls?.setItem(CURRENT, JSON.stringify(points))
    } catch {
      /* localStorage plein en trajet : IndexedDB prend le relais sans bloquer */
    }
    const db = await openDb()
    if (db) {
      const tx = db.transaction(META_STORE, 'readwrite')
      tx.objectStore(META_STORE).put({ key: 'current', points })
      await txDone(tx)
    }
  }

  async function loadCurrent() {
    let lsPts = null
    try {
      lsPts = safeParse(ls?.getItem(CURRENT), null)
    } catch {
      lsPts = null
    }
    const db = await openDb()
    let dbPts = null
    if (db) {
      const tx = db.transaction(META_STORE, 'readonly')
      const rec = await reqP(tx.objectStore(META_STORE).get('current'))
      await txDone(tx)
      dbPts = rec?.points ?? null
    }
    if (!dbPts) return lsPts
    if (!lsPts) return dbPts
    return dbPts.length >= lsPts.length ? dbPts : lsPts
  }

  async function clearCurrent() {
    try {
      ls?.removeItem(CURRENT)
    } catch {
      /* ignore */
    }
    const db = await openDb()
    if (db) {
      const tx = db.transaction(META_STORE, 'readwrite')
      tx.objectStore(META_STORE).delete('current')
      await txDone(tx)
    }
  }

  return {
    loadTrips,
    addTrip,
    updateTrip,
    deleteTrip,
    saveCurrent,
    loadCurrent,
    clearCurrent,
  }
}

const defaultStorage = createStorage({
  idb: typeof indexedDB !== 'undefined' ? indexedDB : null,
  ls: typeof localStorage !== 'undefined' ? localStorage : null,
})

export const loadTrips = () => defaultStorage.loadTrips()
export const addTrip = (trip) => defaultStorage.addTrip(trip)
export const updateTrip = (trip) => defaultStorage.updateTrip(trip)
export const deleteTrip = (id) => defaultStorage.deleteTrip(id)
export const saveCurrent = (points) => defaultStorage.saveCurrent(points)
export const loadCurrent = () => defaultStorage.loadCurrent()
export const clearCurrent = () => defaultStorage.clearCurrent()

export async function storageEstimate() {
  try {
    const est = await navigator.storage?.estimate?.()
    if (!est || est.quota == null) return null
    return { usage: est.usage ?? 0, quota: est.quota }
  } catch {
    return null
  }
}
