import test from 'node:test'
import assert from 'node:assert/strict'
import { haversine, leanAngle, motionToFrame, createLeanTracker, tripStats } from './stats.js'

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
  const k = Math.PI / 180
  const ios = motionToFrame({ x: 1, y: -9.81, z: -2 }, { alpha: 10, beta: 20, gamma: 30 }, true)
  assert.deepEqual(ios.up, { x: -1, y: 9.81, z: 2 })
  assert.ok(Math.abs(ios.rot.x - 10 * k) < 1e-12)
  assert.ok(Math.abs(ios.rot.y - 20 * k) < 1e-12)
  assert.ok(Math.abs(ios.rot.z - 30 * k) < 1e-12)

  const android = motionToFrame({ x: 1, y: 9.81, z: 2 }, { alpha: 10, beta: 20, gamma: 30 }, false)
  assert.deepEqual(android.up, { x: 1, y: 9.81, z: 2 })
  assert.ok(Math.abs(android.rot.x - 20 * k) < 1e-12)
  assert.ok(Math.abs(android.rot.y - 30 * k) < 1e-12)
  assert.ok(Math.abs(android.rot.z - 10 * k) < 1e-12)
})

test('createLeanTracker iOS guidon incliné 45° : virages stables à ±30°', () => {
  const c = Math.SQRT1_2
  const accel = { x: 0, y: -9.81 * c, z: -9.81 * c }
  // sin(30°) * 9.81 / 20 rad/s -> deg/s
  const omegaDeg = ((0.5 * 9.81) / 20) * (180 / Math.PI)

  const tracker = createLeanTracker(true)
  let t = 0
  let lean = 0
  for (let i = 0; i < 200; i++) {
    lean = tracker.update(accel, { alpha: 0, beta: omegaDeg * c, gamma: omegaDeg * c }, 20, (t += 20))
  }
  assert.ok(Math.abs(lean - 30) < 0.2, `attendu ~30°, reçu ${lean}`)

  for (let i = 0; i < 200; i++) {
    lean = tracker.update(accel, { alpha: 0, beta: -omegaDeg * c, gamma: -omegaDeg * c }, 20, (t += 20))
  }
  assert.ok(Math.abs(lean + 30) < 0.2, `attendu ~-30°, reçu ${lean}`)
})

test('createLeanTracker iOS ligne droite : rejette tangage, roulis et chocs', () => {
  const c = Math.SQRT1_2
  const normalAccel = { x: 0, y: -9.81 * c, z: -9.81 * c }
  const tracker = createLeanTracker(true)
  let t = 0
  // Stabilisation initiale à l'arrêt
  for (let i = 0; i < 50; i++) {
    tracker.update(normalAccel, { alpha: 0, beta: 0, gamma: 0 }, 0, (t += 20))
  }

  let maxAbs = 0
  for (let i = 0; i < 150; i++) {
    const sign = i % 2 === 0 ? 1 : -1
    // Alternance de chocs > 30 m/s², tangage ±100°/s (alpha), et roulis ±80°/s autour de l'axe avant
    const accel = i % 5 === 0 ? { x: 20, y: -20, z: -15 } : normalAccel
    const rot =
      i % 3 === 0
        ? { alpha: 100 * sign, beta: 0, gamma: 0 }
        : { alpha: 0, beta: 80 * sign * c, gamma: -80 * sign * c }
    const lean = tracker.update(accel, rot, 20, (t += 20))
    maxAbs = Math.max(maxAbs, Math.abs(lean))
  }
  assert.ok(maxAbs < 2, `fausse inclinaison trop élevée : ${maxAbs}°`)
})

test('createLeanTracker : coupure basse vitesse et atténuation d\'un à-coup bref', () => {
  const c = Math.SQRT1_2
  const accel = { x: 0, y: -9.81 * c, z: -9.81 * c }
  const tracker = createLeanTracker(true)
  let t = 0

  // À basse vitesse (< 4 m/s), même un fort braquage donne 0° et ne s'accumule pas
  for (let i = 0; i < 100; i++) {
    const lean = tracker.update(accel, { alpha: 0, beta: 60 * c, gamma: 60 * c }, 2, (t += 20))
    assert.equal(lean, 0)
  }
  const afterAccel = tracker.update(accel, { alpha: 0, beta: 0, gamma: 0 }, 15, (t += 20))
  assert.equal(afterAccel, 0)

  // À-coup de lacet de 0.2 s équivalent à 30° à 20 m/s : fortement atténué
  const omegaDeg = ((0.5 * 9.81) / 20) * (180 / Math.PI)
  let peak = 0
  for (let i = 0; i < 10; i++) {
    const lean = tracker.update(accel, { alpha: 0, beta: omegaDeg * c, gamma: omegaDeg * c }, 20, (t += 20))
    peak = Math.max(peak, Math.abs(lean))
  }
  assert.ok(peak < 8, `à-coup bref trop fort : ${peak}°`)
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
