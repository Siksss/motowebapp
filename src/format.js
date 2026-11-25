export const km = (m) => ((m || 0) / 1000).toFixed(1) + ' km'
export const hms = (s) => new Date(Math.max(0, s || 0) * 1000).toISOString().slice(11, 19)
export const fmtLap = (ms) => {
  const s = Math.max(0, ms || 0) / 1000
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`
}
export const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const TILE_ATTR = '© OpenStreetMap'
