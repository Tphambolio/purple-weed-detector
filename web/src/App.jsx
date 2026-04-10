import { useRef, useState } from 'react'
import AccessGate from './components/AccessGate'
import FilePicker from './components/FilePicker'
import ScanProgress from './components/ScanProgress'
import PhotoGallery from './components/PhotoGallery'
import PhotoDetail from './components/PhotoDetail'
import { scanFile } from './lib/scanner'
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
        <PhotoDetail photo={selectedPhoto} onClose={() => setSelectedPhoto(null)} />
      )}
    </div>
  )
}
