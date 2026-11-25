import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import { useRecorder } from './useRecorder.js'
import { loadTrips, addTrip, updateTrip, deleteTrip, loadCurrent, clearCurrent } from './storage.js'
import { tripStats } from './stats.js'
import { geocode, route, routeFromTrip, trackProgressOnPath, formatDist, formatManeuver, trackStep, nextAnnouncement } from './nav.js'
import { speak, createAudioCoach } from './voice.js'
import { createLapTimer } from './lap.js'
import { fetchMotoWeather } from './weather.js'
import { km, hms, fmtLap, TILES, TILE_ATTR } from './format.js'
import { TripDetail, Trips } from './TripsView.jsx'

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

function GBar({ g }) {
  const pct = Math.min(50, (Math.abs(g) / 1.2) * 50)
  const brake = g < -0.04
  const accel = g > 0.04
  return (
    <div className="gbar" aria-label="G-mètre longitudinal">
      <span className={brake ? 'gval brake' : 'gval'}>−1G</span>
      <div className="gtrack">
        <div className="gmid" />
        <div
          className={brake ? 'gfill brake' : 'gfill'}
          style={{ width: `${pct}%`, left: brake ? `${50 - pct}%` : '50%' }}
        />
      </div>
      <span className="gread">{(g >= 0 ? '+' : '−') + Math.abs(g).toFixed(2)} G</span>
      <span className={accel ? 'gval accel' : 'gval'}>+1G</span>
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

function Ride({ rec, nav, setNav, mode, setMode }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [stepIdx, setStepIdx] = useState(0)
  const [voiceOn, setVoiceOn] = useState(() => localStorage.getItem('moto.voice') !== '0')
  const [hud, setHud] = useState(false)
  const [weather, setWeather] = useState(null)
  const [weatherOpen, setWeatherOpen] = useState(false)
  const [msg, setMsg] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [startedAt, setStartedAt] = useState(null)
  const [debugOpen, setDebugOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const [fallbackText, setFallbackText] = useState('')
  const announcedRef = useRef(new Set())
  const wasOffRouteRef = useRef(false)
  const coachRef = useRef(null)
  coachRef.current ??= createAudioCoach()
  const lapRef = useRef(null)
  lapRef.current ??= createLapTimer()
  const [lapState, setLapState] = useState(() => lapRef.current.state())
  const [lapNow, setLapNow] = useState(() => Date.now())
  const { pos, lean, gLong, points, recording } = rec
  const weatherCell = pos
    ? `${(Math.round(pos.lat * 20) / 20).toFixed(2)},${(Math.round(pos.lon * 20) / 20).toFixed(2)}`
    : null

  useEffect(() => {
    if (!weatherCell || !pos) return
    let cancelled = false
    fetchMotoWeather(pos).then((w) => {
      if (!cancelled && w) setWeather(w)
    })
    return () => {
      cancelled = true
    }
  }, [weatherCell])

  useEffect(() => {
    setStepIdx(0)
    announcedRef.current.clear()
    wasOffRouteRef.current = false
  }, [nav])

  useEffect(() => {
    coachRef.current?.reset()
  }, [recording])

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
  const navStep = useMemo(() => {
    if (!nav?.steps?.length || !pos) return null
    const tracked = trackStep(pos, nav.steps, stepIdx)
    return { ...tracked, ...formatManeuver(tracked.step) }
  }, [nav, pos, stepIdx])

  useEffect(() => {
    if (!navStep) return
    if (navStep.stepIdx !== stepIdx) setStepIdx(navStep.stepIdx)
    if (!voiceOn || !navStep.step) return
    const ann = nextAnnouncement(navStep.distM, navStep.stepIdx, navStep.step, announcedRef.current)
    if (!ann) return
    announcedRef.current.add(ann.key)
    speak(ann.phrase, { enabled: true })
  }, [navStep, stepIdx, voiceOn])

  useEffect(() => {
    if (!recording || !voiceOn) return
    const phrase = coachRef.current?.update({ distanceM: liveStats.distance, leanDeg: lean })
    if (phrase) speak(phrase, { enabled: true })
  }, [recording, voiceOn, liveStats.distance, lean])

  function toggleVoice() {
    const next = !voiceOn
    setVoiceOn(next)
    localStorage.setItem('moto.voice', next ? '1' : '0')
    if (next) speak('Guidage vocal activé', { enabled: true })
  }

  const t0 = points[0]?.t ?? startedAt
  const elapsed = recording && t0 ? Math.max(0, Math.floor((now - t0) / 1000)) : 0
  const speedKmh = rec.simSpeed ? 50 : pos?.speed != null ? Math.round(pos.speed * 3.6) : null
  const liveMaxSpeed = recording ? Math.max(liveStats.maxSpeed, speedKmh ?? 0) : 0
  const liveMaxL = recording ? Math.max(liveStats.maxLeanLeft, lean > 0 ? lean : 0) : 0
  const liveMaxR = recording ? Math.max(liveStats.maxLeanRight, lean < 0 ? -lean : 0) : 0

  useEffect(() => {
    if (!lapState.active || !pos) return
    const next = lapRef.current.update(pos, Date.now())
    setLapState(next)
    if (next.completedLapMs != null && voiceOn) {
      speak(`Tour ${next.lapCount} en ${(next.completedLapMs / 1000).toFixed(1)} secondes`, { enabled: true })
    }
  }, [pos, lapState.active, voiceOn])

  useEffect(() => {
    if (!lapState.active || lapState.lapStartMs == null) return
    const id = setInterval(() => setLapNow(Date.now()), 200)
    return () => clearInterval(id)
  }, [lapState.active, lapState.lapStartMs])

  const ghostProgress = useMemo(
    () => (nav?.mode === 'ghost' && pos ? trackProgressOnPath(pos, nav.coords) : null),
    [nav, pos]
  )

  useEffect(() => {
    if (!ghostProgress) return
    if (ghostProgress.isOffRoute && !wasOffRouteRef.current) {
      wasOffRouteRef.current = true
      if (voiceOn) speak('Attention, hors trace', { enabled: true })
    } else if (!ghostProgress.isOffRoute) {
      wasOffRouteRef.current = false
    }
  }, [ghostProgress, voiceOn])

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
      const nextNav = await route(pos, dest)
      setNav(nextNav)
      setMsg('')
      speak('Itinéraire prêt', { enabled: voiceOn })
    } catch (err) {
      setMsg(err.message)
    }
  }

  async function addStop(stop) {
    setResults([])
    if (!pos) return setMsg('Position GPS inconnue')
    if (nav?.mode !== 'osrm' || !nav.waypoints?.length) return go(stop)
    try {
      const dest = nav.waypoints.at(-1)
      const via = nav.waypoints.slice(1, -1)
      const nextNav = await route([pos, ...via, { lat: stop.lat, lon: stop.lon }, dest])
      setNav(nextNav)
      setMsg('')
      speak('Étape ajoutée', { enabled: voiceOn })
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
          <button
            type="button"
            className={voiceOn ? 'pill btn on' : 'pill btn'}
            onClick={toggleVoice}
            aria-label="Guidage vocal"
            title={voiceOn ? 'Couper la voix' : 'Activer la voix'}
          >
            {voiceOn ? '🔊' : '🔇'}
          </button>
          <button
            type="button"
            className={hud ? 'pill btn on' : 'pill btn'}
            onClick={() => setHud((h) => !h)}
            aria-label="Mode HUD pare-brise"
          >
            HUD
          </button>
          <button
            type="button"
            className={lapState.active ? 'pill btn on' : 'pill btn'}
            onClick={() => {
              if (lapState.active) {
                setLapState(lapRef.current.clear())
              } else if (!pos) {
                setMsg('Position GPS requise pour chrono')
              } else {
                lapRef.current.setGate(pos)
                setLapState(lapRef.current.state())
                if (voiceOn) speak('Ligne de chrono posée', { enabled: true })
              }
            }}
            aria-label="Chrono boucle auto-lap"
          >
            ⏱
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

      {lapState.active && (
        <div className="lap-bar">
          <span>
            ⏱ T{lapState.lapCount + 1} ·{' '}
            <b>{lapState.lapStartMs != null ? fmtLap(Math.max(0, lapNow - lapState.lapStartMs)) : 'Prêt'}</b>
          </span>
          <span>
            Best <b>{lapState.bestLapMs != null ? fmtLap(lapState.bestLapMs) : '--'}</b>
          </span>
        </div>
      )}

      {mode === 'cockpit' ? (
        <div className={hud ? 'cockpit hud-mirror' : 'cockpit'}>
          {nav && (
            <div className={ghostProgress?.isOffRoute ? 'navbanner warn' : 'navbanner'} onClick={() => setMode('map')}>
              <span>
                {nav.mode === 'ghost'
                  ? ghostProgress?.isOffRoute
                    ? `⚠ Hors trace (+${formatDist(ghostProgress.offRouteM)})`
                    : `📍 ${nav.name} · Reste ${km(ghostProgress ? ghostProgress.remainingM : nav.distance)}`
                  : navStep?.step
                    ? `${navStep.icon} ${formatDist(navStep.distM)} · ${navStep.text}`
                    : `Itinéraire · ${km(nav.distance)} · ${Math.round(nav.duration / 60)} min`}
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
          <div className="cockpit-main">
            <SpeedGauge
              speed={speedKmh}
              maxSpeed={liveMaxSpeed}
              recording={recording}
              hasPos={!!pos}
              simSpeed={rec.simSpeed}
            />
          </div>
          <div className="cockpit-side">
            <LeanGauge
              lean={lean}
              maxLeft={liveMaxL}
              maxRight={liveMaxR}
              onCalibrate={rec.calibrate}
            />
            <GBar g={gLong} />
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
                <li
                  key={r.name}
                  className={nav?.mode === 'osrm' ? 'res-row' : ''}
                  onClick={nav?.mode === 'osrm' ? undefined : () => go(r)}
                >
                  <span className="res-name" onClick={() => go(r)}>
                    {r.name}
                  </span>
                  {nav?.mode === 'osrm' && (
                    <div className="res-actions">
                      <button type="button" onClick={() => addStop(r)}>
                        + Étape
                      </button>
                      <button type="button" className="primary" onClick={() => go(r)}>
                        Dest.
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {nav && (
            <div className={ghostProgress?.isOffRoute ? 'navcard off' : 'navcard'}>
              {nav.mode === 'ghost' ? (
                <>
                  <span className="navcard-icon">{ghostProgress?.isOffRoute ? '⚠' : '📍'}</span>
                  <div className="navcard-body">
                    <b>
                      {ghostProgress?.isOffRoute
                        ? `Hors trace (+${formatDist(ghostProgress.offRouteM)})`
                        : `Reste ${km(ghostProgress ? ghostProgress.remainingM : nav.distance)}`}
                    </b>
                    <span>{nav.name} (trace hors-ligne)</span>
                  </div>
                </>
              ) : navStep?.step ? (
                <>
                  <span className="navcard-icon">{navStep.icon}</span>
                  <div className="navcard-body">
                    <b>{navStep.done ? 'Arrivée' : formatDist(navStep.distM)}</b>
                    <span>{navStep.text}</span>
                  </div>
                  <small className="navcard-rem">
                    {nav.waypoints?.length > 2 ? `+${nav.waypoints.length - 2} ét. · ` : ''}
                    {km(nav.distance)} · {Math.round(nav.duration / 60)} min
                  </small>
                </>
              ) : (
                <div className="navcard-body">
                  <b>
                    {km(nav.distance)} · {Math.round(nav.duration / 60)} min
                  </b>
                  <span>En attente du signal GPS</span>
                </div>
              )}
            </div>
          )}
          {msg && <div className="navinfo warn">{msg}</div>}
          <MapContainer center={[46.6, 2.4]} zoom={6} className="map" zoomControl={false}>
            <TileLayer url={TILES} attribution={TILE_ATTR} maxZoom={19} />
            {nav && (
              <>
                <Polyline positions={nav.coords} color="#0057ff" weight={10} opacity={0.28} />
                <Polyline
                  positions={nav.coords}
                  color={nav.mode === 'ghost' ? '#a855f7' : '#38bdf8'}
                  dashArray={nav.mode === 'ghost' ? '8 8' : undefined}
                  weight={4.5}
                  opacity={0.95}
                />
                {nav.waypoints?.slice(1, -1).map((wp, i) => (
                  <CircleMarker
                    key={i}
                    center={[wp.lat, wp.lon]}
                    radius={6}
                    color="#ffffff"
                    weight={2}
                    fillColor="#38bdf8"
                    fillOpacity={1}
                  >
                    <Tooltip>Étape {i + 1}</Tooltip>
                  </CircleMarker>
                ))}
              </>
            )}
            {points.length > 1 && (
              <>
                <Polyline
                  positions={points.map((p) => [p.lat, p.lon])}
                  color="#0057ff"
                  weight={10}
                  opacity={0.28}
                />
                <Polyline
                  positions={points.map((p) => [p.lat, p.lon])}
                  color="#1d6bff"
                  weight={4.5}
                  opacity={1}
                />
              </>
            )}
            {lapState.gate && (
              <CircleMarker
                center={[lapState.gate.lat, lapState.gate.lon]}
                radius={10}
                color="#38bdf8"
                weight={3}
                fillColor="#38bdf8"
                fillOpacity={0.2}
              >
                <Tooltip>Ligne Chrono</Tooltip>
              </CircleMarker>
            )}
            {pos && (
              <>
                <CircleMarker
                  center={[pos.lat, pos.lon]}
                  radius={16}
                  stroke={false}
                  fillColor="#0057ff"
                  fillOpacity={0.25}
                />
                <CircleMarker
                  center={[pos.lat, pos.lon]}
                  radius={7}
                  color="#ffffff"
                  weight={2.5}
                  fillColor="#0057ff"
                  fillOpacity={1}
                />
              </>
            )}
            <Follow pos={pos} />
          </MapContainer>
          {weather && (
            <>
              {weatherOpen && (
                <div className="weather-toast" onClick={() => setWeatherOpen(false)}>
                  <b>
                    {weather.icon} {weather.label} · {weather.tempC != null ? `${weather.tempC} °C` : '--'}
                  </b>
                  <span>
                    Vent {weather.windKmh} km/h · Rafales {weather.gustsKmh} km/h
                  </span>
                  <small>{weather.advice}</small>
                </div>
              )}
              <button
                type="button"
                className={`weather-pill ${weather.level}`}
                onClick={() => setWeatherOpen((o) => !o)}
                aria-label="Météo moto locale"
              >
                {weather.icon} {weather.tempC != null ? `${weather.tempC}°` : ''}
                {weather.gustsKmh >= 35 ? ` · 💨 ${weather.gustsKmh}` : ''}
              </button>
            </>
          )}
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
  const [rideMode, setRideMode] = useState('cockpit')
  const [nav, setNav] = useState(null)
  const [trips, setTrips] = useState([])
  const [open, setOpen] = useState(null)
  const rec = useRecorder((all, trip) => {
    setTrips(all)
    setOpen(trip)
    setTab('trips')
  })

  // Chargement IndexedDB + vérification trajet interrompu
  useEffect(() => {
    let cancelled = false
    loadTrips().then((all) => {
      if (!cancelled) setTrips(all)
    })
    loadCurrent().then((cur) => {
      if (!cancelled && cur?.length > 1) {
        if (confirm('Un trajet a été interrompu. Le reprendre ?')) rec.start(true)
        else clearCurrent()
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="app">
      {rec.error && <div className="error">{rec.error}</div>}
      {tab === 'ride' && (
        <Ride rec={rec} nav={nav} setNav={setNav} mode={rideMode} setMode={setRideMode} />
      )}
      {tab === 'trips' &&
        (open ? (
          <TripDetail
            trip={open}
            onBack={() => setOpen(null)}
            onFollow={(t) => {
              setNav(routeFromTrip(t))
              setRideMode('map')
              setTab('ride')
            }}
            onUpdate={async (updated) => {
              const all = await updateTrip(updated)
              setTrips(all)
              setOpen(updated)
            }}
            onDelete={async (id) => {
              setTrips(await deleteTrip(id))
              setOpen(null)
            }}
          />
        ) : (
          <Trips
            trips={trips}
            onOpen={setOpen}
            onRide={() => setTab('ride')}
            onImport={async (trip) => {
              const all = await addTrip(trip)
              setTrips(all)
              setOpen(trip)
            }}
          />
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
