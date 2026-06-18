import { useEffect, useRef, useState } from 'react'
import { GestureRecognizer, DrawingUtils } from '@mediapipe/tasks-vision'
import type { Landmark } from './useInspectorFrameLoop'

export type HandsData = Landmark[][]

export function useARFrameLoop(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  recognizerRef: React.RefObject<GestureRecognizer | null>,
  active: boolean,
) {
  const handsRef    = useRef<HandsData>([])
  const gesturesRef = useRef<string[]>([])
  const [handCount, setHandCount] = useState(0)

  useEffect(() => {
    if (!active) {
      handsRef.current = []
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

          handsRef.current    = result.landmarks ?? []
          gesturesRef.current = (result.gestures ?? []).map(g => g[0]?.categoryName ?? 'None')
          setHandCount(result.landmarks?.length ?? 0)
        }
      }
      rafId = requestAnimationFrame(loop)
    }

    rafId = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(rafId)
      handsRef.current = []
    }
  }, [active, videoRef, canvasRef, recognizerRef])

  return { handsRef, gesturesRef, handCount }
}
