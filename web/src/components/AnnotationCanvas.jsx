import { useRef, useState, useEffect } from 'react'

export const WEED_SPECIES = [
  { value: 'purple_loosestrife', label: 'Purple Loosestrife' },
  { value: 'thistle',            label: 'Thistle (Canada / Nodding)' },
  { value: 'dames_rocket',       label: "Dame's Rocket" },
  { value: 'unknown_purple',     label: 'Unknown Purple Weed' },
]

export default function AnnotationCanvas({ imgRef, imgBox, photo, annotating, onSave }) {
  const canvasRef = useRef(null)
  const [drag, setDrag]       = useState(null)   // live rubber-band rect
  const [pending, setPending] = useState(null)   // finished rect awaiting species
  const [species, setSpecies] = useState(WEED_SPECIES[0].value)

  // Resize canvas to match displayed image
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !imgBox) return
    canvas.width  = imgBox.w
    canvas.height = imgBox.h
  }, [imgBox])

  // Redraw rubber-band and confirmed-pending rect
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const drawRect = (r, dashed) => {
      ctx.strokeStyle = '#a855f7'
      ctx.lineWidth   = 2
      ctx.setLineDash(dashed ? [6, 3] : [])
      ctx.strokeRect(r.x, r.y, r.w, r.h)
      ctx.fillStyle = 'rgba(168,85,247,0.12)'
      ctx.fillRect(r.x, r.y, r.w, r.h)
    }

    if (drag) {
      drawRect({
        x: Math.min(drag.x0, drag.x1),
        y: Math.min(drag.y0, drag.y1),
        w: Math.abs(drag.x1 - drag.x0),
        h: Math.abs(drag.y1 - drag.y0),
      }, true)
    }
    if (pending) drawRect(pending, false)
  }, [drag, pending])

  const canvasXY = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onMouseDown = (e) => {
    if (!annotating || pending) return
    e.preventDefault()
    const { x, y } = canvasXY(e)
    setDrag({ x0: x, y0: y, x1: x, y1: y })
  }

  const onMouseMove = (e) => {
    if (!drag) return
    e.preventDefault()
    const { x, y } = canvasXY(e)
    setDrag(d => ({ ...d, x1: x, y1: y }))
  }

  const onMouseUp = (e) => {
    if (!drag) return
    e.preventDefault()
    const { x, y } = canvasXY(e)
    const rect = {
      x: Math.round(Math.min(drag.x0, x)),
      y: Math.round(Math.min(drag.y0, y)),
      w: Math.round(Math.abs(x - drag.x0)),
      h: Math.round(Math.abs(y - drag.y0)),
    }
    setDrag(null)
    if (rect.w < 10 || rect.h < 10) return  // too small — ignore
    setPending(rect)
  }

  const confirmAnnotation = () => {
    if (!pending || !imgRef.current || !imgBox || !photo.width || !photo.height) return

    // Convert display coords → native image pixel coords
    const sx = photo.width  / imgBox.w
    const sy = photo.height / imgBox.h
    const nativeRect = {
      x: Math.round(pending.x * sx),
      y: Math.round(pending.y * sy),
      w: Math.round(pending.w * sx),
      h: Math.round(pending.h * sy),
    }

    // Extract crop from the live <img> element
    const cropCanvas = document.createElement('canvas')
    cropCanvas.width  = nativeRect.w
    cropCanvas.height = nativeRect.h
    cropCanvas.getContext('2d').drawImage(
      imgRef.current,
      nativeRect.x, nativeRect.y, nativeRect.w, nativeRect.h,
      0, 0, nativeRect.w, nativeRect.h,
    )

    onSave({
      imageHash:   photo.hash,
      filename:    photo.filename,
      rect:        nativeRect,
      displayRect: pending,
      species,
      crop:        cropCanvas.toDataURL('image/jpeg', 0.85),
    })

    setPending(null)
    setSpecies(WEED_SPECIES[0].value)
  }

  const cancelPending = () => { setPending(null); setDrag(null) }

  // Clamp picker so it doesn't overflow the right edge
  const pickerLeft = pending
    ? Math.min(pending.x + pending.w + 8, (imgBox?.w ?? 400) - 220)
    : 0

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`annotation-canvas${annotating ? ' active' : ''}`}
        style={{ pointerEvents: annotating ? 'all' : 'none' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      />

      {pending && imgBox && (
        <div
          className="annotation-picker"
          style={{ left: pickerLeft, top: pending.y }}
          onClick={e => e.stopPropagation()}
        >
          <div className="annotation-picker-title">Identify species</div>
          <select
            className="annotation-species-select"
            value={species}
            onChange={e => setSpecies(e.target.value)}
            autoFocus
          >
            {WEED_SPECIES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <div className="annotation-picker-actions">
            <button className="btn-primary btn-sm" onClick={confirmAnnotation}>Save ID</button>
            <button className="btn-secondary btn-sm" onClick={cancelPending}>Cancel</button>
          </div>
        </div>
      )}
    </>
  )
}
