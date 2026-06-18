import { useEffect, useRef, useState } from 'react'
import { GestureRecognizer, DrawingUtils } from '@mediapipe/tasks-vision'

export type DetectedGesture = { name: string; score: number } | null
export type Landmark = { x: number; y: number; z: number }

export function useInspectorFrameLoop(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  recognizerRef: React.RefObject<GestureRecognizer | null>,
  active: boolean,
) {
  const gestureRef = useRef<{ name: string; score: number } | null>(null)
  const landmarkRef = useRef<Landmark[] | null>(null)
  const [detected, setDetected] = useState<DetectedGesture>(null)

  useEffect(() => {
    if (!active) {
      gestureRef.current = null
      landmarkRef.current = null
      return
    }

    const video = videoRef.current!
    const canvas = canvasRef.current!
    const recognizer = recognizerRef.current!
    const ctx = canvas.getContext('2d')!
    const drawingUtils = new DrawingUtils(ctx)
    let lastTs = -1
    let rafId = 0

    function loop() {
      if (video.readyState >= 2) {
        const ts = performance.now()
        if (ts > lastTs) {
          lastTs = ts

          if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth
          if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight
          ctx.clearRect(0, 0, canvas.width, canvas.height)

          const result = recognizer.recognizeForVideo(video, ts)

          for (const lm of result.landmarks ?? []) {
            drawingUtils.drawConnectors(lm, GestureRecognizer.HAND_CONNECTIONS, {
              color: '#00FF88',
              lineWidth: 2,
            })
            drawingUtils.drawLandmarks(lm, { color: '#FF3366', lineWidth: 1, radius: 5 })
          }

          const best = result.gestures?.[0]?.[0]
          const det: DetectedGesture =
            best && best.categoryName !== 'None'
              ? { name: best.categoryName, score: best.score }
              : null

          gestureRef.current = det
          landmarkRef.current = result.landmarks?.[0] ?? null
          setDetected(det)
        }
      }
      rafId = requestAnimationFrame(loop)
    }

    rafId = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(rafId)
      gestureRef.current = null
      landmarkRef.current = null
    }
  }, [active, videoRef, canvasRef, recognizerRef])

  return { gestureRef, landmarkRef, detected }
}
