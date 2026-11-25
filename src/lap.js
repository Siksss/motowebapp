import { haversine } from './stats.js'

export function createLapTimer({ minLapMs = 20000, gateRadiusM = 35 } = {}) {
  let gate = null
  let lapStartMs = null
  let armed = false
  let laps = []
  let lastLapMs = null
  let bestLapMs = null
  let deltaMs = null
  let currentLapMs = 0

  function state() {
    return {
      active: !!gate,
      gate,
      lapStartMs,
      lapCount: laps.length,
      currentLapMs,
      lastLapMs,
      bestLapMs,
      deltaMs,
      laps: [...laps],
    }
  }

  function clear() {
    gate = null
    lapStartMs = null
    armed = false
    laps = []
    lastLapMs = null
    bestLapMs = null
    deltaMs = null
    currentLapMs = 0
    return state()
  }

  function setGate(pos, bearingDeg = null) {
    if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) return false
    clear()
    gate = { lat: pos.lat, lon: pos.lon, bearingDeg }
    return true
  }

  function update(pos, tMs) {
    if (!gate || !pos || !Number.isFinite(tMs)) return { ...state(), completedLapMs: null }
    const d = haversine(pos, gate)

    if (lapStartMs == null) {
      lapStartMs = tMs
      return { ...state(), completedLapMs: null }
    }

    if (!armed && d > gateRadiusM * 2) armed = true

    const elapsed = Math.max(0, tMs - lapStartMs)
    if (armed && d <= gateRadiusM && elapsed >= minLapMs) {
      laps.push(elapsed)
      const prevBest = bestLapMs
      lastLapMs = elapsed
      bestLapMs = prevBest == null ? elapsed : Math.min(prevBest, elapsed)
      deltaMs = prevBest == null ? 0 : elapsed - prevBest
      lapStartMs = tMs
      armed = false
      currentLapMs = 0
      return { ...state(), completedLapMs: elapsed }
    }

    currentLapMs = elapsed
    return { ...state(), completedLapMs: null }
  }

  return { setGate, update, clear, state }
}
