import { tripStats } from './stats.js'

const GPX_NS = 'http://www.topografix.com/GPX/1/1'
const MOTO_NS = 'https://siksss.github.io/motowebapp/gpx/1'

function escapeXml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function unescapeXml(str) {
  return String(str)
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

function readTag(body, tagRegex) {
  const m = body.match(tagRegex)
  return m ? m[1].trim() : null
}

/** Exporte un trajet au format GPX 1.1 avec extensions vitesse (m/s) et inclinaison (°). */
export function tripToGpx(trip) {
  const pts = trip?.points || []
  const title =
    trip?.name ||
    new Date(trip?.date ?? pts[0]?.t ?? Date.now()).toLocaleString('fr-FR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  const headTime = new Date(trip?.date ?? pts[0]?.t ?? Date.now()).toISOString()

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="MotoWebApp" xmlns="${GPX_NS}" xmlns:moto="${MOTO_NS}">`,
    '  <metadata>',
    `    <name>${escapeXml(title)}</name>`,
    `    <time>${headTime}</time>`,
    '  </metadata>',
    '  <trk>',
    `    <name>${escapeXml(title)}</name>`,
    ...(trip?.note?.trim() ? [`    <desc>${escapeXml(trip.note.trim())}</desc>`] : []),
    '    <trkseg>',
  ]

  for (const p of pts) {
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lon)) continue
    lines.push(`      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">`)
    if (p.alt != null && Number.isFinite(p.alt)) {
      lines.push(`        <ele>${Number(p.alt).toFixed(1)}</ele>`)
    }
    if (p.t != null && Number.isFinite(p.t)) {
      lines.push(`        <time>${new Date(p.t).toISOString()}</time>`)
    }
    const hasSpeed = p.speed != null && Number.isFinite(p.speed)
    const hasLean = p.lean != null && Number.isFinite(p.lean)
    if (hasSpeed || hasLean) {
      lines.push('        <extensions>')
      if (hasSpeed) lines.push(`          <moto:speed>${Number(p.speed).toFixed(2)}</moto:speed>`)
      if (hasLean) lines.push(`          <moto:lean>${Number(p.lean).toFixed(1)}</moto:lean>`)
      lines.push('        </extensions>')
    }
    lines.push('      </trkpt>')
  }

  lines.push('    </trkseg>', '  </trk>', '</gpx>')
  return lines.join('\n')
}

function parsePoints(xmlText, tag) {
  const re = new RegExp(`<${tag}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${tag}>)`, 'gi')
  const pts = []
  let m
  while ((m = re.exec(xmlText)) !== null) {
    const attrs = m[1] || ''
    const body = m[2] || ''
    const latM = attrs.match(/\blat\s*=\s*["']([^"']+)["']/i)
    const lonM = attrs.match(/\blon\s*=\s*["']([^"']+)["']/i)
    if (!latM || !lonM) continue
    const lat = Number(latM[1])
    const lon = Number(lonM[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      continue
    }
    const eleStr = readTag(body, /<ele>\s*([^<]+?)\s*<\/ele>/i)
    const ele = eleStr != null ? Number(eleStr) : NaN
    const timeStr = readTag(body, /<time>\s*([^<]+?)\s*<\/time>/i)
    const parsedT = timeStr != null ? Date.parse(timeStr) : NaN
    const speedStr = readTag(body, /<(?:moto:)?speed>\s*([^<]+?)\s*<\/(?:moto:)?speed>/i)
    const speedVal = speedStr != null ? Number(speedStr) : NaN
    const leanStr = readTag(body, /<(?:moto:)?lean>\s*([^<]+?)\s*<\/(?:moto:)?lean>/i)
    const leanVal = leanStr != null ? Number(leanStr) : NaN

    pts.push({
      lat,
      lon,
      alt: Number.isFinite(ele) ? Math.round(ele * 10) / 10 : null,
      t: Number.isFinite(parsedT) ? parsedT : null,
      speed: Number.isFinite(speedVal) && speedVal >= 0 ? speedVal : null,
      lean: Number.isFinite(leanVal) && Math.abs(leanVal) <= 90 ? leanVal : 0,
    })
  }
  return pts
}

/** Parse un fichier GPX 1.1 (<trkpt> ou repli <rtept>) en trajet MotoWebApp complet. */
export function parseGpx(xmlText) {
  if (typeof xmlText !== 'string' || !xmlText.trim()) {
    throw new Error('Fichier GPX vide ou invalide')
  }
  let rawPts = parsePoints(xmlText, 'trkpt')
  if (rawPts.length < 2) rawPts = parsePoints(xmlText, 'rtept')
  if (rawPts.length < 2) {
    throw new Error('Aucun tracé GPX valide trouvé (minimum 2 points requis)')
  }

  const baseTime = rawPts.find((p) => p.t != null)?.t ?? Date.now()
  const points = rawPts.map((p, i) => ({
    ...p,
    t: p.t != null ? p.t : i === 0 ? baseTime : rawPts[i - 1].t != null ? rawPts[i - 1].t + 1000 : baseTime + i * 1000,
  }))
  // Garantir un temps strictement croissant en cas d'horodatages partiels
  for (let i = 1; i < points.length; i++) {
    if (points[i].t < points[i - 1].t) points[i].t = points[i - 1].t + 1000
  }

  const nameMatch =
    xmlText.match(/<trk>[\s\S]*?<name>([^<]+)<\/name>/i) ||
    xmlText.match(/<metadata>[\s\S]*?<name>([^<]+)<\/name>/i) ||
    xmlText.match(/<name>([^<]+)<\/name>/i)
  const rawName = nameMatch ? unescapeXml(nameMatch[1].trim()) : ''
  const descMatch =
    xmlText.match(/<trk>[\s\S]*?<desc>([^<]+)<\/desc>/i) ||
    xmlText.match(/<desc>([^<]+)<\/desc>/i)
  const rawNote = descMatch ? unescapeXml(descMatch[1].trim()) : ''

  return {
    id: Date.now(),
    ...(rawName ? { name: rawName } : {}),
    ...(rawNote ? { note: rawNote } : {}),
    date: points[0].t,
    points,
    stats: tripStats(points),
  }
}
