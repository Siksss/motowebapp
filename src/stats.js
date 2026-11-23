// Calculs purs (testables avec `npm test`).

const R = 6371000
const G = 9.81
const MIN_SPEED = 4 // m/s (~14 km/h) : seuil de mode roulage
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

function buildFrame(rawUp) {
  const n = Math.hypot(rawUp.x, rawUp.y, rawUp.z)
  if (!n) return null
  const u = { x: rawUp.x / n, y: rawUp.y / n, z: rawUp.z / n }
  const ref = Math.abs(u.x) < 0.8 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
  const d = ref.x * u.x + ref.y * u.y + ref.z * u.z
  const rx = ref.x - d * u.x
  const ry = ref.y - d * u.y
  const rz = ref.z - d * u.z
  const rn = Math.hypot(rx, ry, rz)
  const r = { x: rx / rn, y: ry / rn, z: rz / rn }
  const f = {
    x: u.y * r.z - u.z * r.y,
    y: u.z * r.x - u.x * r.z,
    z: u.x * r.y - u.y * r.x,
  }
  return { u, r, f }
}

/** Filtre complémentaire 3D calibré sur la position de départ du téléphone. */
export function createLeanTracker(isIOS) {
  let frame = null
  let lastRawUp = null
  let lean = 0
  let wUp = 0
  let lastT = null

  function resetLean() {
    lean = 0
    wUp = 0
    lastT = null
  }

  function calibrate() {
    if (lastRawUp) frame = buildFrame(lastRawUp)
    resetLean()
  }

  function update(accel, rotRate, v, tMs) {
    const { up: rawUp, rot } = motionToFrame(accel, rotRate, isIOS)
    lastRawUp = rawUp
    if (!frame) {
      frame = buildFrame(rawUp)
      lastT = tMs
      return 0
    }

    const dt = lastT == null ? 0.02 : Math.min(0.2, Math.max(0.001, (tMs - lastT) / 1000))
    lastT = tMs

    const rawNorm = Math.hypot(rawUp.x, rawUp.y, rawUp.z)
    const rotNorm = Math.hypot(rot.x, rot.y, rot.z)
    if (v >= MIN_SPEED && rotNorm < 0.08 && rawNorm > 8.5 && rawNorm < 11.2) {
      const a = 1 - Math.exp(-dt / 15)
      const next = buildFrame({
        x: frame.u.x + a * (rawUp.x / rawNorm - frame.u.x),
        y: frame.u.y + a * (rawUp.y / rawNorm - frame.u.y),
        z: frame.u.z + a * (rawUp.z / rawNorm - frame.u.z),
      })
      if (next) frame = next
    }

    const rollDeg = -(rot.x * frame.f.x + rot.y * frame.f.y + rot.z * frame.f.z) * (180 / Math.PI)
    const pred = lean + rollDeg * dt

    if (v >= MIN_SPEED) {
      const omegaUp = rot.x * frame.u.x + rot.y * frame.u.y + rot.z * frame.u.z
      const aW = 1 - Math.exp(-dt / 0.4)
      wUp += aW * (omegaUp - wUp)
      const refLean = leanFromOmega(wUp, v)
      const a = 1 - Math.exp(-dt / 2.0)
      lean = pred + a * (refLean - pred)
    } else {
      wUp = 0
      if (rawNorm > 7 && rawNorm < 13) {
        const lat = rawUp.x * frame.r.x + rawUp.y * frame.r.y + rawUp.z * frame.r.z
        const vert = rawUp.x * frame.u.x + rawUp.y * frame.u.y + rawUp.z * frame.u.z
        const refLean = (Math.atan2(lat, vert) * 180) / Math.PI
        const a = 1 - Math.exp(-dt / 0.6)
        lean = pred + a * (refLean - pred)
      } else {
        lean = pred
      }
    }

    lean = Math.max(-85, Math.min(85, lean))
    return Math.abs(lean) < 1.5 ? 0 : lean
  }

  return { update, calibrate, resetLean, state: () => ({ up: frame?.u ?? null, omega: wUp }) }
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
