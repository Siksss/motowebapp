import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatDist, formatManeuver, trackStep, nextAnnouncement } from './nav.js'
import { speak, createAudioCoach } from './voice.js'

describe('navigation tour-par-tour', () => {
  it('formate les manoeuvres et distances en français', () => {
    assert.deepEqual(formatManeuver({ type: 'turn', modifier: 'right', name: 'D91' }), {
      icon: '↱',
      text: 'Tourner à droite sur D91',
    })
    assert.deepEqual(formatManeuver({ type: 'roundabout', exit: 2, name: 'N7' }), {
      icon: '↻',
      text: 'Au rond-point, 2e sortie sur N7',
    })
    assert.equal(formatManeuver({ type: 'arrive' }).icon, '🏁')
    assert.equal(formatDist(214), '210 m')
    assert.equal(formatDist(1460), '1.5 km')
  })

  it('suit la progression des étapes GPS et détecte l arrivée', () => {
    const steps = [
      { type: 'depart', modifier: '', name: 'Rue A', location: { lat: 48.0, lon: 2.0 } },
      { type: 'turn', modifier: 'left', name: 'D91', location: { lat: 48.0045, lon: 2.0 } }, // ~500m nord
      { type: 'arrive', modifier: '', name: '', location: { lat: 48.009, lon: 2.0 } }, // ~1000m nord
    ]

    const s0 = trackStep({ lat: 48.0, lon: 2.0 }, steps, 0)
    assert.equal(s0.stepIdx, 1)
    assert.equal(s0.done, false)
    assert.ok(s0.distM > 450 && s0.distM < 550)

    const s1 = trackStep({ lat: 48.0044, lon: 2.0 }, steps, s0.stepIdx)
    assert.equal(s1.stepIdx, 2)
    assert.equal(s1.done, false)

    const s2 = trackStep({ lat: 48.009, lon: 2.0 }, steps, s1.stepIdx)
    assert.equal(s2.stepIdx, 2)
    assert.equal(s2.done, true)
  })

  it('génère les annonces vocales aux seuils 500m / 200m / 50m sans répétition', () => {
    const step = { type: 'turn', modifier: 'right', name: 'D91' }
    const seen = new Set()

    assert.equal(nextAnnouncement(650, 1, step, seen), null)

    const far = nextAnnouncement(420, 1, step, seen)
    assert.equal(far.phrase, 'Dans 500 mètres, tourner à droite sur D91')
    seen.add(far.key)
    assert.equal(nextAnnouncement(380, 1, step, seen), null)

    const near = nextAnnouncement(160, 1, step, seen)
    assert.equal(near.phrase, 'Dans 200 mètres, tourner à droite sur D91')
    seen.add(near.key)

    const now = nextAnnouncement(35, 1, step, seen)
    assert.equal(now.phrase, 'Maintenant, tourner à droite sur D91')
    seen.add(now.key)

    const arrive = nextAnnouncement(20, 2, { type: 'arrive' }, seen)
    assert.equal(arrive.phrase, 'Vous êtes arrivé')
  })
})

describe('copilote audio et speak', () => {
  it('parle uniquement si activé et annule la file précédente', () => {
    const spoken = []
    let canceled = 0
    const synth = { cancel: () => canceled++, speak: (u) => spoken.push(u) }
    class FakeUtterance {
      constructor(t) {
        this.text = t
      }
    }

    assert.equal(speak('Test', { enabled: false, synth, Utterance: FakeUtterance }), false)
    assert.equal(speak('Tournez à gauche', { enabled: true, synth, Utterance: FakeUtterance }), true)
    assert.equal(canceled, 1)
    assert.equal(spoken[0].text, 'Tournez à gauche')
    assert.equal(spoken[0].lang, 'fr-FR')
  })

  it('annonce les paliers 10 km et les records d inclinaison avec cooldown', () => {
    let t = 0
    const heard = []
    const coach = createAudioCoach({ onSpeak: (p) => heard.push(p), now: () => t })

    assert.equal(coach.update({ distanceM: 9500, leanDeg: 22 }), null)
    assert.equal(coach.update({ distanceM: 10100, leanDeg: 26 }), '10 kilomètres parcourus')

    t = 1000
    assert.equal(coach.update({ distanceM: 10200, leanDeg: 26 }), 'Nouvel angle record : 26 degrés')
    t = 10000
    assert.equal(coach.update({ distanceM: 10300, leanDeg: 33 }), null)
    t = 17000
    assert.equal(coach.update({ distanceM: 10400, leanDeg: 28 }), null)
    assert.equal(coach.update({ distanceM: 10500, leanDeg: 30 }), 'Nouvel angle record : 30 degrés')

    coach.reset()
    t = 18000
    assert.equal(coach.update({ distanceM: 10050, leanDeg: 10 }), '10 kilomètres parcourus')
    assert.equal(heard.length, 4)
  })

  it('déclenche l alerte d angle limite configurable avec cooldown 10 s', () => {
    let t = 0
    const coach = createAudioCoach({ now: () => t })
    assert.equal(coach.update({ leanDeg: 35, leanLimitDeg: 38 }), 'Nouvel angle record : 35 degrés')
    assert.equal(coach.update({ leanDeg: -39, leanLimitDeg: 38 }), 'Attention, angle limite de 38 degrés atteint')
    t = 5000
    assert.equal(coach.update({ leanDeg: 41, leanLimitDeg: 38 }), null)
    t = 11000
    assert.equal(coach.update({ leanDeg: 40, leanLimitDeg: 38 }), 'Attention, angle limite de 38 degrés atteint')
  })
})
