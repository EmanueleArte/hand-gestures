import { SUPPORTED_GESTURES, type GestureName } from '../constants'

type Props = {
  value: GestureName
  onChange: (g: GestureName) => void
}

export function GestureSelect({ value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1.5 flex-1 min-w-44">
      <label
        htmlFor="gesture-select"
        className="text-xs uppercase tracking-widest text-slate-400"
      >
        Target gesture
      </label>
      <select
        id="gesture-select"
        value={value}
        onChange={e => onChange(e.target.value as GestureName)}
        className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-indigo-500 transition-colors cursor-pointer"
      >
        {SUPPORTED_GESTURES.map(g => (
          <option key={g} value={g}>
            {g.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
    </div>
  )
}
