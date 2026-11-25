import { detectCorners } from './analysis.js'

const maxLeanOf = (s) => Math.max(s?.maxLeanLeft || 0, s?.maxLeanRight || 0)

export function scoreTrip(trip) {
  const s = trip?.stats || {}
  const distKm = (s.distance || 0) / 1000
  const dPlus = s.elevationGain || 0
  const maxLean = maxLeanOf(s)
  const { corners, hairpinCount } = detectCorners(trip?.points || [])

  const densityPts = Math.min(40, (corners.length / Math.max(2, distKm)) * 12)
  const leanPts = Math.min(30, maxLean * 0.7)
  const hairpinPts = Math.min(15, hairpinCount * 3)
  const climbPts = Math.min(15, (dPlus / Math.max(10, distKm)) * 0.5)
  const score = Math.round(Math.min(100, densityPts + leanPts + hairpinPts + climbPts))

  let badge = 'Balade'
  if (distKm >= 200) badge = 'Grand Tourisme'
  else if (score >= 65) badge = dPlus >= 300 ? 'Col alpin' : 'Spéciale virolo'
  else if (maxLean >= 35 || corners.length >= 6) badge = 'Route sinueuse'
  else if (distKm > 0 && distKm < 15 && (s.avgMovingSpeed || 0) >= 35) badge = 'Urbain'

  return { score, badge, cornersCount: corners.length, hairpinCount }
}

export function computeRecords(trips = []) {
  let totalDistanceM = 0
  let totalElevationM = 0
  let maxSpeedKmh = 0
  let maxSpeedTripId = null
  let bestLeanDeg = 0
  let bestLeanTripId = null
  let longestDistM = 0
  let longestTripId = null
  let bestVirolo = 0
  let bestViroloTripId = null

  for (const t of trips) {
    const s = t?.stats || {}
    const d = s.distance || 0
    const spd = s.maxSpeed || 0
    const lean = maxLeanOf(s)
    const { score } = scoreTrip(t)

    totalDistanceM += d
    totalElevationM += s.elevationGain || 0
    if (spd > maxSpeedKmh) {
      maxSpeedKmh = spd
      maxSpeedTripId = t.id
    }
    if (lean > bestLeanDeg) {
      bestLeanDeg = lean
      bestLeanTripId = t.id
    }
    if (d > longestDistM) {
      longestDistM = d
      longestTripId = t.id
    }
    if (score > bestVirolo) {
      bestVirolo = score
      bestViroloTripId = t.id
    }
  }

  return {
    totalTrips: trips.length,
    totalDistanceM,
    totalElevationM,
    maxSpeedKmh,
    maxSpeedTripId,
    bestLeanDeg,
    bestLeanTripId,
    longestDistM,
    longestTripId,
    bestVirolo,
    bestViroloTripId,
  }
}

export function filterAndSortTrips(trips = [], { query = '', sort = 'recent' } = {}) {
  const q = query.trim().toLowerCase()
  const filtered = !q
    ? [...trips]
    : trips.filter((t) => {
        const name = (t.name || '').toLowerCase()
        const note = (t.note || '').toLowerCase()
        const tags = Array.isArray(t.tags) ? t.tags.join(' ').toLowerCase() : ''
        const dateStr = t.date ? new Date(t.date).toLocaleDateString('fr-FR').toLowerCase() : ''
        return name.includes(q) || note.includes(q) || tags.includes(q) || dateStr.includes(q)
      })

  filtered.sort((a, b) => {
    if (sort === 'distance') return (b.stats?.distance ?? 0) - (a.stats?.distance ?? 0)
    if (sort === 'speed') return (b.stats?.maxSpeed ?? 0) - (a.stats?.maxSpeed ?? 0)
    if (sort === 'lean') return maxLeanOf(b.stats) - maxLeanOf(a.stats)
    return (b.date ?? b.id ?? 0) - (a.date ?? a.id ?? 0)
  })
  return filtered
}
