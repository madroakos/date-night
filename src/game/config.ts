export type LevelId = 'continent' | 'country' | 'state' | 'city' | 'district'

export interface LevelConfig {
  id: LevelId
  label: string
  prompt: string
  unlockDate: string
  targetName: string
}

export const LEVELS: LevelConfig[] = [
  {
    id: 'continent',
    label: 'Földrész',
    prompt: 'Melyik földrészen kezdődik a nyomozás?',
    unlockDate: '2026-09-09',
    targetName: 'Europe',
  },
  {
    id: 'country',
    label: 'Ország',
    prompt: 'Melyik ország őrzi a titkot?',
    unlockDate: '2026-09-10',
    targetName: 'Hungary',
  },
  {
    id: 'state',
    label: 'Megye',
    prompt: 'Melyik megyében rejtőzik?',
    unlockDate: '2026-09-11',
    targetName: 'Pest',
  },
  {
    id: 'city',
    label: 'Város',
    prompt: 'Melyik város hív?',
    unlockDate: '2026-09-12',
    targetName: 'Budapest',
  },
  {
    id: 'district',
    label: 'Kerület',
    prompt: 'Melyik kerület őrzi a kincset?',
    unlockDate: '2026-09-13',
    targetName: 'V. kerület',
  },
]

export const DESTINATION = {
  name: 'Országház',
  coords: [19.0457, 47.507] as [number, number],
}

export const FINAL_ZOOM = 17

export function isUnlocked(level: LevelConfig, now = new Date()): boolean {
  const [y, m, d] = level.unlockDate.split('-').map(Number)
  const unlock = new Date(y, m - 1, d, 0, 0, 0)
  return now.getTime() >= unlock.getTime()
}
