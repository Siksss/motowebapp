import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from 'react-leaflet'
import { useRecorder } from './useRecorder.js'
import { loadTrips, deleteTrip, loadCurrent, clearCurrent } from './storage.js'
import { tripStats } from './stats.js'
import { geocode, route } from './nav.js'

const km = (m) => (m / 1000).toFixed(1) + ' km'
const hms = (s) => new Date(Math.max(0, s) * 1000).toISOString().slice(11, 19)
const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

function arcPath(cx, cy, r, startDeg, endDeg) {
  const [x1, y1] = polar(cx, cy, r, startDeg)
  const [x2, y2] = polar(cx, cy, r, endDeg)
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0
  const sweep = endDeg >= startDeg ? 1 : 0
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

const SPEED_R = 102
const SPEED_ARC_LEN = (240 / 360) * 2 * Math.PI * SPEED_R
const SPEED_TRACK = arcPath(140, 140, SPEED_R, 150, 390)
const SPEED_TICKS = Array.from({ length: 11 }, (_, i) => i * 20)

function SpeedGauge({ speed, maxSpeed, recording, hasPos, simSpeed }) {
  const pct = Math.max(0, Math.min(1, (speed ?? 0) / 200))
  return (
    <div className="speed-gauge">
      <svg viewBox="0 0 280 230" className="speed-svg" aria-hidden="true">
        <defs>
          <linearGradient id="speedGrad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="65%" stopColor="#0057ff" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
        </defs>
        {SPEED_TICKS.map((v) => {
          const deg = 150 + (v / 200) * 240
          const major = v % 40 === 0
          const [x1, y1] = polar(140, 140, 112, deg)
          const [x2, y2] = polar(140, 140, major ? 121 : 117, deg)
          const [lx, ly] = polar(140, 140, 131, deg)
          return (
            <g key={v}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={major ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.18)'}
                strokeWidth={major ? 2 : 1.5}
                strokeLinecap="round"
              />
              {major && (
                <text x={lx} y={ly + 4} textAnchor="middle" className="tick-label">
                  {v}
                </text>
              )}
            </g>
          )
        })}
        <path
          d={SPEED_TRACK}
          fill="none"
          stroke="rgba(255,255,255,0.09)"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path
          d={SPEED_TRACK}
          fill="none"
          stroke="url(#speedGrad)"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={SPEED_ARC_LEN}
          strokeDashoffset={SPEED_ARC_LEN * (1 - pct)}
          className="speed-arc"
          style={{ opacity: pct > 0.004 ? 1 : 0 }}
        />
      </svg>
      <div className="speed-center">
        <div className={speed == null ? 'speed-val empty' : 'speed-val'}>
          {speed != null ? speed : '--'}
        </div>
        <div className="speed-unit">KM/H</div>
        <div className="speed-pill">
          {recording
            ? `MAX ${Math.round(maxSpeed)} km/h`
            : simSpeed
              ? 'SIM 50'
              : hasPos
                ? 'PRÊT'
                : 'GPS…'}
        </div>
      </div>
    </div>
  )
}

const LEAN_TRACK = arcPath(140, 100, 76, 215, 325)
const LEAN_TICKS = [-45, -30, -15, 0, 15, 30, 45]

function LeanGauge({ lean, maxLeft, maxRight, onCalibrate }) {
  const [calOk, setCalOk] = useState(false)
  const vis = Math.max(-55, Math.min(55, lean))
  const abs = Math.abs(lean)
  const high = Math.abs(vis) >= 40
  const color = high ? '#ef4444' : '#0057ff'
  const activeArc =
    vis > 0.5
      ? arcPath(140, 100, 76, 270 - vis, 270)
      : vis < -0.5
        ? arcPath(140, 100, 76, 270, 270 - vis)
        : null
  const dir = lean > 1 ? '◀ GAUCHE' : lean < -1 ? 'DROITE ▶' : 'DROIT'

  return (
    <div className="card lean-card">
      <button
        type="button"
        className={calOk ? 'cal-btn ok' : 'cal-btn'}
        aria-label="Calibrer le point zéro"
        onClick={async () => {
          await onCalibrate?.()
          setCalOk(true)
          setTimeout(() => setCalOk(false), 1200)
        }}
      >
        {calOk ? 'OK' : '0°'}
      </button>
      <div className="lean-peak">
        <small>MAX G</small>
        <b>{Math.round(maxLeft)}°</b>
      </div>
      <div className="lean-mid">
        <svg viewBox="0 0 280 112" className="lean-svg" aria-hidden="true">
          {LEAN_TICKS.map((a) => {
            const major = a === 0 || Math.abs(a) === 45
            const [x1, y1] = polar(140, 100, 70, 270 + a)
            const [x2, y2] = polar(140, 100, major ? 82 : 79, 270 + a)
            const [lx, ly] = polar(140, 100, 91, 270 + a)
            return (
              <g key={a}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={major ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.2)'}
                  strokeWidth={a === 0 ? 2 : 1.5}
                  strokeLinecap="round"
                />
                {Math.abs(a) === 45 && (
                  <text x={lx} y={ly + 3} textAnchor="middle" className="tick-label small">
                    45°
                  </text>
                )}
              </g>
            )
          })}
          <path
            d={LEAN_TRACK}
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="7"
            strokeLinecap="round"
          />
          {activeArc && (
            <path d={activeArc} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" />
          )}
          <line x1="88" y1="98" x2="192" y2="98" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
          <g transform={`rotate(${-vis} 140 96)`}>
            <line x1="140" y1="45" x2="140" y2="31" stroke={color} strokeWidth="2" strokeLinecap="round" />
            <path d="M123 53 L134 56 M157 53 L146 56" stroke="#cbd5e1" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M134 46 L146 46 L149 58 L131 58 Z" fill="#94a3b8" />
            <path d="M129 58 L151 58 L148 77 L132 77 Z" fill="#e2e8f0" />
            <line x1="136" y1="63" x2="144" y2="63" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
            <rect x="134" y="75" width="12" height="21" rx="5" fill="#475569" stroke="#cbd5e1" strokeWidth="1.5" />
          </g>
        </svg>
        <div className="lean-readout">
          <b>{abs.toFixed(0)}°</b>
          <span className={abs > 1 ? 'dir active' : 'dir'}>{dir}</span>
        </div>
      </div>
      <div className="lean-peak">
        <small>MAX D</small>
        <b>{Math.round(maxRight)}°</b>
      </div>
    </div>
  )
}

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
    ['Durée totale', hms(s.duration)],
    ['En mouvement', hms(s.movingTime)],
    ['Vitesse max', s.maxSpeed.toFixed(0) + ' km/h'],
    ['Vitesse moy.', s.avgSpeed.toFixed(0) + ' km/h'],
    ['Moy. en mouv.', s.avgMovingSpeed.toFixed(0) + ' km/h'],
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
  const [mode, setMode] = useState('cockpit')
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [nav, setNav] = useState(null)
  const [msg, setMsg] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [startedAt, setStartedAt] = useState(null)
  const [debugOpen, setDebugOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const [fallbackText, setFallbackText] = useState('')
  const { pos, lean, points, recording } = rec

  useEffect(() => {
    if (!recording) {
      setStartedAt(null)
      return
    }
    const t = Date.now()
    setStartedAt(t)
    setNow(t)
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [recording])

  const liveStats = useMemo(() => tripStats(points), [points])
  const t0 = points[0]?.t ?? startedAt
  const elapsed = recording && t0 ? Math.max(0, Math.floor((now - t0) / 1000)) : 0
  const speedKmh = rec.simSpeed ? 50 : pos?.speed != null ? Math.round(pos.speed * 3.6) : null
  const liveMaxSpeed = recording ? Math.max(liveStats.maxSpeed, speedKmh ?? 0) : 0
  const liveMaxL = recording ? Math.max(liveStats.maxLeanLeft, lean > 0 ? lean : 0) : 0
  const liveMaxR = recording ? Math.max(liveStats.maxLeanRight, lean < 0 ? -lean : 0) : 0

  async function copyLogs() {
    const text = rec.exportLogs()
    try {
      await navigator.clipboard.writeText(text)
      setFallbackText('')
      setCopyStatus('Copié !')
      setTimeout(() => setCopyStatus(''), 2000)
    } catch {
      setFallbackText(text)
    }
  }

  async function shareLogs() {
    const text = rec.exportLogs()
    try {
      await navigator.share({ title: 'MotoWebApp logs', text })
    } catch (err) {
      if (err?.name !== 'AbortError') setFallbackText(text)
    }
  }

  async function search(e) {
    e.preventDefault()
    if (!q.trim()) return
    try {
      setResults(await geocode(q))
      setMsg('')
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

  return (
    <div className="ride">
      <header className="topbar">
        <div className="pills">
          <span className={pos ? 'pill gps ok' : 'pill gps'}>
            <i />
            {pos ? 'GPS' : 'GPS…'}
          </span>
          {recording && (
            <span className="pill rec">
              <i />
              {hms(elapsed)}
            </span>
          )}
          <button
            type="button"
            className={debugOpen ? 'pill btn on' : 'pill btn'}
            onClick={() => {
              const next = !debugOpen
              setDebugOpen(next)
              if (next) rec.requestSensors()
            }}
          >
            Log
          </button>
        </div>
        <div className="seg" role="tablist" aria-label="Mode d'affichage">
          <button
            type="button"
            className={mode === 'cockpit' ? 'on' : ''}
            onClick={() => setMode('cockpit')}
          >
            Compteur
          </button>
          <button
            type="button"
            className={mode === 'map' ? 'on' : ''}
            onClick={() => setMode('map')}
          >
            Carte
          </button>
        </div>
      </header>

      {debugOpen && (
        <div className="debug-panel">
          <div className="debug-readout">
            {rec.debug ? (
              <>
                <div>
                  v: <b>{rec.debug.v}</b> km/h · ω: <b>{rec.debug.w}</b> · lean: <b>{rec.debug.lean}°</b>
                </div>
                <div>
                  acc: {rec.debug.ax}, {rec.debug.ay}, {rec.debug.az}
                </div>
                <div>
                  rot: {rec.debug.ra}, {rec.debug.rb}, {rec.debug.rg}
                </div>
              </>
            ) : (
              <div className="debug-empty">
                <span>Capteurs inactifs</span>
                <button type="button" onClick={() => rec.requestSensors()}>
                  Activer capteurs
                </button>
              </div>
            )}
          </div>
          <div className="debug-actions">
            <button
              type="button"
              className={rec.simSpeed ? 'on' : ''}
              onClick={() => rec.toggleSimSpeed()}
            >
              Simuler 50 km/h
            </button>
            <button type="button" onClick={copyLogs} disabled={!rec.logCount}>
              {copyStatus || `Copier (${rec.logCount})`}
            </button>
            {typeof navigator.share === 'function' && (
              <button type="button" onClick={shareLogs} disabled={!rec.logCount}>
                Partager
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                rec.clearLogs()
                setFallbackText('')
              }}
            >
              Vider
            </button>
          </div>
          {fallbackText && (
            <textarea
              className="debug-text"
              readOnly
              rows={4}
              value={fallbackText}
              onFocus={(e) => e.target.select()}
            />
          )}
        </div>
      )}

      {mode === 'cockpit' ? (
        <div className="cockpit">
          {nav && (
            <div className="navbanner" onClick={() => setMode('map')}>
              <span>
                Itinéraire · {km(nav.distance)} · {Math.round(nav.duration / 60)} min
              </span>
              <button
                type="button"
                aria-label="Effacer l'itinéraire"
                onClick={(e) => {
                  e.stopPropagation()
                  setNav(null)
                }}
              >
                ✕
              </button>
            </div>
          )}
          <SpeedGauge
            speed={speedKmh}
            maxSpeed={liveMaxSpeed}
            recording={recording}
            hasPos={!!pos}
            simSpeed={rec.simSpeed}
          />
          <LeanGauge
            lean={lean}
            maxLeft={liveMaxL}
            maxRight={liveMaxR}
            onCalibrate={rec.calibrate}
          />
          <div className="strip">
            <div>
              <small>Distance</small>
              <b>{recording ? km(liveStats.distance) : '0.0 km'}</b>
            </div>
            <div>
              <small>Durée</small>
              <b>{hms(elapsed)}</b>
            </div>
            <div>
              <small>Moyenne</small>
              <b>{recording && liveStats.avgSpeed > 0 ? liveStats.avgSpeed.toFixed(0) + ' km/h' : '--'}</b>
            </div>
          </div>
          <button
            type="button"
            className={recording ? 'cta stop' : 'cta start'}
            onClick={() => (recording ? rec.stop() : rec.start())}
          >
            {recording ? '■ Terminer' : '● Démarrer'}
          </button>
        </div>
      ) : (
        <div className="map-view">
          <form className="search" onSubmit={search}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Destination…" />
            {nav && (
              <button type="button" aria-label="Effacer l'itinéraire" onClick={() => setNav(null)}>
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
          {msg && <div className="navinfo warn">{msg}</div>}
          <MapContainer center={[46.6, 2.4]} zoom={6} className="map" zoomControl={false}>
            <TileLayer url={TILES} attribution="© OpenStreetMap" />
            {nav && <Polyline positions={nav.coords} color="#38bdf8" weight={6} opacity={0.8} />}
            {points.length > 1 && (
              <Polyline positions={points.map((p) => [p.lat, p.lon])} color="#0057ff" weight={5} />
            )}
            {pos && (
              <CircleMarker
                center={[pos.lat, pos.lon]}
                radius={8}
                color="#fff"
                fillColor="#0057ff"
                fillOpacity={1}
              />
            )}
            <Follow pos={pos} />
          </MapContainer>
          <div className="hud">
            <div>
              <b>{speedKmh ?? '--'}</b>
              <small>km/h</small>
            </div>
            <div>
              <b>
                {Math.abs(lean).toFixed(0)}° {lean > 1 ? '◀' : lean < -1 ? '▶' : ''}
              </b>
              <small>inclinaison</small>
            </div>
            <button
              type="button"
              className={recording ? 'stop' : 'start'}
              onClick={() => (recording ? rec.stop() : rec.start())}
            >
              {recording ? '■ Stop' : '● Rouler'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function TripDetail({ trip, onBack, onDelete }) {
  const coords = trip.points.map((p) => [p.lat, p.lon])
  const s = trip.stats
  const scale = Math.max(45, s.maxLeanLeft, s.maxLeanRight)
  const leftPct = Math.min(100, (s.maxLeanLeft / scale) * 100)
  const rightPct = Math.min(100, (s.maxLeanRight / scale) * 100)

  return (
    <div className="page">
      <div className="detail-head">
        <button type="button" className="back-btn" onClick={onBack}>
          ← Retour
        </button>
        <h2>{new Date(trip.date).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}</h2>
      </div>
      {coords.length > 0 && (
        <div className="map-card">
          <MapContainer center={coords[0]} zoom={13} className="map small" zoomControl={false}>
            <TileLayer url={TILES} attribution="© OpenStreetMap" />
            <Polyline positions={coords} color="#0057ff" weight={5} />
            <FitTo coords={coords} />
          </MapContainer>
        </div>
      )}
      <div className="card lean-compare">
        <div className="lean-compare-head">
          <div>
            <small>GAUCHE MAX</small>
            <b>{s.maxLeanLeft.toFixed(0)}°</b>
          </div>
          <span>INCLINAISON</span>
          <div className="right">
            <small>DROITE MAX</small>
            <b>{s.maxLeanRight.toFixed(0)}°</b>
          </div>
        </div>
        <div className="lean-bars">
          <div className="bar-half left">
            <i style={{ width: `${leftPct}%` }} />
          </div>
          <div className="bar-half right">
            <i style={{ width: `${rightPct}%` }} />
          </div>
        </div>
      </div>
      <Stats s={s} />
      <button
        type="button"
        className="danger full"
        onClick={() => confirm('Supprimer ce trajet ?') && onDelete(trip.id)}
      >
        Supprimer le trajet
      </button>
    </div>
  )
}

function Trips({ trips, onOpen, onRide }) {
  if (!trips.length) {
    return (
      <div className="page empty-page">
        <div className="card empty-card">
          <svg viewBox="0 0 64 64" className="empty-icon" aria-hidden="true">
            <circle cx="32" cy="36" r="22" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="4" />
            <path d="M16 49 A22 22 0 1 1 48 49" fill="none" stroke="#0057ff" strokeWidth="4" strokeLinecap="round" />
            <line x1="32" y1="36" x2="44" y2="24" stroke="#f8fafc" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <h2>Aucun trajet enregistré</h2>
          <p>Fixe ton téléphone sur le guidon et lance un premier trajet pour voir ta vitesse et tes angles.</p>
          <button type="button" className="cta start" onClick={onRide}>
            Aller rouler
          </button>
        </div>
      </div>
    )
  }

  const total = trips.reduce((a, t) => a + t.stats.distance, 0)
  const bestSpeed = trips.reduce((a, t) => Math.max(a, t.stats.maxSpeed), 0)
  const bestLean = trips.reduce(
    (a, t) => Math.max(a, t.stats.maxLeanLeft, t.stats.maxLeanRight),
    0
  )

  return (
    <div className="page">
      <div className="card hero">
        <div>
          <small>DISTANCE TOTALE</small>
          <strong>{km(total)}</strong>
        </div>
        <div className="hero-meta">
          <span>
            <b>{trips.length}</b> trajet{trips.length > 1 ? 's' : ''}
          </span>
          <span>
            <b>{bestSpeed.toFixed(0)}</b> km/h max
          </span>
          <span>
            <b>{bestLean.toFixed(0)}°</b> angle max
          </span>
        </div>
      </div>
      <ul className="trips">
        {trips.map((t) => (
          <li key={t.id} onClick={() => onOpen(t)}>
            <div className="trip-top">
              <b>
                {new Date(t.date).toLocaleDateString('fr-FR', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </b>
              <span className="dist-badge">{km(t.stats.distance)}</span>
            </div>
            <div className="trip-meta">
              <span>{hms(t.stats.duration)}</span>
              <span>max {t.stats.maxSpeed.toFixed(0)} km/h</span>
              <span>
                ◀ {t.stats.maxLeanLeft.toFixed(0)}° / {t.stats.maxLeanRight.toFixed(0)}° ▶
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function GaugeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4.9 18.1a9 9 0 1 1 14.2 0" />
      <path d="M12 13l4-4" />
      <circle cx="12" cy="13" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

function RouteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <path d="M8.5 18H14a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h5.5" />
    </svg>
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
          <Trips trips={trips} onOpen={setOpen} onRide={() => setTab('ride')} />
        ))}
      <nav className="tabs">
        <button type="button" className={tab === 'ride' ? 'on' : ''} onClick={() => setTab('ride')}>
          <GaugeIcon />
          <span>Rouler</span>
        </button>
        <button type="button" className={tab === 'trips' ? 'on' : ''} onClick={() => setTab('trips')}>
          <RouteIcon />
          <span>Trajets</span>
        </button>
      </nav>
    </div>
  )
}
