import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createLapTimer } from './lap.js'

describe('chrono auto-lap (lap)', () => {
  it('détecte 3 tours complets, calcule meilleur tour et delta, et ignore les faux passages', () => {
    const timer = createLapTimer({ minLapMs: 20000, gateRadiusM: 35 })
    const start = { lat: 48.0, lon: 2.0 }
    const far = { lat: 48.002, lon: 2.0 } // ~222 m (> 70 m armement)

    assert.equal(timer.setGate(start), true)
    assert.equal(timer.state().active, true)

    let t = 0
    timer.update(start, t)
    // Passage trop rapide (< 20s) ou sans s'être éloigné ne valide pas de tour
    assert.equal(timer.update(start, (t += 5000)).completedLapMs, null)

    // Tour 1 : 30s
    timer.update(far, 15000)
    const lap1 = timer.update(start, 30000)
    assert.equal(lap1.completedLapMs, 30000)
    assert.equal(lap1.lapCount, 1)
    assert.equal(lap1.bestLapMs, 30000)
    assert.equal(lap1.deltaMs, 0)

    // Double passage immédiat à la ligne rejeté (non réarmé)
    assert.equal(timer.update(start, 31000).completedLapMs, null)

    // Tour 2 : 25s (nouveau meilleur tour, delta -5s)
    timer.update(far, 42000)
    const lap2 = timer.update(start, 55000)
    assert.equal(lap2.completedLapMs, 25000)
    assert.equal(lap2.bestLapMs, 25000)
    assert.equal(lap2.deltaMs, -5000)

    // Tour 3 : 28s (+3s vs record)
    timer.update(far, 68000)
    const lap3 = timer.update(start, 83000)
    assert.equal(lap3.lapCount, 3)
    assert.equal(lap3.lastLapMs, 28000)
    assert.equal(lap3.bestLapMs, 25000)
    assert.equal(lap3.deltaMs, 3000)

    timer.clear()
    assert.equal(timer.state().active, false)
    assert.equal(timer.state().lapCount, 0)
  })
})
