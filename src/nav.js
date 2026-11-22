// Services gratuits publics : Nominatim (adresses) et OSRM (itinéraires).
// shortcut: serveurs de démo à usage limité, prendre une clé (ex. OpenRouteService) si usage intensif.

export async function geocode(q) {
  const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=5&q=' + encodeURIComponent(q))
  if (!res.ok) throw new Error('Recherche impossible')
  return (await res.json()).map((r) => ({ name: r.display_name, lat: +r.lat, lon: +r.lon }))
}

export async function route(from, to) {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok || !data.routes?.length) throw new Error('Itinéraire introuvable')
  const r = data.routes[0]
  return { coords: r.geometry.coordinates.map(([lon, lat]) => [lat, lon]), distance: r.distance, duration: r.duration }
}
