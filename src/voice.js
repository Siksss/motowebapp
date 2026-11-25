// Synthèse vocale Web Speech API (guidage casque & alertes télémétrie)

export function speak(text, { enabled = true, synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance } = {}) {
  if (!enabled || !text || !synth || !Utterance) return false
  const u = new Utterance(text)
  u.lang = 'fr-FR'
  u.rate = 1.05
  synth.cancel?.()
  synth.speak(u)
  return true
}

export function createAudioCoach({ onSpeak, now = () => Date.now(), leanLimitDeg = 0 } = {}) {
  let lastKmBucket = 0
  let bestLean = 0
  let lastLeanAt = -Infinity
  let lastLimitAt = -Infinity

  function update({ distanceM = 0, leanDeg = 0, leanLimitDeg: overrideLimit } = {}) {
    const absLean = Math.round(Math.abs(leanDeg))
    const t = now()
    const limit = overrideLimit ?? leanLimitDeg
    if (limit > 0 && absLean >= limit && t - lastLimitAt >= 10000) {
      lastLimitAt = t
      const phrase = `Attention, angle limite de ${limit} degrés atteint`
      onSpeak?.(phrase)
      return phrase
    }

    const bucket = Math.floor(Math.max(0, distanceM) / 10000)
    if (bucket > lastKmBucket) {
      lastKmBucket = bucket
      const phrase = `${bucket * 10} kilomètres parcourus`
      onSpeak?.(phrase)
      return phrase
    }

    if (absLean >= 25 && (bestLean === 0 || absLean >= bestLean + 3) && t - lastLeanAt >= 15000) {
      bestLean = absLean
      lastLeanAt = t
      const phrase = `Nouvel angle record : ${absLean} degrés`
      onSpeak?.(phrase)
      return phrase
    }
    return null
  }

  function reset() {
    lastKmBucket = 0
    bestLean = 0
    lastLeanAt = -Infinity
    lastLimitAt = -Infinity
  }

  return { update, reset }
}
