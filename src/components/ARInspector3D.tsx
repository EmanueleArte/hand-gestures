import { useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { useGestureRecognizer } from '../hooks/useGestureRecognizer'
import { useCamera } from '../hooks/useCamera'
import { useARFrameLoop, type HandsData } from '../hooks/useARFrameLoop'
import { StatusScreen } from './StatusScreen'

// Pinch detection thresholds (normalized thumb-tip ↔ index-tip distance)
const PINCH_START = 0.07   // enter pinch mode
const PINCH_END   = 0.22   // exit pinch mode (hysteresis keeps it active while spreading)

// Grab: 3D world-space radius around cube center that activates grab
const GRAB_RADIUS = 1.2

// Yaw  (Y rotation): in-plane angle of wrist→middleMCP, purely 2D — no axis coupling
// Pitch (X rotation): depth component (midMCP.z - wrist.z) / 2D-len — orthogonal to yaw
const ROT_SPEED_YAW   = 2.0
const ROT_SPEED_PITCH = 2.0

// Scale change per world-unit of two-pinch-center distance delta
const SCALE_SPEED = 0.4

const MIN_SCALE = 0.2
const MAX_SCALE = 5

// Position bounds in world space
const MAX_X = 5
const MAX_Y = 3

const LEGEND = [
  { label: 'Grab & Move',  desc: 'Pinch near cube → drag' },
  { label: 'Rotate X / Y', desc: 'Tilt wrist while grabbing' },
  { label: 'Zoom',         desc: 'Pinch with both hands, spread or close' },
  { label: 'Reset',        desc: 'Victory gesture (✌)' },
]

type ARCubeProps = {
  handsRef:     React.MutableRefObject<HandsData>
  gesturesRef:  React.MutableRefObject<string[]>
  onGrabChange: (grabbed: boolean) => void
  onZoomChange: (zooming: boolean) => void
}

function ARCube({ handsRef, gesturesRef, onGrabChange, onZoomChange }: ARCubeProps) {
  const groupRef = useRef<THREE.Group>(null)

  const targetPos   = useRef(new THREE.Vector3(0, 0, 0))
  const targetRot   = useRef({ x: 0, y: 0 })
  const targetScale = useRef(1)

  // ── One-hand state ─────────────────────────────────────────────────────────
  const isGrabbing    = useRef(false)
  const grabOffset    = useRef(new THREE.Vector3())
  // Per-frame hand pose: yaw = in-plane angle, pitch = normalised depth ratio
  const prevHandPose  = useRef<{ yaw: number; pitch: number } | null>(null)
  const wasGrabbing   = useRef(false)
  // Pinch hysteresis for one-hand grab
  const isPinch1H = useRef(false)

  // ── Two-hand state ─────────────────────────────────────────────────────────
  // Separate pinch hysteresis per hand so each hand can reach PINCH_START
  // independently before zoom activates.
  const isPinch2H_0    = useRef(false)
  const isPinch2H_1    = useRef(false)
  const prevZoomDist   = useRef<number | null>(null)
  const wasZooming     = useRef(false)

  // Reused THREE objects (avoid per-frame allocation)
  const raycasterR = useRef(new THREE.Raycaster())
  const zPlaneR    = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0))
  const tmpV2      = useRef(new THREE.Vector2())

  useFrame((state, delta) => {
    const group = groupRef.current
    if (!group) return

    const hands = handsRef.current
    const cam   = state.camera

    // Project a landmark (normalized MediaPipe coords) onto the world-space z=0 plane.
    // Mirrors x to match the CSS scaleX(-1) applied to video and landmark canvas.
    function lmToWorld(lm: { x: number; y: number }): THREE.Vector3 | null {
      tmpV2.current.set((1 - lm.x) * 2 - 1, -(lm.y * 2 - 1))
      raycasterR.current.setFromCamera(tmpV2.current, cam)
      const result = new THREE.Vector3()
      return raycasterR.current.ray.intersectPlane(zPlaneR.current, result)
    }

    function pinchCenter(lms: HandsData[number]) {
      return { x: (lms[4].x + lms[8].x) / 2, y: (lms[4].y + lms[8].y) / 2 }
    }

    function pinchDist(lms: HandsData[number]) {
      return Math.hypot(lms[4].x - lms[8].x, lms[4].y - lms[8].y)
    }

    // ── Victory → reset ───────────────────────────────────────────────────────
    if (gesturesRef.current.some(g => g === 'Victory')) {
      targetPos.current.set(0, 0, 0)
      targetRot.current = { x: 0, y: 0 }
      targetScale.current = 1
      isGrabbing.current = false
      isPinch1H.current  = false
      isPinch2H_0.current = false
      isPinch2H_1.current = false
      prevHandPose.current  = null
      prevZoomDist.current = null
      if (wasGrabbing.current) { onGrabChange(false); wasGrabbing.current = false }
      if (wasZooming.current)  { onZoomChange(false); wasZooming.current  = false }
      // fall through so lerp still smoothly returns cube to center
    } else {

    // ── Two-hand zoom ─────────────────────────────────────────────────────────
    if (hands.length >= 2) {
      // Release any active one-hand grab and reset its pinch state
      isPinch1H.current = false
      if (isGrabbing.current) {
        isGrabbing.current = false
        prevHandPose.current = null
        if (wasGrabbing.current) { onGrabChange(false); wasGrabbing.current = false }
      }

      const pd0 = pinchDist(hands[0])
      const pd1 = pinchDist(hands[1])

      // Per-hand hysteresis: each hand independently enters/exits pinch mode
      if (!isPinch2H_0.current && pd0 < PINCH_START) isPinch2H_0.current = true
      else if (isPinch2H_0.current && pd0 > PINCH_END) isPinch2H_0.current = false

      if (!isPinch2H_1.current && pd1 < PINCH_START) isPinch2H_1.current = true
      else if (isPinch2H_1.current && pd1 > PINCH_END) isPinch2H_1.current = false

      const bothPinching = isPinch2H_0.current && isPinch2H_1.current

      if (bothPinching) {
        // Distance between the two pinch centers drives scale
        const p0 = lmToWorld(pinchCenter(hands[0]))
        const p1 = lmToWorld(pinchCenter(hands[1]))
        if (p0 && p1) {
          const dist = p0.distanceTo(p1)
          if (prevZoomDist.current !== null) {
            const dd = dist - prevZoomDist.current
            // spreading (dd > 0) → zoom in; closing (dd < 0) → zoom out
            targetScale.current = Math.max(MIN_SCALE,
              Math.min(MAX_SCALE, targetScale.current + dd * SCALE_SPEED))
          }
          prevZoomDist.current = dist
        }

        if (!wasZooming.current) { onZoomChange(true); wasZooming.current = true }
      } else {
        prevZoomDist.current = null
        if (wasZooming.current) { onZoomChange(false); wasZooming.current = false }
      }
    } else {
      // Reset two-hand state when back to fewer than 2 hands
      isPinch2H_0.current = false
      isPinch2H_1.current = false
      prevZoomDist.current = null
      if (wasZooming.current) { onZoomChange(false); wasZooming.current = false }
    }

    // ── One-hand grab + rotate ────────────────────────────────────────────────
    if (hands.length === 1) {
      const lms = hands[0]
      const pd  = pinchDist(lms)

      if (!isPinch1H.current && pd < PINCH_START) isPinch1H.current = true
      else if (isPinch1H.current && pd > PINCH_END) isPinch1H.current = false

      if (isPinch1H.current) {
        const pinch3D = lmToWorld(pinchCenter(lms))

        if (pinch3D) {
          // Start grab when pinch is close enough to cube center
          if (!isGrabbing.current && pinch3D.distanceTo(targetPos.current) < GRAB_RADIUS) {
            isGrabbing.current = true
            grabOffset.current.copy(targetPos.current).sub(pinch3D)
            prevHandPose.current = null
            onGrabChange(true)
            wasGrabbing.current = true
          }

          if (isGrabbing.current) {
            // Move: cube follows pinch + initial offset
            targetPos.current.set(
              Math.max(-MAX_X, Math.min(MAX_X, pinch3D.x + grabOffset.current.x)),
              Math.max(-MAX_Y, Math.min(MAX_Y, pinch3D.y + grabOffset.current.y)),
              0,
            )

            // Rotation from two orthogonal measurements of wrist→middleMCP:
            //   yaw   = atan2 of the 2D projected vector → pure in-plane rotation → rotY
            //   pitch = (midMCP.z - wrist.z) / 2D-length → depth foreshortening → rotX
            // These are geometrically orthogonal: yaw measures in-plane angle,
            // pitch measures out-of-plane tilt, so neither bleeds into the other.
            const wrist  = lms[0]
            const midMCP = lms[9]

            const vx    = wrist.x - midMCP.x   // mirrored x
            const vy    = midMCP.y - wrist.y
            const len2D = Math.hypot(vx, vy)

            if (len2D > 0.02 && prevHandPose.current !== null) {
              const yaw   = Math.atan2(vy, vx)
              const pitch = (midMCP.z - wrist.z) / len2D

              let dyaw = yaw - prevHandPose.current.yaw
              if (dyaw >  Math.PI) dyaw -= 2 * Math.PI
              if (dyaw < -Math.PI) dyaw += 2 * Math.PI

              const dpitch = pitch - prevHandPose.current.pitch

              if (Math.abs(dyaw)   < 1.0) targetRot.current.y += dyaw   * ROT_SPEED_YAW
              if (Math.abs(dpitch) < 0.5) targetRot.current.x += dpitch * ROT_SPEED_PITCH
            }
            if (len2D > 0.02) {
              prevHandPose.current = {
                yaw:   Math.atan2(vy, vx),
                pitch: (midMCP.z - wrist.z) / len2D,
              }
            }
          }
        }
      } else if (isGrabbing.current) {
        // Pinch opened → release
        isGrabbing.current = false
        prevHandPose.current = null
        if (wasGrabbing.current) { onGrabChange(false); wasGrabbing.current = false }
      }
    } else if (hands.length === 0 && isGrabbing.current) {
      isGrabbing.current = false
      isPinch1H.current = false
      prevHandPose.current = null
      if (wasGrabbing.current) { onGrabChange(false); wasGrabbing.current = false }
    }

    } // end of non-Victory branch

    // ── Lerp toward targets (tighter when grabbed for direct-manipulation feel) ──
    const lerp = isGrabbing.current ? 0.35 : 0.15
    const t = 1 - Math.pow(1 - lerp, delta * 60)
    group.position.lerp(targetPos.current, t)
    group.rotation.x += (targetRot.current.x - group.rotation.x) * t
    group.rotation.y += (targetRot.current.y - group.rotation.y) * t
    const s = group.scale.x + (targetScale.current - group.scale.x) * t
    group.scale.setScalar(s)
  })

  return (
    <group ref={groupRef}>
      <RoundedBox args={[1.5, 1.5, 1.5]} radius={0.1} smoothness={4}>
        <meshStandardMaterial
          color="#7c3aed"
          roughness={0.2}
          metalness={0.7}
          transparent
          opacity={0.85}
        />
      </RoundedBox>
    </group>
  )
}

export function ARInspector3D() {
  const videoRef  = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [grabbed,   setGrabbed]   = useState(false)
  const [isZooming, setIsZooming] = useState(false)

  const { recognizerRef, status: modelStatus, error: modelError } = useGestureRecognizer()
  const { status: cameraStatus, error: cameraError, start: startCamera } = useCamera(videoRef)
  const { handsRef, gesturesRef, handCount } = useARFrameLoop(
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

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-4xl">
      {/* AR view – all three layers stacked in the same aspect-video container */}
      <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-slate-700 bg-black">

        {/* Layer 1 – webcam background */}
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover [transform:scaleX(-1)]"
          muted
          playsInline
        />

        {/* Layer 2 – landmark + connection canvas */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full [transform:scaleX(-1)] pointer-events-none"
        />

        {/* Layer 3 – transparent R3F scene aligned to the same viewport */}
        <div className="absolute inset-0 pointer-events-none">
          <Canvas
            gl={{ alpha: true, antialias: true }}
            onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
            camera={{ position: [0, 0, 5], fov: 60 }}
            style={{ width: '100%', height: '100%' }}
          >
            <ambientLight intensity={0.8} />
            <directionalLight position={[5, 8, 5]} intensity={1.5} />
            <directionalLight position={[-4, -2, -4]} intensity={0.4} color="#818cf8" />
            <ARCube
              handsRef={handsRef}
              gesturesRef={gesturesRef}
              onGrabChange={setGrabbed}
              onZoomChange={setIsZooming}
            />
          </Canvas>
        </div>

        {/* Status overlay (loading / error / start button) */}
        {screenStatus && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/90 z-10">
            <StatusScreen status={screenStatus} error={screenError} onStart={startCamera} />
          </div>
        )}

        {/* Running state indicators */}
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
