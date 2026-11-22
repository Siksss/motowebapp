import { useEffect, useRef, useState } from 'react'
import { leanAngle, tripStats } from './stats.js'
import { addTrip, saveCurrent, loadCurrent, clearCurrent } from './storage.js'

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)

export function useRecorder(onSaved) {
  const [pos, setPos] = useState(null) // {lat, lon, speed}
  const [lean, setLean] = useState(0)
  const [points, setPoints] = useState([])
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState(null)
  const r = useRef({ recording: false, points: [], speed: 0, lean: 0, peak: 0, wake: null })

  // GPS toujours actif (carte + navigation), enregistré seulement pendant un trajet
  useEffect(() => {
    if (!navigator.geolocation) return setError('GPS non disponible sur cet appareil')
    const id = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        const p = { lat: coords.latitude, lon: coords.longitude, speed: coords.speed }
        r.current.speed = coords.speed ?? r.current.speed
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
      if (!g || !rr || g.x == null || rr.alpha == null) return
      const s = isIOS ? -1 : 1 // iOS inverse le signe de l'accéléromètre
      const k = Math.PI / 180
      const raw = leanAngle(
        { x: s * g.x, y: s * g.y, z: s * g.z },
        { x: rr.beta * k, y: rr.gamma * k, z: rr.alpha * k },
        r.current.speed || 0
      )
      const l = (r.current.lean = r.current.lean * 0.9 + raw * 0.1) // lissage
      if (Math.abs(l) > Math.abs(r.current.peak)) r.current.peak = l
    }
    window.addEventListener('devicemotion', onMotion)
    const ui = setInterval(() => setLean(r.current.lean), 200)
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

  async function start(resume = false) {
    // iOS : la permission capteurs doit être demandée suite à un clic
    if (typeof DeviceMotionEvent?.requestPermission === 'function') {
      try {
        if ((await DeviceMotionEvent.requestPermission()) !== 'granted') setError('Capteurs refusés : pas d\'inclinaison')
      } catch (e) {
        setError(e.message)
      }
    }
    await lockScreen()
    r.current.points = resume ? loadCurrent() || [] : []
    r.current.peak = 0
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

  return { pos, lean, points, recording, error, start, stop }
}
