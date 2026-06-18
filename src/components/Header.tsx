export type Tab = 'counter' | 'inspector' | 'ar' | 'ar2d' | 'kamehameha'

const TABS: { id: Tab; label: string }[] = [
  { id: 'counter',     label: 'Hand Gesture Counter' },
  { id: 'inspector',   label: '3D Object Inspector' },
  { id: 'ar',          label: 'Augmented Reality 3D Inspector' },
  { id: 'ar2d',        label: 'Augmented Reality 2D Inspector' },
  { id: 'kamehameha',  label: 'Kamehameha' },
]

type Props = {
  active: Tab
  onChange: (tab: Tab) => void
}

export function Header({ active, onChange }: Props) {
  return (
    <header className="fixed w-full border-b border-slate-700 bg-slate-900">
      <div className="w-full mx-auto px-4 h-14 flex items-center justify-center gap-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
              active === tab.id
                ? 'bg-violet-600 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </header>
  )
}
