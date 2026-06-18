import { useRef, useState, useEffect } from 'react'
import { useGestureRecognizer } from '../hooks/useGestureRecognizer'
import { useCamera } from '../hooks/useCamera'
import { useKamehamehaLoop, type KamehamehaPhase } from '../hooks/useKamehamehaLoop'
import { StatusScreen } from './StatusScreen'
import { FullscreenButton } from './FullscreenButton'

const PHASE_LABELS: Record<KamehamehaPhase, string> = {
  IDLE:     'IDLE',
  CHARGING: 'CARICA...',
  FIRING:   'KA·ME·HA·ME·HA!',
  COOLDOWN: 'COOLDOWN',
}

const PHASE_COLORS: Record<KamehamehaPhase, string> = {
  IDLE:     'bg-black/60 text-white',
  CHARGING: 'bg-blue-600/80 text-white',
  FIRING:   'bg-yellow-300/90 text-slate-900 font-extrabold',
  COOLDOWN: 'bg-indigo-600/80 text-white',
}

const LEGEND = [
  { label: 'Carica',  desc: 'Porta le mani unite a coppa su un lato del corpo e tienile ferme' },
  { label: 'Lancia',  desc: 'Spingi entrambe le mani rapidamente in avanti verso la camera' },
  { label: 'Annulla', desc: 'Allontana le mani tra loro per interrompere la carica' },
]

export function Kamehameha() {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef     = useRef<HTMLVideoElement>(null)
  const lmCanvasRef  = useRef<HTMLCanvasElement>(null)
  const fxCanvasRef  = useRef<HTMLCanvasElement>(null)

  const { recognizerRef, status: modelStatus, error: modelError } = useGestureRecognizer()
  const { status: cameraStatus, error: cameraError, start: startCamera } = useCamera(videoRef)

  const isRunning = cameraStatus === 'running'

  const { phase, chargeLevel, handCount } = useKamehamehaLoop(
    videoRef,
    lmCanvasRef,
    fxCanvasRef,
    recognizerRef,
    isRunning,
  )

  // Trigger screen-shake CSS animation when FIRING starts
  const [shaking, setShaking] = useState(false)
  useEffect(() => {
    if (phase !== 'FIRING') return
    setShaking(true)
    const t = setTimeout(() => setShaking(false), 500)
    return () => clearTimeout(t)
  }, [phase])

  const screenStatus =
    modelStatus === 'loading'                               ? 'loading' :
    modelStatus === 'error' || cameraStatus === 'error'     ? 'error'   :
    isRunning                                               ? null       :
    'ready'

  const screenError = modelError || cameraError
  const chargePct   = Math.round(chargeLevel * 100)

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-4xl">
      {/* AR container — all layers stacked */}
      <div
        ref={containerRef}
        className={`relative w-full aspect-video rounded-xl overflow-hidden border border-slate-700 bg-black ${
          shaking ? 'animate-shake' : ''
        }`}
      >
        {/* Layer 1 – webcam feed */}
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover [transform:scaleX(-1)]"
          muted
          playsInline
        />

        {/* Layer 2 – hand landmark overlay */}
        <canvas
          ref={lmCanvasRef}
          className="absolute inset-0 w-full h-full [transform:scaleX(-1)] pointer-events-none"
        />

        {/* Layer 3 – energy effects (sphere + beam) */}
        <canvas
          ref={fxCanvasRef}
          className="absolute inset-0 w-full h-full [transform:scaleX(-1)] pointer-events-none"
        />

        {/* Fullscreen toggle */}
        <div className="absolute top-2 right-2 z-20">
          <FullscreenButton targetRef={containerRef} />
        </div>

        {/* Status overlay (loading / error / start button) */}
        {screenStatus && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/90 z-10">
            <StatusScreen status={screenStatus} error={screenError} onStart={startCamera} />
          </div>
        )}

        {/* HUD — visible only while camera is running */}
        {isRunning && (
          <>
            {/* Phase badge – top-left */}
            <div className="absolute top-3 left-3 z-20 pointer-events-none">
              <span className={`text-xs px-3 py-1.5 rounded-lg backdrop-blur-sm transition-all duration-150 ${PHASE_COLORS[phase]}`}>
                {PHASE_LABELS[phase]}
              </span>
            </div>

            {/* Bottom row: hand count + charge bar */}
            <div className="absolute bottom-3 left-3 right-12 flex items-center gap-3 z-20 pointer-events-none">
              <span className="bg-black/60 text-white text-xs px-2.5 py-1.5 rounded-lg backdrop-blur-sm whitespace-nowrap">
                {handCount} {handCount === 1 ? 'mano' : 'mani'}
              </span>

              {(phase === 'CHARGING' || phase === 'FIRING' || phase === 'COOLDOWN') && (
                <div className="flex-1 flex items-center gap-2">
                  <span className="bg-black/60 text-white text-xs px-2 py-1.5 rounded-lg backdrop-blur-sm whitespace-nowrap">
                    {chargePct}%
                  </span>
                  <div className="flex-1 bg-black/50 rounded-full h-2 overflow-hidden backdrop-blur-sm">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${chargePct}%`,
                        background: 'linear-gradient(90deg, #3b82f6, #93c5fd, #ffffff)',
                        boxShadow: '0 0 8px #60a5fa',
                        transition: 'width 0.1s linear',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Legend */}
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl px-5 py-4 w-full">
        <span className="text-xs uppercase tracking-widest text-slate-400 block mb-3">Istruzioni</span>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
