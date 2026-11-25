import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateRidingWeather, fetchMotoWeather, clearWeatherCache } from './weather.js'

describe('météo moto locale (weather)', () => {
  it('évalue soleil idéal, pluie, rafales >= 50 km/h et route froide < 5 °C', () => {
    const sun = evaluateRidingWeather({ temperature: 21.4, precipitation: 0, weatherCode: 0, windSpeed: 12, windGusts: 18 })
    assert.equal(sun.level, 'ok')
    assert.equal(sun.icon, '☀️')
    assert.equal(sun.tempC, 21)

    const rain = evaluateRidingWeather({ temperature: 13, precipitation: 1.1, weatherCode: 61, windSpeed: 15, windGusts: 22 })
    assert.equal(rain.level, 'warn')
    assert.equal(rain.icon, '🌧️')
    assert.match(rain.advice, /mouillée/i)

    const gusty = evaluateRidingWeather({ temperature: 18, precipitation: 0, weatherCode: 2, windSpeed: 32, windGusts: 58 })
    assert.equal(gusty.level, 'danger')
    assert.match(gusty.advice, /Rafales/i)

    const cold = evaluateRidingWeather({ temperature: 3.2, precipitation: 0, weatherCode: 1, windSpeed: 8, windGusts: 12 })
    assert.equal(cold.level, 'warn')
    assert.match(cold.advice, /froide/i)
  })

  it('met en cache 15 min par cellule 0.05° et retourne null si hors-ligne', async () => {
    clearWeatherCache()
    let calls = 0
    const mockFetch = async () => {
      calls++
      return {
        ok: true,
        json: async () => ({
          current: { temperature_2m: 19, precipitation: 0, weather_code: 1, wind_speed_10m: 14, wind_gusts_10m: 20 },
        }),
      }
    }

    const pos = { lat: 45.112, lon: 5.712 }
    const w1 = await fetchMotoWeather(pos, { fetchImpl: mockFetch, now: 1000 })
    const w2 = await fetchMotoWeather({ lat: 45.119, lon: 5.719 }, { fetchImpl: mockFetch, now: 60_000 })
    assert.equal(calls, 1)
    assert.equal(w1.tempC, 19)
    assert.equal(w2.level, 'ok')

    const offline = await fetchMotoWeather(
      { lat: 48.85, lon: 2.35 },
      { fetchImpl: async () => { throw new Error('offline') }, now: 1000 }
    )
    assert.equal(offline, null)
  })
})
