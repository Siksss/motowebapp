import { haversine } from './stats.js'
import { scoreTrip } from './scoring.js'

const G = 9.81
const RAD = Math.PI / 180
const DEG = 180 / Math.PI

export function bearing(a, b) {
  const lat1 = a.lat * RAD
  const lat2 = b.lat * RAD
  const dLon = (b.lon - a.lon) * RAD
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return (Math.atan2(y, x) * DEG + 360) % 360
}

export function angleDiff(a, b) {
  return ((b - a + 540) % 360) - 180
}

function enrichPoints(points) {
  if (!points || !points.length) return []
  const t0 = points[0].t || 0
  const hasSensorLean = points.some((p) => Math.abs(p.lean || 0) >= 3)
  let dist = 0
  const raw = []
  let prevBear = null

  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    let d = 0
    let dt = 0
    let v = p.speed
    let bear = prevBear
    if (i > 0) {
      d = haversine(points[i - 1], p)
      dt = (p.t - points[i - 1].t) / 1000
      dist += d
      if (v == null && dt > 0) v = d / dt
      if (d >= 1.5) bear = bearing(points[i - 1], p)
    }
    const speedMs = v != null && Number.isFinite(v) && v >= 0 ? v : 0
    let rawLean = p.lean || 0
    if (!hasSensorLean && i > 0 && prevBear != null && bear != null && dt > 0 && d >= 1.5 && speedMs >= 3) {
      const dh = angleDiff(prevBear, bear)
      const omegaYaw = (-dh * RAD) / dt // + = virage à gauche
      rawLean = Math.max(-60, Math.min(60, Math.atan((speedMs * omegaYaw) / G) * DEG))
    }
    if (bear != null) prevBear = bear
    raw.push({
      idx: i,
      t: (p.t - t0) / 1000,
      dist,
      speedMs,
      speedKmh: speedMs * 3.6,
      alt: p.alt ?? null,
      bear,
      rawLean,
    })
  }

  return raw.map((item, i) => {
    if (hasSensorLean) return { ...item, effLean: item.rawLean }
    const a = raw[Math.max(0, i - 1)].rawLean
    const b = item.rawLean
    const c = raw[Math.min(raw.length - 1, i + 1)].rawLean
    return { ...item, effLean: 0.25 * a + 0.5 * b + 0.25 * c }
  })
}

/** Détecte les virages et épingles d'un trajet (capteurs ou courbure GPS en repli). */
export function detectCorners(points) {
  if (!points || points.length < 3) {
    return { corners: [], leftCount: 0, rightCount: 0, hairpinCount: 0, topCorners: [] }
  }
  const eff = enrichPoints(points)
  const rawRuns = []
  let cur = null

  for (let i = 0; i < eff.length; i++) {
    const abs = Math.abs(eff[i].effLean)
    const side = eff[i].effLean > 0 ? 'left' : 'right'
    if (abs >= 12) {
      if (cur && cur.side === side) {
        cur.endIdx = i
      } else {
        if (cur) rawRuns.push(cur)
        cur = { side, startIdx: i, endIdx: i }
      }
    } else if (cur) {
      rawRuns.push(cur)
      cur = null
    }
  }
  if (cur) rawRuns.push(cur)

  const merged = []
  for (const run of rawRuns) {
    const prev = merged.at(-1)
    if (prev && prev.side === run.side && eff[run.startIdx].t - eff[prev.endIdx].t <= 1.2) {
      prev.endIdx = run.endIdx
    } else {
      merged.push({ ...run })
    }
  }

  const corners = []
  for (const run of merged) {
    const duration = eff[run.endIdx].t - eff[run.startIdx].t
    if (duration < 1.5) continue
    let apexIdx = run.startIdx
    let maxLean = 0
    let minSpeedKmh = Infinity
    let headingChange = 0
    let lastB = null

    const bStart = Math.max(0, run.startIdx - 1)
    const bEnd = Math.min(eff.length - 1, run.endIdx + 1)
    for (let k = bStart; k <= bEnd; k++) {
      if (eff[k].bear != null) {
        if (lastB != null) headingChange += angleDiff(lastB, eff[k].bear)
        lastB = eff[k].bear
      }
    }

    for (let k = run.startIdx; k <= run.endIdx; k++) {
      const a = Math.abs(eff[k].effLean)
      if (a > maxLean) {
        maxLean = a
        apexIdx = k
      }
      if (eff[k].speedKmh < minSpeedKmh) minSpeedKmh = eff[k].speedKmh
    }
    if (maxLean < 15) continue

    const absTurn = Math.abs(headingChange)
    const kind = absTurn >= 115 ? 'Épingle' : absTurn >= 55 ? 'Serré' : 'Courbe'
    corners.push({
      side: run.side,
      startIdx: run.startIdx,
      apexIdx,
      endIdx: run.endIdx,
      maxLean,
      apexSpeedKmh: eff[apexIdx].speedKmh,
      minSpeedKmh: Number.isFinite(minSpeedKmh) ? minSpeedKmh : eff[apexIdx].speedKmh,
      duration,
      headingChange,
      kind,
      lat: points[apexIdx].lat,
      lon: points[apexIdx].lon,
    })
  }

  const leftCount = corners.filter((c) => c.side === 'left').length
  const rightCount = corners.filter((c) => c.side === 'right').length
  const hairpinCount = corners.filter((c) => c.kind === 'Épingle').length
  const topCorners = [...corners].sort((a, b) => b.maxLean - a.maxLean).slice(0, 5)
  return { corners, leftCount, rightCount, hairpinCount, topCorners }
}

/** Sous-échantillonne la télémétrie en préservant les pics d'inclinaison de chaque fenêtre. */
export function buildTelemetrySeries(points, maxSamples = 160) {
  const eff = enrichPoints(points)
  const n = eff.length
  if (!n) return []
  if (n <= maxSamples) {
    return eff.map((e) => ({
      idx: e.idx,
      t: e.t,
      dist: e.dist,
      speedKmh: e.speedKmh,
      lean: e.effLean,
      alt: e.alt,
    }))
  }
  const out = []
  for (let b = 0; b < maxSamples; b++) {
    const start = Math.floor((b * n) / maxSamples)
    const end = Math.max(start + 1, Math.floor(((b + 1) * n) / maxSamples))
    let best = eff[start]
    for (let i = start + 1; i < end; i++) {
      if (Math.abs(eff[i].effLean) > Math.abs(best.effLean)) best = eff[i]
    }
    out.push({
      idx: best.idx,
      t: best.t,
      dist: best.dist,
      speedKmh: best.speedKmh,
      lean: best.effLean,
      alt: best.alt,
    })
  }
  return out
}

function speedColor(kmh) {
  if (kmh < 50) return '#3b82f6'
  if (kmh < 90) return '#38bdf8'
  if (kmh < 130) return '#f59e0b'
  return '#ef4444'
}

function leanColor(absDeg) {
  if (absDeg < 12) return '#475569'
  if (absDeg < 25) return '#1d6bff'
  if (absDeg < 38) return '#8b5cf6'
  return '#ef4444'
}

/** Regroupe les segments consécutifs de même couleur pour un rendu Leaflet fluide. */
export function buildColorSegments(points, mode) {
  if (!points || points.length < 2 || (mode !== 'speed' && mode !== 'lean')) return []
  const eff = enrichPoints(points)
  const groups = []
  for (let i = 1; i < points.length; i++) {
    const color =
      mode === 'speed'
        ? speedColor((eff[i - 1].speedKmh + eff[i].speedKmh) / 2)
        : leanColor(Math.max(Math.abs(eff[i - 1].effLean), Math.abs(eff[i].effLean)))
    const pA = [points[i - 1].lat, points[i - 1].lon]
    const pB = [points[i].lat, points[i].lon]
    const last = groups.at(-1)
    if (last && last.color === color) {
      last.positions.push(pB)
    } else {
      groups.push({ color, positions: [pA, pB] })
    }
  }
  return groups
}

/** Profil altimétrique et pente max pour trajets disposant d'au moins 2 altitudes valides. */
export function buildAltitudeProfile(points, maxSamples = 160) {
  const eff = enrichPoints(points).filter((e) => e.alt != null && Number.isFinite(e.alt))
  if (eff.length < 2) return null

  let minAlt = Infinity
  let maxAlt = -Infinity
  let maxSlopePct = 0
  for (let i = 0; i < eff.length; i++) {
    if (eff[i].alt < minAlt) minAlt = eff[i].alt
    if (eff[i].alt > maxAlt) maxAlt = eff[i].alt
    if (i > 0) {
      const dd = eff[i].dist - eff[i - 1].dist
      if (dd >= 10) {
        const slope = Math.min(45, Math.abs((eff[i].alt - eff[i - 1].alt) / dd) * 100)
        if (slope > maxSlopePct) maxSlopePct = slope
      }
    }
  }

  let picked = eff
  if (eff.length > maxSamples) {
    picked = []
    for (let i = 0; i < maxSamples; i++) {
      const pos = Math.round((i * (eff.length - 1)) / Math.max(1, maxSamples - 1))
      picked.push(eff[pos])
    }
  }

  return {
    minAlt: Math.round(minAlt),
    maxAlt: Math.round(maxAlt),
    maxSlopePct: Math.round(maxSlopePct),
    samples: picked.map((e) => ({ idx: e.idx, t: e.t, dist: e.dist, alt: Math.round(e.alt) })),
  }
}

/** Compare deux trajets (A = référence, B = candidat) avec deltas signés B - A. */
export function compareTrips(tripA, tripB) {
  const pick = (t) => {
    const s = t?.stats || {}
    return {
      id: t?.id,
      name: t?.name || '',
      distanceM: s.distance || 0,
      durationS: s.duration || 0,
      avgMovingSpeed: s.avgMovingSpeed || 0,
      maxSpeed: s.maxSpeed || 0,
      maxLean: Math.max(s.maxLeanLeft || 0, s.maxLeanRight || 0),
      elevationGain: s.elevationGain || 0,
      viroloScore: scoreTrip(t).score,
    }
  }
  const a = pick(tripA)
  const b = pick(tripB)
  const delta = {
    distanceM: b.distanceM - a.distanceM,
    durationS: b.durationS - a.durationS,
    avgMovingSpeed: b.avgMovingSpeed - a.avgMovingSpeed,
    maxSpeed: b.maxSpeed - a.maxSpeed,
    maxLean: b.maxLean - a.maxLean,
    elevationGain: b.elevationGain - a.elevationGain,
    viroloScore: b.viroloScore - a.viroloScore,
  }
  return { a, b, delta }
}

const MONTHS_FR = ['jan', 'fév', 'mar', 'avr', 'mai', 'jun', 'jul', 'aoû', 'sep', 'oct', 'nov', 'déc']

/** Cumule kilomètres et sorties sur les N derniers mois calendaires. */
export function buildMonthlySummary(trips = [], now = Date.now(), months = 6) {
  const cur = new Date(now)
  const buckets = []
  const byKey = new Map()
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(cur.getFullYear(), cur.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const item = { key, label: MONTHS_FR[d.getMonth()], km: 0, count: 0 }
    buckets.push(item)
    byKey.set(key, item)
  }

  for (const t of trips) {
    if (!t?.date) continue
    const d = new Date(t.date)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const bucket = byKey.get(key)
    if (bucket) {
      bucket.km += (t.stats?.distance || 0) / 1000
      bucket.count++
    }
  }

  return buckets.map((b) => ({ ...b, km: Math.round(b.km * 10) / 10 }))
}

/** Analyse la fluidité, la symétrie gauche/droite et les zones d'inclinaison du pilotage. */
export function analyzeRidingStyle(points) {
  const empty = {
    hasData: false,
    zones: { z0: 100, z1: 0, z2: 0, z3: 0 },
    leftAvgDeg: 0,
    rightAvgDeg: 0,
    diffDeg: 0,
    dominantSide: 'balanced',
    smoothness: 100,
    insights: [],
  }
  if (!points || points.length < 2) return empty

  const eff = enrichPoints(points)
  const moving = eff.filter((e) => e.speedMs >= 3)
  const base = moving.length >= 2 ? moving : eff

  let c0 = 0
  let c1 = 0
  let c2 = 0
  let c3 = 0
  let leftSum = 0
  let leftN = 0
  let rightSum = 0
  let rightN = 0

  for (const e of base) {
    const abs = Math.abs(e.effLean)
    if (abs < 15) c0++
    else if (abs < 30) c1++
    else if (abs < 40) c2++
    else c3++

    if (e.effLean >= 12) {
      leftSum += e.effLean
      leftN++
    } else if (e.effLean <= -12) {
      rightSum += -e.effLean
      rightN++
    }
  }

  const n = base.length || 1
  const z1 = Math.round((c1 / n) * 100)
  const z2 = Math.round((c2 / n) * 100)
  const z3 = Math.round((c3 / n) * 100)
  const z0 = Math.max(0, 100 - z1 - z2 - z3)

  const leftAvgDeg = leftN ? Math.round((leftSum / leftN) * 10) / 10 : 0
  const rightAvgDeg = rightN ? Math.round((rightSum / rightN) * 10) / 10 : 0
  const diffDeg = Math.round((leftAvgDeg - rightAvgDeg) * 10) / 10
  const dominantSide = Math.abs(diffDeg) < 3 ? 'balanced' : diffDeg > 0 ? 'left' : 'right'

  let speedJerkSum = 0
  let leanJerkSum = 0
  let jerkN = 0
  for (let i = 1; i < eff.length; i++) {
    const dt = eff[i].t - eff[i - 1].t
    if (dt < 0.2 || dt > 10 || Math.max(eff[i].speedMs, eff[i - 1].speedMs) < 2) continue
    speedJerkSum += Math.abs(eff[i].speedMs - eff[i - 1].speedMs) / dt
    leanJerkSum += Math.abs(eff[i].effLean - eff[i - 1].effLean) / dt
    jerkN++
  }

  const avgSpeedJerk = jerkN ? speedJerkSum / jerkN : 0
  const avgLeanJerk = jerkN ? leanJerkSum / jerkN : 0
  const smoothness = Math.round(Math.max(0, Math.min(100, 100 - (avgSpeedJerk * 10 + avgLeanJerk * 0.7))))

  const insights = []
  if (leftN + rightN < 3) {
    insights.push('Peu de virages marqués : symétrie indicative.')
  } else if (dominantSide === 'balanced') {
    insights.push('Pilotage équilibré gauche / droite.')
  } else {
    const side = dominantSide === 'left' ? 'gauche' : 'droite'
    insights.push(`Prise d’angle plus franche à ${side} (+${Math.abs(diffDeg)}° en moyenne).`)
  }
  if (z2 + z3 >= 18) insights.push(`Rythme engagé : ${z2 + z3}% du trajet au-dessus de 30°.`)
  else insights.push('Trajectoire posée, majorité de courbes modérées.')
  insights.push(
    smoothness >= 75
      ? 'Transitions vitesse et mise sur l’angle très fluides.'
      : 'Transitions nerveuses : anticiper freinage et progressivité en entrée.'
  )

  return {
    hasData: true,
    zones: { z0, z1, z2, z3 },
    leftAvgDeg,
    rightAvgDeg,
    diffDeg,
    dominantSide,
    smoothness,
    insights,
  }
}
