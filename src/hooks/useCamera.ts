import { useEffect, useRef, useState, useCallback } from 'react'

type CameraStatus = 'idle' | 'running' | 'error'

export function useCamera(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const streamRef = useRef<MediaStream | null>(null)
  const [status, setStatus] = useState<CameraStatus>('idle')
  const [error, setError] = useState('')

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' },
        audio: false,
      })
      streamRef.current = stream
      const video = videoRef.current!
      video.srcObject = stream
      await video.play()
      setStatus('running')
    } catch (e) {
      const msg =
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'Camera permission denied. Allow access and reload.'
          : e instanceof DOMException && e.name === 'NotFoundError'
          ? 'No camera found on this device.'
          : `Camera error: ${e}`
      setError(msg)
      setStatus('error')
    }
  }, [videoRef])

  // Stop stream on unmount.
  useEffect(() => {
    return () => streamRef.current?.getTracks().forEach(t => t.stop())
  }, [])

  return { status, error, start }
}
