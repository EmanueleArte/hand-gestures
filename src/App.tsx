import { useState } from 'react'
import { Header, type Tab } from './components/Header'
import { GestureDetector } from './components/GestureDetector'
import { ObjectInspector3D } from './components/ObjectInspector3D'
import { ARInspector3D } from './components/ARInspector3D'
import { ARInspector2D } from './components/ARInspector2D'

export default function App() {
  const [tab, setTab] = useState<Tab>('counter')

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100 flex flex-col">
      <Header active={tab} onChange={setTab} />
      <main className="flex-1 flex flex-col items-center px-4 py-6 gap-6">
        {tab === 'counter'   && <GestureDetector />}
        {tab === 'inspector' && <ObjectInspector3D />}
        {tab === 'ar'        && <ARInspector3D />}
        {tab === 'ar2d'      && <ARInspector2D />}
      </main>
    </div>
  )
}
