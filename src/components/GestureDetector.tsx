import { useRef, useState } from 'react'
import { useGestureRecognizer } from '../hooks/useGestureRecognizer'
import { useCamera } from '../hooks/useCamera'
import { useFrameLoop } from '../hooks/useFrameLoop'
import { StatusScreen } from './StatusScreen'
import { VideoCanvas } from './VideoCanvas'
import { GestureSelect } from './GestureSelect'
import { GestureCounter } from './GestureCounter'
import { DetectionBadge } from './DetectionBadge'
import { type GestureName } from '../constants'

export function GestureDetector() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [selectedGesture, setSelectedGesture] = useState<GestureName>('Thumb_Up')

  const { recognizerRef, status: modelStatus, error: modelError } = useGestureRecognizer()
  const { status: cameraStatus, error: cameraError, start: startCamera } = useCamera(videoRef)
  const { detected, count, resetCount } = useFrameLoop(
    videoRef,
    canvasRef,
    recognizerRef,
    selectedGesture,
    cameraStatus === 'running',
  )

  const isRunning = cameraStatus === 'running'

  const screenStatus =
    modelStatus === 'loading' ? 'loading' :
    modelStatus === 'error' || cameraStatus === 'error' ? 'error' :
    isRunning ? null :
    'ready'

  const screenError = modelError || cameraError

  return (
    <div className="flex flex-col items-center gap-6 w-full">
      {screenStatus && (
        <StatusScreen
          status={screenStatus}
          error={screenError}
          onStart={startCamera}
        />
      )}

      <VideoCanvas
        videoRef={videoRef}
        canvasRef={canvasRef}
      />

      {isRunning && (
        <div className="flex flex-wrap gap-3 w-full max-w-2xl">
          <div className="flex flex-col gap-1.5 flex-1 min-w-44 bg-slate-800/60 border border-slate-700 rounded-xl px-5 py-4">
            <GestureSelect value={selectedGesture} onChange={setSelectedGesture} />
          </div>
          <GestureCounter count={count} onReset={resetCount} />
          <DetectionBadge detected={detected} target={selectedGesture} />
        </div>
      )}
    </div>
  )
}
