# Implementation Plan: Date-Night Journey — Progressive Location Hunt

## Goal
A step-by-step treasure hunt where the user narrows down a location across 4 levels,
each locked behind a date. Final destination: **Tereza étterem**
(`[19.061686, 47.5026769]`, 1065 Budapest, Nagymező utca 3., District VI — "VI. kerület").

Chain: **Country → State/County → City → District**

## Verified data sources (already checked via HTTP)
| Level | Source | Notes |
|---|---|---|
| Country | `https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json` | 180 features, has `Hungary` (`properties.name`) |
| County (state) | `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/HUN/ADM1/geoBoundaries-HUN-ADM1_simplified.geojson` | 19 counties, `shapeName: "Pest"` is the target (contains Budapest) |
| City + District | `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/HUN/ADM2/geoBoundaries-HUN-ADM2_simplified.geojson` | 198 features; the 23 Budapest districts are named `I. kerület` … `XXIII. kerület`. City-level target = all 23 grouped as "Budapest" (no geometry ops needed — just tag them) |

## Game state (src/game/config.ts + src/game/useJourney.ts)
```ts
type LevelId = 'country' | 'state' | 'city' | 'district'
interface LevelConfig {
  id: LevelId
  label: string            // "Select the country"
  unlockDate: string       // ISO date; for testing all <= today
  targetName: string       // 'Hungary' | 'Pest' | 'Budapest' | 'VI. kerület'
}
```
- 4 hardcoded levels, unlock dates `2026-09-10 … 2026-09-13` (all past → unlocked for testing).
- State kept in React (`useReducer`), persisted to `localStorage` key `date-night-progress`:
  `{ currentLevel, unlockedAt checks, wrongGuesses: Record<LevelId, string[]>, completedAt }`.
- On mount: compare each level's `unlockDate` to `new Date()`; a level is playable only if
  the previous level is solved AND its own date has passed. Locked steps show the date on the HUD.
- "Reset journey" button (small, bottom-left) clears storage — for testing.

## Map behaviour (src/components/GlobeMap.tsx — extend)
Props: `candidates: CandidateFeature[] | null`, `wrongIds: string[]`, `targetId: string | null`,
`fitBounds: [[lng,lat],[lng,lat]] | null`, `onPick(feature)`.

Per step:
1. **Data fetch** (`src/game/data.ts`): `loadCountries()`, `loadCounties()`, `loadBudapestAreas()`
   — `fetch` + cache in module scope. City step: filter ADM2 to the 23 `* kerület` features
   (tag `city: 'Budapest'`) + a few other Pest ADM2 distractors (`Vác`, `Szob`, `Szentendre`,
   `Cegléd`, `Nagykáta`, `Dunakeszi`). District step: the same 23 kerület features.
2. **Frame rule**: on level load, `map.fitBounds(boundsOfParentArea, { padding: 40 })`.
   - country step → world view (current default center/zoom)
   - state step → Hungary bbox
   - city step → Pest county bbox
   - district step → Budapest bbox (bbox-union of the 23 features — pure math, no geometry lib)
3. **Render**: add/replace a GeoJSON source `candidates` + layers:
   - `candidates-fill` (fill, transparent white `rgba(255,255,255,0.08)`, outline white/40)
   - `candidates-wrong-fill` → red (`rgba(239,68,68,0.45)`) via a filter/`case` on wrong ids
   - `candidates-target-fill` → green pulse on solved target after correct pick
   - hover: cursor pointer + slight brighten.
4. **Click**: `queryRenderedFeatures` on the fill layer → call `onPick(feature)`.
   Correct → advance level (wrong marks cleared for HUD "perfect" tracking but map keeps
   target green briefly). Wrong → id appended to `wrongIds`, feature turns red, HUD shake.

## HUD (src/routes/index.tsx)
- Top card: journey title, step list (Country ✓ / County / City 🔒 2026-09-12 / District 🔒 …),
  current prompt ("Which county is it in?"), wrong-guess count for current level.
- After final correct pick: the map flies to `zoom 18` on Tereza's coordinates
  with a marker and a configurable invitation card.

## Files
- `src/game/config.ts` — levels, dates, target, coords
- `src/game/data.ts` — fetch/cache GeoJSON, candidate builders, bbox utils
- `src/game/useJourney.ts` — reducer + localStorage persistence + unlock logic
- `src/components/GlobeMap.tsx` — map + candidate layers + picking (rewrite)
- `src/routes/index.tsx` — HUD wiring

## Verification
- `npm run build` passes (tsc via vite).
- Dev server + browser: click-through country→county→city→district, wrong clicks turn red,
  reload restores progress, final flies to the Tereza marker.
