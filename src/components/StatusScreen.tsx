type Props = {
  status: 'loading' | 'ready' | 'error'
  error: string
  onStart: () => void
}

export function StatusScreen({ status, error, onStart }: Props) {
  if (status === 'loading') {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-slate-400">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p>Loading model…</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="rounded-xl border border-rose-500 bg-rose-500/10 px-6 py-5 text-rose-400 text-center max-w-sm">
        {error}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-5 py-10">
      <p className="text-slate-300 text-sm">Model ready. Grant camera access to begin.</p>
      <button
        onClick={onStart}
        className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 rounded-lg font-semibold transition-colors cursor-pointer"
      >
        Start Camera
      </button>
    </div>
  )
}
