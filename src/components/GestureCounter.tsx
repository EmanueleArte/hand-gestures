type Props = {
  count: number
  onReset: () => void
}

export function GestureCounter({ count, onReset }: Props) {
  return (
    <div className="flex flex-col items-center gap-2 flex-1 min-w-36 bg-slate-800/60 border border-slate-700 rounded-xl px-5 py-4">
      <span className="text-xs uppercase tracking-widest text-slate-400">Count</span>
      <span className="text-6xl font-extrabold tabular-nums text-indigo-400 leading-none">
        {count}
      </span>
      <button
        onClick={onReset}
        className="mt-1 px-4 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors cursor-pointer text-slate-200"
      >
        Reset
      </button>
    </div>
  )
}
