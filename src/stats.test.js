import test from 'node:test'
import assert from 'node:assert/strict'
import { haversine, leanAngle, motionToFrame, createLeanTracker, tripStats } from './stats.js'

const RAD = Math.PI / 180

function tiltedIosAccel(tiltBackDeg, leanDeg) {
  const tb = tiltBackDeg * RAD
  const th = leanDeg * RAD
  // En virage/inclinaison gauche (+th), la gravité apparente (up) a +sin(th) sur +X et +cos(th) sur u0
  const ux = Math.sin(th)
  const uy = Math.cos(th) * Math.cos(tb)
  const uz = Math.cos(th) * Math.sin(tb)
  // iOS inverse l'accéléromètre
  return { x: -9.81 * ux, y: -9.81 * uy, z: -9.81 * uz }
}

test('haversine ~111 km par degré de latitude', () => {
  const d = haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })
  assert.ok(Math.abs(d - 111195) < 10)
})

test('inclinaison : virage à gauche à 72 km/h, ~0.35 rad/s => 45°', () => {
  // vitesse 20 m/s, sin(45°)*9.81/20 = 0.3468 rad/s autour de l'axe haut de la moto
  const lean = leanAngle({ x: 0, y: 9.81, z: 0 }, { x: 0, y: 0.3468, z: 0 }, 20)
  assert.ok(Math.abs(lean - 45) < 0.5, lean)
  assert.ok(leanAngle({ x: 0, y: 9.81, z: 0 }, { x: 0, y: -0.3468, z: 0 }, 20) < -44)
  assert.equal(leanAngle({ x: 0, y: 9.81, z: 0 }, { x: 0, y: 1, z: 0 }, 1), 0)
})

test('motionToFrame : mapping iOS (CoreMotion) vs Android (W3C)', () => {
  const ios = motionToFrame({ x: 1, y: -9.81, z: -2 }, { alpha: 10, beta: 20, gamma: 30 }, true)
  assert.deepEqual(ios.up, { x: -1, y: 9.81, z: 2 })
  assert.ok(Math.abs(ios.rot.x - 10 * RAD) < 1e-12)
  assert.ok(Math.abs(ios.rot.y - 20 * RAD) < 1e-12)
  assert.ok(Math.abs(ios.rot.z - 30 * RAD) < 1e-12)

  const android = motionToFrame({ x: 1, y: 9.81, z: 2 }, { alpha: 10, beta: 20, gamma: 30 }, false)
  assert.deepEqual(android.up, { x: 1, y: 9.81, z: 2 })
  assert.ok(Math.abs(android.rot.x - 20 * RAD) < 1e-12)
  assert.ok(Math.abs(android.rot.y - 30 * RAD) < 1e-12)
  assert.ok(Math.abs(android.rot.z - 10 * RAD) < 1e-12)
})

test('createLeanTracker iOS à l\'arrêt (v = 0) : suit l\'inclinaison en main sans dériver + zone morte', () => {
  const tb = 70 * RAD
  const fz = -Math.cos(tb)
  const fy = Math.sin(tb)
  const tracker = createLeanTracker(true)
  let t = 0

  // Calibration à 70° vers l'arrière (comme dans le log iPhone)
  tracker.update(tiltedIosAccel(70, 0), { alpha: 0, beta: 0, gamma: 0 }, 0, (t += 20))
  tracker.calibrate()

  // Penche à +40° gauche en 0.5 s (80°/s autour de -f), puis maintenu immobile 3 s
  let lean = 0
  for (let i = 1; i <= 25; i++) {
    const ang = (40 * i) / 25
    lean = tracker.update(tiltedIosAccel(70, ang), { alpha: 0, beta: -80 * fy, gamma: -80 * fz }, 0, (t += 20))
  }
  assert.ok(Math.abs(lean - 40) < 2, `réponse trop lente à +40° : ${lean}`)
  for (let i = 0; i < 150; i++) {
    lean = tracker.update(tiltedIosAccel(70, 40), { alpha: 0, beta: 0, gamma: 0 }, 0, (t += 20))
  }
  assert.ok(Math.abs(lean - 40) < 1, `dérive en maintien à +40° : ${lean}`)

  // Passe à -45° droite en 1 s (-85°/s), puis maintenu immobile 3 s
  for (let i = 1; i <= 50; i++) {
    const ang = 40 - (85 * i) / 50
    lean = tracker.update(tiltedIosAccel(70, ang), { alpha: 0, beta: 85 * fy, gamma: 85 * fz }, 0, (t += 20))
  }
  for (let i = 0; i < 150; i++) {
    lean = tracker.update(tiltedIosAccel(70, -45), { alpha: 0, beta: 0, gamma: 0 }, 0, (t += 20))
  }
  assert.ok(Math.abs(lean + 45) < 1, `dérive en maintien à -45° : ${lean}`)

  // Retour droit avec tremblement ±1° => zone morte retourne exactement 0°
  for (let i = 1; i <= 45; i++) {
    const ang = -45 + i
    tracker.update(tiltedIosAccel(70, ang), { alpha: 0, beta: -50 * fy, gamma: -50 * fz }, 0, (t += 20))
  }
  for (let i = 0; i < 100; i++) {
    const jitter = i % 2 === 0 ? 1 : -1
    lean = tracker.update(tiltedIosAccel(70, jitter), { alpha: 0, beta: 0, gamma: 0 }, 0, (t += 20))
  }
  assert.equal(lean, 0)
})

test('createLeanTracker : recalibration à la volée (calibrate)', () => {
  const tracker = createLeanTracker(true)
  let t = 0
  tracker.update(tiltedIosAccel(70, 0), { alpha: 0, beta: 0, gamma: 0 }, 0, (t += 20))
  tracker.update(tiltedIosAccel(70, 30), { alpha: 0, beta: 0, gamma: 0 }, 0, (t += 20))
  tracker.calibrate()
  const afterCal = tracker.update(tiltedIosAccel(70, 30), { alpha: 0, beta: 0, gamma: 0 }, 0, (t += 20))
  assert.equal(afterCal, 0)
})

test('createLeanTracker iOS ligne droite en roulant : rejette tangage et chocs', () => {
  const normalAccel = tiltedIosAccel(45, 0)
  const tracker = createLeanTracker(true)
  let t = 0
  for (let i = 0; i < 20; i++) {
    tracker.update(normalAccel, { alpha: 0, beta: 0, gamma: 0 }, 0, (t += 20))
  }

  let maxAbs = 0
  for (let i = 0; i < 150; i++) {
    const sign = i % 2 === 0 ? 1 : -1
    const accel = i % 5 === 0 ? { x: 20, y: -20, z: -15 } : normalAccel
    const rot = { alpha: 100 * sign, beta: 0, gamma: 0 }
    const lean = tracker.update(accel, rot, 20, (t += 20))
    maxAbs = Math.max(maxAbs, Math.abs(lean))
  }
  assert.ok(maxAbs < 2, `fausse inclinaison trop élevée : ${maxAbs}°`)
})

test('createLeanTracker iOS en roulant (20 m/s) : réponse rapide et sans dérive à ±30°', () => {
  const c = Math.SQRT1_2
  const accel = tiltedIosAccel(45, 0)
  const omegaDeg = ((0.5 * 9.81) / 20) * (180 / Math.PI)
  const tracker = createLeanTracker(true)
  let t = 0
  tracker.update(accel, { alpha: 0, beta: 0, gamma: 0 }, 0, (t += 20))

  // Mise sur l'angle gauche (+30° en 0.5 s avec lacet progressif réaliste), puis virage stable 4 s
  let lean = 0
  for (let i = 0; i < 25; i++) {
    const w = omegaDeg * ((i + 1) / 25)
    lean = tracker.update(accel, { alpha: 0, beta: (-60 + w) * c, gamma: (60 + w) * c }, 20, (t += 20))
  }
  assert.ok(lean > 25, `réponse mise sur l'angle trop lente : ${lean}`)
  for (let i = 0; i < 350; i++) {
    lean = tracker.update(accel, { alpha: 0, beta: omegaDeg * c, gamma: omegaDeg * c }, 20, (t += 20))
  }
  assert.ok(Math.abs(lean - 30) < 0.5, `attendu ~30°, reçu ${lean}`)

  // Passage droite (-30° en 1 s avec lacet progressif), puis virage stable 7 s
  for (let i = 0; i < 50; i++) {
    const w = omegaDeg * (1 - (2 * (i + 1)) / 50)
    lean = tracker.update(accel, { alpha: 0, beta: (60 + w) * c, gamma: (-60 + w) * c }, 20, (t += 20))
  }
  for (let i = 0; i < 350; i++) {
    lean = tracker.update(accel, { alpha: 0, beta: -omegaDeg * c, gamma: -omegaDeg * c }, 20, (t += 20))
  }
  assert.ok(Math.abs(lean + 30) < 0.5, `attendu ~-30°, reçu ${lean}`)
})

test('stats d\'un trajet', () => {
  const pts = [
    { lat: 0, lon: 0, t: 0, speed: 10, lean: 0 },
    { lat: 0.001, lon: 0, t: 10000, speed: 15, lean: 30 },
    { lat: 0.002, lon: 0, t: 20000, speed: null, lean: -20 },
  ]
  const s = tripStats(pts)
  assert.ok(Math.abs(s.distance - 222.4) < 1)
  assert.equal(s.duration, 20)
  assert.equal(s.maxSpeed, 15 * 3.6)
  assert.equal(s.maxLeanLeft, 30)
  assert.equal(s.maxLeanRight, 20)
  assert.ok(Math.abs(s.avgSpeed - 40.03) < 0.1)
})
