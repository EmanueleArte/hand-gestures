import { GestureDetector } from './components/GestureDetector'

export default function App() {
  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100 flex flex-col items-center px-4 py-10 gap-6">
      <header className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">Hand Gesture Counter</h1>
        <p className="text-slate-400 text-sm mt-1">Powered by MediaPipe GestureRecognizer</p>
      </header>
      <GestureDetector />
    </div>
  )
}
