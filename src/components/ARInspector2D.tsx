import { useRef, useState, useEffect, useCallback } from 'react'
import { useGestureRecognizer } from '../hooks/useGestureRecognizer'
import { useCamera } from '../hooks/useCamera'
import { useARFrameLoop, type HandsData } from '../hooks/useARFrameLoop'
import { StatusScreen } from './StatusScreen'

const PINCH_START = 0.07
const PINCH_END   = 0.22

// Grab radius as fraction of container width
const GRAB_RADIUS_FRAC = 0.13

// Scale change per normalized two-pinch distance delta
const SCALE_SPEED = 1.5

const MIN_SCALE = 0.1
const MAX_SCALE = 10

const LEGEND = [
  { label: 'Grab & Move', desc: 'Pinch near image → drag' },
  { label: 'Zoom',        desc: 'Pinch both hands, spread or close' },
  { label: 'Reset',       desc: 'Victory gesture (✌)' },
]

const ACCEPT = '.png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml'

function pinchDist(lms: HandsData[number]) {
  return Math.hypot(lms[4].x - lms[8].x, lms[4].y - lms[8].y)
}

function pinchCenter(lms: HandsData[number]) {
  return { x: (lms[4].x + lms[8].x) / 2, y: (lms[4].y + lms[8].y) / 2 }
}

function lmToPixels(lm: { x: number; y: number }, w: number, h: number) {
  return { x: (1 - lm.x) * w, y: lm.y * h }
}

export function ARInspector2D() {
  const videoRef     = useRef<HTMLVideoElement>(null)
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const imgRef       = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [grabbed,    setGrabbed]    = useState(false)
  const [isZooming,  setIsZooming]  = useState(false)
  const [imageUrl,   setImageUrl]   = useState<string | null>(null)
  const [imageName,  setImageName]  = useState('')

  const { recognizerRef, status: modelStatus, error: modelError } = useGestureRecognizer()
  const { status: cameraStatus, error: cameraError, start: startCamera } = useCamera(videoRef)
  const { handsRef, gesturesRef, handCount } = useARFrameLoop(
    videoRef, canvasRef, recognizerRef, cameraStatus === 'running',
  )

  const isRunning = cameraStatus === 'running'

  // Target transform (driven by gestures)
  const targetPos   = useRef({ x: 0, y: 0 })
  const targetScale = useRef(1)

  // Current (lerped) transform applied to DOM
  const currentPos   = useRef({ x: 0, y: 0 })
  const currentScale = useRef(1)

  // One-hand grab state
  const isGrabbing  = useRef(false)
  const grabOffset  = useRef({ x: 0, y: 0 })
  const isPinch1H   = useRef(false)
  const wasGrabbing = useRef(false)

  // Two-hand zoom state
  const isPinch2H_0  = useRef(false)
  const isPinch2H_1  = useRef(false)
  const prevZoomDist = useRef<number | null>(null)
  const wasZooming   = useRef(false)

  useEffect(() => {
    if (!isRunning) return

    let rafId: number
    let lastTime = performance.now()

    function loop() {
      const now   = performance.now()
      const delta = Math.min((now - lastTime) / 1000, 0.1)
      lastTime    = now

      const hands    = handsRef.current
      const gestures = gesturesRef.current
      const container = containerRef.current
      const img       = imgRef.current

      if (!container || !img) { rafId = requestAnimationFrame(loop); return }

      const w = container.clientWidth
      const h = container.clientHeight
      const cx = w / 2
      const cy = h / 2

      // ── Victory → reset ──────────────────────────────────────────────────
      if (gestures.some(g => g === 'Victory')) {
        targetPos.current   = { x: 0, y: 0 }
        targetScale.current = 1
        isGrabbing.current  = false
        isPinch1H.current   = false
        isPinch2H_0.current = false
        isPinch2H_1.current = false
        prevZoomDist.current = null
        if (wasGrabbing.current) { setGrabbed(false);   wasGrabbing.current = false }
        if (wasZooming.current)  { setIsZooming(false); wasZooming.current  = false }
      } else {

        // ── Two-hand zoom ────────────────────────────────────────────────────
        if (hands.length >= 2) {
          isPinch1H.current = false
          if (isGrabbing.current) {
            isGrabbing.current = false
            if (wasGrabbing.current) { setGrabbed(false); wasGrabbing.current = false }
          }

          const pd0 = pinchDist(hands[0])
          const pd1 = pinchDist(hands[1])

          if (!isPinch2H_0.current && pd0 < PINCH_START) isPinch2H_0.current = true
          else if (isPinch2H_0.current && pd0 > PINCH_END) isPinch2H_0.current = false

          if (!isPinch2H_1.current && pd1 < PINCH_START) isPinch2H_1.current = true
          else if (isPinch2H_1.current && pd1 > PINCH_END) isPinch2H_1.current = false

          if (isPinch2H_0.current && isPinch2H_1.current) {
            const c0 = lmToPixels(pinchCenter(hands[0]), w, h)
            const c1 = lmToPixels(pinchCenter(hands[1]), w, h)
            // Normalize by diagonal so SCALE_SPEED matches 3D feel
            const diag    = Math.hypot(w, h)
            const relDist = Math.hypot(c0.x - c1.x, c0.y - c1.y) / diag

            if (prevZoomDist.current !== null) {
              const dd = relDist - prevZoomDist.current
              targetScale.current = Math.max(MIN_SCALE,
                Math.min(MAX_SCALE, targetScale.current + dd * SCALE_SPEED))
            }
            prevZoomDist.current = relDist

            if (!wasZooming.current) { setIsZooming(true); wasZooming.current = true }
          } else {
            prevZoomDist.current = null
            if (wasZooming.current) { setIsZooming(false); wasZooming.current = false }
          }
        } else {
          isPinch2H_0.current  = false
          isPinch2H_1.current  = false
          prevZoomDist.current = null
          if (wasZooming.current) { setIsZooming(false); wasZooming.current = false }
        }

        // ── One-hand grab + move ─────────────────────────────────────────────
        if (hands.length === 1) {
          const lms = hands[0]
          const pd  = pinchDist(lms)

          if (!isPinch1H.current && pd < PINCH_START) isPinch1H.current = true
          else if (isPinch1H.current && pd > PINCH_END) isPinch1H.current = false

          if (isPinch1H.current) {
            const pc      = pinchCenter(lms)
            const pinchPx = lmToPixels(pc, w, h)
            const imgCx   = cx + targetPos.current.x
            const imgCy   = cy + targetPos.current.y

            if (!isGrabbing.current) {
              const d = Math.hypot(pinchPx.x - imgCx, pinchPx.y - imgCy)
              if (d < w * GRAB_RADIUS_FRAC) {
                isGrabbing.current = true
                grabOffset.current = { x: imgCx - pinchPx.x, y: imgCy - pinchPx.y }
                setGrabbed(true)
                wasGrabbing.current = true
              }
            }

            if (isGrabbing.current) {
              targetPos.current.x = pinchPx.x + grabOffset.current.x - cx
              targetPos.current.y = pinchPx.y + grabOffset.current.y - cy
            }
          } else if (isGrabbing.current) {
            isGrabbing.current = false
            if (wasGrabbing.current) { setGrabbed(false); wasGrabbing.current = false }
          }
        } else if (hands.length === 0 && isGrabbing.current) {
          isGrabbing.current = false
          isPinch1H.current  = false
          if (wasGrabbing.current) { setGrabbed(false); wasGrabbing.current = false }
        }
      }

      // ── Lerp current toward target ───────────────────────────────────────
      const lerp = isGrabbing.current ? 0.35 : 0.15
      const t    = 1 - Math.pow(1 - lerp, delta * 60)

      currentPos.current.x   += (targetPos.current.x   - currentPos.current.x)   * t
      currentPos.current.y   += (targetPos.current.y   - currentPos.current.y)   * t
      currentScale.current   += (targetScale.current   - currentScale.current)   * t

      img.style.top       = `calc(50% + ${currentPos.current.y}px)`
      img.style.left      = `calc(50% + ${currentPos.current.x}px)`
      img.style.transform = `translate(-50%, -50%) scale(${currentScale.current})`

      rafId = requestAnimationFrame(loop)
    }

    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [isRunning, handsRef, gesturesRef])

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file) })
    setImageName(file.name)
    targetPos.current   = { x: 0, y: 0 }
    targetScale.current = 1
    currentPos.current  = { x: 0, y: 0 }
    currentScale.current = 1
  }, [])

  const screenStatus =
    modelStatus === 'loading' ? 'loading' :
    modelStatus === 'error' || cameraStatus === 'error' ? 'error' :
    isRunning ? null :
    'ready'

  const screenError = modelError || cameraError

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-4xl">

      {/* File loader */}
      <div className="flex items-center gap-3 w-full">
        <label className="cursor-pointer flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          Load Image
          <input type="file" accept={ACCEPT} onChange={handleFile} className="hidden" />
        </label>
        {imageName && (
          <span className="text-slate-400 text-sm truncate max-w-xs">{imageName}</span>
        )}
      </div>

      {/* AR view */}
      <div
        ref={containerRef}
        className="relative w-full aspect-video rounded-xl overflow-hidden border border-slate-700 bg-black"
      >
        {/* Layer 1 – webcam */}
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover [transform:scaleX(-1)]"
          muted
          playsInline
        />

        {/* Layer 2 – landmark canvas */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full [transform:scaleX(-1)] pointer-events-none"
        />

        {/* Layer 3 – 2D image */}
        {imageUrl && (
          <img
            ref={imgRef}
            src={imageUrl}
            alt="2D object"
            className="absolute pointer-events-none select-none"
            style={{
              top: '50%',
              left: '50%',
              maxWidth: '40%',
              maxHeight: '40%',
              transform: 'translate(-50%, -50%)',
              transformOrigin: 'center center',
            }}
          />
        )}

        {!imageUrl && isRunning && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-slate-500 text-sm">Load an image to inspect</span>
          </div>
        )}

        {/* Status overlay */}
        {screenStatus && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/90 z-10">
            <StatusScreen status={screenStatus} error={screenError} onStart={startCamera} />
          </div>
        )}

        {/* Running indicators */}
        {isRunning && (
          <div className="absolute bottom-3 left-3 flex gap-2 z-20 pointer-events-none">
            <span className="bg-black/60 text-white text-xs px-2.5 py-1.5 rounded-lg backdrop-blur-sm">
              {handCount} {handCount === 1 ? 'hand' : 'hands'}
            </span>
            <span className={`text-white text-xs px-2.5 py-1.5 rounded-lg backdrop-blur-sm transition-colors ${
              grabbed ? 'bg-violet-600/80' : 'bg-black/60'
            }`}>
              {grabbed ? 'Grabbed' : 'Free'}
            </span>
            {isZooming && (
              <span className="bg-indigo-600/80 text-white text-xs px-2.5 py-1.5 rounded-lg backdrop-blur-sm">
                Zooming
              </span>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl px-5 py-4 w-full">
        <span className="text-xs uppercase tracking-widest text-slate-400 block mb-3">Controls</span>
        <div className="grid grid-cols-3 gap-3">
          {LEGEND.map(({ label, desc }) => (
            <div key={label} className="rounded-lg px-3 py-2.5 border border-slate-700 bg-slate-900/50">
              <div className="font-semibold text-sm text-slate-100">{label}</div>
              <div className="text-xs text-slate-500 mt-0.5">{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
