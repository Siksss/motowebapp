import test from 'node:test'
import assert from 'node:assert/strict'
import { tripToGpx, parseGpx } from './gpx.js'
import { tripStats } from './stats.js'

test('GPX : round-trip complet avec nom XML spécial, altitude, vitesse et inclinaison', () => {
  const pts = [
    { lat: 44.82, lon: 6.735, alt: 1400, t: 1700000000000, speed: 15, lean: 0 },
    { lat: 44.821, lon: 6.736, alt: 1425.5, t: 1700000010000, speed: 20, lean: 32.5 },
    { lat: 44.822, lon: 6.737, alt: 1460, t: 1700000020000, speed: 18, lean: -28 },
  ]
  const trip = {
    id: 123,
    name: "Col d'Izoard & Lautaret <2360m>",
    note: 'Bitume sec & épingle propre',
    date: pts[0].t,
    points: pts,
    stats: tripStats(pts),
  }

  const xml = tripToGpx(trip)
  assert.ok(xml.includes('&amp;'))
  assert.ok(xml.includes('&lt;2360m&gt;'))
  assert.ok(xml.includes('<moto:lean>32.5</moto:lean>'))
  assert.ok(xml.includes('<desc>Bitume sec &amp; épingle propre</desc>'))

  const parsed = parseGpx(xml)
  assert.equal(parsed.name, "Col d'Izoard & Lautaret <2360m>")
  assert.equal(parsed.note, 'Bitume sec & épingle propre')
  assert.equal(parsed.points.length, 3)
  assert.equal(parsed.points[1].lean, 32.5)
  assert.equal(parsed.points[2].lean, -28)
  assert.equal(parsed.points[1].speed, 20)
  assert.equal(parsed.points[1].alt, 1425.5)
  assert.equal(Math.round(parsed.stats.elevationGain), 60)
  assert.equal(parsed.stats.maxLeanLeft, 32.5)
  assert.equal(parsed.stats.maxLeanRight, 28)
})

test('GPX : import standard Strava/Calimoto et repli <rtept> sans timestamps', () => {
  const gpx = `<?xml version="1.0"?>
  <gpx version="1.1">
    <metadata><name>Balade Vercors</name></metadata>
    <rte>
      <rtept lon='5.51' lat='45.05'><ele>850</ele></rtept>
      <rtept lon='5.52' lat='45.06'><ele>910</ele></rtept>
    </rte>
  </gpx>`
  const trip = parseGpx(gpx)
  assert.equal(trip.name, 'Balade Vercors')
  assert.equal(trip.points.length, 2)
  assert.equal(trip.points[0].lat, 45.05)
  assert.equal(trip.points[0].lon, 5.51)
  assert.equal(trip.points[1].t - trip.points[0].t, 1000)
  assert.equal(trip.stats.elevationGain, 60)
})

test('GPX : validation stricte des entrées invalides ou hors bornes', () => {
  assert.throws(() => parseGpx(''), /vide/i)
  assert.throws(() => parseGpx('<gpx><trk></trk></gpx>'), /minimum 2 points/i)
  assert.throws(
    () =>
      parseGpx(`<gpx><trk><trkseg>
        <trkpt lat="95" lon="6"></trkpt>
        <trkpt lat="45" lon="6"></trkpt>
      </trkseg></trk></gpx>`),
    /minimum 2 points/i
  )
})
