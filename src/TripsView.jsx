import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from 'react-leaflet'
import { tripToGpx, parseGpx } from './gpx.js'
import { detectCorners, buildColorSegments, compareTrips, buildMonthlySummary } from './analysis.js'
import { scoreTrip, computeRecords, filterAndSortTrips } from './scoring.js'
import { shareTripPoster } from './poster.js'
import { km, hms, TILES, TILE_ATTR } from './format.js'
import TelemetryView from './TelemetryView.jsx'

const RIDE_TAGS = ['Sec', 'Mouillé', 'Duo', 'Col', 'Circuit', 'Nuit']

function FitTo({ coords }) {
  const map = useMap()
  useEffect(() => {
    if (coords.length > 1) map.fitBounds(coords, { padding: [20, 20] })
  }, [coords, map])
  return null
}

function PanTo({ point }) {
  const map = useMap()
  useEffect(() => {
    if (point) map.panTo([point.lat, point.lon], { animate: false })
  }, [point, map])
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
    ['Dénivelé +', Math.round(s.elevationGain || 0) + ' m'],
  ]
  if (s.maxAccelG > 0 || s.maxBrakeG > 0) {
    rows.push(['Accél. max', '+' + s.maxAccelG.toFixed(2) + ' G'])
    rows.push(['Frein. max', '−' + s.maxBrakeG.toFixed(2) + ' G'])
  }
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

async function exportTripGpx(trip) {
  const xml = tripToGpx(trip)
  const slug =
    (trip.name || new Date(trip.date).toISOString().slice(0, 10))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'trajet'
  const filename = `${slug}.gpx`
  const blob = new Blob([xml], { type: 'application/gpx+xml' })
  if (typeof File === 'function' && navigator.canShare) {
    try {
      const file = new File([blob], filename, { type: 'application/gpx+xml' })
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ title: trip.name || 'MotoWebApp', files: [file] })
        return
      }
    } catch (err) {
      if (err?.name === 'AbortError') return
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function TripDetail({ trip, onBack, onUpdate, onFollow, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(trip.name || '')
  const [note, setNote] = useState(trip.note || '')
  const [mapMode, setMapMode] = useState('plain')
  const [cursorIdx, setCursorIdx] = useState(0)
  const [posterBusy, setPosterBusy] = useState(false)
  useEffect(() => {
    setDraft(trip.name || '')
    setNote(trip.note || '')
    setEditing(false)
    setCursorIdx(0)
  }, [trip.id])

  const tags = Array.isArray(trip.tags) ? trip.tags : []
  const toggleTag = (tag) => {
    const next = tags.includes(tag) ? tags.filter((x) => x !== tag) : [...tags, tag]
    onUpdate({ ...trip, tags: next.length ? next : undefined })
  }
  const saveNote = () => {
    const clean = note.trim() || undefined
    if (clean !== trip.note) onUpdate({ ...trip, note: clean })
  }

  const coords = useMemo(() => trip.points.map((p) => [p.lat, p.lon]), [trip.points])
  const cornersInfo = useMemo(() => detectCorners(trip.points), [trip.points])
  const virolo = useMemo(() => scoreTrip(trip), [trip])
  const segments = useMemo(() => buildColorSegments(trip.points, mapMode), [trip.points, mapMode])
  const cursorPt = cursorIdx > 0 && trip.points[cursorIdx] ? trip.points[cursorIdx] : null
  const s = trip.stats
  const scale = Math.max(45, s.maxLeanLeft, s.maxLeanRight)
  const leftPct = Math.min(100, (s.maxLeanLeft / scale) * 100)
  const rightPct = Math.min(100, (s.maxLeanRight / scale) * 100)
  const dateStr = new Date(trip.date).toLocaleString('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return (
    <div className="page">
      <div className="detail-head">
        <button type="button" className="back-btn" onClick={onBack}>
          ← Retour
        </button>
        {editing ? (
          <form
            className="rename-form"
            onSubmit={async (e) => {
              e.preventDefault()
              await onUpdate({ ...trip, name: draft.trim() || undefined })
              setEditing(false)
            }}
          >
            <input
              className="rename-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Nom du trajet…"
              maxLength={60}
              autoFocus
            />
            <button type="submit" className="save-btn">
              OK
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(trip.name || '')
                setEditing(false)
              }}
            >
              ✕
            </button>
          </form>
        ) : (
          <>
            <div className="detail-title" onClick={() => setEditing(true)}>
              <h2>{trip.name || dateStr}</h2>
              {trip.name && <small>{dateStr}</small>}
            </div>
            <button
              type="button"
              className="icon-btn"
              aria-label="Renommer le trajet"
              onClick={() => setEditing(true)}
            >
              ✎
            </button>
          </>
        )}
      </div>
      <div className="detail-badges">
        <span className="ride-badge">{virolo.badge}</span>
        <span className="virolo-pill">Virolo {virolo.score}/100</span>
        <span className="corners-pill">
          {virolo.cornersCount} virage{virolo.cornersCount > 1 ? 's' : ''}
        </span>
      </div>
      {coords.length > 0 && (
        <div className="map-card">
          <MapContainer center={coords[0]} zoom={13} className="map small" zoomControl={false}>
            <TileLayer url={TILES} attribution={TILE_ATTR} maxZoom={19} />
            {mapMode !== 'plain' && segments.length > 0 ? (
              segments.map((seg, i) => (
                <Polyline key={i} positions={seg.positions} color={seg.color} weight={5} opacity={0.95} />
              ))
            ) : (
              <>
                <Polyline positions={coords} color="#0057ff" weight={10} opacity={0.28} />
                <Polyline positions={coords} color="#1d6bff" weight={4.5} opacity={1} />
              </>
            )}
            <CircleMarker
              center={coords[0]}
              radius={5}
              color="#050608"
              weight={2}
              fillColor="#cbd5e1"
              fillOpacity={1}
            />
            <CircleMarker
              center={coords.at(-1)}
              radius={6}
              color="#ffffff"
              weight={2}
              fillColor="#0057ff"
              fillOpacity={1}
            />
            {trip.points[cursorIdx] && (
              <CircleMarker
                center={[trip.points[cursorIdx].lat, trip.points[cursorIdx].lon]}
                radius={7}
                color="#ffffff"
                weight={2.5}
                fillColor="#38bdf8"
                fillOpacity={1}
              />
            )}
            <FitTo coords={coords} />
            <PanTo point={cursorPt} />
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
      <TelemetryView
        trip={trip}
        mapMode={mapMode}
        onMapMode={setMapMode}
        cursorIdx={cursorIdx}
        onCursorChange={setCursorIdx}
        cornersInfo={cornersInfo}
      />
      <Stats s={s} />
      <div className="card journal-card">
        <div className="journal-head">
          <b>Carnet de bord</b>
        </div>
        <div className="tag-chips">
          {RIDE_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              className={tags.includes(tag) ? 'tag-chip on' : 'tag-chip'}
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            saveNote()
          }}
        >
          <input
            type="text"
            className="note-input"
            value={note}
            maxLength={140}
            onChange={(e) => setNote(e.target.value)}
            onBlur={saveNote}
            placeholder="Note de sortie (bitume, pression, ressenti)…"
          />
        </form>
      </div>
      <div className="detail-actions">
        {trip.points?.length > 1 && (
          <button type="button" className="cta start" onClick={() => onFollow(trip)}>
            Suivre ce trajet (hors-ligne)
          </button>
        )}
        <button
          type="button"
          className="secondary full"
          disabled={posterBusy}
          onClick={async () => {
            setPosterBusy(true)
            try {
              await shareTripPoster(trip, virolo)
            } finally {
              setPosterBusy(false)
            }
          }}
        >
          {posterBusy ? 'Génération…' : 'Carte souvenir PNG'}
        </button>
        <button type="button" className="secondary full" onClick={() => exportTripGpx(trip)}>
          Exporter GPX
        </button>
        <button
          type="button"
          className="danger full"
          onClick={() => confirm('Supprimer ce trajet ?') && onDelete(trip.id)}
        >
          Supprimer le trajet
        </button>
      </div>
    </div>
  )
}

export function Trips({ trips, onOpen, onRide, onImport }) {
  const fileRef = useRef(null)
  const [importErr, setImportErr] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('recent')
  const [compareOn, setCompareOn] = useState(false)
  const [compareIds, setCompareIds] = useState([])

  const records = useMemo(() => computeRecords(trips), [trips])
  const monthly = useMemo(() => buildMonthlySummary(trips), [trips])
  const maxMonthKm = Math.max(1, ...monthly.map((m) => m.km))
  const scoreById = useMemo(() => new Map(trips.map((t) => [t.id, scoreTrip(t)])), [trips])
  const visibleTrips = useMemo(() => filterAndSortTrips(trips, { query, sort }), [trips, query, sort])
  const compared = useMemo(() => {
    if (compareIds.length !== 2) return null
    const a = trips.find((t) => t.id === compareIds[0])
    const b = trips.find((t) => t.id === compareIds[1])
    return a && b ? compareTrips(a, b) : null
  }, [compareIds, trips])
  const toggleCompareId = (id) =>
    setCompareIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 2 ? [prev[1], id] : [...prev, id]
    )
  const openById = (id) => {
    const match = trips.find((t) => t.id === id)
    if (match) onOpen(match)
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      setImportErr('')
      const trip = parseGpx(await file.text())
      await onImport(trip)
    } catch (err) {
      setImportErr(err?.message || 'Import GPX impossible')
    }
  }

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept=".gpx,application/gpx+xml,text/xml"
      hidden
      onChange={handleFile}
    />
  )

  if (!trips.length) {
    return (
      <div className="page empty-page">
        {fileInput}
        <div className="card empty-card">
          <svg viewBox="0 0 64 64" className="empty-icon" aria-hidden="true">
            <circle cx="32" cy="36" r="22" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="4" />
            <path d="M16 49 A22 22 0 1 1 48 49" fill="none" stroke="#0057ff" strokeWidth="4" strokeLinecap="round" />
            <line x1="32" y1="36" x2="44" y2="24" stroke="#f8fafc" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <h2>Aucun trajet enregistré</h2>
          <p>Fixe ton téléphone sur le guidon et lance un premier trajet pour voir ta vitesse et tes angles.</p>
          {importErr && <div className="inline-err">{importErr}</div>}
          <div className="empty-actions">
            <button type="button" className="cta start" onClick={onRide}>
              Aller rouler
            </button>
            <button type="button" className="secondary full" onClick={() => fileRef.current?.click()}>
              Importer un fichier GPX
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      {fileInput}
      <div className="card hero">
        <div className="hero-top">
          <div>
            <small>DISTANCE TOTALE</small>
            <strong>{km(records.totalDistanceM)}</strong>
          </div>
          <div className="hero-actions">
            {trips.length >= 2 && (
              <button
                type="button"
                className={compareOn ? 'gpx-btn on' : 'gpx-btn'}
                onClick={() => {
                  setCompareOn((c) => !c)
                  setCompareIds([])
                }}
              >
                ⇄ Comparer
              </button>
            )}
            <button type="button" className="gpx-btn" onClick={() => fileRef.current?.click()}>
              + Importer GPX
            </button>
          </div>
        </div>
        <div className="hero-meta">
          <span>
            <b>{records.totalTrips}</b> trajet{records.totalTrips > 1 ? 's' : ''}
          </span>
          <span>
            <b>+{Math.round(records.totalElevationM)}</b> m D+
          </span>
        </div>
        <div className="records-bar">
          <button type="button" onClick={() => openById(records.maxSpeedTripId)}>
            <small>Vmax record</small>
            <b>{records.maxSpeedKmh.toFixed(0)} km/h</b>
          </button>
          <button type="button" onClick={() => openById(records.bestLeanTripId)}>
            <small>Angle max</small>
            <b>{records.bestLeanDeg.toFixed(0)}°</b>
          </button>
          <button type="button" onClick={() => openById(records.longestTripId)}>
            <small>Plus longue</small>
            <b>{km(records.longestDistM)}</b>
          </button>
          <button type="button" onClick={() => openById(records.bestViroloTripId)}>
            <small>Top Virolo</small>
            <b>{records.bestVirolo}/100</b>
          </button>
        </div>
        <div className="month-bars" aria-label="Activité des 6 derniers mois">
          {monthly.map((m) => (
            <div key={m.key} className="month-col">
              <small className="month-km">{m.km > 0 ? m.km.toFixed(0) : ''}</small>
              <div className="month-track">
                <i style={{ height: `${m.km > 0 ? Math.max(10, Math.round((m.km / maxMonthKm) * 100)) : 4}%` }} className={m.km > 0 ? 'on' : ''} />
              </div>
              <span>{m.label}</span>
            </div>
          ))}
        </div>
      </div>
      {compareOn && (
        <div className="card compare-card">
          <div className="compare-head">
            <b>
              {compared
                ? `${compared.a.name || 'Trajet A'} vs ${compared.b.name || 'Trajet B'}`
                : `Comparateur (${compareIds.length}/2 choisis)`}
            </b>
            <button
              type="button"
              onClick={() => {
                setCompareOn(false)
                setCompareIds([])
              }}
            >
              Fermer
            </button>
          </div>
          {compared ? (
            <div className="compare-grid">
              {[
                ['Distance', km(compared.b.distanceM), compared.delta.distanceM / 1000, ' km', 1],
                ['Durée', hms(compared.b.durationS), Math.round(compared.delta.durationS / 60), ' min', 0],
                ['Moy. mouv.', `${compared.b.avgMovingSpeed.toFixed(0)} km/h`, compared.delta.avgMovingSpeed, ' km/h', 0],
                ['Vmax', `${compared.b.maxSpeed.toFixed(0)} km/h`, compared.delta.maxSpeed, ' km/h', 0],
                ['Angle max', `${compared.b.maxLean.toFixed(0)}°`, compared.delta.maxLean, '°', 0],
                ['D+', `${Math.round(compared.b.elevationGain)} m`, compared.delta.elevationGain, ' m', 0],
                ['Virolo', `${compared.b.viroloScore}/100`, compared.delta.viroloScore, '', 0],
              ].map(([label, valB, d, unit, dec]) => {
                const sign = d > 0.05 ? '+' : d < -0.05 ? '−' : ''
                const cls = d > 0.05 ? 'pos' : d < -0.05 ? 'neg' : 'eq'
                return (
                  <div key={label} className="compare-row">
                    <span>{label}</span>
                    <b>{valB}</b>
                    <em className={cls}>
                      {sign}
                      {Math.abs(d).toFixed(dec)}
                      {unit}
                    </em>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="compare-hint">Touche deux trajets dans la liste ci-dessous pour afficher les écarts.</p>
          )}
        </div>
      )}
      <div className="trip-controls">
        <input
          type="search"
          className="trip-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un trajet ou une date…"
          aria-label="Rechercher un trajet"
        />
        <div className="sort-pills" role="group" aria-label="Trier les trajets">
          {[
            ['recent', 'Récent'],
            ['distance', 'Dist.'],
            ['speed', 'Vmax'],
            ['lean', 'Angle'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={sort === id ? 'on' : ''}
              onClick={() => setSort(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {importErr && <div className="inline-err">{importErr}</div>}
      <ul className="trips">
        {!visibleTrips.length ? (
          <li className="trips-empty">Aucun trajet trouvé</li>
        ) : (
          visibleTrips.map((t) => {
            const meta = scoreById.get(t.id) || { score: 0, badge: 'Balade' }
            const dateLabel = new Date(t.date).toLocaleDateString('fr-FR', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })
            return (
              <li
                key={t.id}
                className={compareOn && compareIds.includes(t.id) ? 'selected' : ''}
                onClick={() => (compareOn ? toggleCompareId(t.id) : onOpen(t))}
              >
                <div className="trip-top">
                  <div className="trip-title-wrap">
                    <b>{t.name || dateLabel}</b>
                    {t.name && <small className="trip-date">{dateLabel}</small>}
                  </div>
                  <span className="dist-badge">{km(t.stats.distance)}</span>
                </div>
                <div className="trip-badges">
                  <span className="ride-badge">{meta.badge}</span>
                  <span className="virolo-pill">Virolo {meta.score}</span>
                  {t.tags?.slice(0, 3).map((tag) => (
                    <span key={tag} className="corners-pill">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="trip-meta">
                  <span>{hms(t.stats.duration)}</span>
                  <span>max {t.stats.maxSpeed.toFixed(0)} km/h</span>
                  <span>
                    ◀ {t.stats.maxLeanLeft.toFixed(0)}° / {t.stats.maxLeanRight.toFixed(0)}° ▶
                  </span>
                </div>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}
