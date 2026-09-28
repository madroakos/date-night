import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { GlobeMap, WORLD_BOUNDS, isPhoneViewport } from '../components/GlobeMap'
import { InvitationCard } from '../components/InvitationCard'
import {
  DESTINATION,
  LEVELS,
  formatCountdown,
  unlockTimeForIndex,
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
  const {
    state,
    now,
    currentLevel,
    currentUnlocked,
    pick,
    reset,
  } = useJourney()
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fitBounds, setFitBounds] = useState<Bounds | null>(WORLD_BOUNDS)
  const [invitationOpen, setInvitationOpen] = useState(false)
  const reopenInvitationRef = useRef<HTMLButtonElement>(null)

  const levelId: LevelId | null = state.completed ? null : (currentLevel?.id ?? null)
  const cooldown =
    !state.completed && Boolean(currentLevel) && !currentUnlocked
  const currentUnlockAt = unlockTimeForIndex(state.levelIndex)

  useEffect(() => {
    loadContinentCandidates().catch(() => {})
    loadCounties().catch(() => {})
    loadCityCandidates().catch(() => {})
    loadDistrictCandidates().catch(() => {})
  }, [])

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

        const isNewDataGroup = dataGroup !== activeDataGroupRef.current
        activeDataGroupRef.current = dataGroup
        if (isNewDataGroup) setCandidates(null)

        if (levelId === 'continent') {
          setFitBounds(WORLD_BOUNDS)
          if (!cancelled) setCandidates(await loadContinentCandidates())
        } else if (levelId === 'country') {
          setFitBounds(bboxToBounds(await loadEuropeBbox()))
          if (!cancelled) setCandidates(await loadCountries())
        } else if (levelId === 'state') {
          const countries = await loadCountries()
          if (cancelled) return
          const hungary = countries.find((candidate) => candidate.name === 'Hungary')
          setFitBounds(hungary ? bboxToBounds(hungary.bbox) : WORLD_BOUNDS)
          if (!cancelled) setCandidates(await loadCounties())
        } else if (levelId === 'city') {
          const counties = await loadCounties()
          if (cancelled) return
          const pest = counties.find((candidate) => candidate.name === 'Pest')
          if (pest) setFitBounds(bboxToBounds(pest.bbox))
          if (!cancelled) setCandidates(await loadCityCandidates())
        } else if (levelId === 'district') {
          setFitBounds(bboxToBounds(await loadBudapestBbox()))
          if (!cancelled) setCandidates(await loadDistrictCandidates())
        }
      } catch (caught) {
        if (!cancelled) {
          activeDataGroupRef.current = null
          setCandidates(null)
          setError(caught instanceof Error ? caught.message : 'Failed to load map data')
        }
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [levelId, currentUnlocked, state.completed])

  const wrongGroups = useMemo(
    () => (levelId ? state.wrongGuesses[levelId] : []),
    [levelId, state.wrongGuesses],
  )
  const solvedGroups = useMemo(
    () => (levelId && state.solved[levelId] ? [currentLevel.targetName] : []),
    [currentLevel, levelId, state.solved],
  )

  const labelClasses: string[] | 'all' = state.completed
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
    let selectionGroup: string
    switch (currentLevel.id) {
      case 'continent':
        correct = groupName === 'Europe'
        selectionGroup = groupName ?? name
        break
      case 'country':
        correct = name === 'Hungary'
        selectionGroup = name
        break
      case 'state':
        correct = name === 'Pest'
        selectionGroup = name
        break
      case 'city':
        correct = groupName === 'Budapest'
        selectionGroup = groupName ?? name
        break
      case 'district':
        correct = name === currentLevel.targetName
        selectionGroup = name
        break
    }

    pick(correct, selectionGroup)
  }

  const handleFinalFlightEnd = useCallback(() => setInvitationOpen(true), [])
  const closeInvitation = useCallback(() => {
    setInvitationOpen(false)
    window.requestAnimationFrame(() => reopenInvitationRef.current?.focus())
  }, [])

  const phone = isPhoneViewport()
  const minCameraZoom = (() => {
    switch (levelId) {
      case 'country':
        return phone ? 2.6 : 3.1
      case 'state':
        return phone ? 5.2 : 5.8
      case 'city':
        return phone ? 7.2 : 7.9
      case 'district':
        return phone ? 10 : 10.6
      default:
        return phone ? 1.05 : 1.4
    }
  })()

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#05070d] text-white">
      <GlobeMap
        candidates={candidates}
        dataKey={state.completed ? 'done' : (levelId ?? 'none')}
        wrongGroups={wrongGroups}
        solvedGroups={solvedGroups}
        fitBounds={fitBounds}
        minCameraZoom={minCameraZoom}
        labelClasses={labelClasses}
        completed={state.completed}
        destination={DESTINATION}
        onFinalFlightEnd={handleFinalFlightEnd}
        onPick={handlePick}
      />

      {cooldown && (
        <div className="absolute inset-0 z-[5] bg-black/60" />
      )}

      <header
        className={
          cooldown
            ? 'pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4'
            : 'pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]'
        }
      >
        <div className="rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-center shadow-lg backdrop-blur-md">
          <ol className="mt-0 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] sm:text-xs">
            {LEVELS.map((level, index) => {
              const solved = state.solved[level.id]
              const isCurrent = index === state.levelIndex && !state.completed
              const unlockAt = unlockTimeForIndex(index)
              const timeLocked = !solved && unlockAt !== null && now < unlockAt
              const unlocked =
                (index === 0 || state.solved[LEVELS[index - 1].id]) && !timeLocked
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
                  {index < LEVELS.length - 1 && (
                    <span className="ml-2 text-white/25">›</span>
                  )}
                </li>
              )
            })}
          </ol>

          {cooldown && currentUnlockAt !== null && (
            <p className="mt-2 text-base font-semibold tabular-nums text-amber-300">
              ⏳ {formatCountdown(currentUnlockAt - now)}
            </p>
          )}

          {!state.completed && currentLevel && currentUnlocked && candidates === null && !error && (
            <p className="mt-1 text-[11px] text-amber-300/80">Térkép betöltése…</p>
          )}
          {!state.completed && currentLevel && currentUnlocked && (
            <p className="mt-2 text-[11px] text-white/70 sm:text-xs">
              {currentLevel.prompt}
              {currentUnlocked && wrongGroups.length > 0 && (
                <span className="ml-2 text-red-400">
                  {wrongGroups.length} rossz tipp
                </span>
              )}
            </p>
          )}
          {state.completed && (
            <p className="mt-2 text-xs font-semibold text-emerald-400">
              {DESTINATION.icon ?? '📍'} Megvan a cél: {DESTINATION.shortName ?? DESTINATION.name}!
            </p>
          )}
        </div>
      </header>

      {state.completed && !invitationOpen && (
        <button
          ref={reopenInvitationRef}
          type="button"
          onClick={() => setInvitationOpen(true)}
          className="absolute bottom-[calc(env(safe-area-inset-bottom)+1rem)] left-1/2 z-20 -translate-x-1/2 rounded-full border border-rose-200/20 bg-[#11131d]/90 px-5 py-2.5 text-sm font-semibold text-rose-100 shadow-xl backdrop-blur-xl transition hover:bg-rose-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-rose-200"
        >
          {state.invitationAccepted ? 'Meghívó újra 💛' : 'Meghívó megnyitása 💌'}
        </button>
      )}

      {state.completed && invitationOpen && (
        <InvitationCard
          destination={DESTINATION}
          onClose={closeInvitation}
        />
      )}

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
