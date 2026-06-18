import { useState, useEffect } from 'react'

type Props = {
  targetRef: React.RefObject<HTMLElement | null>
  className?: string
}

export function FullscreenButton({ targetRef, className = '' }: Props) {
  const [isFs, setIsFs] = useState(false)

  useEffect(() => {
    const sync = () => setIsFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  const toggle = () => {
    if (!document.fullscreenElement) targetRef.current?.requestFullscreen()
    else document.exitFullscreen()
  }

  return (
    <div className={`relative group/fs ${className}`}>
      <button
        onClick={toggle}
        aria-label="Toggle fullscreen"
        className="flex items-center justify-center w-8 h-8 rounded-lg bg-black/50 hover:bg-black/75 text-white/70 hover:text-white backdrop-blur-sm transition-colors"
      >
        {isFs ? <CollapseIcon /> : <ExpandIcon />}
      </button>
      <div className="pointer-events-none absolute right-0 top-full mt-1.5 z-50 w-max rounded-md bg-slate-800 border border-slate-600 px-2 py-1 text-xs text-slate-300 opacity-0 group-hover/fs:opacity-100 transition-opacity duration-150 shadow-lg whitespace-nowrap">
        Toggle fullscreen
      </div>
    </div>
  )
}

function ExpandIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9"/>
      <polyline points="9 21 3 21 3 15"/>
      <line x1="21" y1="3" x2="14" y2="10"/>
      <line x1="3" y1="21" x2="10" y2="14"/>
    </svg>
  )
}

function CollapseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 14 10 14 10 20"/>
      <polyline points="20 10 14 10 14 4"/>
      <line x1="10" y1="14" x2="3" y2="21"/>
      <line x1="21" y1="3" x2="14" y2="10"/>
    </svg>
  )
}
