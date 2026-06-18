import { useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { useGestureRecognizer } from '../hooks/useGestureRecognizer'
import { useCamera } from '../hooks/useCamera'
import {
  useInspectorFrameLoop,
  type DetectedGesture,
  type Landmark,
} from '../hooks/useInspectorFrameLoop'
import { VideoCanvas } from './VideoCanvas'
import { StatusScreen } from './StatusScreen'

const LERP = 0.12
const MOVE_SCALE = 3.5
const ROT_SPEED = 6
// Pinch: normalized 2-D distance between thumb tip (lm 4) and index tip (lm 8).
// Hysteresis: activate below START, release only above END so spreading fingers
// (zoom-in gesture) doesn't immediately deactivate pinch mode.
const PINCH_START = 0.07
const PINCH_END = 0.22
const PINCH_ZOOM_SPEED = 12
const MIN_SCALE = 0.2
const MAX_SCALE = 4

const GESTURE_CONTROLS = [
  { gesture: 'Closed_Fist', action: 'Rotate', description: 'Drag hand → rotation' },
  { gesture: 'Open_Palm',   action: 'Move',   description: 'Tracks wrist X/Y' },
  { gesture: 'Pinch',       action: 'Zoom',   description: 'Pinch/spread thumb-index' },
  { gesture: 'Victory',     action: 'Reset',  description: 'Reset pos / rot / scale' },
] as const

type GestureKey = (typeof GESTURE_CONTROLS)[number]['gesture']

type CubeProps = {
  gestureRef: React.MutableRefObject<DetectedGesture>
  landmarkRef: React.MutableRefObject<Landmark[] | null>
  onPinchChange: (pinching: boolean) => void
}

function InspectorCube({ gestureRef, landmarkRef, onPinchChange }: CubeProps) {
  const groupRef = useRef<THREE.Group>(null)
  const targetPos = useRef(new THREE.Vector3(0, 0, 0))
  const targetRot = useRef({ x: 0, y: 0 })
  const targetScale = useRef(1)
  const prevWrist = useRef<{ x: number; y: number } | null>(null)
  const prevPinchDist = useRef<number | null>(null)
  const isPinchActive = useRef(false)
  const wasPinching = useRef(false)

  useFrame((_, delta) => {
    const group = groupRef.current
    if (!group) return

    const gesture = gestureRef.current
    const landmarks = landmarkRef.current
    const wrist = landmarks?.[0]

    // --- Pinch zoom (landmark-based) ---
    // Disabled when Closed_Fist is active to avoid false positives (fist ≈ small thumb-index dist).
    const thumbTip = landmarks?.[4]
    const indexTip = landmarks?.[8]
    let isPinching = false

    if (gesture?.name !== 'Closed_Fist' && thumbTip && indexTip) {
      const dist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y)

      // Hysteresis toggle: enter pinch mode below START, exit only above END.
      if (!isPinchActive.current && dist < PINCH_START) isPinchActive.current = true
      else if (isPinchActive.current && dist > PINCH_END) isPinchActive.current = false

      isPinching = isPinchActive.current

      if (isPinching) {
        if (prevPinchDist.current !== null) {
          const dd = dist - prevPinchDist.current
          // spreading (dd > 0) → zoom in; pinching (dd < 0) → zoom out
          targetScale.current = Math.max(
            MIN_SCALE,
            Math.min(MAX_SCALE, targetScale.current + dd * PINCH_ZOOM_SPEED),
          )
        }
        prevPinchDist.current = dist
      } else {
        prevPinchDist.current = null
      }
    } else {
      isPinchActive.current = false
      prevPinchDist.current = null
    }

    if (isPinching !== wasPinching.current) {
      onPinchChange(isPinching)
      wasPinching.current = isPinching
    }

    // --- Gesture classifier actions (skipped while pinching) ---
    if (!isPinching && gesture && wrist) {
      switch (gesture.name) {
        case 'Closed_Fist': {
          // Rotate: delta wrist movement → rotation axes
          if (prevWrist.current) {
            const dx = (prevWrist.current.x - wrist.x) * ROT_SPEED
            const dy = (wrist.y - prevWrist.current.y) * ROT_SPEED
            targetRot.current.y += dx
            targetRot.current.x += dy
          }
          prevWrist.current = { x: wrist.x, y: wrist.y }
          break
        }
        case 'Open_Palm': {
          // Move: absolute wrist position → cube X/Y
          const wx = (0.5 - wrist.x) * MOVE_SCALE * 2
          const wy = (0.5 - wrist.y) * MOVE_SCALE * 1.5
          targetPos.current.set(
            Math.max(-MOVE_SCALE, Math.min(MOVE_SCALE, wx)),
            Math.max(-MOVE_SCALE * 0.75, Math.min(MOVE_SCALE * 0.75, wy)),
            0,
          )
          prevWrist.current = null
          break
        }
        case 'Victory': {
          targetPos.current.set(0, 0, 0)
          targetRot.current = { x: 0, y: 0 }
          targetScale.current = 1
          prevWrist.current = null
          break
        }
        default:
          prevWrist.current = null
      }
    } else {
      prevWrist.current = null
    }

    // Frame-rate-corrected lerp
    const t = 1 - Math.pow(1 - LERP, delta * 60)
    group.position.lerp(targetPos.current, t)
    group.rotation.x += (targetRot.current.x - group.rotation.x) * t
    group.rotation.y += (targetRot.current.y - group.rotation.y) * t
    const s = group.scale.x + (targetScale.current - group.scale.x) * t
    group.scale.setScalar(s)
  })

  return (
    <group ref={groupRef}>
      <RoundedBox args={[1.5, 1.5, 1.5]} radius={0.1} smoothness={4}>
        <meshStandardMaterial color="#7c3aed" roughness={0.2} metalness={0.7} />
      </RoundedBox>
    </group>
  )
}

function GestureBadge({ detected, isPinching }: { detected: DetectedGesture; isPinching: boolean }) {
  const label = isPinching ? 'Pinch' : (detected?.name?.replace(/_/g, ' ') ?? null)
  const score = isPinching ? null : detected?.score

  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-xl px-5 py-4">
      <span className="text-xs uppercase tracking-widest text-slate-400 block mb-1">Detected</span>
      {label ? (
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-violet-400">{label}</span>
          {score != null && (
            <span className="text-sm text-slate-400">{(score * 100).toFixed(1)}%</span>
          )}
        </div>
      ) : (
        <span className="text-2xl text-slate-600">—</span>
      )}
    </div>
  )
}

function GestureLegend({ current }: { current: GestureKey | null }) {
  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-xl px-5 py-4 w-full">
      <span className="text-xs uppercase tracking-widest text-slate-400 block mb-3">
        Gesture controls
      </span>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {GESTURE_CONTROLS.map(({ gesture, action, description }) => (
          <div
            key={gesture}
            className={`rounded-lg px-3 py-2.5 border transition-colors ${
              current === gesture
                ? 'border-violet-500 bg-violet-500/20'
                : 'border-slate-700 bg-slate-900/50'
            }`}
          >
            <div className="text-xs font-mono text-slate-500 truncate">{gesture}</div>
            <div className="font-semibold text-sm text-slate-100 mt-0.5">{action}</div>
            <div className="text-xs text-slate-500 mt-0.5">{description}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ObjectInspector3D() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isPinching, setIsPinching] = useState(false)

  const { recognizerRef, status: modelStatus, error: modelError } = useGestureRecognizer()
  const { status: cameraStatus, error: cameraError, start: startCamera } = useCamera(videoRef)
  const { gestureRef, landmarkRef, detected } = useInspectorFrameLoop(
    videoRef,
    canvasRef,
    recognizerRef,
    cameraStatus === 'running',
  )

  const isRunning = cameraStatus === 'running'

  const screenStatus =
    modelStatus === 'loading' ? 'loading' :
    modelStatus === 'error' || cameraStatus === 'error' ? 'error' :
    isRunning ? null :
    'ready'

  const screenError = modelError || cameraError

  const activeControl: GestureKey | null = isPinching
    ? 'Pinch'
    : ((detected?.name ?? null) as GestureKey | null)

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-5xl">
      <div className="relative w-full">
        <div className="flex flex-col lg:flex-row gap-4 w-full">
          {/* Webcam with hand landmarks */}
          <div className="flex-1 min-w-0">
            <VideoCanvas videoRef={videoRef} canvasRef={canvasRef} />
          </div>

          {/* 3D scene */}
          <div className="flex-1 min-w-0 flex flex-col gap-3">
            <div className="aspect-video rounded-xl overflow-hidden border border-slate-700 bg-slate-900">
              <Canvas camera={{ position: [0, 0, 6], fov: 50 }}>
                <color attach="background" args={['#0f172a']} />
                <ambientLight intensity={0.5} />
                <directionalLight position={[5, 8, 5]} intensity={1.5} />
                <directionalLight position={[-4, -2, -4]} intensity={0.4} color="#818cf8" />
                <InspectorCube
                  gestureRef={gestureRef}
                  landmarkRef={landmarkRef}
                  onPinchChange={setIsPinching}
                />
              </Canvas>
            </div>
            {isRunning && <GestureBadge detected={detected} isPinching={isPinching} />}
          </div>
        </div>

        {screenStatus && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm rounded-xl z-10">
            <StatusScreen status={screenStatus} error={screenError} onStart={startCamera} />
          </div>
        )}
      </div>

      <GestureLegend current={activeControl} />
    </div>
  )
}
