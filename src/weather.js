const weatherCache = new Map()

export function clearWeatherCache() {
  weatherCache.clear()
}

export function evaluateRidingWeather(raw = {}) {
  const temp = Number(raw.temperature ?? raw.temperature_2m)
  const precip = Number(raw.precipitation ?? 0)
  const code = Number(raw.weatherCode ?? raw.weather_code ?? 0)
  const wind = Number(raw.windSpeed ?? raw.wind_speed_10m ?? 0)
  const gusts = Number(raw.windGusts ?? raw.wind_gusts_10m ?? 0)

  let icon = '⛅'
  let label = 'Nuageux'
  let level = 'ok'
  const notes = []

  if (code >= 95) {
    icon = '⛈️'
    label = 'Orage'
    level = 'danger'
    notes.push('Orage actif, prudence')
  } else if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    icon = '❄️'
    label = 'Neige / Verglas'
    level = 'danger'
    notes.push('Risque d’adhérence critique')
  } else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || precip >= 0.2) {
    icon = '🌧️'
    label = 'Pluie'
    level = precip >= 2 ? 'danger' : 'warn'
    notes.push('Chaussée mouillée, marge accrue')
  } else if (code === 45 || code === 48) {
    icon = '🌫️'
    label = 'Brouillard'
    level = 'warn'
    notes.push('Visibilité réduite')
  } else if (code <= 2) {
    icon = '☀️'
    label = 'Dégagé'
  }

  if (gusts >= 50) {
    level = 'danger'
    notes.push(`Rafales fortes (${Math.round(gusts)} km/h)`)
  } else if (wind >= 35 || gusts >= 38) {
    if (level === 'ok') level = 'warn'
    notes.push(`Vent soutenu (${Math.round(Math.max(wind, gusts))} km/h)`)
  }

  if (Number.isFinite(temp) && temp < 5) {
    if (level === 'ok') level = 'warn'
    notes.push('Route froide (< 5 °C)')
  }

  return {
    level,
    icon,
    label,
    advice: notes.length ? notes.join(' · ') : 'Conditions idéales pour rouler',
    tempC: Number.isFinite(temp) ? Math.round(temp) : null,
    windKmh: Number.isFinite(wind) ? Math.round(wind) : 0,
    gustsKmh: Number.isFinite(gusts) ? Math.round(gusts) : 0,
  }
}

export async function fetchMotoWeather(pos, { fetchImpl = globalThis.fetch, now = Date.now(), ttlMs = 15 * 60_000 } = {}) {
  if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lon) || typeof fetchImpl !== 'function') {
    return null
  }
  const cLat = (Math.round(pos.lat * 20) / 20).toFixed(2)
  const cLon = (Math.round(pos.lon * 20) / 20).toFixed(2)
  const key = `${cLat},${cLon}`
  const hit = weatherCache.get(key)
  if (hit && now - hit.ts < ttlMs) return hit.data

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${pos.lat.toFixed(4)}&longitude=${pos.lon.toFixed(4)}` +
      '&current=temperature_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m&timezone=auto'
    const res = await fetchImpl(url)
    if (!res?.ok) return null
    const json = await res.json()
    if (!json?.current) return null
    const data = evaluateRidingWeather(json.current)
    weatherCache.set(key, { ts: now, data })
    return data
  } catch {
    return null
  }
}
