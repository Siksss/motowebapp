import { useEffect, useMemo, useRef, useState } from 'react'
import { buildTelemetrySeries, buildAltitudeProfile, analyzeRidingStyle } from './analysis.js'

const hms = (s) => new Date(Math.max(0, s) * 1000).toISOString().slice(11, 19)

export default function TelemetryView({ trip, mapMode, onMapMode, cursorIdx, onCursorChange, cornersInfo }) {
  const points = trip.points
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(4)
  const svgRef = useRef(null)

  const series = useMemo(() => buildTelemetrySeries(points, 160), [points])
  const altProf = useMemo(() => buildAltitudeProfile(points, 160), [points])
  const style = useMemo(() => analyzeRidingStyle(points), [points])
  const totalSec = points.length > 1 ? Math.max(1, (points.at(-1).t - points[0].t) / 1000) : 1
  const maxSpeed = Math.max(40, trip.stats?.maxSpeed || 0)
  const maxLeanScale = Math.max(45, trip.stats?.maxLeanLeft || 0, trip.stats?.maxLeanRight || 0)

  // Réinitialiser la lecture à l'ouverture d'un autre trajet
  useEffect(() => {
    setPlaying(false)
  }, [trip.id])

  // Avancement synchronisé du replay
  const cursorRef = useRef(cursorIdx)
  cursorRef.current = cursorIdx
  useEffect(() => {
    if (!playing || points.length < 2) return
    let lastTick = performance.now()
    let simT = (points[cursorRef.current]?.t ?? points[0].t) - points[0].t
    const id = setInterval(() => {
      const now = performance.now()
      simT += (now - lastTick) * rate
      lastTick = now
      const targetEpoch = points[0].t + simT
      let idx = cursorRef.current
      while (idx < points.length - 1 && points[idx + 1].t <= targetEpoch) idx++
      if (idx >= points.length - 1) {
        onCursorChange(points.length - 1)
        setPlaying(false)
      } else if (idx !== cursorRef.current) {
        onCursorChange(idx)
      }
    }, 80)
    return () => clearInterval(id)
  }, [playing, rate, points, onCursorChange])

  // Trouver l'échantillon de série correspondant au curseur actuel
  const curSample = useMemo(() => {
    if (!series.length) return null
    let best = series[0]
    let bestD = Infinity
    for (const s of series) {
      const d = Math.abs(s.idx - cursorIdx)
      if (d < bestD) {
        best = s
        bestD = d
      }
    }
    return best
  }, [series, cursorIdx])

  const W = 360
  const speedPath = useMemo(() => {
    if (series.length < 2) return ''
    return series
      .map((s, i) => {
        const x = (s.t / totalSec) * W
        const y = 70 - Math.min(1, s.speedKmh / maxSpeed) * 58
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
      })
      .join(' ')
  }, [series, totalSec, maxSpeed])

  const speedArea = useMemo(() => {
    if (!speedPath || !series.length) return ''
    const xEnd = ((series.at(-1).t / totalSec) * W).toFixed(1)
    const xStart = ((series[0].t / totalSec) * W).toFixed(1)
    return `${speedPath} L${xEnd} 72 L${xStart} 72 Z`
  }, [speedPath, series, totalSec])

  const leanPath = useMemo(() => {
    if (series.length < 2) return ''
    return series
      .map((s, i) => {
        const x = (s.t / totalSec) * W
        // + = gauche (au-dessus de la ligne médiane 116), - = droite (en dessous)
        const y = 116 - Math.max(-1, Math.min(1, s.lean / maxLeanScale)) * 28
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
      })
      .join(' ')
  }, [series, totalSec, maxLeanScale])

  const altSpan = altProf ? Math.max(10, altProf.maxAlt - altProf.minAlt) : 10
  const altPath = useMemo(() => {
    if (!altProf || altProf.samples.length < 2) return ''
    return altProf.samples
      .map((s, i) => {
        const x = (s.t / totalSec) * W
        const y = 204 - ((s.alt - altProf.minAlt) / altSpan) * 34
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
      })
      .join(' ')
  }, [altProf, altSpan, totalSec])

  const altArea = useMemo(() => {
    if (!altPath || !altProf?.samples?.length) return ''
    const xEnd = ((altProf.samples.at(-1).t / totalSec) * W).toFixed(1)
    const xStart = ((altProf.samples[0].t / totalSec) * W).toFixed(1)
    return `${altPath} L${xEnd} 206 L${xStart} 206 Z`
  }, [altPath, altProf, totalSec])

  function scrubAt(clientX) {
    const el = svgRef.current
    if (!el || !series.length) return
    const rect = el.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)))
    const targetT = pct * totalSec
    let best = series[0]
    let bestD = Infinity
    for (const s of series) {
      const d = Math.abs(s.t - targetT)
      if (d < bestD) {
        best = s
        bestD = d
      }
    }
    setPlaying(false)
    onCursorChange(best.idx)
  }

  if (points.length < 2 || !curSample) return null

  const curX = (curSample.t / totalSec) * W
  const curSpeedY = 70 - Math.min(1, curSample.speedKmh / maxSpeed) * 58
  const curLeanY = 116 - Math.max(-1, Math.min(1, curSample.lean / maxLeanScale)) * 28
  const curLean = curSample.lean
  const leanColor = Math.abs(curLean) >= 38 ? '#ef4444' : curLean > 1 ? '#3b82f6' : curLean < -1 ? '#8b5cf6' : '#94a3b8'
  const H = altProf ? 216 : 156
  const curAltY =
    altProf && curSample.alt != null && Number.isFinite(curSample.alt)
      ? 204 - ((curSample.alt - altProf.minAlt) / altSpan) * 34
      : null

  return (
    <>
      <div className="card telemetry-card">
        <div className="tele-head">
          <div className="seg small">
            {[
              ['plain', 'Tracé'],
              ['speed', 'Vitesse'],
              ['lean', 'Angle'],
            ].map(([m, label]) => (
              <button
                key={m}
                type="button"
                className={mapMode === m ? 'on' : ''}
                onClick={() => onMapMode(m)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="replay-btns">
            <button
              type="button"
              className={playing ? 'play-btn on' : 'play-btn'}
              onClick={() => {
                if (!playing && cursorIdx >= points.length - 1) onCursorChange(0)
                setPlaying((p) => !p)
              }}
            >
              {playing ? '⏸ Pause' : '▶ Replay'}
            </button>
            <button
              type="button"
              className="rate-btn"
              onClick={() => setRate((r) => (r === 1 ? 4 : r === 4 ? 10 : 1))}
            >
              {rate}×
            </button>
          </div>
        </div>

        {mapMode !== 'plain' && (
          <div className="heat-legend">
            {mapMode === 'speed' ? (
              <>
                <span><i style={{ background: '#3b82f6' }} />&lt;50</span>
                <span><i style={{ background: '#38bdf8' }} />50–90</span>
                <span><i style={{ background: '#f59e0b' }} />90–130</span>
                <span><i style={{ background: '#ef4444' }} />130+ km/h</span>
              </>
            ) : (
              <>
                <span><i style={{ background: '#475569' }} />&lt;12°</span>
                <span><i style={{ background: '#1d6bff' }} />12–25°</span>
                <span><i style={{ background: '#8b5cf6' }} />25–38°</span>
                <span><i style={{ background: '#ef4444' }} />38°+</span>
              </>
            )}
          </div>
        )}

        <div className="tele-readout">
          <div>
            <small>Temps</small>
            <b>{hms(curSample.t)}</b>
          </div>
          <div>
            <small>Vitesse</small>
            <b>{Math.round(curSample.speedKmh)} km/h</b>
          </div>
          <div className="tele-lean">
            <svg viewBox="0 0 28 28" width="22" height="22" aria-hidden="true">
              <g transform={`rotate(${-Math.max(-55, Math.min(55, curLean))} 14 23)`}>
                <line x1="8" y1="9" x2="20" y2="9" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" />
                <path d="M11 9 L17 9 L16 17 L12 17 Z" fill={leanColor} />
                <rect x="12.5" y="16.5" width="3" height="6" rx="1.5" fill="#94a3b8" />
              </g>
            </svg>
            <div>
              <small>Angle</small>
              <b>
                {Math.abs(curLean).toFixed(0)}° {curLean > 1 ? '◀' : curLean < -1 ? '▶' : ''}
              </b>
            </div>
          </div>
          <div>
            <small>Dist.</small>
            <b>{(curSample.dist / 1000).toFixed(1)} km</b>
          </div>
          {curSample.alt != null && Number.isFinite(curSample.alt) && (
            <div>
              <small>Alt.</small>
              <b>{Math.round(curSample.alt)} m</b>
            </div>
          )}
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="tele-svg"
          onPointerDown={(e) => {
            try {
              e.currentTarget.setPointerCapture?.(e.pointerId)
            } catch {
              /* ignore */
            }
            scrubAt(e.clientX)
          }}
          onPointerMove={(e) => {
            if (e.buttons > 0 || e.pointerType === 'touch') scrubAt(e.clientX)
          }}
        >
          <defs>
            <linearGradient id="teleSpeedFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(56, 189, 248, 0.32)" />
              <stop offset="100%" stopColor="rgba(56, 189, 248, 0.0)" />
            </linearGradient>
            <linearGradient id="teleAltFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(16, 185, 129, 0.28)" />
              <stop offset="100%" stopColor="rgba(16, 185, 129, 0.0)" />
            </linearGradient>
          </defs>
          <text x="4" y="12" className="tele-axis">
            VITESSE (max {Math.round(maxSpeed)} km/h)
          </text>
          {speedArea && <path d={speedArea} fill="url(#teleSpeedFill)" />}
          {speedPath && (
            <path d={speedPath} fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinejoin="round" />
          )}

          <line x1="0" y1="80" x2={W} y2="80" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          <text x="4" y="92" className="tele-axis">
            ANGLE G (+) / D (-)
          </text>
          <line
            x1="0"
            y1="116"
            x2={W}
            y2="116"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
          {leanPath && (
            <path d={leanPath} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" />
          )}

          {altProf && (
            <>
              <line x1="0" y1="154" x2={W} y2="154" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
              <text x="4" y="166" className="tele-axis">
                ALTITUDE ({altProf.minAlt}–{altProf.maxAlt} m · pente {altProf.maxSlopePct}%)
              </text>
              {altArea && <path d={altArea} fill="url(#teleAltFill)" />}
              {altPath && (
                <path d={altPath} fill="none" stroke="#10b981" strokeWidth="2" strokeLinejoin="round" />
              )}
            </>
          )}

          <line x1={curX} y1="6" x2={curX} y2={H - 6} stroke="rgba(255,255,255,0.55)" strokeWidth="1.2" />
          <circle cx={curX} cy={curSpeedY} r="4" fill="#38bdf8" stroke="#050608" strokeWidth="1.5" />
          <circle cx={curX} cy={curLeanY} r="4" fill={leanColor} stroke="#ffffff" strokeWidth="1.5" />
          {curAltY != null && (
            <circle cx={curX} cy={curAltY} r="4" fill="#10b981" stroke="#050608" strokeWidth="1.5" />
          )}
        </svg>
      </div>

      <div className="card corners-card">
        <div className="corners-head">
          <b>Virages détectés</b>
          <span>
            {cornersInfo.corners.length} virage{cornersInfo.corners.length > 1 ? 's' : ''} ·{' '}
            {cornersInfo.leftCount} G / {cornersInfo.rightCount} D
            {cornersInfo.hairpinCount > 0 ? ` · ${cornersInfo.hairpinCount} épingle${cornersInfo.hairpinCount > 1 ? 's' : ''}` : ''}
          </span>
        </div>
        {cornersInfo.topCorners.length > 0 ? (
          <div className="corner-chips">
            {cornersInfo.topCorners.map((c, idx) => {
              const active = cursorIdx >= c.startIdx && cursorIdx <= c.endIdx
              return (
                <button
                  key={`${c.apexIdx}-${idx}`}
                  type="button"
                  className={active ? 'corner-chip on' : 'corner-chip'}
                  onClick={() => {
                    setPlaying(false)
                    onCursorChange(c.apexIdx)
                  }}
                >
                  <span>
                    {c.kind} {c.side === 'left' ? '◀' : '▶'}
                  </span>
                  <b>{Math.round(c.maxLean)}°</b>
                  <small>{Math.round(c.apexSpeedKmh)} km/h</small>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="corners-empty">Aucun virage appuyé (&ge; 15°) détecté sur ce tracé.</p>
        )}
      </div>

      {style.hasData && (
        <div className="card style-card">
          <div className="corners-head">
            <b>Coaching &amp; Fluidité</b>
            <span className="virolo-pill">Fluidité {style.smoothness}/100</span>
          </div>
          <div className="style-sym">
            <span>
              Moy. G <b>{style.leftAvgDeg}°</b> / D <b>{style.rightAvgDeg}°</b>
            </span>
            <small>
              {style.dominantSide === 'balanced'
                ? 'Symétrique'
                : style.dominantSide === 'left'
                  ? `+${Math.abs(style.diffDeg)}° gauche`
                  : `+${Math.abs(style.diffDeg)}° droite`}
            </small>
          </div>
          <div className="zone-bar" aria-label="Répartition par zones d'angle">
            <i className="z0" style={{ width: `${style.zones.z0}%` }} />
            <i className="z1" style={{ width: `${style.zones.z1}%` }} />
            <i className="z2" style={{ width: `${style.zones.z2}%` }} />
            <i className="z3" style={{ width: `${style.zones.z3}%` }} />
          </div>
          <div className="zone-legend">
            <span><em className="z0" />&lt;15° {style.zones.z0}%</span>
            <span><em className="z1" />15–30° {style.zones.z1}%</span>
            <span><em className="z2" />30–40° {style.zones.z2}%</span>
            <span><em className="z3" />40°+ {style.zones.z3}%</span>
          </div>
          <ul className="style-insights">
            {style.insights.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
