import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from 'react-leaflet'
import { useRecorder } from './useRecorder.js'
import { loadTrips, deleteTrip, loadCurrent, clearCurrent } from './storage.js'
import { geocode, route } from './nav.js'

const km = (m) => (m / 1000).toFixed(1) + ' km'
const hms = (s) => new Date(s * 1000).toISOString().slice(11, 19)
const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

function Follow({ pos }) {
  const map = useMap()
  useEffect(() => {
    if (pos) map.setView([pos.lat, pos.lon], Math.max(map.getZoom(), 15))
  }, [pos, map])
  return null
}

function FitTo({ coords }) {
  const map = useMap()
  useEffect(() => {
    if (coords.length > 1) map.fitBounds(coords, { padding: [20, 20] })
  }, [coords, map])
  return null
}

function Stats({ s }) {
  const rows = [
    ['Distance', km(s.distance)],
    ['Durée', hms(s.duration)],
    ['En mouvement', hms(s.movingTime)],
    ['Vitesse max', s.maxSpeed.toFixed(0) + ' km/h'],
    ['Vitesse moy.', s.avgSpeed.toFixed(0) + ' km/h'],
    ['Moy. en mouvement', s.avgMovingSpeed.toFixed(0) + ' km/h'],
    ['Inclinaison max gauche', s.maxLeanLeft.toFixed(0) + '°'],
    ['Inclinaison max droite', s.maxLeanRight.toFixed(0) + '°'],
  ]
  return (
    <div className="stats">
      {rows.map(([k, v]) => (
        <div key={k}>
          <small>{k}</small>
          <b>{v}</b>
        </div>
      ))}
    </div>
  )
}

function Ride({ rec }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [nav, setNav] = useState(null)
  const [msg, setMsg] = useState('')
  const { pos, lean, points, recording } = rec

  async function search(e) {
    e.preventDefault()
    try {
      setResults(await geocode(q))
    } catch (err) {
      setMsg(err.message)
    }
  }
  async function go(dest) {
    setResults([])
    if (!pos) return setMsg('Position GPS inconnue')
    try {
      setNav(await route(pos, dest))
      setMsg('')
    } catch (err) {
      setMsg(err.message)
    }
  }

  const speed = pos?.speed != null ? Math.round(pos.speed * 3.6) : '--'
  return (
    <div className="ride">
      <form className="search" onSubmit={search}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Destination…" />
        {nav && (
          <button type="button" onClick={() => setNav(null)}>
            ✕
          </button>
        )}
      </form>
      {results.length > 0 && (
        <ul className="results">
          {results.map((r) => (
            <li key={r.name} onClick={() => go(r)}>
              {r.name}
            </li>
          ))}
        </ul>
      )}
      {nav && (
        <div className="navinfo">
          {km(nav.distance)} · {Math.round(nav.duration / 60)} min
        </div>
      )}
      {msg && <div className="navinfo">{msg}</div>}
      <MapContainer center={[46.6, 2.4]} zoom={6} className="map" zoomControl={false}>
        <TileLayer url={TILES} attribution="© OpenStreetMap" />
        {nav && <Polyline positions={nav.coords} color="#3b82f6" weight={6} opacity={0.7} />}
        {points.length > 1 && <Polyline positions={points.map((p) => [p.lat, p.lon])} color="#ff6a00" weight={5} />}
        {pos && <CircleMarker center={[pos.lat, pos.lon]} radius={8} color="#fff" fillColor="#ff6a00" fillOpacity={1} />}
        <Follow pos={pos} />
      </MapContainer>
      <div className="hud">
        <div>
          <b>{speed}</b>
          <small>km/h</small>
        </div>
        <div>
          <b>
            {Math.abs(lean).toFixed(0)}° {lean > 1 ? '◀' : lean < -1 ? '▶' : ''}
          </b>
          <small>inclinaison</small>
        </div>
        <button className={recording ? 'stop' : 'start'} onClick={() => (recording ? rec.stop() : rec.start())}>
          {recording ? '■ Stop' : '● Rouler'}
        </button>
      </div>
    </div>
  )
}

function TripDetail({ trip, onBack, onDelete }) {
  const coords = trip.points.map((p) => [p.lat, p.lon])
  return (
    <div className="page">
      <button onClick={onBack}>← Retour</button>
      <h2>{new Date(trip.date).toLocaleString('fr-FR')}</h2>
      <MapContainer center={coords[0]} zoom={13} className="map small">
        <TileLayer url={TILES} attribution="© OpenStreetMap" />
        <Polyline positions={coords} color="#ff6a00" weight={5} />
        <FitTo coords={coords} />
      </MapContainer>
      <Stats s={trip.stats} />
      <button
        className="danger"
        onClick={() => confirm('Supprimer ce trajet ?') && onDelete(trip.id)}
      >
        Supprimer
      </button>
    </div>
  )
}

function Trips({ trips, onOpen }) {
  if (!trips.length) return <p className="page">Aucun trajet. Va rouler ! 🏍️</p>
  const total = trips.reduce((a, t) => a + t.stats.distance, 0)
  return (
    <div className="page">
      <h2>
        {trips.length} trajets · {km(total)}
      </h2>
      <ul className="trips">
        {trips.map((t) => (
          <li key={t.id} onClick={() => onOpen(t)}>
            <b>{new Date(t.date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}</b>
            <span>
              {km(t.stats.distance)} · {hms(t.stats.duration)} · max {t.stats.maxSpeed.toFixed(0)} km/h
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function App() {
  const [tab, setTab] = useState('ride')
  const [trips, setTrips] = useState(loadTrips)
  const [open, setOpen] = useState(null)
  const rec = useRecorder((all, trip) => {
    setTrips(all)
    setOpen(trip)
    setTab('trips')
  })

  // Trajet interrompu (page fermée pendant l'enregistrement) ?
  useEffect(() => {
    const cur = loadCurrent()
    if (cur?.length > 1) {
      if (confirm('Un trajet a été interrompu. Le reprendre ?')) rec.start(true)
      else clearCurrent()
    }
  }, [])

  return (
    <div className="app">
      {rec.error && <div className="error">{rec.error}</div>}
      {tab === 'ride' && <Ride rec={rec} />}
      {tab === 'trips' &&
        (open ? (
          <TripDetail
            trip={open}
            onBack={() => setOpen(null)}
            onDelete={(id) => {
              setTrips(deleteTrip(id))
              setOpen(null)
            }}
          />
        ) : (
          <Trips trips={trips} onOpen={setOpen} />
        ))}
      <nav className="tabs">
        <button className={tab === 'ride' ? 'on' : ''} onClick={() => setTab('ride')}>
          🏍️ Rouler
        </button>
        <button className={tab === 'trips' ? 'on' : ''} onClick={() => setTab('trips')}>
          📊 Trajets
        </button>
      </nav>
    </div>
  )
}
