import test from 'node:test'
import assert from 'node:assert/strict'
import { haversine, leanAngle, tripStats } from './stats.js'

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
