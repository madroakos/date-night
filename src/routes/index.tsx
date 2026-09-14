import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { GlobeMap, WORLD_BOUNDS } from '../components/GlobeMap'
import {
  LEVELS,
  type LevelId,
} from '../game/config'
import {
  loadBudapestBbox,
  loadCityCandidates,
  loadContinentCandidates,
  loadCounties,
  loadCountries,
  loadDistrictCandidates,
  loadEuropeBbox,
  type Candidate,
} from '../game/data'
import { useJourney } from '../game/useJourney'

export const Route = createFileRoute('/')({ component: Home })

type Bounds = [[number, number], [number, number]]

function Home() {
  const { state, currentLevel, currentUnlocked, nextUnlockDate, pick, reset } = useJourney()
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fitBounds, setFitBounds] = useState<Bounds | null>(WORLD_BOUNDS)

  const levelId: LevelId | null = state.completed ? null : (currentLevel?.id ?? null)

  // Warm the data cache early so later steps render instantly
  useEffect(() => {
    loadContinentCandidates().catch(() => {})
    loadCounties().catch(() => {})
    loadCityCandidates().catch(() => {})
    loadDistrictCandidates().catch(() => {})
  }, [])

  // Load candidates + frame the parent area for the current level.
  // Levels grouped over the SAME dataset (Földrész/Ország → world,
  // Város/Kerület → Budapest) share one memoized array, so those
  // transitions swap zero map data.
  const activeDataGroupRef = useRef<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setError(null)

    const dataGroup =
      levelId === 'continent' || levelId === 'country'
        ? 'world'
        : levelId === 'state'
          ? 'counties'
          : levelId === 'city' || levelId === 'district'
            ? 'budapest'
            : null

    async function run() {
      try {
        if (state.completed || !currentLevel || !currentUnlocked) {
          activeDataGroupRef.current = null
          setCandidates(null)
          return
        }

        if (dataGroup && dataGroup === activeDataGroupRef.current) {
          // same dataset already on the map — nothing to swap
          return
        }
        activeDataGroupRef.current = dataGroup
        setCandidates(null)

        if (levelId === 'continent') {
          setFitBounds(WORLD_BOUNDS)
          if (!cancelled) setCandidates(await loadContinentCandidates())
        } else if (levelId === 'country') {
          setFitBounds(bboxToBounds(await loadEuropeBbox()))
          if (!cancelled) setCandidates(await loadCountries())
        } else if (levelId === 'state') {
          const countries = await loadCountries()
          if (cancelled) return
          const hungary = countries.find((c) => c.name === 'Hungary')
          setFitBounds(hungary ? bboxToBounds(hungary.bbox) : WORLD_BOUNDS)
          if (!cancelled) setCandidates(await loadCounties())
        } else if (levelId === 'city') {
          const counties = await loadCounties()
          if (cancelled) return
          const pest = counties.find((c) => c.name === 'Pest')
          if (pest) setFitBounds(bboxToBounds(pest.bbox))
          if (!cancelled) setCandidates(await loadCityCandidates())
        } else if (levelId === 'district') {
          setFitBounds(bboxToBounds(await loadBudapestBbox()))
          if (!cancelled) setCandidates(await loadDistrictCandidates())
        }
      } catch (e) {
        if (!cancelled) {
          activeDataGroupRef.current = null
          setCandidates(null)
          setError(e instanceof Error ? e.message : 'Failed to load map data')
        }
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [levelId, currentUnlocked, state.completed])

  const wrongGroups = useMemo(
    () => [...new Set(LEVELS.flatMap((l) => state.wrongGuesses[l.id]))],
    [state.wrongGuesses],
  )
  const solvedGroups = useMemo(
    () => LEVELS.filter((l) => state.solved[l.id]).map((l) => l.targetName),
    [state.solved],
  )

  const labelClasses: string[] | 'all' =
    state.completed
      ? 'all'
      : levelId === 'continent'
        ? ['continent']
        : levelId === 'country'
          ? ['country']
          : levelId === 'state'
            ? ['state']
            : levelId === 'city'
              ? ['city', 'town']
              : ['suburb', 'neighbourhood', 'city', 'town']

  function handlePick(_candidateId: string, groupName: string | undefined, name: string) {
    if (!currentLevel || !currentUnlocked) return
    let correct: boolean
    switch (currentLevel.id) {
      case 'continent':
        correct = groupName === 'Europe'
        break
      case 'country':
        correct = name === 'Hungary'
        break
      case 'state':
        correct = name === 'Pest'
        break
      case 'city':
        correct = groupName === 'Budapest'
        break
      case 'district':
        correct = name === 'V. kerület'
        break
    }
    pick(correct, groupName ?? name)
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#05070d] text-white">
      <GlobeMap
        candidates={candidates}
        wrongGroups={wrongGroups}
        solvedGroups={solvedGroups}
        fitBounds={fitBounds}
        labelClasses={labelClasses}
        completed={state.completed}
        onPick={handlePick}
      />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <div className="rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-center shadow-lg backdrop-blur-md">
          <h1 className="text-sm font-semibold tracking-wide sm:text-base">Randevú 🌙</h1>
          <ol className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] sm:text-xs">
            {LEVELS.map((level, i) => {
              const solved = state.solved[level.id]
              const isCurrent = i === state.levelIndex && !state.completed
              const unlocked = i === 0 || state.solved[LEVELS[i - 1].id]
              return (
                <li
                  key={level.id}
                  className={
                    solved
                      ? 'text-emerald-400'
                      : isCurrent && currentUnlocked
                        ? 'font-semibold text-white'
                        : isCurrent
                          ? 'text-amber-400'
                          : 'text-white/40'
                  }
                >
                  {solved ? '✓ ' : unlocked ? '' : '🔒 '}
                  {level.label}
                  {isCurrent && !unlocked && ` · ${level.unlockDate}`}
                  {i < LEVELS.length - 1 && <span className="ml-2 text-white/25">›</span>}
                </li>
              )
            })}
          </ol>
          {!state.completed && currentLevel && currentUnlocked && candidates === null && !error && (
            <p className="mt-1 text-[11px] text-amber-300/80">Térkép betöltése…</p>
          )}
          {!state.completed && currentLevel && (
            <p className="mt-2 text-[11px] text-white/70 sm:text-xs">
              {currentUnlocked ? (
                currentLevel.prompt
              ) : (
                <>Zárolva eddig: {nextUnlockDate ?? currentLevel.unlockDate}</>
              )}
              {currentUnlocked && wrongGroups.length > 0 && (
                <span className="ml-2 text-red-400">
                  {wrongGroups.length} rossz tipp
                </span>
              )}
            </p>
          )}
          {state.completed && (
            <p className="mt-2 text-xs font-semibold text-emerald-400">
              🏛 Megvan a cél: Országház!
            </p>
          )}
        </div>
      </header>

      {error && (
        <div className="absolute inset-x-0 bottom-16 z-10 flex justify-center px-4">
          <div className="rounded-xl border border-red-500/40 bg-red-950/70 px-4 py-2 text-xs text-red-200 backdrop-blur">
            {error}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={reset}
        className="absolute bottom-3 left-3 z-10 rounded-lg border border-white/15 bg-black/45 px-3 py-1.5 text-[11px] text-white/60 backdrop-blur transition hover:text-white"
      >
        Újrakezdés
      </button>
    </main>
  )
}

function bboxToBounds(bbox: [number, number, number, number]): Bounds {
  return [
    [bbox[0], bbox[1]],
    [bbox[2], bbox[3]],
  ]
}
