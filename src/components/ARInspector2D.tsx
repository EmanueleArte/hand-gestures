import { useRef, useState, useEffect, useCallback } from 'react'
import { useGestureRecognizer } from '../hooks/useGestureRecognizer'
import { useCamera } from '../hooks/useCamera'
import { useARFrameLoop, type HandsData } from '../hooks/useARFrameLoop'
import { StatusScreen } from './StatusScreen'
import { loadPdfPages } from '../lib/pdfLoader'
import { loadPptxSlides } from '../lib/pptxLoader'

const PINCH_START = 0.07
const PINCH_END   = 0.1

const GRAB_RADIUS_FRAC     = 0.13
const SCALE_SPEED          = 1.5
const MIN_SCALE            = 0.1
const MAX_SCALE            = 10
const GESTURE_NAV_COOLDOWN = 1200  // ms between gesture-triggered page changes
const TAP_MAX_DURATION     = 350   // ms: pinch shorter than this = tap, not grab
const TAP_HIT_PAD          = 18    // px padding around button hit area

const ACCEPT = '.png,.jpg,.jpeg,.svg,.pdf,.pptx'

const LEGEND = [
  { label: 'Grab & Move', desc: 'Pinch near image → drag' },
  { label: 'Zoom',        desc: 'Pinch both hands, spread or close' },
  { label: 'Reset',       desc: 'Victory gesture (✌)' },
]

function pinchDist(lms: HandsData[number]) {
  return Math.hypot(lms[4].x - lms[8].x, lms[4].y - lms[8].y)
}
function pinchCenter(lms: HandsData[number]) {
  return { x: (lms[4].x + lms[8].x) / 2, y: (lms[4].y + lms[8].y) / 2 }
}
function lmToPixels(lm: { x: number; y: number }, w: number, h: number) {
  return { x: (1 - lm.x) * w, y: lm.y * h }
}

type NavMode = 'buttons' | 'gesture'

export function ARInspector2D() {
  const videoRef     = useRef<HTMLVideoElement>(null)
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const imgRef       = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const navBtnsRef   = useRef<HTMLDivElement>(null)
  const prevBtnRef   = useRef<HTMLButtonElement>(null)
  const nextBtnRef   = useRef<HTMLButtonElement>(null)

  const [grabbed,     setGrabbed]     = useState(false)
  const [isZooming,   setIsZooming]   = useState(false)
  const [imageUrl,    setImageUrl]    = useState<string | null>(null)
  const [imageName,   setImageName]   = useState('')
  const [pages,       setPages]       = useState<string[]>([])
  const [currentPage, setCurrentPage] = useState(0)
  const [docLoading,  setDocLoading]  = useState(false)
  const [docError,    setDocError]    = useState<string | null>(null)
  const [navMode,     setNavMode]     = useState<NavMode>('buttons')

  const isBlobUrl      = useRef(false)
  const pagesRef       = useRef<string[]>([])
  const currentPageRef = useRef(0)
  const navModeRef     = useRef<NavMode>('buttons')
  const lastPageChange = useRef(0)
  const prevGestureNav = useRef<string[]>([])
  // Pinch tap detection: tracks start time; nulled when grab activates
  const tapState       = useRef<{ startTime: number } | null>(null)

  // Keep refs in sync with state
  navModeRef.current = navMode

  const { recognizerRef, status: modelStatus, error: modelError } = useGestureRecognizer()
  const { status: cameraStatus, error: cameraError, start: startCamera } = useCamera(videoRef)
  const { handsRef, gesturesRef, handCount } = useARFrameLoop(
    videoRef, canvasRef, recognizerRef, cameraStatus === 'running',
  )

  const isRunning = cameraStatus === 'running'

  const targetPos   = useRef({ x: 0, y: 0 })
  const targetScale = useRef(1)
  const currentPos  = useRef({ x: 0, y: 0 })
  const currentScl  = useRef(1)

  const isGrabbing  = useRef(false)
  const grabOffset  = useRef({ x: 0, y: 0 })
  const isPinch1H   = useRef(false)
  const wasGrabbing = useRef(false)

  const isPinch2H    = useRef(false)   // true only when BOTH hands pinch simultaneously
  const prevZoomDist = useRef<number | null>(null)
  const wasZooming   = useRef(false)

  function resetTransform() {
    targetPos.current   = { x: 0, y: 0 }
    targetScale.current = 1
    currentPos.current  = { x: 0, y: 0 }
    currentScl.current  = 1
  }

  // Navigate to a page using refs (safe to call from RAF)
  const goToPageDirect = useCallback((index: number) => {
    const ps = pagesRef.current
    if (index < 0 || index >= ps.length) return
    setCurrentPage(index)
    setImageUrl(ps[index])
    currentPageRef.current = index
  }, [])

  // Navigate using state (for bottom bar buttons)
  const goToPage = useCallback((index: number) => {
    if (index < 0 || index >= pages.length) return
    setCurrentPage(index)
    setImageUrl(pages[index])
    currentPageRef.current = index
  }, [pages])

  useEffect(() => {
    if (!isRunning) return

    let rafId: number
    let lastTime = performance.now()

    function flashButton(btn: HTMLButtonElement | null) {
      if (!btn) return
      // Animated press-in
      btn.style.transition = 'transform 0.12s ease-in, background-color 0.12s ease-in'
      btn.style.transform = 'scale(0.9)'
      btn.style.backgroundColor = 'rgba(255,255,255,0.4)'
      // Spring-back after press completes
      setTimeout(() => {
        btn.style.transition = 'transform 0.22s cubic-bezier(0.34,1.56,0.64,1), background-color 0.18s ease-out'
        btn.style.transform = ''
        btn.style.backgroundColor = ''
      }, 160)
    }

    function loop() {
      const now   = performance.now()
      const delta = Math.min((now - lastTime) / 1000, 0.1)
      lastTime    = now

      const hands    = handsRef.current
      const gestures = gesturesRef.current
      const container = containerRef.current
      const img       = imgRef.current
      if (!container || !img) { rafId = requestAnimationFrame(loop); return }

      const w  = container.clientWidth
      const h  = container.clientHeight
      const cx = w / 2
      const cy = h / 2

      // ── Victory → reset ─────────────────────────────────────────────────
      if (gestures.some(g => g === 'Victory')) {
        targetPos.current   = { x: 0, y: 0 }
        targetScale.current = 1
        isGrabbing.current   = false
        isPinch1H.current    = false
        isPinch2H.current    = false
        prevZoomDist.current = null
        if (wasGrabbing.current) { setGrabbed(false);   wasGrabbing.current = false }
        if (wasZooming.current)  { setIsZooming(false); wasZooming.current  = false }
      } else {

        // ── Two-hand zoom ──────────────────────────────────────────────────
        if (hands.length >= 2) {
          isPinch1H.current = false
          if (isGrabbing.current) {
            isGrabbing.current = false
            if (wasGrabbing.current) { setGrabbed(false); wasGrabbing.current = false }
          }

          const pd0 = pinchDist(hands[0])
          const pd1 = pinchDist(hands[1])

          // Activate only when BOTH hands pinch simultaneously;
          // deactivate as soon as EITHER hand opens
          if (!isPinch2H.current && pd0 < PINCH_START && pd1 < PINCH_START)
            isPinch2H.current = true
          else if (isPinch2H.current && (pd0 > PINCH_END || pd1 > PINCH_END))
            isPinch2H.current = false

          if (isPinch2H.current) {
            const c0 = lmToPixels(pinchCenter(hands[0]), w, h)
            const c1 = lmToPixels(pinchCenter(hands[1]), w, h)
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
          isPinch2H.current    = false
          prevZoomDist.current = null
          if (wasZooming.current) { setIsZooming(false); wasZooming.current = false }
        }

        // ── One-hand grab + move (with pinch-tap detection) ───────────────
        if (hands.length === 1) {
          const lms = hands[0]
          const pd  = pinchDist(lms)

          if (!isPinch1H.current && pd < PINCH_START) {
            isPinch1H.current = true
            tapState.current  = { startTime: now }
          } else if (isPinch1H.current && pd > PINCH_END) {
            isPinch1H.current = false
            // Pinch released — check for short tap on nav buttons
            if (tapState.current && !isGrabbing.current) {
              const dur = now - tapState.current.startTime
              if (dur < TAP_MAX_DURATION && navModeRef.current === 'buttons') {
                const releasePx = lmToPixels(pinchCenter(lms), w, h)
                const cRect = container.getBoundingClientRect()
                const hitTest = (el: HTMLButtonElement | null) => {
                  if (!el) return false
                  const r = el.getBoundingClientRect()
                  return (
                    releasePx.x >= r.left - cRect.left - TAP_HIT_PAD &&
                    releasePx.x <= r.left - cRect.left + r.width  + TAP_HIT_PAD &&
                    releasePx.y >= r.top  - cRect.top  - TAP_HIT_PAD &&
                    releasePx.y <= r.top  - cRect.top  + r.height + TAP_HIT_PAD
                  )
                }
                if (hitTest(prevBtnRef.current) && currentPageRef.current > 0) {
                  flashButton(prevBtnRef.current)
                  goToPageDirect(currentPageRef.current - 1)
                } else if (hitTest(nextBtnRef.current) && currentPageRef.current < pagesRef.current.length - 1) {
                  flashButton(nextBtnRef.current)
                  goToPageDirect(currentPageRef.current + 1)
                }
              }
            }
            tapState.current = null
          }

          if (isPinch1H.current) {
            const pinchPx = lmToPixels(pinchCenter(lms), w, h)
            const imgCx   = cx + targetPos.current.x
            const imgCy   = cy + targetPos.current.y

            if (!isGrabbing.current) {
              const d = Math.hypot(pinchPx.x - imgCx, pinchPx.y - imgCy)
              if (d < w * GRAB_RADIUS_FRAC) {
                isGrabbing.current = true
                grabOffset.current = { x: imgCx - pinchPx.x, y: imgCy - pinchPx.y }
                tapState.current   = null   // became a grab, not a tap
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

        // ── Gesture page navigation ────────────────────────────────────────
        if (navModeRef.current === 'gesture' && pagesRef.current.length > 1) {
          const prev = prevGestureNav.current
          const thumbUpNew   = gestures.some(g => g === 'Thumb_Up')   && !prev.some(g => g === 'Thumb_Up')
          const thumbDownNew = gestures.some(g => g === 'Thumb_Down') && !prev.some(g => g === 'Thumb_Down')

          if ((thumbUpNew || thumbDownNew) && now - lastPageChange.current > GESTURE_NAV_COOLDOWN) {
            if (thumbUpNew)   goToPageDirect(currentPageRef.current + 1)
            if (thumbDownNew) goToPageDirect(currentPageRef.current - 1)
            lastPageChange.current = now
          }
          prevGestureNav.current = gestures
        }
      }

      // ── Lerp current toward target ─────────────────────────────────────
      const lerp = isGrabbing.current ? 0.35 : 0.15
      const t    = 1 - Math.pow(1 - lerp, delta * 60)

      currentPos.current.x += (targetPos.current.x - currentPos.current.x) * t
      currentPos.current.y += (targetPos.current.y - currentPos.current.y) * t
      currentScl.current   += (targetScale.current  - currentScl.current)  * t

      img.style.top       = `calc(50% + ${currentPos.current.y}px)`
      img.style.left      = `calc(50% + ${currentPos.current.x}px)`
      img.style.transform = `translate(-50%, -50%) scale(${currentScl.current})`

      // ── Floating nav buttons: follow bottom edge of image ───────────────
      const navBtns = navBtnsRef.current
      if (navBtns) {
        const imgRect = img.getBoundingClientRect()
        const cRect   = container.getBoundingClientRect()
        navBtns.style.left = `${imgRect.left - cRect.left + imgRect.width / 2}px`
        navBtns.style.top  = `${imgRect.bottom - cRect.top + 8}px`
      }

      rafId = requestAnimationFrame(loop)
    }

    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [isRunning, handsRef, gesturesRef, goToPageDirect])

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImageUrl(prev => { if (prev && isBlobUrl.current) URL.revokeObjectURL(prev); return null })
    isBlobUrl.current = false
    pagesRef.current  = []
    currentPageRef.current = 0
    setPages([])
    setCurrentPage(0)
    setDocError(null)
    setImageName(file.name)
    resetTransform()

    const ext = file.name.split('.').pop()?.toLowerCase()

    if (ext === 'pdf') {
      setDocLoading(true)
      try {
        const urls = await loadPdfPages(file)
        pagesRef.current = urls
        setPages(urls)
        setCurrentPage(0)
        setImageUrl(urls[0] ?? null)
      } catch (err) {
        setDocError(err instanceof Error ? err.message : 'Failed to load PDF')
      } finally {
        setDocLoading(false)
      }
    } else if (ext === 'pptx') {
      setDocLoading(true)
      try {
        const urls = await loadPptxSlides(file)
        pagesRef.current = urls
        setPages(urls)
        setCurrentPage(0)
        setImageUrl(urls[0] ?? null)
      } catch (err) {
        setDocError(err instanceof Error ? err.message : 'Failed to load PPTX')
      } finally {
        setDocLoading(false)
      }
    } else {
      isBlobUrl.current = true
      setImageUrl(URL.createObjectURL(file))
    }
  }, [])

  const screenStatus =
    modelStatus === 'loading' ? 'loading' :
    modelStatus === 'error' || cameraStatus === 'error' ? 'error' :
    isRunning ? null :
    'ready'

  const screenError   = modelError || cameraError
  const isMultiPage   = pages.length > 1

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-4xl">

      {/* File loader row */}
      <div className="flex items-center gap-3 w-full flex-wrap">
        <label className="cursor-pointer flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          Load File
          <input type="file" accept={ACCEPT} onChange={handleFile} className="hidden" />
        </label>
        {imageName && (
          <span className="text-slate-400 text-sm truncate max-w-xs">{imageName}</span>
        )}
        {docError && (
          <span className="text-red-400 text-sm">{docError}</span>
        )}

        {/* Nav mode toggle — only shown for multi-page documents */}
        {isMultiPage && (
          <div className="ml-auto flex items-center gap-1">
            <span className="text-xs text-slate-500 mr-1">Nav:</span>
            <button
              onClick={() => setNavMode('buttons')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                navMode === 'buttons'
                  ? 'bg-violet-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              Floating Buttons
            </button>
            <button
              onClick={() => setNavMode('gesture')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                navMode === 'gesture'
                  ? 'bg-violet-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              Gesture
            </button>
          </div>
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

        {/* Layer 3 – 2D image / slide */}
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

        {!imageUrl && isRunning && !docLoading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-slate-500 text-sm">Load a file to inspect</span>
          </div>
        )}

        {/* Floating nav buttons — position via RAF, pinch-tap only (no mouse) */}
        <div
          ref={navBtnsRef}
          className="absolute z-20 pointer-events-none"
          style={{
            display: isMultiPage && navMode === 'buttons' && !!imageUrl ? 'block' : 'none',
            transform: 'translateX(-50%)',
          }}
        >
          <div className="flex items-center gap-2 bg-black/75 backdrop-blur-sm rounded-full px-3 py-2 border border-white/10">
            <button
              ref={prevBtnRef}
              disabled={currentPage === 0}
              className="w-12 h-12 rounded-full flex items-center justify-center disabled:opacity-30 text-white text-3xl leading-none select-none"
            >
              <img className="invert brightness-200 h-6" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAB4AAAAeCAYAAAA7MK6iAAAACXBIWXMAAAsTAAALEwEAmpwYAAAA6UlEQVR4nO3WwQoBURTG8X9KVnZKWVl4ABtLKytbNrwDXsJ4CCteYR6AbJSRZ1CUleykRGg0U9NpLM+5lK/u5m5+3du55x7450eSBwLgGa25BZoB/AQaro0FPBLoCahoo23gkUBvQEMbrQJncdqeNloE9gKdaKNZYCHQJZDThscC3UU3oJqBQC9ATRttRFUbo2E1d7TRMnAUpx1ikLVA/ahjqSdwBZdTrtrDKHXgKoqra4X3XTynTw3kAJQwSNZVywxTALYCn2KUasq3GNaASVpiELgDTSvcczH6OB324vF2lYBn791/vikvhQ9rMP7mWfoAAAAASUVORK5CYII=" alt="chevron-left" />
            </button>
            <span className="text-white text-sm tabular-nums min-w-[3.5rem] text-center select-none font-medium">
              {currentPage + 1} / {pages.length}
            </span>
            <button
              ref={nextBtnRef}
              disabled={currentPage === pages.length - 1}
              className="w-12 h-12 rounded-full flex items-center justify-center disabled:opacity-30 text-white text-3xl leading-none select-none"
            >
              <img className="invert brightness-200 h-6" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAB4AAAAeCAYAAAA7MK6iAAAACXBIWXMAAAsTAAALEwEAmpwYAAAA3klEQVR4nO3WMQrCQBCF4Z+AWNkJgpWFB7DQ0iqVrTZ6B/USxkOk0it4AIONoOAZBAUrsRNBFCOBFZbBTjKRJQ+2/phldnYgz58lAmJztkBJC95ZcHIWgKcB14CzwAOU0gbuFvwCBlr4SFR9A1paeCjwE1DVgAvASuBroKiBl4G9wOcopQFcBZ70gEq6prs/8BPoaOGBqPoC1DVgz0yyWIxVd+FpFlfdE831APwsntMwbbQCHAU6c3ZkhgI9mBtINeMv32IzbdQ3XWsvAv0sVp8JLi97SwvdaK63efg1bx9lay4TR1IYAAAAAElFTkSuQmCC" alt="chevron-right" />
            </button>
          </div>
        </div>

        {/* Gesture nav hint badge */}
        {isMultiPage && navMode === 'gesture' && isRunning && (
          <div className="absolute top-3 right-3 z-20 pointer-events-none">
            <span className="bg-black/60 text-white text-xs px-2.5 py-1.5 rounded-lg backdrop-blur-sm">
              Thumb Up / Down = page
            </span>
          </div>
        )}

        {/* Document processing overlay */}
        {docLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 z-30">
            <span className="text-slate-300 text-sm animate-pulse">Processing document…</span>
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

      {/* Bottom page bar — always visible for multi-page */}
      {isMultiPage && (
        <div className="flex items-center justify-center gap-4 bg-slate-800/60 border border-slate-700 rounded-xl px-5 py-3 w-full">
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 0}
            className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-medium transition-colors"
          >
            ← Prev
          </button>
          <span className="text-sm text-slate-300 tabular-nums">
            {currentPage + 1} / {pages.length}
          </span>
          <button
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === pages.length - 1}
            className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed text-sm font-medium transition-colors"
          >
            Next →
          </button>
        </div>
      )}

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
