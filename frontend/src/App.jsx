import { useState, useRef } from 'react'
import FolderInput from './components/FolderInput'
import ScanProgress from './components/ScanProgress'
import PhotoGallery from './components/PhotoGallery'
import PhotoDetail from './components/PhotoDetail'
import './index.css'

const WEED_OPTIONS = [
  { value: 'any', label: 'Any purple weed' },
  { value: 'purple_loosestrife', label: 'Purple Loosestrife' },
  { value: 'thistle', label: 'Thistle' },
  { value: 'dames_rocket', label: "Dame's Rocket" },
]

const API = 'http://localhost:8000'

export default function App() {
  const [folder, setFolder] = useState('')
  const [driveFolder, setDriveFolder] = useState('')
  const [selectedWeeds, setSelectedWeeds] = useState(['any'])
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState(null)
  const [results, setResults] = useState([])
  const [selectedPhoto, setSelectedPhoto] = useState(null)
  const readerRef = useRef(null)

  const runScan = async (endpoint, body) => {
    setScanning(true)
    setResults([])
    setProgress({ status: 'scanning', total: 0, processed: 0, detected: 0 })

    try {
      const response = await fetch(`${API}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) throw new Error(`Server error: ${response.status}`)

      const reader = response.body.getReader()
      readerRef.current = reader
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            setProgress({
              status: data.status,
              total: data.total,
              processed: data.processed,
              detected: data.detected,
              current_file: data.current_file,
            })
            if (data.result) {
              setResults(prev => [...prev, data.result])
            }
            if (data.status === 'complete' || data.status === 'error') {
              setScanning(false)
            }
          } catch {
            // ignore malformed lines
          }
        }
      }
    } catch (err) {
      console.error('Scan failed:', err)
      setProgress(prev => prev ? { ...prev, status: 'error' } : null)
    } finally {
      setScanning(false)
    }
  }

  const startScan = () => {
    if (!folder.trim()) return
    runScan('/api/scan', { folder: folder.trim(), weeds: selectedWeeds })
  }

  const startDriveScan = () => {
    if (!driveFolder.trim()) return
    runScan('/api/scan-drive', { folder: driveFolder.trim(), weeds: selectedWeeds })
  }

  const cancelScan = () => {
    readerRef.current?.cancel()
    setScanning(false)
    setProgress(prev => prev ? { ...prev, status: 'cancelled' } : null)
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Purple Weed Detector</h1>
        <p>Scan photo folders for invasive purple weeds using Gemini Vision + OpenCV</p>
      </header>

      <main className="main">
        <FolderInput
          folder={folder}
          setFolder={setFolder}
          driveFolder={driveFolder}
          setDriveFolder={setDriveFolder}
          selectedWeeds={selectedWeeds}
          setSelectedWeeds={setSelectedWeeds}
          weedOptions={WEED_OPTIONS}
          onScan={startScan}
          onScanDrive={startDriveScan}
          onCancel={cancelScan}
          scanning={scanning}
        />

        {progress && <ScanProgress progress={progress} />}

        {results.length > 0 && (
          <PhotoGallery
            results={results}
            selected={selectedPhoto}
            onSelect={setSelectedPhoto}
            apiBase={API}
          />
        )}
      </main>

      {selectedPhoto && (
        <PhotoDetail
          photo={selectedPhoto}
          onClose={() => setSelectedPhoto(null)}
          apiBase={API}
        />
      )}
    </div>
  )
}
