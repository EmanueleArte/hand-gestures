import type { DetectedGesture } from '../hooks/useFrameLoop'
import type { GestureName } from '../constants'

type Props = {
  detected: DetectedGesture
  target: GestureName
}

export function DetectionBadge({ detected, target }: Props) {
  const isMatch = detected?.name === target

  return (
    <div className="flex flex-col gap-1.5 flex-1 min-w-44 bg-slate-800/60 border border-slate-700 rounded-xl px-5 py-4">
      <span className="text-xs uppercase tracking-widest text-slate-400">Detected</span>
      {detected ? (
        <>
          <span
            className={`text-xl font-bold transition-colors ${
              isMatch ? 'text-emerald-400' : 'text-slate-100'
            }`}
          >
            {detected.name.replace(/_/g, ' ')}
          </span>
          <span className="text-sm text-slate-400">
            {(detected.score * 100).toFixed(1)}% confidence
          </span>
        </>
      ) : (
        <span className="text-2xl text-slate-600">—</span>
      )}
    </div>
  )
}
