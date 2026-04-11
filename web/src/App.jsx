import { useEffect, useRef, useState } from 'react'
import FilePicker from './components/FilePicker'
import ScanProgress from './components/ScanProgress'
import PhotoGallery from './components/PhotoGallery'
import PhotoDetail from './components/PhotoDetail'
import SpeciesCalendar from './components/SpeciesCalendar'
import ScienceTab from './components/ScienceTab'
import WeedMap from './components/WeedMap'
import {
  scanFile,
  applyVerdictToDetection,
  clearVerdictFromDetection,
  recomputePhotoSummary,
} from './lib/scanner'
import { clearCache, putResult, recordVerdict, removeVerdict } from './lib/db'
import { SPECIES } from './lib/species'
import { getActiveSpecies } from './lib/phenology'
import { earliestPhotoDate } from './lib/exif'
import { publishConfirmedDetections, recordsEnabled } from './lib/records'
import './index.css'

export default function App() {
  const [tab, setTab] = useState('scan')
  const [sidebarOpen, setSidebarOpen] = useState(true) // mobile drawer state
  const [files, setFiles] = useState([])
  const [selectedSpeciesIds, setSelectedSpeciesIds] = useState(() => SPECIES.map(s => s.id))
  const [photoDate, setPhotoDate] = useState(null)
  const [photoDateSource, setPhotoDateSource] = useState(null)
  const [inSeasonOnly, setInSeasonOnly] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState(null)
  const [results, setResults] = useState([])
  const [selectedPhoto, setSelectedPhoto] = useState(null)
  const [fewShotEnabled, setFewShotEnabledState] = useState(
    () => localStorage.getItem('fewshot_enabled') === '1'
  )
  const setFewShotEnabled = (v) => {
    setFewShotEnabledState(v)
    try { localStorage.setItem('fewshot_enabled', v ? '1' : '0') } catch {}
  }
  const cancelRef = useRef(false)
  // App-level file input — shared by the FilePicker sidebar button AND the
  // EmptyState centred CTA so a single click opens the OS file chooser
  // regardless of which entry point the user used.
  const fileInputRef = useRef(null)
  const openFileChooser = () => fileInputRef.current?.click()
  const onFileInputChange = (e) => {
    const list = Array.from(e.target.files || []).filter(f => /^image\//.test(f.type))
    setFiles(list)
  }

  // EXIF date extraction on file change drives the phenology auto-filter.
  useEffect(() => {
    if (files.length === 0) {
      setPhotoDate(null)
      setPhotoDateSource(null)
      return
    }
    let cancelled = false
    ;(async () => {
      const { date, source } = await earliestPhotoDate(files)
      if (cancelled) return
      setPhotoDate(date)
      setPhotoDateSource(source)
      if (inSeasonOnly) {
        const active = getActiveSpecies(date, SPECIES)
        if (active.length > 0) setSelectedSpeciesIds(active.map(s => s.id))
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files])

  useEffect(() => {
    if (!inSeasonOnly || !photoDate) return
    const active = getActiveSpecies(photoDate, SPECIES)
    setSelectedSpeciesIds(active.map(s => s.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inSeasonOnly])

  const handlePhotoDateOverride = (date) => {
    setPhotoDate(date)
    setPhotoDateSource('override')
    if (inSeasonOnly) {
      const active = getActiveSpecies(date, SPECIES)
      setSelectedSpeciesIds(active.map(s => s.id))
    }
  }

  const startScan = async () => {
    if (files.length === 0) return
    setScanning(true)
    setResults([])
    cancelRef.current = false

    let processed = 0
    let detected = 0
    const total = files.length
    setProgress({ status: 'scanning', total, processed: 0, detected: 0 })

    for (const file of files) {
      if (cancelRef.current) break
      setProgress(p => ({ ...p, current_file: file.name }))

      let result
      try {
        result = await scanFile(file, selectedSpeciesIds, {
          fewShot: fewShotEnabled,
          photoDate,
          onProgress: ({ stage, blobIndex, totalBlobs }) => {
            const subLabel = stage === 'analyzing'
              ? `${file.name} — blob ${blobIndex + 1}/${totalBlobs}`
              : `${file.name} — ${stage}`
            setProgress(p => ({ ...p, current_file: subLabel }))
          },
        })
      } catch (e) {
        result = {
          hash: `error_${file.name}_${Date.now()}`,
          filename: file.name,
          width: 0, height: 0,
          has_purple: false,
          detected: false,
          status: 'error',
          description: (e.message || e).toString().slice(0, 200),
          detections: [],
          previewUrl: URL.createObjectURL(file),
        }
      }

      processed += 1
      if (result.detected) detected += 1
      setResults(prev => [...prev, result])
      setProgress({
        status: 'scanning', total,
        processed, detected,
        current_file: file.name,
      })

      // Auto-publish AI-confirmed matches to the records backend so they
      // appear on the team-wide map. Skips silently if records are disabled
      // (no VITE_RECORDS_URL) or the photo has no GPS in EXIF.
      if (result.detected && recordsEnabled() && result.photo_location) {
        publishConfirmedDetections(result).catch(e => console.warn('publish failed', e))
      }

      await new Promise(r => setTimeout(r, 0))
    }

    setProgress(p => ({ ...p, status: cancelRef.current ? 'cancelled' : 'complete' }))
    setScanning(false)
  }

  const cancelScan = () => { cancelRef.current = true }

  // ─── HITL verdict handlers (unchanged from previous build) ──────────
  const persistVerdict = async (photo, blobIndex, verdictRow) => {
    try {
      await recordVerdict({
        photo_hash: photo.hash,
        blob_index: blobIndex,
        ai_verdict: verdictRow.ai_verdict,
        human_verdict: verdictRow.human_verdict,
        human_species: verdictRow.human_species ?? null,
        phash: verdictRow.phash ?? null,
        thumb_b64: verdictRow.thumb_b64 ?? null,
        blob_geom: verdictRow.blob_geom ?? null,
      })
    } catch (e) { console.error('recordVerdict failed', e) }
  }

  const handleVerdict = async (photo, blobIndex, verdict) => {
    const det = photo.detections?.[blobIndex]
    if (!det) return
    const next = applyVerdictToDetection(det, { ...verdict, targetWeeds: selectedSpeciesIds })
    const newDetections = photo.detections.map((d, i) => (i === blobIndex ? next : d))
    const updatedPhoto = recomputePhotoSummary({ ...photo, detections: newDetections })
    setResults(prev => prev.map(r => (r.hash === photo.hash ? updatedPhoto : r)))
    setSelectedPhoto(updatedPhoto)
    try { await putResult(updatedPhoto) } catch (e) { console.error(e) }
    // Re-publish to records backend so the human verdict overrides the
    // AI's snapshot. Idempotent — same photo_hash + blob_index doc.
    if (recordsEnabled() && updatedPhoto.photo_location) {
      publishConfirmedDetections(updatedPhoto).catch(e => console.warn('publish failed', e))
    }
    await persistVerdict(updatedPhoto, blobIndex, {
      ai_verdict: det.ai_snapshot ?? {
        species: det.species,
        confidence: det.confidence,
        description: det.description,
        is_plant: det.is_match,
      },
      human_verdict: verdict.human_verdict,
      human_species: verdict.human_species,
      phash: det.phash,
      thumb_b64: det.thumb_b64,
      blob_geom: { x: det.x, y: det.y, w: det.w, h: det.h, cx: det.cx, cy: det.cy, area_px: det.area_px },
    })
  }

  const handleClearVerdict = async (photo, blobIndex) => {
    const det = photo.detections?.[blobIndex]
    if (!det) return
    const next = clearVerdictFromDetection(det)
    const newDetections = photo.detections.map((d, i) => (i === blobIndex ? next : d))
    const updatedPhoto = recomputePhotoSummary({ ...photo, detections: newDetections })
    setResults(prev => prev.map(r => (r.hash === photo.hash ? updatedPhoto : r)))
    setSelectedPhoto(updatedPhoto)
    try { await putResult(updatedPhoto) } catch (e) { console.error(e) }
    try { await removeVerdict(photo.hash, blobIndex) } catch (e) { console.error(e) }
  }

  const resetSession = async ({ clearAnalysisCache = false } = {}) => {
    for (const r of results) {
      if (r.previewUrl) {
        try { URL.revokeObjectURL(r.previewUrl) } catch {}
      }
    }
    setFiles([])
    setResults([])
    setProgress(null)
    setSelectedPhoto(null)
    setPhotoDate(null)
    setPhotoDateSource(null)
    setSelectedSpeciesIds(SPECIES.map(s => s.id))
    if (clearAnalysisCache) {
      try { await clearCache() } catch {}
    }
  }

  // ─── Layout helpers ─────────────────────────────────────────────────
  const tabClass = (id) => `text-sm font-medium tracking-tight transition-colors duration-200 px-1 ${
    tab === id
      ? 'text-primary border-b-2 border-primary pb-1'
      : 'text-on-surface-variant/70 hover:text-on-surface'
  }`

  const mobileTabClass = (id) => `flex flex-col items-center justify-center gap-0.5 flex-1 py-1.5 ${
    tab === id ? 'text-primary scale-105' : 'text-on-surface-variant/60'
  }`

  return (
    <div className="min-h-screen bg-background text-on-surface flex flex-col">
      {/* App-level hidden file input (shared by EmptyState + FilePicker buttons) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={onFileInputChange}
      />

      {/* ── Top nav (frosted glass, sticky) ──────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-40 h-[56px] flex justify-between items-center px-4 md:px-6 bg-surface-container-low/85 backdrop-blur-xl">
        <div className="flex items-center gap-3 min-w-0">
          <button
            className="md:hidden p-2 -ml-2 text-on-surface-variant hover:text-on-surface"
            onClick={() => setSidebarOpen(o => !o)}
            aria-label="Toggle sidebar"
          >
            <span className="material-symbols-outlined text-xl">menu</span>
          </button>
          <div className="w-2.5 h-2.5 rounded-full bg-primary shadow-[0_0_10px_rgba(221,183,255,0.6)] flex-shrink-0" />
          <span className="text-base md:text-lg font-bold tracking-tighter text-on-surface truncate">
            Edmonton Weed Detector
          </span>
        </div>
        <div className="hidden md:flex items-center gap-7">
          <button className={tabClass('scan')} onClick={() => setTab('scan')}>Scan</button>
          <button className={tabClass('map')} onClick={() => setTab('map')}>Map</button>
          <button className={tabClass('calendar')} onClick={() => setTab('calendar')}>Calendar</button>
          <button className={tabClass('science')} onClick={() => setTab('science')}>Science</button>
        </div>
        <div className="flex items-center gap-2">
          {results.length > 0 && (
            <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-tertiary-container/20 text-tertiary text-[11px] font-bold uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-tertiary" />
              {results.filter(r => r.detected).length}/{results.length}
            </span>
          )}
        </div>
      </nav>

      {/* ── Workspace ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 pt-[56px] pb-[44px] md:pb-0">
        {/* Sidebar — fixed left on desktop, drawer on mobile */}
        <aside
          className={`fixed md:static top-[56px] left-0 z-30 h-[calc(100vh-56px-44px)] md:h-[calc(100vh-56px)] w-[320px] md:w-[340px] bg-surface-container-low transition-transform duration-200 ease-out ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
          } ${tab === 'scan' ? 'block' : 'hidden md:hidden'}`}
        >
          {tab === 'scan' && (
            <FilePicker
              files={files}
              setFiles={setFiles}
              openFileChooser={openFileChooser}
              selectedSpeciesIds={selectedSpeciesIds}
              setSelectedSpeciesIds={setSelectedSpeciesIds}
              photoDate={photoDate}
              photoDateSource={photoDateSource}
              onPhotoDateOverride={handlePhotoDateOverride}
              inSeasonOnly={inSeasonOnly}
              setInSeasonOnly={setInSeasonOnly}
              onScan={() => { startScan(); setSidebarOpen(false) }}
              onCancel={cancelScan}
              scanning={scanning}
              hasResults={results.length > 0}
              onReset={resetSession}
              fewShotEnabled={fewShotEnabled}
              setFewShotEnabled={setFewShotEnabled}
            />
          )}
        </aside>

        {/* Backdrop overlay when mobile drawer is open */}
        {sidebarOpen && tab === 'scan' && (
          <div
            className="md:hidden fixed inset-0 top-[56px] z-20 bg-background/60 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main content area */}
        <main className="flex-1 min-w-0 overflow-y-auto bg-background">
          {tab === 'scan' && (
            <ScanWorkspace
              results={results}
              scanning={scanning}
              progress={progress}
              selectedPhoto={selectedPhoto}
              onSelect={setSelectedPhoto}
              onChoosePhotos={() => { openFileChooser(); setSidebarOpen(true) }}
              hasFiles={files.length > 0}
            />
          )}
          {tab === 'map' && <WeedMap />}
          {tab === 'calendar' && <SpeciesCalendar photoDate={photoDate} />}
          {tab === 'science' && <ScienceTab />}
        </main>
      </div>

      {/* ── Mobile bottom nav ─────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-[44px] bg-surface-container-low/90 backdrop-blur-lg shadow-[0_-4px_20px_rgba(0,0,0,0.4)] flex">
        <button className={mobileTabClass('scan')} onClick={() => setTab('scan')}>
          <span className="material-symbols-outlined text-lg">target</span>
          <span className="text-[9px] uppercase tracking-widest font-semibold">Scan</span>
        </button>
        <button className={mobileTabClass('map')} onClick={() => setTab('map')}>
          <span className="material-symbols-outlined text-lg">map</span>
          <span className="text-[9px] uppercase tracking-widest font-semibold">Map</span>
        </button>
        <button className={mobileTabClass('calendar')} onClick={() => setTab('calendar')}>
          <span className="material-symbols-outlined text-lg">calendar_today</span>
          <span className="text-[9px] uppercase tracking-widest font-semibold">Calendar</span>
        </button>
        <button className={mobileTabClass('science')} onClick={() => setTab('science')}>
          <span className="material-symbols-outlined text-lg">science</span>
          <span className="text-[9px] uppercase tracking-widest font-semibold">Science</span>
        </button>
      </nav>

      {selectedPhoto && (
        <PhotoDetail
          photo={selectedPhoto}
          onClose={() => setSelectedPhoto(null)}
          onVerdict={handleVerdict}
          onClearVerdict={handleClearVerdict}
        />
      )}
    </div>
  )
}

// ─── Scan workspace: empty state OR progress OR gallery ───────────────
function ScanWorkspace({ results, scanning, progress, selectedPhoto, onSelect, onChoosePhotos, hasFiles }) {
  if (results.length === 0 && !scanning) {
    return <EmptyState onChoosePhotos={onChoosePhotos} hasFiles={hasFiles} />
  }
  return (
    <div className="p-4 md:p-6 lg:p-8">
      {progress && <ScanProgress progress={progress} />}
      {results.length > 0 && (
        <PhotoGallery results={results} selected={selectedPhoto} onSelect={onSelect} />
      )}
    </div>
  )
}

function EmptyState({ onChoosePhotos, hasFiles }) {
  return (
    <div className="relative h-full min-h-[calc(100vh-56px-44px)] md:min-h-[calc(100vh-56px)] flex items-center justify-center p-6 md:p-8">
      {/* Subtle background dot pattern */}
      <div
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(#33343b 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      <div className="relative max-w-3xl w-full p-7 md:p-10 rounded-[2rem] bg-surface-container-low/80 backdrop-blur-2xl text-center space-y-6">
        <div className="relative inline-block">
          <div className="absolute -inset-4 bg-primary/20 blur-3xl rounded-full" />
          <div className="relative w-20 h-20 md:w-24 md:h-24 rounded-full bg-surface-container-highest flex items-center justify-center mx-auto">
            <span className="material-symbols-outlined text-4xl md:text-5xl text-primary" style={{ fontVariationSettings: "'wght' 200" }}>
              add_a_photo
            </span>
          </div>
        </div>
        <div className="space-y-3">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-on-surface">
            Upload drone photos to begin
          </h1>
          <p className="text-on-surface-variant text-sm font-light leading-relaxed max-w-md mx-auto">
            Detects 18 regulated invasive weed species across the Edmonton river valley.
            Photos stay on your device — only small crops are sent to Gemini Vision.
          </p>
        </div>

        {/* ── Pilot capture guidelines ───────────────────────── */}
        <div className="text-left bg-surface-container-lowest/60 rounded-2xl p-5 md:p-6 max-w-xl mx-auto">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-primary text-lg">flight</span>
            <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-primary">
              Pilot capture guidelines
            </span>
          </div>
          <ul className="space-y-2 text-xs md:text-[13px] text-on-surface-variant/90 leading-relaxed">
            <li className="flex gap-3">
              <span className="material-symbols-outlined text-on-surface-variant/40 text-base flex-shrink-0 mt-0.5">height</span>
              <span><strong className="text-on-surface">Altitude:</strong> 50–100 m AGL for weed-scale detail. Higher altitudes lose flower detail; lower altitudes miss coverage.</span>
            </li>
            <li className="flex gap-3">
              <span className="material-symbols-outlined text-on-surface-variant/40 text-base flex-shrink-0 mt-0.5">photo_camera</span>
              <span><strong className="text-on-surface">Camera:</strong> nadir (straight down), highest-resolution JPEG, neutral colour profile, auto-exposure.</span>
            </li>
            <li className="flex gap-3">
              <span className="material-symbols-outlined text-on-surface-variant/40 text-base flex-shrink-0 mt-0.5">wb_sunny</span>
              <span><strong className="text-on-surface">Time of day:</strong> 10 AM – 2 PM for accurate flower colour. Golden-hour shadows shift hues and break the colour masks.</span>
            </li>
            <li className="flex gap-3">
              <span className="material-symbols-outlined text-on-surface-variant/40 text-base flex-shrink-0 mt-0.5">cloud_queue</span>
              <span><strong className="text-on-surface">Weather:</strong> clear or light overcast. Avoid wind &gt; 25 km/h, rain, or harsh shadows from low cloud.</span>
            </li>
            <li className="flex gap-3">
              <span className="material-symbols-outlined text-on-surface-variant/40 text-base flex-shrink-0 mt-0.5">my_location</span>
              <span><strong className="text-on-surface">Geotagging:</strong> keep GPS enabled (DJI default). Required for the map view of confirmed detections.</span>
            </li>
            <li className="flex gap-3">
              <span className="material-symbols-outlined text-on-surface-variant/40 text-base flex-shrink-0 mt-0.5">grid_view</span>
              <span><strong className="text-on-surface">Coverage:</strong> overlap photos ~30% so a single weed isn't split across two frames. Survey the same patch on the same day if possible.</span>
            </li>
          </ul>
        </div>

        <div className="flex flex-col items-center gap-3">
          <button
            onClick={onChoosePhotos}
            className="px-7 md:px-8 py-3 md:py-4 bg-gradient-to-r from-primary to-primary-container text-on-primary-container rounded-full font-black text-base md:text-lg shadow-[0_8px_30px_rgba(221,183,255,0.3)] hover:translate-y-[-2px] active:translate-y-[1px] transition-all"
          >
            {hasFiles ? 'Choose more photos' : 'Choose photos'}
          </button>
          <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-on-surface-variant/40">
            JPEG, PNG, TIFF · ≤ 8K resolution · GPS recommended
          </p>
        </div>
      </div>
    </div>
  )
}
