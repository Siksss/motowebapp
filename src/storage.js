// shortcut: localStorage (~5 Mo, ≈ 20 h de trajets à 1 point/s), passer à IndexedDB si ça sature.
const KEY = 'moto.trips'
const CURRENT = 'moto.current'

export const loadTrips = () => JSON.parse(localStorage.getItem(KEY) || '[]')

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    alert('Stockage plein : exporte ou supprime des trajets. (' + e.message + ')')
    throw e
  }
}

export function addTrip(trip) {
  const trips = loadTrips()
  trips.unshift(trip)
  save(KEY, trips)
  localStorage.removeItem(CURRENT)
  return trips
}

export function deleteTrip(id) {
  const trips = loadTrips().filter((t) => t.id !== id)
  save(KEY, trips)
  return trips
}

// Trajet en cours sauvegardé en continu : récupéré si le navigateur tue la page.
export const saveCurrent = (points) => save(CURRENT, points)
export const loadCurrent = () => JSON.parse(localStorage.getItem(CURRENT) || 'null')
export const clearCurrent = () => localStorage.removeItem(CURRENT)
