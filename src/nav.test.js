import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildOsrmUrl, routeFromTrip, trackProgressOnPath } from './nav.js'

describe('roadbook multi-étapes et trace fantôme', () => {
  it('construit des URLs OSRM à 2 ou plusieurs étapes', () => {
    const p1 = { lat: 45.1, lon: 5.7 }
    const p2 = { lat: 45.2, lon: 5.8 }
    const p3 = { lat: 45.3, lon: 5.9 }

    const u2 = buildOsrmUrl([p1, p2])
    assert.ok(u2.includes('5.7,45.1;5.8,45.2?'))
    assert.ok(u2.includes('steps=true'))

    const u3 = buildOsrmUrl([p1, p2, p3])
    assert.ok(u3.includes('5.7,45.1;5.8,45.2;5.9,45.3?'))

    assert.throws(() => buildOsrmUrl([p1]))
  })

  it('génère une trace fantôme hors-ligne et suit la progression + écart > 120 m', () => {
    const trip = {
      name: 'Col du Glandon',
      points: [
        { lat: 45.0, lon: 6.0 },
        { lat: 45.01, lon: 6.0 }, // ~1112 m nord
        { lat: 45.02, lon: 6.0 }, // ~2224 m nord
      ],
      stats: { distance: 2224, duration: 180 },
    }

    const ghost = routeFromTrip(trip)
    assert.equal(ghost.mode, 'ghost')
    assert.equal(ghost.name, 'Col du Glandon')
    assert.equal(ghost.coords.length, 3)

    // À mi-chemin sur le premier segment : sur la trace, ~1668 m restants
    const mid = trackProgressOnPath({ lat: 45.005, lon: 6.0 }, ghost.coords)
    assert.equal(mid.isOffRoute, false)
    assert.ok(mid.offRouteM <= 5, `écart inattendu : ${mid.offRouteM}`)
    assert.ok(mid.remainingM > 1550 && mid.remainingM < 1780, `reste : ${mid.remainingM}`)

    // Écart latéral de ~0.003° en lon (~235 m > 120 m) -> hors trace
    const off = trackProgressOnPath({ lat: 45.015, lon: 6.003 }, ghost.coords)
    assert.equal(off.isOffRoute, true)
    assert.ok(off.offRouteM > 180 && off.offRouteM < 300)
  })
})
