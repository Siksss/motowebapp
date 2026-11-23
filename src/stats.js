// Calculs purs (testables avec `npm test`).

const R = 6371000
const G = 9.81
const MIN_SPEED = 4 // m/s (~14 km/h) : en dessous, le braquage domine l'inclinaison
const rad = (d) => (d * Math.PI) / 180

export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function leanFromOmega(omega, v) {
  if (!(v >= MIN_SPEED)) return 0
  const s = Math.max(-1, Math.min(1, (v * omega) / G))
  return (Math.asin(s) * 180) / Math.PI
}

export function motionToFrame(accel, rotRate, isIOS) {
  const s = isIOS ? -1 : 1
  const k = Math.PI / 180
  return {
    up: { x: s * accel.x, y: s * accel.y, z: s * accel.z },
    // WebKit (iOS) place CoreMotion (x, y, z) dans (alpha, beta, gamma) au lieu du mapping W3C.
    rot: isIOS
      ? { x: rotRate.alpha * k, y: rotRate.beta * k, z: rotRate.gamma * k }
      : { x: rotRate.beta * k, y: rotRate.gamma * k, z: rotRate.alpha * k },
  }
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
  if (!n || !(v >= MIN_SPEED)) return 0
  const omega = (rot.x * up.x + rot.y * up.y + rot.z * up.z) / n
  return leanFromOmega(omega, v)
}

/** Filtre l'axe vertical (vibrations/chocs) et la rotation avant sin⁻¹. */
export function createLeanTracker(isIOS) {
  let up = null
  let w1 = 0
  let w2 = 0
  let lastT = null

  function resetLean() {
    w1 = 0
    w2 = 0
    lastT = null
  }

  function update(accel, rotRate, v, tMs) {
    const { up: rawUp, rot } = motionToFrame(accel, rotRate, isIOS)
    const dt = lastT == null ? 0.02 : Math.min(0.2, Math.max(0.001, (tMs - lastT) / 1000))
    lastT = tMs

    const rawNorm = Math.hypot(rawUp.x, rawUp.y, rawUp.z)
    if (!up) {
      if (!rawNorm) return 0
      up = { ...rawUp }
    } else if (rawNorm > 5 && rawNorm < 18) {
      const aUp = 1 - Math.exp(-dt / (v >= MIN_SPEED ? 5 : 0.5))
      up.x += aUp * (rawUp.x - up.x)
      up.y += aUp * (rawUp.y - up.y)
      up.z += aUp * (rawUp.z - up.z)
    }

    const n = Math.hypot(up.x, up.y, up.z)
    const omega = n && v >= MIN_SPEED ? (rot.x * up.x + rot.y * up.y + rot.z * up.z) / n : 0
    const aW = 1 - Math.exp(-dt / 0.3)
    w1 += aW * (omega - w1)
    w2 += aW * (w1 - w2)
    return leanFromOmega(w2, v)
  }

  return { update, resetLean }
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
