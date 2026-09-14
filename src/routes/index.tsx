import { createFileRoute } from '@tanstack/react-router'
import { GlobeMap } from '../components/GlobeMap'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <main className="fixed inset-0 overflow-hidden bg-[#05070d] text-white">
      <GlobeMap />
      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <div className="rounded-2xl border border-white/10 bg-black/45 px-4 py-2 text-center shadow-lg backdrop-blur-md">
          <h1 className="text-sm font-semibold tracking-wide sm:text-base">Date Night</h1>
          <p className="text-[11px] text-white/60 sm:text-xs">Tap a country to begin the journey</p>
        </div>
      </header>
    </main>
  )
}
