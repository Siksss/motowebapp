import { useEffect, useRef, useState } from 'react'
import { haversine, createLeanTracker, tripStats } from './stats.js'
import { addTrip, saveCurrent, loadCurrent, clearCurrent } from './storage.js'

const isIOS =
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export function useRecorder(onSaved) {
  const [pos, setPos] = useState(null) // {lat, lon, speed}
  const [lean, setLean] = useState(0)
  const [points, setPoints] = useState([])
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState(null)
  const [simSpeed, setSimSpeed] = useState(false)
  const [debug, setDebug] = useState(null)
  const [logCount, setLogCount] = useState(0)
  const r = useRef({
    recording: false,
    points: [],
    speed: 0,
    speedAt: 0,
    lastPos: null,
    lean: 0,
    peak: 0,
    wake: null,
    simSpeed: false,
    lastLog: 0,
    debug: null,
    logs: [],
    tracker: createLeanTracker(isIOS),
  })

  // GPS toujours actif (carte + navigation), enregistré seulement pendant un trajet
  useEffect(() => {
    if (!navigator.geolocation) return setError('GPS non disponible sur cet appareil')
    const id = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        const now = performance.now()
        let speed = coords.speed != null && coords.speed >= 0 ? coords.speed : null
        if (speed == null && coords.accuracy <= 50 && r.current.lastPos) {
          const dt = (timestamp - r.current.lastPos.t) / 1000
          if (dt > 0.5 && dt < 5) {
            speed = haversine(r.current.lastPos, { lat: coords.latitude, lon: coords.longitude }) / dt
          }
        }
        if (coords.accuracy <= 50) {
          r.current.lastPos = { lat: coords.latitude, lon: coords.longitude, t: timestamp }
        }
        const p = { lat: coords.latitude, lon: coords.longitude, speed }
        r.current.speed = speed ?? 0
        r.current.speedAt = now
        setPos(p)
        if (!r.current.recording) return
        if (coords.accuracy > 50) return // point GPS trop imprécis
        const pt = { ...p, t: timestamp, lean: Math.round(r.current.peak * 10) / 10 }
        r.current.peak = 0
        r.current.points = [...r.current.points, pt]
        setPoints(r.current.points)
        saveCurrent(r.current.points)
      },
      (e) => setError('GPS : ' + e.message),
      { enableHighAccuracy: true, maximumAge: 0 }
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  useEffect(() => {
    const onMotion = (e) => {
      const g = e.accelerationIncludingGravity
      const rr = e.rotationRate
      if (
        !g ||
        !rr ||
        g.x == null ||
        g.y == null ||
        g.z == null ||
        rr.alpha == null ||
        rr.beta == null ||
        rr.gamma == null
      ) {
        return
      }
      const now = performance.now()
      const v = r.current.simSpeed
        ? 50 / 3.6
        : now - r.current.speedAt <= 3000
          ? r.current.speed
          : 0
      const l = (r.current.lean = r.current.tracker.update(g, rr, v, now))
      if (Math.abs(l) > Math.abs(r.current.peak)) r.current.peak = l
      if (now - r.current.lastLog >= 200) {
        r.current.lastLog = now
        const snap = {
          t: Math.round(now),
          v: +(v * 3.6).toFixed(1),
          ax: +g.x.toFixed(2),
          ay: +g.y.toFixed(2),
          az: +g.z.toFixed(2),
          ra: +rr.alpha.toFixed(1),
          rb: +rr.beta.toFixed(1),
          rg: +rr.gamma.toFixed(1),
          w: +r.current.tracker.state().omega.toFixed(3),
          lean: +l.toFixed(1),
        }
        r.current.debug = snap
        r.current.logs.push(snap)
        if (r.current.logs.length > 300) r.current.logs.shift()
      }
    }
    window.addEventListener('devicemotion', onMotion)
    const ui = setInterval(() => {
      setLean(r.current.lean)
      setDebug((prev) => (prev === r.current.debug ? prev : r.current.debug))
      setLogCount(r.current.logs.length)
    }, 100)
    const onVis = () => {
      if (r.current.recording && document.visibilityState === 'visible') lockScreen()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('devicemotion', onMotion)
      document.removeEventListener('visibilitychange', onVis)
      clearInterval(ui)
    }
  }, [])

  async function lockScreen() {
    try {
      r.current.wake = await navigator.wakeLock?.request('screen')
    } catch {
      /* pas bloquant */
    }
  }

  async function requestSensors() {
    // iOS : la permission capteurs doit être demandée suite à un clic
    if (typeof DeviceMotionEvent?.requestPermission === 'function') {
      try {
        if ((await DeviceMotionEvent.requestPermission()) !== 'granted') {
          setError("Capteurs refusés : pas d'inclinaison")
          return false
        }
      } catch (e) {
        setError(e.message)
        return false
      }
    }
    return true
  }

  async function start(resume = false) {
    await requestSensors()
    await lockScreen()
    r.current.points = resume ? loadCurrent() || [] : []
    r.current.peak = 0
    r.current.tracker.resetLean()
    r.current.recording = true
    setPoints(r.current.points)
    setRecording(true)
  }

  function stop() {
    r.current.recording = false
    setRecording(false)
    r.current.wake?.release()
    const pts = r.current.points
    if (pts.length < 2) return clearCurrent()
    const trip = { id: Date.now(), date: pts[0].t, points: pts, stats: tripStats(pts) }
    onSaved(addTrip(trip), trip)
  }

  function toggleSimSpeed() {
    const next = !r.current.simSpeed
    r.current.simSpeed = next
    r.current.tracker.resetLean()
    r.current.lean = 0
    setSimSpeed(next)
    setLean(0)
  }

  function exportLogs() {
    const head = `# MotoWebApp | isIOS=${isIOS} | sim50=${r.current.simSpeed} | ua=${navigator.userAgent}`
    const cols = 't_ms,v_kmh,ax,ay,az,ra,rb,rg,w_rads,lean_deg'
    const rows = r.current.logs.map((d) =>
      [d.t, d.v, d.ax, d.ay, d.az, d.ra, d.rb, d.rg, d.w, d.lean].join(',')
    )
    return [head, cols, ...rows].join('\n')
  }

  function clearLogs() {
    r.current.logs = []
    r.current.debug = null
    setDebug(null)
    setLogCount(0)
  }

  return {
    pos,
    lean,
    points,
    recording,
    error,
    start,
    stop,
    requestSensors,
    simSpeed,
    toggleSimSpeed,
    debug,
    logCount,
    exportLogs,
    clearLogs,
  }
}
