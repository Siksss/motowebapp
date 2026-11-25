import { buildColorSegments } from './analysis.js'
import { scoreTrip } from './scoring.js'

const fmtKm = (m) => ((m || 0) / 1000).toFixed(1) + ' km'
const fmtHms = (s) => new Date(Math.max(0, s || 0) * 1000).toISOString().slice(11, 19)

export function projectTrack(points, { x = 0, y = 0, w = 800, h = 600, pad = 24 } = {}) {
  if (!points?.length) return { coords: [], bounds: null }

  let minLat = Infinity
  let maxLat = -Infinity
  let minLon = Infinity
  let maxLon = -Infinity
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
    if (p.lon < minLon) minLon = p.lon
    if (p.lon > maxLon) maxLon = p.lon
  }

  const avgLat = (minLat + maxLat) / 2
  const cosLat = Math.max(0.2, Math.cos((avgLat * Math.PI) / 180))
  const spanLon = (maxLon - minLon) * cosLat
  const spanLat = maxLat - minLat
  const bounds = { minLat, maxLat, minLon, maxLon }

  if (spanLon < 1e-9 && spanLat < 1e-9) {
    const cx = +(x + w / 2).toFixed(1)
    const cy = +(y + h / 2).toFixed(1)
    return {
      coords: points.map((p) => ({ x: cx, y: cy, speed: p.speed ?? 0, lean: p.lean ?? 0 })),
      bounds,
    }
  }

  const innerW = Math.max(1, w - pad * 2)
  const innerH = Math.max(1, h - pad * 2)
  const scale = Math.min(innerW / Math.max(spanLon, 1e-9), innerH / Math.max(spanLat, 1e-9))
  const drawW = spanLon * scale
  const drawH = spanLat * scale
  const ox = x + (w - drawW) / 2
  const oy = y + (h - drawH) / 2

  return {
    coords: points.map((p) => ({
      x: +(ox + (p.lon - minLon) * cosLat * scale).toFixed(1),
      y: +(oy + (maxLat - p.lat) * scale).toFixed(1),
      speed: p.speed ?? 0,
      lean: p.lean ?? 0,
    })),
    bounds,
  }
}

export function buildPosterModel(trip, scoreInfo = scoreTrip(trip)) {
  const s = trip?.stats || {}
  const maxLean = Math.round(Math.max(s.maxLeanLeft || 0, s.maxLeanRight || 0))
  const dateStr = trip?.date
    ? new Date(trip.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : ''
  return {
    title: trip?.name?.trim() || 'Sortie Moto',
    dateStr,
    badge: scoreInfo?.badge || 'Balade',
    viroloScore: scoreInfo?.score ?? 0,
    cornersCount: scoreInfo?.cornersCount ?? 0,
    distance: fmtKm(s.distance),
    duration: fmtHms(s.duration),
    maxSpeed: `${Math.round(s.maxSpeed || 0)} km/h`,
    maxLean: `${maxLean}°`,
    dPlus: `${Math.round(s.elevationGain || 0)} m`,
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
}

export async function renderTripPoster(trip, scoreInfo, { canvas } = {}) {
  const c = canvas || document.createElement('canvas')
  c.width = 1080
  c.height = 1350
  const ctx = c.getContext('2d')

  // Fond OLED sombre + lueur bleu Yamaha
  const bg = ctx.createLinearGradient(0, 0, 0, 1350)
  bg.addColorStop(0, '#050608')
  bg.addColorStop(1, '#091122')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 1080, 1350)

  const glow = ctx.createRadialGradient(540, 540, 40, 540, 540, 520)
  glow.addColorStop(0, 'rgba(0, 87, 255, 0.18)')
  glow.addColorStop(1, 'rgba(0, 87, 255, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, 1080, 1080)

  const model = buildPosterModel(trip, scoreInfo)

  // En-tête
  ctx.fillStyle = '#38bdf8'
  ctx.font = '700 22px system-ui, -apple-system, sans-serif'
  ctx.fillText('MOTOWEBAPP · CARTE SOUVENIR', 68, 86)

  ctx.fillStyle = '#f8fafc'
  ctx.font = '800 54px system-ui, -apple-system, sans-serif'
  ctx.fillText(model.title.slice(0, 26), 68, 150)

  ctx.fillStyle = '#94a3b8'
  ctx.font = '500 26px system-ui, -apple-system, sans-serif'
  ctx.fillText(model.dateStr, 68, 192)

  // Badge Virolo en haut à droite
  roundRect(ctx, 816, 62, 196, 128, 24)
  ctx.fillStyle = 'rgba(0, 87, 255, 0.22)'
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(59, 130, 246, 0.55)'
  ctx.stroke()
  ctx.fillStyle = '#93c5fd'
  ctx.font = '700 18px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('INDICE VIROLO', 914, 96)
  ctx.fillStyle = '#f8fafc'
  ctx.font = '800 48px system-ui, -apple-system, sans-serif'
  ctx.fillText(`${model.viroloScore}`, 914, 146)
  ctx.fillStyle = '#bae6fd'
  ctx.font = '700 18px system-ui, -apple-system, sans-serif'
  ctx.fillText(model.badge.toUpperCase(), 914, 174)
  ctx.textAlign = 'left'

  // Cadre tracé GPS
  const box = { x: 68, y: 232, w: 944, h: 650 }
  roundRect(ctx, box.x, box.y, box.w, box.h, 28)
  ctx.fillStyle = '#0c1018'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
  ctx.lineWidth = 2
  ctx.stroke()

  const pts = trip?.points || []
  const { coords } = projectTrack(pts, { ...box, pad: 54 })
  if (coords.length > 1) {
    const hasLean = pts.some((p) => Math.abs(p.lean || 0) >= 5)

    // Halo général bleu Yamaha
    ctx.beginPath()
    coords.forEach((cPt, i) => (i === 0 ? ctx.moveTo(cPt.x, cPt.y) : ctx.lineTo(cPt.x, cPt.y)))
    ctx.strokeStyle = 'rgba(0, 87, 255, 0.28)'
    ctx.lineWidth = 18
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()

    if (hasLean) {
      const segs = buildColorSegments(pts, 'lean')
      let ptr = 0
      for (const seg of segs) {
        ctx.beginPath()
        for (let k = 0; k < seg.positions.length; k++) {
          const cPt = coords[Math.min(coords.length - 1, ptr + k)]
          if (k === 0) ctx.moveTo(cPt.x, cPt.y)
          else ctx.lineTo(cPt.x, cPt.y)
        }
        ptr += Math.max(0, seg.positions.length - 1)
        ctx.strokeStyle = seg.color
        ctx.lineWidth = 7
        ctx.stroke()
      }
    } else {
      ctx.beginPath()
      coords.forEach((cPt, i) => (i === 0 ? ctx.moveTo(cPt.x, cPt.y) : ctx.lineTo(cPt.x, cPt.y)))
      ctx.strokeStyle = '#1d6bff'
      ctx.lineWidth = 7
      ctx.stroke()
    }

    // Marqueurs départ / arrivée
    const sPt = coords[0]
    const ePt = coords.at(-1)
    ctx.beginPath()
    ctx.arc(sPt.x, sPt.y, 10, 0, Math.PI * 2)
    ctx.fillStyle = '#cbd5e1'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(ePt.x, ePt.y, 12, 0, Math.PI * 2)
    ctx.fillStyle = '#0057ff'
    ctx.fill()
    ctx.lineWidth = 4
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
  }

  // Grille 6 métriques
  const tiles = [
    ['DISTANCE', model.distance],
    ['DURÉE', model.duration],
    ['VITESSE MAX', model.maxSpeed],
    ['ANGLE MAX', model.maxLean],
    ['DÉNIVELÉ +', model.dPlus],
    ['VIRAGES', String(model.cornersCount)],
  ]
  const cols = 3
  const tileW = 300
  const tileH = 148
  const gapX = 22
  const gapY = 20
  tiles.forEach(([label, val], i) => {
    const tx = 68 + (i % cols) * (tileW + gapX)
    const ty = 914 + Math.floor(i / cols) * (tileH + gapY)
    roundRect(ctx, tx, ty, tileW, tileH, 22)
    ctx.fillStyle = '#0f141e'
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
    ctx.stroke()

    ctx.fillStyle = '#94a3b8'
    ctx.font = '700 20px system-ui, -apple-system, sans-serif'
    ctx.fillText(label, tx + 24, ty + 48)
    ctx.fillStyle = '#f8fafc'
    ctx.font = '800 44px system-ui, -apple-system, sans-serif'
    ctx.fillText(val, tx + 24, ty + 110)
  })

  ctx.fillStyle = '#64748b'
  ctx.font = '600 20px system-ui, -apple-system, sans-serif'
  ctx.fillText('Télémétrie 100 % locale · MotoWebApp', 68, 1296)

  return new Promise((resolve, reject) => {
    c.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Export PNG impossible'))), 'image/png')
  })
}

export async function shareTripPoster(trip, scoreInfo) {
  const blob = await renderTripPoster(trip, scoreInfo)
  const slug =
    (trip?.name || new Date(trip?.date || Date.now()).toISOString().slice(0, 10))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'trajet'
  const filename = `${slug}-carte.png`

  if (typeof File === 'function' && navigator.canShare) {
    try {
      const file = new File([blob], filename, { type: 'image/png' })
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ title: trip?.name || 'MotoWebApp', files: [file] })
        return
      }
    } catch (err) {
      if (err?.name === 'AbortError') return
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
