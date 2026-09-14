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

const WORLD_GEOJSON =
  'https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json'
const HUN_ADM1 =
  'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/HUN/ADM1/geoBoundaries-HUN-ADM1_simplified.geojson'
const HUN_ADM2 =
  'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/HUN/ADM2/geoBoundaries-HUN-ADM2_simplified.geojson'

const BUDAPEST_DISTRICTS = new Set(
  'I II III IV V VI VII VIII IX X XI XII XIII XIV XV XVI XVII XVIII XIX XX XXI XXII XXIII'
    .split(' ')
    .map((r) => `${r}. kerület`),
)

const CITY_DISTRACTORS = new Set(['Vác', 'Szob', 'Szentendre', 'Cegléd', 'Nagykáta', 'Dunakeszi'])

const cache = new Map<string, Promise<RawFeature[]>>()

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
    groupName,
    geometry: f.geometry,
    bbox: featureBbox(f.geometry),
  }
}

export async function loadCountries(): Promise<Candidate[]> {
  const features = await fetchFeatures(WORLD_GEOJSON)
  return features
    .map((f, i) =>
      candidate(f, `country-${i}`, String(f.properties.name ?? `Country ${i}`), 'country'),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function loadCounties(): Promise<Candidate[]> {
  const features = await fetchFeatures(HUN_ADM1)
  return features.map((f, i) =>
    candidate(f, `state-${i}`, String(f.properties.shapeName ?? `County ${i}`), 'state'),
  )
}

async function loadAdm2(): Promise<RawFeature[]> {
  return fetchFeatures(HUN_ADM2)
}

/** City-level candidates: Budapest (all 23 districts grouped) + a few Pest-county distractors. */
export async function loadCityCandidates(): Promise<Candidate[]> {
  const features = await loadAdm2()
  const out: Candidate[] = []
  const districts: RawFeature[] = []

  features.forEach((f, i) => {
    const name = String(f.properties.shapeName ?? '')
    if (BUDAPEST_DISTRICTS.has(name)) {
      districts.push(f)
      out.push(candidate(f, `city-bud-${i}`, name, 'city', 'Budapest'))
    } else if (CITY_DISTRACTORS.has(name)) {
      out.push(candidate(f, `city-other-${i}`, name, 'city', name))
    }
  })

  if (!districts.length) throw new Error('Budapest districts missing from ADM2 data')
  return out
}

export async function loadDistrictCandidates(): Promise<Candidate[]> {
  const features = await loadAdm2()
  return features
    .map((f, i) => ({ f, i, name: String(f.properties.shapeName ?? '') }))
    .filter(({ name }) => BUDAPEST_DISTRICTS.has(name))
    .sort((a, b) => a.name.localeCompare(b.name, 'hu'))
    .map(({ f, i, name }) => candidate(f, `district-${i}`, name, 'district'))
}

export async function loadBudapestBbox(): Promise<[number, number, number, number]> {
  const districts = await loadDistrictCandidates()
  return unionBbox(districts.map((d) => d.bbox))
}
