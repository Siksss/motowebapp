// Services gratuits publics : Nominatim (adresses) et OSRM (itinéraires).
// shortcut: serveurs de démo à usage limité, prendre une clé (ex. OpenRouteService) si usage intensif.
import { haversine } from './stats.js'

const MODS = {
  'sharp left': { icon: '↰', label: 'à gauche' },
  left: { icon: '↰', label: 'à gauche' },
  'slight left': { icon: '↖', label: 'légèrement à gauche' },
  'sharp right': { icon: '↱', label: 'à droite' },
  right: { icon: '↱', label: 'à droite' },
  'slight right': { icon: '↗', label: 'légèrement à droite' },
  uturn: { icon: '↺', label: 'demi-tour' },
  straight: { icon: '↑', label: 'tout droit' },
}

export async function geocode(q) {
  const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=5&q=' + encodeURIComponent(q))
  if (!res.ok) throw new Error('Recherche impossible')
  return (await res.json()).map((r) => ({ name: r.display_name, lat: +r.lat, lon: +r.lon }))
}

export function buildOsrmUrl(waypoints) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    throw new Error('Au moins deux points requis')
  }
  const list = waypoints.map((p) => `${p.lon},${p.lat}`).join(';')
  return `https://router.project-osrm.org/route/v1/driving/${list}?overview=full&geometries=geojson&steps=true`
}

export async function route(fromOrWaypoints, to) {
  const waypoints = Array.isArray(fromOrWaypoints) ? fromOrWaypoints : [fromOrWaypoints, to]
  const res = await fetch(buildOsrmUrl(waypoints))
  const data = await res.json()
  if (!res.ok || !data.routes?.length) throw new Error('Itinéraire introuvable')
  const r = data.routes[0]
  const rawSteps = r.legs?.flatMap((leg) => leg.steps || []) ?? []
  const steps = rawSteps.map((s) => ({
    type: s.maneuver?.type ?? 'continue',
    modifier: s.maneuver?.modifier ?? '',
    exit: s.maneuver?.exit ?? null,
    name: s.name || '',
    distance: s.distance ?? 0,
    location: s.maneuver?.location ? { lat: s.maneuver.location[1], lon: s.maneuver.location[0] } : null,
  }))
  return {
    coords: r.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
    distance: r.distance,
    duration: r.duration,
    steps,
    waypoints,
    mode: 'osrm',
  }
}

export function routeFromTrip(trip) {
  const coords = (trip?.points || [])
    .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon))
    .map((p) => [p.lat, p.lon])
  return {
    coords,
    distance: trip?.stats?.distance ?? 0,
    duration: trip?.stats?.duration ?? 0,
    steps: [],
    waypoints: [],
    mode: 'ghost',
    name: trip?.name || 'Trace fantôme',
  }
}

export function trackProgressOnPath(pos, coords) {
  if (!pos || !coords?.length) {
    return { nearestIdx: 0, offRouteM: Infinity, remainingM: 0, isOffRoute: false }
  }
  if (coords.length === 1) {
    const offRouteM = Math.round(haversine(pos, { lat: coords[0][0], lon: coords[0][1] }))
    return { nearestIdx: 0, offRouteM, remainingM: 0, isOffRoute: offRouteM > 120 }
  }

  // Pré-calcul des distances cumulées vers l'arrivée pour rester O(N)
  const suffix = new Array(coords.length).fill(0)
  for (let i = coords.length - 2; i >= 0; i--) {
    suffix[i] =
      suffix[i + 1] + haversine({ lat: coords[i][0], lon: coords[i][1] }, { lat: coords[i + 1][0], lon: coords[i + 1][1] })
  }

  let bestIdx = 0
  let bestDist = Infinity
  let remainingM = 0
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i]
    const b = coords[i + 1]
    const cosLat = Math.max(0.2, Math.cos(((a[0] + b[0]) * Math.PI) / 360))
    const vx = (b[1] - a[1]) * cosLat
    const vy = b[0] - a[0]
    const wx = (pos.lon - a[1]) * cosLat
    const wy = pos.lat - a[0]
    const len2 = vx * vx + vy * vy
    const u = len2 > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2)) : 0
    const proj = { lat: a[0] + u * (b[0] - a[0]), lon: a[1] + u * (b[1] - a[1]) }
    const d = haversine(pos, proj)
    if (d < bestDist) {
      bestDist = d
      bestIdx = u > 0.5 ? i + 1 : i
      remainingM = haversine(proj, { lat: b[0], lon: b[1] }) + suffix[i + 1]
    }
  }

  const offRouteM = Math.round(bestDist)
  return {
    nearestIdx: bestIdx,
    offRouteM,
    remainingM: Math.round(remainingM),
    isOffRoute: offRouteM > 120,
  }
}

export function formatDist(m) {
  if (!Number.isFinite(m) || m < 0) return '--'
  if (m < 50) return Math.round(m / 5) * 5 + ' m'
  if (m < 1000) return Math.round(m / 10) * 10 + ' m'
  return (m / 1000).toFixed(1) + ' km'
}

export function formatManeuver(step) {
  if (!step) return { icon: '↑', text: 'Continuer' }
  const mod = MODS[step.modifier]
  const road = step.name ? ' sur ' + step.name : ''
  const t = step.type

  if (t === 'arrive') return { icon: '🏁', text: 'Arrivée à destination' }
  if (t === 'depart') return { icon: '▶', text: step.name ? 'Départ sur ' + step.name : 'Départ' }
  if (t === 'roundabout' || t === 'rotary' || t === 'exit roundabout' || t === 'exit rotary') {
    const exitTxt = step.exit ? (step.exit === 1 ? '1re sortie' : step.exit + 'e sortie') : 'sortie'
    return { icon: '↻', text: `Au rond-point, ${exitTxt}${road}` }
  }
  if (t === 'fork' || t === 'off ramp' || t === 'on ramp') {
    const dir = mod ? ' ' + mod.label : ''
    return { icon: mod?.icon ?? '↗', text: `Prendre${dir}${road}` }
  }
  if (t === 'merge') return { icon: mod?.icon ?? '↗', text: `Rejoindre${road}` }
  if (t === 'turn' || t === 'end of road') {
    const verb = step.modifier === 'uturn' ? 'Faire demi-tour' : mod ? 'Tourner ' + mod.label : 'Continuer'
    return { icon: mod?.icon ?? '↑', text: `${verb}${road}` }
  }
  const suffix = mod && step.modifier !== 'straight' ? ' ' + mod.label : ' tout droit'
  return { icon: mod?.icon ?? '↑', text: `Continuer${suffix}${road}` }
}

export function trackStep(pos, steps, currentIdx = 0) {
  if (!pos || !steps?.length) return { stepIdx: 0, step: null, distM: Infinity, done: true }
  let idx = Math.max(0, Math.min(currentIdx, steps.length - 1))

  if (idx === 0 && steps[0].type === 'depart' && steps.length > 1) {
    if (!steps[0].location || haversine(pos, steps[0].location) <= 80) idx = 1
  }

  while (idx < steps.length - 1) {
    const cur = steps[idx]
    const dCur = cur.location ? haversine(pos, cur.location) : 0
    const next = steps[idx + 1]
    const dNext = next?.location ? haversine(pos, next.location) : Infinity
    if (!cur.location || dCur <= 28 || dNext <= 28) idx++
    else break
  }

  const step = steps[idx]
  const distM = step.location ? Math.round(haversine(pos, step.location)) : Infinity
  const done = idx === steps.length - 1 && distM <= 25
  return { stepIdx: idx, step, distM, done }
}

export function nextAnnouncement(distM, stepIdx, step, announcedSet) {
  if (!step || step.type === 'depart' || !Number.isFinite(distM) || distM < 0) return null
  const band = distM <= 50 ? 'now' : distM <= 200 ? 'near' : distM <= 500 ? 'far' : null
  if (!band) return null
  const key = `${stepIdx}:${band}`
  if (announcedSet?.has(key)) return null

  const { text } = formatManeuver(step)
  const low = text.charAt(0).toLowerCase() + text.slice(1)
  if (band === 'far') return { key, phrase: `Dans 500 mètres, ${low}` }
  if (band === 'near') return { key, phrase: `Dans 200 mètres, ${low}` }
  return { key, phrase: step.type === 'arrive' ? 'Vous êtes arrivé' : `Maintenant, ${low}` }
}
