import { useEffect, useRef, useState } from 'react'
import { GestureRecognizer, FilesetResolver } from '@mediapipe/tasks-vision'
import { WASM_CDN, MODEL_URL } from '../constants'

type ModelStatus = 'loading' | 'ready' | 'error'

export function useGestureRecognizer() {
  const recognizerRef = useRef<GestureRecognizer | null>(null)
  const [status, setStatus] = useState<ModelStatus>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_CDN)
        const recognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 2,
        })
        if (active) {
          recognizerRef.current = recognizer
          setStatus('ready')
        }
      } catch (e) {
        if (active) {
          setError(`Model load failed: ${e}`)
          setStatus('error')
        }
      }
    }

    void load()
    return () => { active = false }
  }, [])

  return { recognizerRef, status, error }
}
