import { useEffect, useRef, useState } from 'react'
import { GestureRecognizer, DrawingUtils } from '@mediapipe/tasks-vision'
import type { Landmark } from './useInspectorFrameLoop'

export type KamehamehaPhase = 'IDLE' | 'CHARGING' | 'FIRING' | 'COOLDOWN'

// ── Thresholds ────────────────────────────────────────────────────────────────
const POS_ALPHA          = 0.25   // EMA smoothing for midpoint
const CHARGE_ENTER_DIST  = 0.28   // normalised wrist–wrist dist to start charging
const CHARGE_EXIT_DIST   = 0.38   // hysteresis: exit CHARGING if wrists drift apart
const CHARGE_HOLD_MS     = 500    // ms of still pose required before CHARGING begins
const MAX_CHARGE_MS      = 3500   // ms to reach 100% charge
const SCALE_WIN          = 12     // frames in the scale comparison window
const FIRE_SCALE_RATIO   = 1.12   // forward push: 12% scale increase over half window
const MIN_CHARGE_TO_FIRE = 0.04   // guard: at least 4% charge before FIRING
const FIRING_MS          = 2000   // FIRING phase duration
const COOLDOWN_MS        = 1200   // COOLDOWN phase duration

// ── Helpers ───────────────────────────────────────────────────────────────────

// Distance wrist(0)→middle-MCP(9): proxy for apparent hand size on screen
function handScale(lms: Landmark[]): number {
  return Math.hypot(lms[0].x - lms[9].x, lms[0].y - lms[9].y)
}

function wristDist(a: Landmark[], b: Landmark[]): number {
  return Math.hypot(a[0].x - b[0].x, a[0].y - b[0].y)
}

// Landmark 9 = middle-finger MCP: geometric center of the palm
function midOf(a: Landmark[], b: Landmark[]) {
  return { x: (a[9].x + b[9].x) / 2, y: (a[9].y + b[9].y) / 2 }
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useKamehamehaLoop(
  videoRef:    React.RefObject<HTMLVideoElement | null>,
  lmCanvasRef: React.RefObject<HTMLCanvasElement | null>,
  fxCanvasRef: React.RefObject<HTMLCanvasElement | null>,
  recRef:      React.RefObject<GestureRecognizer | null>,
  active:      boolean,
) {
  const [phase,       setPhase]       = useState<KamehamehaPhase>('IDLE')
  const [chargeLevel, setChargeLevel] = useState(0)
  const [handCount,   setHandCount]   = useState(0)

  // Internal state (no stale closure issues in RAF)
  const phaseRef         = useRef<KamehamehaPhase>('IDLE')
  const chargeLvlRef     = useRef(0)
  const holdStartRef     = useRef<number | null>(null)
  const chargeStartRef   = useRef<number | null>(null)
  const firingStartRef   = useRef<number | null>(null)
  const cooldownStartRef = useRef<number | null>(null)
  const midRef           = useRef({ x: 0.5, y: 0.5 })
  // Snapshot at fire-moment, used throughout FIRING+COOLDOWN draw
  const fxOriginRef      = useRef({ x: 0.5, y: 0.5 })
  const fxChargeRef      = useRef(0)
  // +1 = beam extends toward increasing canvas-x (appears as screen-left after mirror)
  // -1 = beam extends toward decreasing canvas-x (appears as screen-right after mirror)
  const fxDirRef         = useRef(1)
  const scaleHistRef     = useRef<number[]>([])

  useEffect(() => {
    if (!active) {
      phaseRef.current = 'IDLE'
      setPhase('IDLE')
      setChargeLevel(0)
      setHandCount(0)
      scaleHistRef.current = []
      return
    }

    const video   = videoRef.current!
    const lmC     = lmCanvasRef.current!
    const fxC     = fxCanvasRef.current!
    const rec     = recRef.current!
    const lmCtx   = lmC.getContext('2d')!
    const fxCtx   = fxC.getContext('2d')!
    const drawing = new DrawingUtils(lmCtx)
    let lastTs    = -1
    let rafId     = 0

    function go(next: KamehamehaPhase, ts: number) {
      phaseRef.current = next
      setPhase(next)
      if (next === 'FIRING') {
        firingStartRef.current = ts
        fxOriginRef.current    = { ...midRef.current }
        fxChargeRef.current    = chargeLvlRef.current
        // midpoint.x > 0.5 → canvas right half → screen left after CSS flip
        // → beam goes toward screen-left edge → increasing canvas-x (dir = +1)
        fxDirRef.current       = midRef.current.x > 0.5 ? 1 : -1
      }
      if (next === 'COOLDOWN') cooldownStartRef.current = ts
      if (next === 'IDLE') {
        chargeLvlRef.current   = 0
        setChargeLevel(0)
        chargeStartRef.current = null
        holdStartRef.current   = null
        scaleHistRef.current   = []
      }
    }

    // ── Effect drawing ────────────────────────────────────────────────────────
    function drawFx(ts: number, w: number, h: number) {
      fxCtx.clearRect(0, 0, w, h)
      const p    = phaseRef.current
      const maxR = Math.min(w, h) * 0.17
      // Canvas-space midpoint (CSS scaleX(-1) applied to canvas, same as landmark canvas)
      const mx   = midRef.current.x * w
      const my   = midRef.current.y * h

      // ── CHARGING: energy sphere ───────────────────────────────────────────
      if (p === 'CHARGING') {
        const c  = chargeLvlRef.current
        const r  = maxR * Math.max(c, 0.06)
        const pu = 0.92 + 0.08 * Math.sin(ts * 0.009)  // slow pulse

        // Outer atmospheric glow (4 expanding rings)
        for (let i = 3; i >= 0; i--) {
          const ri = r * pu * (1.8 + i * 0.6)
          const a  = c * 0.07 * (4 - i)
          const g  = fxCtx.createRadialGradient(mx, my, 0, mx, my, ri)
          g.addColorStop(0, `rgba(80,160,255,${a})`)
          g.addColorStop(1, 'rgba(40,80,220,0)')
          fxCtx.beginPath()
          fxCtx.arc(mx, my, ri, 0, Math.PI * 2)
          fxCtx.fillStyle = g
          fxCtx.fill()
        }

        // Core sphere: white hot → cyan → blue edge
        const g = fxCtx.createRadialGradient(mx, my, 0, mx, my, r * pu)
        g.addColorStop(0,    `rgba(255,255,255,${c * 0.98})`)
        g.addColorStop(0.2,  `rgba(180,230,255,${c * 0.9})`)
        g.addColorStop(0.5,  `rgba(60,140,255,${c * 0.8})`)
        g.addColorStop(0.85, `rgba(20,70,210,${c * 0.5})`)
        g.addColorStop(1,    'rgba(0,20,160,0)')
        fxCtx.beginPath()
        fxCtx.arc(mx, my, r * pu, 0, Math.PI * 2)
        fxCtx.fillStyle = g
        fxCtx.fill()

        // Orbiting energy particles
        const np = Math.floor(c * 14)
        for (let i = 0; i < np; i++) {
          const ang = ts * 0.0035 + i * (Math.PI * 2 / np)
          const d   = r * pu * (1.15 + 0.25 * Math.sin(ts * 0.006 + i * 1.3))
          fxCtx.beginPath()
          fxCtx.arc(mx + Math.cos(ang) * d, my + Math.sin(ang) * d, 2 + c * 5, 0, Math.PI * 2)
          fxCtx.fillStyle = `rgba(180,230,255,${c * 0.9})`
          fxCtx.fill()
        }
      }

      // ── FIRING + COOLDOWN: beam + muzzle sphere ───────────────────────────
      if (p === 'FIRING' || p === 'COOLDOWN') {
        const elapsed   = ts - (firingStartRef.current ?? ts)
        const totalMs   = FIRING_MS + COOLDOWN_MS
        // Alpha: ramps up in 150 ms, holds through FIRING, fades during COOLDOWN
        const rampUp    = Math.min(elapsed / 150, 1)
        const fadeAlpha = elapsed > FIRING_MS
          ? Math.max(0, 1 - (elapsed - FIRING_MS) / COOLDOWN_MS)
          : 1
        const ba = rampUp * fadeAlpha

        const c   = fxChargeRef.current
        const ox  = fxOriginRef.current.x * w
        const oy  = fxOriginRef.current.y * h
        const dir = fxDirRef.current

        // Beam extends quickly (within 400 ms), max length scales with charge
        const extT     = Math.min(elapsed / 400, 1)
        const beamLen  = w * (0.40 + c * 0.70) * extT
        const beamEndX = ox + dir * beamLen

        // Slight vertical vibration during FIRING (energy turbulence)
        const vibY = elapsed < FIRING_MS ? Math.sin(elapsed * 0.08) * 4 * c * ba : 0

        // Screen flash at ignition
        if (elapsed < 180) {
          fxCtx.fillStyle = `rgba(200,235,255,${(1 - elapsed / 180) * 0.55})`
          fxCtx.fillRect(0, 0, w, h)
        }

        // Beam glow — drawn wide-to-narrow so inner layers composite on top
        const layers: { lw: number; a: number }[] = [
          { lw: 660 * c + 90, a: 0.04 },
          { lw: 450 * c + 60, a: 0.09 },
          { lw: 270 * c + 36, a: 0.20 },
          { lw: 135 * c + 21, a: 0.50 },
          { lw: 48,            a: 0.88 },
          { lw: 18,            a: 1.00 },
        ]
        for (const { lw, a } of layers) {
          const grd = fxCtx.createLinearGradient(ox, oy + vibY, beamEndX, oy + vibY)
          const ca  = a * ba
          grd.addColorStop(0,   `rgba(220,245,255,${ca})`)
          grd.addColorStop(0.2, `rgba(120,200,255,${ca})`)
          grd.addColorStop(0.7, `rgba(60,150,255,${ca * 0.6})`)
          grd.addColorStop(1,   `rgba(30,80,200,0)`)
          fxCtx.beginPath()
          fxCtx.lineWidth   = lw
          fxCtx.strokeStyle = grd
          fxCtx.lineCap     = 'round'
          fxCtx.moveTo(ox, oy + vibY)
          fxCtx.lineTo(beamEndX, oy + vibY)
          fxCtx.stroke()
        }

        // Crackling energy particles along beam (new random positions each frame = plasma flicker)
        const np = Math.floor(20 * c * ba)
        for (let i = 0; i < np; i++) {
          const frac   = Math.random()
          const spread = (1 - frac) * 28 * c
          fxCtx.beginPath()
          fxCtx.arc(
            ox + dir * beamLen * frac,
            oy + vibY + (Math.random() - 0.5) * spread,
            1.5 + Math.random() * 3 * c,
            0, Math.PI * 2,
          )
          fxCtx.fillStyle = `rgba(180,235,255,${ba * 0.75})`
          fxCtx.fill()
        }

        // Muzzle sphere — shrinks as cooldown progresses
        const t_  = Math.min(elapsed / totalMs, 1)
        const sr  = maxR * 1.6 * c * (1 - t_ * 0.75)
        if (sr > 1) {
          const grd2 = fxCtx.createRadialGradient(ox, oy + vibY, 0, ox, oy + vibY, sr)
          grd2.addColorStop(0,   `rgba(255,255,255,${ba * 0.95})`)
          grd2.addColorStop(0.3, `rgba(160,225,255,${ba * 0.8})`)
          grd2.addColorStop(1,   'rgba(50,120,255,0)')
          fxCtx.beginPath()
          fxCtx.arc(ox, oy + vibY, sr, 0, Math.PI * 2)
          fxCtx.fillStyle = grd2
          fxCtx.fill()
        }
      }
    }

    // ── RAF loop ──────────────────────────────────────────────────────────────
    function loop() {
      const ts = performance.now()

      if (video.readyState >= 2 && ts > lastTs) {
        lastTs = ts
        const w = video.videoWidth, h = video.videoHeight

        if (lmC.width  !== w) lmC.width  = w
        if (lmC.height !== h) lmC.height = h
        if (fxC.width  !== w) fxC.width  = w
        if (fxC.height !== h) fxC.height = h

        lmCtx.clearRect(0, 0, w, h)

        const result = rec.recognizeForVideo(video, ts)
        const lms    = (result.landmarks ?? []) as Landmark[][]
        setHandCount(lms.length)

        for (const lm of lms) {
          drawing.drawConnectors(lm, GestureRecognizer.HAND_CONNECTIONS, { color: '#00FF88', lineWidth: 2 })
          drawing.drawLandmarks(lm, { color: '#FF3366', lineWidth: 1, radius: 5 })
        }

        const ph = phaseRef.current

        if (lms.length >= 2) {
          const wd  = wristDist(lms[0], lms[1])
          const raw = midOf(lms[0], lms[1])
          // Smooth midpoint with EMA
          midRef.current = {
            x: midRef.current.x * (1 - POS_ALPHA) + raw.x * POS_ALPHA,
            y: midRef.current.y * (1 - POS_ALPHA) + raw.y * POS_ALPHA,
          }

          // Track apparent hand scale for forward-push detection
          const sc = (handScale(lms[0]) + handScale(lms[1])) / 2
          scaleHistRef.current.push(sc)
          if (scaleHistRef.current.length > SCALE_WIN) scaleHistRef.current.shift()

          // ── IDLE → CHARGING ─────────────────────────────────────────────────
          if (ph === 'IDLE') {
            if (wd < CHARGE_ENTER_DIST) {
              if (!holdStartRef.current) holdStartRef.current = ts
              else if (ts - holdStartRef.current >= CHARGE_HOLD_MS) {
                chargeStartRef.current = ts
                go('CHARGING', ts)
              }
            } else {
              holdStartRef.current = null
            }
          }

          // ── CHARGING: update level + detect forward push ─────────────────────
          if (ph === 'CHARGING') {
            if (wd > CHARGE_EXIT_DIST) {
              go('IDLE', ts)
            } else {
              const cl = Math.min((ts - chargeStartRef.current!) / MAX_CHARGE_MS, 1)
              chargeLvlRef.current = cl
              setChargeLevel(cl)

              // Forward-push: compare first half vs second half of scale window
              const hist = scaleHistRef.current
              if (hist.length >= SCALE_WIN) {
                const half  = SCALE_WIN >> 1
                const older = hist.slice(0, half).reduce((s, v) => s + v, 0) / half
                const newer = hist.slice(-half).reduce((s, v) => s + v, 0) / half
                if (newer / older > FIRE_SCALE_RATIO && chargeLvlRef.current >= MIN_CHARGE_TO_FIRE) {
                  go('FIRING', ts)
                }
              }
            }
          }
        } else {
          // Fewer than 2 hands → reset pose timer; abort CHARGING
          holdStartRef.current = null
          scaleHistRef.current = []
          if (ph === 'IDLE' || ph === 'CHARGING') go('IDLE', ts)
        }

        // FIRING timeout → COOLDOWN
        if (phaseRef.current === 'FIRING' && ts - (firingStartRef.current ?? ts) > FIRING_MS) {
          go('COOLDOWN', ts)
        }

        // COOLDOWN timeout → IDLE
        if (phaseRef.current === 'COOLDOWN' && ts - (cooldownStartRef.current ?? ts) > COOLDOWN_MS) {
          go('IDLE', ts)
        }

        drawFx(ts, w, h)
      }

      rafId = requestAnimationFrame(loop)
    }

    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [active, videoRef, lmCanvasRef, fxCanvasRef, recRef])

  return { phase, chargeLevel, handCount }
}
