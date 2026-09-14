import type { Geometry, GeometryCollection } from 'geojson'
import type { LevelId } from './config'

export interface Candidate {
  id: string
  name: string
  level: LevelId
  groupName?: string
  geometry: Geometry
  bbox: [number, number, number, number]
}

type RawFeature = {
  properties: Record<string, unknown>
  geometry: Geometry
}

const HUN_ADM1 =
  'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/HUN/ADM1/geoBoundaries-HUN-ADM1_simplified.geojson'
const HUN_ADM2 =
  'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/HUN/ADM2/geoBoundaries-HUN-ADM2_simplified.geojson'
const NE_COUNTRIES =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson'

const BUDAPEST_DISTRICTS = new Set(
  'I II III IV V VI VII VIII IX X XI XII XIII XIV XV XVI XVII XVIII XIX XX XXI XXII XXIII'
    .split(' ')
    .map((r) => `${r}. kerület`),
)

const CITY_DISTRACTORS = new Set(['Vác', 'Szob', 'Szentendre', 'Cegléd', 'Nagykáta', 'Dunakeszi'])

const cache = new Map<string, Promise<RawFeature[]>>()
const builtCache = new Map<string, Promise<Candidate[]>>()

/** Build (once) and memoize a candidate list — callers get the SAME array
 *  reference on every call so the map can skip redundant setData swaps. */
function built(key: string, build: () => Promise<Candidate[]>): Promise<Candidate[]> {
  let cached = builtCache.get(key)
  if (!cached) {
    cached = build()
    builtCache.set(key, cached)
  }
  return cached
}

function fetchFeatures(url: string): Promise<RawFeature[]> {
  let cached = cache.get(url)
  if (!cached) {
    cached = fetch(url).then((res) => {
      if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`)
      return res.json().then((d) => d.features as RawFeature[])
    })
    cache.set(url, cached)
  }
  return cached
}

function featureBbox(geometry: Geometry): [number, number, number, number] {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  const walk = (coords: unknown): void => {
    if (
      Array.isArray(coords) &&
      typeof coords[0] === 'number' &&
      typeof coords[1] === 'number'
    ) {
      const [x, y] = coords as [number, number]
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      return
    }
    if (Array.isArray(coords)) coords.forEach(walk)
  }
  walk(
    geometry.type === 'GeometryCollection'
      ? geometry.geometries.map((g) => (g.type === 'GeometryCollection' ? [] : g.coordinates))
      : (geometry as Exclude<Geometry, GeometryCollection>).coordinates,
  )
  return [minX, minY, maxX, maxY]
}

export function unionBbox(bboxes: [number, number, number, number][]): [number, number, number, number] {
  return bboxes.reduce(
    (acc, b) => [
      Math.min(acc[0], b[0]),
      Math.min(acc[1], b[1]),
      Math.max(acc[2], b[2]),
      Math.max(acc[3], b[3]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  )
}

function candidate(
  f: RawFeature,
  id: string,
  name: string,
  level: LevelId,
  groupName?: string,
): Candidate {
  return {
    id,
    name,
    level,
    groupName: groupName ?? name,
    geometry: f.geometry,
    bbox: featureBbox(f.geometry),
  }
}

export function loadCountries(): Promise<Candidate[]> {
  return loadWorldCandidates()
}

/** Continent-level candidates: every country polygon tagged with its Natural Earth continent.
 *  All polygons of a continent share one candidate id (`continent-Europe`, …), so a wrong
 *  guess paints the entire continent red and the solved one green. */
/** One world dataset shared by the Földrész and Ország steps — same array
 *  reference for both, so switching between them never touches the map data.
 *  Each polygon: name = country, groupName = continent. */
export function loadWorldCandidates(): Promise<Candidate[]> {
  return built('world', async () => {
    const features = await fetchFeatures(NE_COUNTRIES)
    return features
      .map((f, i) => {
        const name = String(f.properties.NAME ?? f.properties.name ?? `Country ${i}`)
        const continent = String(f.properties.CONTINENT ?? f.properties.continent ?? '')
        return candidate(f, `world-${i}`, name, 'continent', continent)
      })
      .filter((c) => c.groupName !== 'Seven seas (open ocean)')
  })
}

export function loadContinentCandidates(): Promise<Candidate[]> {
  return loadWorldCandidates()
}

/** Europe bbox for framing the country step (Russia excluded — it stretches to the Pacific). */
export async function loadEuropeBbox(): Promise<[number, number, number, number]> {
  const features = await fetchFeatures(NE_COUNTRIES)
  const bboxes = features
    .filter((f) => {
      const props = f.properties as Record<string, unknown>
      return (props.CONTINENT ?? props.continent) === 'Europe' && props.NAME !== 'Russia'
    })
    .map((f) => featureBbox(f.geometry))
  return bboxes.length ? unionBbox(bboxes) : ([-10, 35, 40, 70] as [number, number, number, number])
}

export async function loadCounties(): Promise<Candidate[]> {
  return built('counties', async () => {
    const features = await fetchFeatures(HUN_ADM1)
    return features.map((f, i) => {
      const name = String(f.properties.shapeName ?? `County ${i}`)
      return candidate(f, `state-${i}`, name, 'state', name)
    })
  })
}

async function loadAdm2(): Promise<RawFeature[]> {
  return fetchFeatures(HUN_ADM2)
}

/** One Budapest dataset shared by the Város and Kerület steps (same array
 *  reference for both): the 23 kerület grouped under 'Budapest' plus a few
 *  Pest-county distractor towns. */
export function loadCityCandidates(): Promise<Candidate[]> {
  return built('budapest', async () => {
    const features = await loadAdm2()
    const out: Candidate[] = []
    let districts = 0

    features.forEach((f, i) => {
      const name = String(f.properties.shapeName ?? '')
      if (BUDAPEST_DISTRICTS.has(name)) {
        districts++
        out.push(candidate(f, `city-bud-${i}`, name, 'city', 'Budapest'))
      } else if (CITY_DISTRACTORS.has(name)) {
        out.push(candidate(f, `city-other-${i}`, name, 'city', name))
      }
    })

    if (!districts) throw new Error('Budapest districts missing from ADM2 data')
    return out
  })
}

export function loadDistrictCandidates(): Promise<Candidate[]> {
  return loadCityCandidates()
}

export async function loadBudapestBbox(): Promise<[number, number, number, number]> {
  const districts = await loadDistrictCandidates()
  return unionBbox(districts.map((d) => d.bbox))
}
