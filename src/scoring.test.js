import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { scoreTrip, computeRecords, filterAndSortTrips } from './scoring.js'

function makeTwistyTrip(id, { name, distM = 6000, maxSpeed = 95, maxLean = 42, elevationGain = 420 } = {}) {
  // Génère des épingles réalistes (~135° de changement de cap sur 3 points) pour detectCorners
  const points = []
  let lat = 45.0
  let lon = 6.0
  let t = id
  let hDeg = -65
  const step = 0.00045
  const push = (speed, lean) => {
    const rad = (hDeg * Math.PI) / 180
    lat += Math.cos(rad) * step
    lon += (Math.sin(rad) * step) / Math.cos((lat * Math.PI) / 180)
    points.push({ lat, lon, t: (t += 2000), speed, lean, alt: 500 + points.length * 10 })
  }

  push(20, 0)
  for (let c = 0; c < 10; c++) {
    const side = c % 2 === 0 ? 1 : -1
    for (let k = 0; k < 3; k++) {
      hDeg += side * 45
      push(14, side * maxLean)
    }
    push(20, 0)
  }
  return {
    id,
    name,
    date: id,
    points,
    stats: {
      distance: distM,
      duration: 600,
      movingTime: 560,
      maxSpeed,
      avgSpeed: 72,
      avgMovingSpeed: 77,
      maxLeanLeft: maxLean,
      maxLeanRight: maxLean - 2,
      elevationGain,
    },
  }
}

describe('profil pilote & indice Virolo (scoring)', () => {
  it('attribue un score Virolo élevé et un badge Col alpin sur sortie sinueuse en altitude', () => {
    const trip = makeTwistyTrip(1000, { distM: 6000, maxLean: 44, elevationGain: 550 })
    const res = scoreTrip(trip)
    assert.ok(res.score >= 70, `score attendu >= 70, reçu ${res.score}`)
    assert.equal(res.badge, 'Col alpin')
    assert.ok(res.cornersCount >= 6)
  })

  it('calcule les records personnels et cumuls globaux', () => {
    const t1 = makeTwistyTrip(1000, { name: 'Galibier', distM: 45000, maxSpeed: 108, maxLean: 38, elevationGain: 600 })
    const t2 = {
      id: 2000,
      name: 'Boulot',
      date: 2000,
      points: [
        { lat: 48, lon: 2, t: 2000, speed: 15, lean: 12 },
        { lat: 48.01, lon: 2, t: 62000, speed: 15, lean: 46 },
      ],
      stats: { distance: 8000, maxSpeed: 132, maxLeanLeft: 46, maxLeanRight: 18, elevationGain: 30, avgMovingSpeed: 48 },
    }
    assert.equal(scoreTrip(t2).badge, 'Route sinueuse')

    const rec = computeRecords([t1, t2])
    assert.equal(rec.totalTrips, 2)
    assert.equal(rec.totalDistanceM, 53000)
    assert.equal(rec.totalElevationM, 630)
    assert.equal(rec.maxSpeedKmh, 132)
    assert.equal(rec.maxSpeedTripId, 2000)
    assert.equal(rec.bestLeanDeg, 46)
    assert.equal(rec.bestLeanTripId, 2000)
    assert.equal(rec.longestDistM, 45000)
    assert.equal(rec.longestTripId, 1000)
  })

  it('filtre par recherche et trie par récence, distance, vitesse et angle', () => {
    const t1 = makeTwistyTrip(1000, { name: 'Vercors', distM: 30000, maxSpeed: 90, maxLean: 30 })
    const t2 = makeTwistyTrip(2000, { name: 'Chartreuse', distM: 50000, maxSpeed: 120, maxLean: 25 })
    const t3 = makeTwistyTrip(3000, { name: 'Mont-Ventoux', distM: 20000, maxSpeed: 80, maxLean: 45 })
    const all = [t1, t2, t3]

    assert.deepEqual(filterAndSortTrips(all, { query: 'char' }).map((t) => t.id), [2000])
    assert.deepEqual(filterAndSortTrips(all, { sort: 'distance' }).map((t) => t.id), [2000, 1000, 3000])
    assert.deepEqual(filterAndSortTrips(all, { sort: 'speed' }).map((t) => t.id), [2000, 1000, 3000])
    assert.deepEqual(filterAndSortTrips(all, { sort: 'lean' }).map((t) => t.id), [3000, 1000, 2000])

    const withJournal = [{ ...t1, tags: ['Col', 'Duo'], note: 'Super asphalte' }, t2]
    assert.deepEqual(filterAndSortTrips(withJournal, { query: 'duo' }).map((t) => t.id), [1000])
    assert.deepEqual(filterAndSortTrips(withJournal, { query: 'asphalte' }).map((t) => t.id), [1000])
  })
})
