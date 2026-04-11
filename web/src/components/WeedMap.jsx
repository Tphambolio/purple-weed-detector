import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { listDetections, recordsEnabled } from '../lib/records.js'
import { COLOR_CLASSES } from '../lib/colorClasses.js'
import { SPECIES, getSpeciesById } from '../lib/species.js'

// Edmonton-ish default centre + zoom — used when there are no records yet.
const DEFAULT_CENTER = [53.5461, -113.4938]
const DEFAULT_ZOOM = 11

// CartoDB Dark Matter raster tiles — no API key required, dark theme matches
// the rest of the UI, OpenStreetMap data attribution required by ToS.
const TILE_URL  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
const TILE_SUBDOMAINS = ['a', 'b', 'c', 'd']

function FitToBounds({ records }) {
  const map = useMap()
  const fittedRef = useRef(false)
  useEffect(() => {
    if (fittedRef.current) return
    if (!records || records.length === 0) return
    const valid = records.filter(r => r?.location?.lat != null && r?.location?.lng != null)
    if (valid.length === 0) return
    const bounds = valid.map(r => [r.location.lat, r.location.lng])
    if (bounds.length === 1) {
      map.setView(bounds[0], 15)
    } else {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 })
    }
    fittedRef.current = true
  }, [records, map])
  return null
}

export default function WeedMap() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [filterClass, setFilterClass] = useState(null)
  const [filterSpecies, setFilterSpecies] = useState(null)
  const [verifiedOnly, setVerifiedOnly] = useState(false)

  const reload = async () => {
    if (!recordsEnabled()) {
      setError('Records backend not configured. Set VITE_RECORDS_URL at build time.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { records: list } = await listDetections({ limit: 1000 })
      setRecords(list || [])
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  const filtered = useMemo(() => {
    let out = records.filter(r => r?.location?.lat != null && r?.location?.lng != null)
    if (filterClass) out = out.filter(r => r.color_class === filterClass)
    if (filterSpecies) out = out.filter(r => r.species_id === filterSpecies)
    if (verifiedOnly) out = out.filter(r => r.human_verdict === 'correct')
    return out
  }, [records, filterClass, filterSpecies, verifiedOnly])

  // Per-class counts for the legend
  const classCounts = useMemo(() => {
    const counts = {}
    for (const r of records) {
      if (!r?.color_class) continue
      counts[r.color_class] = (counts[r.color_class] || 0) + 1
    }
    return counts
  }, [records])

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl md:text-2xl font-bold tracking-tight text-on-surface">
            Detection Map
          </h2>
          <p className="text-xs text-on-surface-variant/70 mt-1">
            Confirmed weed sightings shared across the team. Each marker is a single detection,
            colour-coded by its colour class.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={reload}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-container-high hover:bg-surface-container-highest text-xs font-semibold rounded-lg disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-sm ${loading ? 'animate-spin' : ''}`}>
              {loading ? 'autorenew' : 'refresh'}
            </span>
            {loading ? 'Loading…' : `Refresh (${records.length})`}
          </button>
          <label className="flex items-center gap-2 px-3 py-1.5 bg-surface-container-high rounded-lg cursor-pointer">
            <input
              type="checkbox"
              checked={verifiedOnly}
              onChange={e => setVerifiedOnly(e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-primary cursor-pointer"
            />
            <span className="text-xs font-semibold">Verified only</span>
          </label>
        </div>
      </div>

      {/* Filter pills — colour classes */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => { setFilterClass(null); setFilterSpecies(null) }}
          className={`px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${
            !filterClass && !filterSpecies
              ? 'bg-primary/15 text-primary border border-primary/40'
              : 'bg-surface-container-high text-on-surface-variant/60 border border-transparent hover:text-on-surface'
          }`}
        >
          All ({records.length})
        </button>
        {Object.entries(COLOR_CLASSES).map(([clsId, cls]) => {
          const n = classCounts[clsId] || 0
          if (n === 0) return null
          const active = filterClass === clsId
          return (
            <button
              key={clsId}
              onClick={() => { setFilterClass(active ? null : clsId); setFilterSpecies(null) }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider transition-all ${
                active ? 'border' : 'border border-transparent'
              }`}
              style={{
                backgroundColor: active ? cls.bbox_color + '22' : '#282a30',
                color: active ? cls.bbox_color : 'rgba(207,194,214,0.6)',
                borderColor: active ? cls.bbox_color : 'transparent',
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cls.bbox_color }} />
              {cls.label} · {n}
            </button>
          )
        })}
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-error/15 text-error text-xs">
          {error}
        </div>
      )}

      {/* Map container */}
      <div className="rounded-2xl overflow-hidden bg-surface-container-low" style={{ height: 'calc(100vh - 320px)', minHeight: '400px' }}>
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          scrollWheelZoom
          className="w-full h-full"
          style={{ background: '#0c0e14' }}
        >
          <TileLayer url={TILE_URL} attribution={TILE_ATTR} subdomains={TILE_SUBDOMAINS} maxZoom={19} />
          <FitToBounds records={filtered} />
          {filtered.map(r => {
            const cls = COLOR_CLASSES[r.color_class]
            const color = cls?.bbox_color || '#a855f7'
            return (
              <CircleMarker
                key={r.id}
                center={[r.location.lat, r.location.lng]}
                radius={r.human_verdict === 'correct' ? 9 : 7}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: r.human_verdict === 'correct' ? 0.85 : 0.55,
                  weight: r.human_verdict === 'correct' ? 2 : 1.5,
                }}
              >
                <Popup className="weedmap-popup">
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center gap-1.5 font-bold">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                      {r.species_label || r.species_id}
                    </div>
                    {r.description && (
                      <div className="text-[11px] opacity-75 leading-snug">{r.description.slice(0, 200)}</div>
                    )}
                    <div className="text-[10px] opacity-60 space-y-0.5">
                      <div>{r.photo_filename}</div>
                      {r.photo_date && <div>{new Date(r.photo_date).toLocaleString()}</div>}
                      <div>{r.location.lat.toFixed(5)}, {r.location.lng.toFixed(5)}</div>
                      {r.location.altitude != null && <div>{Math.round(r.location.altitude)} m AGL</div>}
                    </div>
                    {r.human_verdict === 'correct' && (
                      <div className="text-[10px] font-bold text-tertiary">✓ HUMAN-VERIFIED</div>
                    )}
                    {r.confidence === 'high' && !r.human_verdict && (
                      <div className="text-[10px] font-bold text-secondary">AI · HIGH CONFIDENCE</div>
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            )
          })}
        </MapContainer>
      </div>

      <div className="text-[10px] text-on-surface-variant/40 italic">
        Showing {filtered.length} of {records.length} records.
        Records are stored in Firestore and shared across all users of this deployment.
        Photos with no GPS in EXIF cannot appear on the map.
      </div>
    </div>
  )
}
