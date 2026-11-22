// Calculs purs (testables avec `npm test`).

const R = 6371000
const G = 9.81
const rad = (d) => (d * Math.PI) / 180

export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Angle d'inclinaison (degrés, + = gauche, - = droite) à partir du gyroscope.
 * Sur une moto en virage, l'accéléromètre "voit" toujours la gravité dans l'axe de la moto,
 * donc on ne peut pas lire l'angle directement : on utilise sin(φ) = v·Ω/g
 * où Ω est la vitesse de rotation autour de l'axe "haut" apparent de la moto.
 * Indépendant de la façon dont le téléphone est fixé.
 * @param up  vecteur accelerationIncludingGravity {x,y,z} (pointe vers le haut)
 * @param rot rotationRate en rad/s {x,y,z} (axes du téléphone)
 * @param v   vitesse en m/s
 */
export function leanAngle(up, rot, v) {
  const n = Math.hypot(up.x, up.y, up.z)
  if (!n || v < 3) return 0 // en dessous de ~10 km/h : bruit
  const omega = (rot.x * up.x + rot.y * up.y + rot.z * up.z) / n
  const s = Math.max(-1, Math.min(1, (v * omega) / G))
  return (Math.asin(s) * 180) / Math.PI
}

/** points: [{lat, lon, t(ms), speed(m/s|null), lean(deg)}] */
export function tripStats(points) {
  let distance = 0
  let maxSpeed = 0
  let maxLeanLeft = 0
  let maxLeanRight = 0
  let movingTime = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    let v = p.speed
    if (i > 0) {
      const d = haversine(points[i - 1], p)
      const dt = (p.t - points[i - 1].t) / 1000
      distance += d
      if (v == null && dt > 0) v = d / dt
      if (dt > 0 && d / dt > 1) movingTime += dt // > 3.6 km/h = en mouvement
    }
    if (v != null) maxSpeed = Math.max(maxSpeed, v)
    maxLeanLeft = Math.max(maxLeanLeft, p.lean || 0)
    maxLeanRight = Math.max(maxLeanRight, -(p.lean || 0))
  }
  const duration = points.length > 1 ? (points.at(-1).t - points[0].t) / 1000 : 0
  return {
    distance, // m
    duration, // s
    movingTime, // s
    maxSpeed: maxSpeed * 3.6, // km/h
    avgSpeed: duration ? (distance / duration) * 3.6 : 0,
    avgMovingSpeed: movingTime ? (distance / movingTime) * 3.6 : 0,
    maxLeanLeft,
    maxLeanRight,
  }
}
