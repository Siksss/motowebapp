import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { projectTrack, buildPosterModel } from './poster.js'

describe('carte souvenir PNG (poster)', () => {
  it('projette le tracé dans le cadre avec correction cos(lat) et marge', () => {
    const pts = [
      { lat: 45.0, lon: 6.0, speed: 15, lean: 10 },
      { lat: 45.02, lon: 6.03, speed: 20, lean: -35 },
      { lat: 45.01, lon: 6.01, speed: 18, lean: 25 },
    ]
    const res = projectTrack(pts, { x: 50, y: 100, w: 900, h: 600, pad: 40 })
    assert.equal(res.coords.length, 3)
    for (const c of res.coords) {
      assert.ok(c.x >= 90 && c.x <= 910, `x hors bornes : ${c.x}`)
      assert.ok(c.y >= 140 && c.y <= 660, `y hors bornes : ${c.y}`)
    }
    // Nord = y plus petit
    assert.ok(res.coords[1].y < res.coords[0].y)
    // Est = x plus grand
    assert.ok(res.coords[1].x > res.coords[0].x)
  })

  it('gère un tracé vide ou réduit à un seul point sans NaN', () => {
    assert.deepEqual(projectTrack([]), { coords: [], bounds: null })
    const single = projectTrack([{ lat: 48.8, lon: 2.3 }], { x: 10, y: 20, w: 200, h: 100 })
    assert.deepEqual(single.coords, [{ x: 110, y: 70, speed: 0, lean: 0 }])
  })

  it('construit les données normalisées du modèle affiche', () => {
    const trip = {
      id: 1,
      name: 'Col de la Croix-de-Fer',
      date: Date.UTC(2026, 6, 14, 10, 0),
      points: [],
      stats: {
        distance: 42350,
        duration: 3725,
        maxSpeed: 104.6,
        maxLeanLeft: 43.2,
        maxLeanRight: 39.8,
        elevationGain: 1245,
      },
    }
    const model = buildPosterModel(trip, { badge: 'Col alpin', score: 86, cornersCount: 34 })
    assert.equal(model.title, 'Col de la Croix-de-Fer')
    assert.equal(model.badge, 'Col alpin')
    assert.equal(model.viroloScore, 86)
    assert.equal(model.distance, '42.4 km')
    assert.equal(model.duration, '01:02:05')
    assert.equal(model.maxSpeed, '105 km/h')
    assert.equal(model.maxLean, '43°')
    assert.equal(model.dPlus, '1245 m')
    assert.equal(model.cornersCount, 34)
  })
})
