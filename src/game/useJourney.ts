import { useCallback, useEffect, useReducer } from 'react'
import { LEVELS, isUnlocked, type LevelId } from './config'

export interface JourneyState {
  levelIndex: number
  solved: Record<LevelId, boolean>
  wrongGuesses: Record<LevelId, string[]>
  wrongPulse: number
  completed: boolean
}

const STORAGE_KEY = 'date-night-progress'

const emptyWrong = () =>
  Object.fromEntries(LEVELS.map((l) => [l.id, [] as string[]])) as Record<LevelId, string[]>

const initialState: JourneyState = {
  levelIndex: 0,
  solved: Object.fromEntries(LEVELS.map((l) => [l.id, false])) as Record<LevelId, boolean>,
  wrongGuesses: emptyWrong(),
  wrongPulse: 0,
  completed: false,
}

type Action =
  | { type: 'pick'; correct: boolean; group: string }
  | { type: 'reset' }

function reducer(state: JourneyState, action: Action): JourneyState {
  switch (action.type) {
    case 'reset':      return initialState
    case 'pick': {
      if (state.completed) return state
      const level = LEVELS[state.levelIndex]
      if (!level) return state
      if (action.correct) {
        const solved = { ...state.solved, [level.id]: true }
        const nextIndex = state.levelIndex + 1
        const completed = nextIndex >= LEVELS.length
        return {
          ...state,
          levelIndex: completed ? state.levelIndex : nextIndex,
          solved,
          completed,
        }
      }
      const wrong = state.wrongGuesses[level.id]
      if (wrong.includes(action.group)) return state
      return {
        ...state,
        wrongGuesses: { ...state.wrongGuesses, [level.id]: [...wrong, action.group] },
        wrongPulse: state.wrongPulse + 1,
      }
    }
  }
}

function loadSaved(): JourneyState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as JourneyState
    if (
      typeof saved.levelIndex !== 'number' ||
      !saved.solved ||
      !saved.wrongGuesses ||
      saved.levelIndex < 0 ||
      saved.levelIndex >= LEVELS.length
    ) {
      return null
    }
    return {
      levelIndex: saved.levelIndex,
      solved: { ...initialState.solved, ...saved.solved },
      wrongGuesses: { ...emptyWrong(), ...saved.wrongGuesses },
      wrongPulse: 0,
      completed: Boolean(saved.completed),
    }
  } catch {
    return null
  }
}

function initFromStorage(base: JourneyState): JourneyState {
  return loadSaved() ?? base
}

export function useJourney() {
  const [state, dispatch] = useReducer(reducer, initialState, initFromStorage)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* storage unavailable — progress stays in memory */
    }
  }, [state])

  const currentLevel = LEVELS[state.levelIndex]
  const currentUnlocked =
    !state.completed &&
    Boolean(currentLevel) &&
    (state.levelIndex === 0
      ? isUnlocked(currentLevel)
      : state.solved[LEVELS[state.levelIndex - 1].id] && isUnlocked(currentLevel))

  const nextUnlockDate = LEVELS.slice(state.levelIndex).find((l) => !isUnlocked(l))?.unlockDate

  const pick = useCallback((correct: boolean, group: string) => dispatch({ type: 'pick', correct, group }), [])
  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    dispatch({ type: 'reset' })
  }, [])

  return { state, currentLevel, currentUnlocked, nextUnlockDate, pick, reset }
}
