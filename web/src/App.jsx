import { useRef, useState } from 'react'
import AccessGate from './components/AccessGate'
import FilePicker from './components/FilePicker'
import ScanProgress from './components/ScanProgress'
import PhotoGallery from './components/PhotoGallery'
import PhotoDetail from './components/PhotoDetail'
import {
  scanFile,
  applyVerdictToDetection,
  clearVerdictFromDetection,
  recomputePhotoSummary,
} from './lib/scanner'
import { clearCache, putResult, recordVerdict, removeVerdict } from './lib/db'
import './index.css'

const USE_PROXY = !!import.meta.env.VITE_USE_PROXY

const WEED_OPTIONS = [
  { value: 'any', label: 'Any purple weed' },
  { value: 'purple_loosestrife', label: 'Purple Loosestrife' },
  { value: 'thistle', label: 'Thistle' },
  { value: 'dames_rocket', label: "Dame's Rocket" },
]

export default function App() {
  const [files, setFiles] = useState([])
  const [selectedWeeds, setSelectedWeeds] = useState(['any'])
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
        result = await scanFile(file, selectedWeeds, {
          fewShot: fewShotEnabled,
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
      // Yield to the event loop so React can repaint between heavy CV+API calls.
      await new Promise(r => setTimeout(r, 0))
    }

    setProgress(p => ({ ...p, status: cancelRef.current ? 'cancelled' : 'complete' }))
    setScanning(false)
  }

  const cancelScan = () => {
    cancelRef.current = true
  }

  // ─── HITL verdict handlers ────────────────────────────
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
    } catch (e) {
      console.error('recordVerdict failed', e)
    }
  }

  const handleVerdict = async (photo, blobIndex, verdict) => {
    const det = photo.detections?.[blobIndex]
    if (!det) return
    const next = applyVerdictToDetection(det, { ...verdict, targetWeeds: selectedWeeds })
    const newDetections = photo.detections.map((d, i) => (i === blobIndex ? next : d))
    const updatedPhoto = recomputePhotoSummary({ ...photo, detections: newDetections })

    setResults(prev => prev.map(r => (r.hash === photo.hash ? updatedPhoto : r)))
    setSelectedPhoto(updatedPhoto)

    try { await putResult(updatedPhoto) } catch (e) { console.error(e) }

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

  const resetSession = async ({ clearAnalysisCache = false, clearPassword = false } = {}) => {
    // Revoke transient blob URLs so we don't leak memory.
    for (const r of results) {
      if (r.previewUrl) {
        try { URL.revokeObjectURL(r.previewUrl) } catch {}
      }
    }
    setFiles([])
    setResults([])
    setProgress(null)
    setSelectedPhoto(null)
    setSelectedWeeds(['any'])
    if (clearAnalysisCache) {
      try { await clearCache() } catch {}
    }
    if (clearPassword) {
      try { localStorage.removeItem('access_password') } catch {}
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Purple Weed Detector</h1>
        <p>Browser-only blob detection + Gemini Vision. Photos stay on your machine.</p>
      </header>

      <main className="main">
        {USE_PROXY && <AccessGate />}

        <FilePicker
          files={files}
          setFiles={setFiles}
          selectedWeeds={selectedWeeds}
          setSelectedWeeds={setSelectedWeeds}
          weedOptions={WEED_OPTIONS}
          onScan={startScan}
          onCancel={cancelScan}
          scanning={scanning}
          hasResults={results.length > 0}
          onReset={resetSession}
          useProxy={USE_PROXY}
          fewShotEnabled={fewShotEnabled}
          setFewShotEnabled={setFewShotEnabled}
        />

        {progress && <ScanProgress progress={progress} />}

        {results.length > 0 && (
          <PhotoGallery
            results={results}
            selected={selectedPhoto}
            onSelect={setSelectedPhoto}
          />
        )}
      </main>

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
