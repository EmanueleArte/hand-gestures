import { useEffect, useRef, useState } from 'react'
import { GestureRecognizer, DrawingUtils } from '@mediapipe/tasks-vision'

export type DetectedGesture = { name: string; score: number } | null

export function useFrameLoop(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  recognizerRef: React.RefObject<GestureRecognizer | null>,
  selectedGesture: string,
  active: boolean,
) {
  const rafRef = useRef(0)
  const prevMatchRef = useRef(false)
  const selectedRef = useRef(selectedGesture)

  const [detected, setDetected] = useState<DetectedGesture>(null)
  const [count, setCount] = useState(0)

  // Keep selectedRef current; reset edge state when target changes.
  useEffect(() => {
    selectedRef.current = selectedGesture
    prevMatchRef.current = false
  }, [selectedGesture])

  useEffect(() => {
    if (!active) return

    const video = videoRef.current!
    const canvas = canvasRef.current!
    const recognizer = recognizerRef.current!
    const ctx = canvas.getContext('2d')!
    const drawingUtils = new DrawingUtils(ctx)
    let lastTs = -1

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

          setDetected(det)

          // Rising-edge: increment only on false → true transition.
          const isMatch = det?.name === selectedRef.current
          if (isMatch && !prevMatchRef.current) setCount(c => c + 1)
          prevMatchRef.current = isMatch
        }
      }
      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [active, videoRef, canvasRef, recognizerRef])

  const resetCount = () => setCount(0)

  return { detected, count, resetCount }
}
