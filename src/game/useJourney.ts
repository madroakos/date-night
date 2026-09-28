import { useCallback, useEffect, useReducer, useState } from 'react'
import { LEVELS, isUnlocked, unlockTimeForIndex, type LevelId } from './config'

export interface JourneyState {
  levelIndex: number
  solved: Record<LevelId, boolean>
  wrongGuesses: Record<LevelId, string[]>
  wrongPulse: number
  completed: boolean
  invitationAccepted: boolean
}

const STORAGE_KEY = 'date-night-progress-v2'

const emptyWrong = () =>
  Object.fromEntries(LEVELS.map((level) => [level.id, [] as string[]])) as Record<
    LevelId,
    string[]
  >

const initialState: JourneyState = {
  levelIndex: 0,
  solved: Object.fromEntries(LEVELS.map((level) => [level.id, false])) as Record<
    LevelId,
    boolean
  >,
  wrongGuesses: emptyWrong(),
  wrongPulse: 0,
  completed: false,
  invitationAccepted: false,
}

type Action =
  | { type: 'pick'; correct: boolean; group: string }
  | { type: 'accept-invitation' }
  | { type: 'reset' }

function reducer(state: JourneyState, action: Action): JourneyState {
  switch (action.type) {
    case 'reset':
      return initialState
    case 'accept-invitation':
      return state.completed ? { ...state, invitationAccepted: true } : state
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
        wrongGuesses: {
          ...state.wrongGuesses,
          [level.id]: [...wrong, action.group],
        },
        wrongPulse: state.wrongPulse + 1,
      }
    }
  }
}

function loadSaved(): JourneyState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as Partial<JourneyState>
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
      invitationAccepted: Boolean(saved.invitationAccepted),
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
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Storage unavailable — progress stays in memory.
    }
  }, [state])

  const currentLevel = LEVELS[state.levelIndex]
  const previousSolved =
    state.levelIndex === 0 || state.solved[LEVELS[state.levelIndex - 1].id]
  const currentUnlocked =
    !state.completed && Boolean(currentLevel) && previousSolved && isUnlocked(state.levelIndex, now)
  const nextUnlockAt = unlockTimeForIndex(state.levelIndex)

  const pick = useCallback((correct: boolean, group: string) => {
    dispatch({ type: 'pick', correct, group })
  }, [])
  const acceptInvitation = useCallback(() => {
    dispatch({ type: 'accept-invitation' })
  }, [])
  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    dispatch({ type: 'reset' })
  }, [])

  return {
    state,
    now,
    currentLevel,
    currentUnlocked,
    nextUnlockAt,
    pick,
    acceptInvitation,
    reset,
  }
}
