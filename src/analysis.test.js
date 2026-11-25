import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bearing,
  angleDiff,
  detectCorners,
  buildTelemetrySeries,
  buildColorSegments,
  buildAltitudeProfile,
  compareTrips,
  buildMonthlySummary,
  analyzeRidingStyle,
} from './analysis.js'

test('analysis : bearing et angleDiff gèrent le passage 355° -> 5°', () => {
  const north = bearing({ lat: 45, lon: 6 }, { lat: 45.01, lon: 6 })
  assert.ok(north < 1 || north > 359)
  const east = bearing({ lat: 45, lon: 6 }, { lat: 45, lon: 6.01 })
  assert.ok(Math.abs(east - 90) < 1)
  assert.equal(angleDiff(355, 5), 10)
  assert.equal(angleDiff(5, 355), -10)
})

test('analysis : detectCorners détecte épingle gauche et courbe droite (capteurs)', () => {
  const pts = []
  let t = 1700000000000
  let lat = 45.0
  let lon = 6.0

  // 1. Ligne droite (5 s)
  for (let i = 0; i < 5; i++) {
    lat += 0.00015
    pts.push({ lat, lon, t: (t += 1000), speed: 18, lean: 0 })
  }
  // 2. Épingle gauche (~160°, 4 s, angle max 38°)
  for (let i = 0; i < 4; i++) {
    const a = (i + 1) * (40 * Math.PI / 180)
    lat += 0.0001 * Math.cos(a)
    lon -= 0.0001 * Math.sin(a)
    pts.push({ lat, lon, t: (t += 1000), speed: 12, lean: i === 2 ? 38 : 28 })
  }
  // 3. Ligne droite (4 s)
  for (let i = 0; i < 4; i++) {
    lat -= 0.00015
    pts.push({ lat, lon, t: (t += 1000), speed: 22, lean: 1 })
  }
  // 4. Courbe droite (~45°, 3 s, angle max -24°)
  for (let i = 0; i < 3; i++) {
    const a = (i + 1) * (15 * Math.PI / 180)
    lat -= 0.00015 * Math.cos(a)
    lon -= 0.00015 * Math.sin(a)
    pts.push({ lat, lon, t: (t += 1000), speed: 24, lean: i === 1 ? -24 : -18 })
  }

  const res = detectCorners(pts)
  assert.equal(res.corners.length, 2)
  assert.equal(res.leftCount, 1)
  assert.equal(res.rightCount, 1)
  assert.equal(res.hairpinCount, 1)
  assert.equal(res.topCorners[0].kind, 'Épingle')
  assert.equal(res.topCorners[0].side, 'left')
  assert.equal(res.topCorners[0].maxLean, 38)
  assert.equal(res.topCorners[1].side, 'right')
  assert.equal(res.topCorners[1].kind, 'Courbe')
})

test('analysis : repli courbure GPS pour GPX sans capteur d\'inclinaison', () => {
  const pts = []
  let t = 1700000000000
  // Arc régulier à gauche de rayon ~50 m à 15 m/s (~25° théorique)
  const R = 50
  const v = 15
  for (let i = 0; i < 8; i++) {
    const ang = (i * v) / R // rad
    const lat = 45 + (R * Math.sin(ang)) / 111195
    const lon = 6 + (R * (1 - Math.cos(ang))) / (111195 * Math.cos((45 * Math.PI) / 180))
    pts.push({ lat, lon, t: (t += 1000), speed: v, lean: 0 })
  }
  const res = detectCorners(pts)
  assert.ok(res.corners.length >= 1)
  assert.ok(res.corners[0].maxLean > 15)
})

test('analysis : buildTelemetrySeries préserve le pic d\'angle lors du sous-échantillonnage', () => {
  const pts = Array.from({ length: 500 }, (_, i) => ({
    lat: 45 + i * 0.0001,
    lon: 6,
    t: 1000 * i,
    speed: 20,
    lean: i === 237 ? -44 : 2,
  }))
  const series = buildTelemetrySeries(pts, 50)
  assert.equal(series.length, 50)
  assert.ok(series.some((s) => s.lean === -44))
})

test('analysis : buildColorSegments fusionne les segments contigus de même couleur', () => {
  const pts = [
    { lat: 45, lon: 6, t: 0, speed: 10, lean: 5 }, // 36 km/h (<50)
    { lat: 45.001, lon: 6, t: 1000, speed: 11, lean: 6 }, // 39.6 km/h (<50)
    { lat: 45.002, lon: 6, t: 2000, speed: 11, lean: 8 }, // 39.6 km/h (<50) -> fusionné
    { lat: 45.003, lon: 6, t: 3000, speed: 25, lean: 20 }, // avg ~65 km/h (50-90)
    { lat: 45.004, lon: 6, t: 4000, speed: 45, lean: 40 }, // avg ~126 km/h (90-130)
  ]
  const speedSegs = buildColorSegments(pts, 'speed')
  assert.equal(speedSegs.length, 3)
  assert.equal(speedSegs[0].positions.length, 3) // 2 segments < 50 fusionnés -> 3 points
  assert.equal(speedSegs[0].color, '#3b82f6')

  const leanSegs = buildColorSegments(pts, 'lean')
  assert.equal(leanSegs[0].color, '#475569')
  assert.equal(leanSegs[0].positions.length, 3)
  assert.equal(leanSegs.at(-1).color, '#ef4444')
})

test('analysis : buildAltitudeProfile retourne null sans altitude puis calcule pente et bornes', () => {
  assert.equal(buildAltitudeProfile([{ lat: 45, lon: 6, t: 0, speed: 10, lean: 0 }]), null)

  const pts = [
    { lat: 45.0, lon: 6.0, t: 0, speed: 15, lean: 0, alt: 500 },
    { lat: 45.001, lon: 6.0, t: 6000, speed: 15, lean: 0, alt: 515 }, // ~111 m, +15 m -> ~13.5%
    { lat: 45.002, lon: 6.0, t: 12000, speed: 15, lean: 0, alt: 510 },
  ]
  const prof = buildAltitudeProfile(pts, 10)
  assert.equal(prof.minAlt, 500)
  assert.equal(prof.maxAlt, 515)
  assert.ok(prof.maxSlopePct >= 12 && prof.maxSlopePct <= 15)
  assert.equal(prof.samples.length, 3)
})

test('analysis : compareTrips calcule les deltas et buildMonthlySummary gère le changement d année', () => {
  const tripA = {
    id: 1,
    name: 'Sortie A',
    stats: { distance: 20000, duration: 1200, avgMovingSpeed: 65, maxSpeed: 95, maxLeanLeft: 32, maxLeanRight: 30, elevationGain: 300 },
    points: [],
  }
  const tripB = {
    id: 2,
    name: 'Sortie B',
    stats: { distance: 35000, duration: 1800, avgMovingSpeed: 74, maxSpeed: 112, maxLeanLeft: 41, maxLeanRight: 38, elevationGain: 650 },
    points: [],
  }
  const cmp = compareTrips(tripA, tripB)
  assert.equal(cmp.delta.distanceM, 15000)
  assert.equal(cmp.delta.maxSpeed, 17)
  assert.equal(cmp.delta.maxLean, 9)
  assert.equal(cmp.delta.elevationGain, 350)

  const jan2026 = new Date(2026, 0, 15).getTime()
  const nov2025 = new Date(2025, 10, 10).getTime()
  const janPrev = new Date(2025, 0, 5).getTime()
  const summary = buildMonthlySummary(
    [
      { date: jan2026, stats: { distance: 42400 } },
      { date: nov2025, stats: { distance: 15000 } },
      { date: janPrev, stats: { distance: 99000 } }, // hors fenêtre 6 mois
    ],
    new Date(2026, 0, 20).getTime(),
    6
  )
  assert.equal(summary.length, 6)
  assert.equal(summary.at(-1).label, 'jan')
  assert.equal(summary.at(-1).km, 42.4)
  assert.equal(summary.at(-1).count, 1)
  assert.equal(summary[3].label, 'nov')
  assert.equal(summary[3].km, 15)
})

test('analysis : analyzeRidingStyle calcule zones, symétrie G/D et fluidité', () => {
  assert.equal(analyzeRidingStyle([]).hasData, false)

  // Trajet fluide et asymétrique à gauche
  const smoothLeft = Array.from({ length: 12 }, (_, i) => ({
    lat: 45 + i * 0.0004,
    lon: 6,
    t: i * 2000,
    speed: 15,
    lean: i < 5 ? 36 : i < 9 ? -22 : 6,
  }))
  const res = analyzeRidingStyle(smoothLeft)
  assert.equal(res.hasData, true)
  const sumPct = res.zones.z0 + res.zones.z1 + res.zones.z2 + res.zones.z3
  assert.equal(sumPct, 100)
  assert.equal(res.dominantSide, 'left')
  assert.ok(res.diffDeg > 10)
  assert.ok(res.smoothness >= 70)

  // Trajet haché / saccadé -> fluidité nettement inférieure
  const jerky = Array.from({ length: 12 }, (_, i) => ({
    lat: 45 + i * 0.0004,
    lon: 6,
    t: i * 1000,
    speed: i % 2 === 0 ? 8 : 22,
    lean: i % 2 === 0 ? 35 : -35,
  }))
  const jerkyRes = analyzeRidingStyle(jerky)
  assert.ok(jerkyRes.smoothness < res.smoothness)
})
