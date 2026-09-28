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

// Vendored GeoJSON served from /public/data — same host as the app, so no
// external connectivity is required (phones on the LAN included).
const WORLD = `${import.meta.env.BASE_URL}data/world.json`
const COUNTIES = `${import.meta.env.BASE_URL}data/counties.json`
const BUDAPEST = `${import.meta.env.BASE_URL}data/budapest.json`
const STREETS = `${import.meta.env.BASE_URL}data/streets.json`

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

/** One world dataset shared by the Földrész and Ország steps — same array
 *  reference for both, so switching between them never touches the map data.
 *  Each polygon: name = country, groupName = continent. */
export function loadWorldCandidates(): Promise<Candidate[]> {
  return built('world', async () => {
    const features = await fetchFeatures(WORLD)
    return features.map((f, i) =>
      candidate(
        f,
        `world-${i}`,
        String(f.properties.name ?? `Country ${i}`),
        'continent',
        String(f.properties.continent ?? ''),
      ),
    )
  })
}

export function loadContinentCandidates(): Promise<Candidate[]> {
  return loadWorldCandidates()
}

export function loadCountries(): Promise<Candidate[]> {
  return loadWorldCandidates()
}

/** Europe bbox for framing the country step (Russia excluded — it stretches to the Pacific). */
export async function loadEuropeBbox(): Promise<[number, number, number, number]> {
  await loadWorldCandidates()
  // Use mainland bounds: raw country geometries include overseas territories
  // such as French Guiana, which otherwise keep the camera near world zoom.
  return [-12, 34, 35, 72]
}

export async function loadCounties(): Promise<Candidate[]> {
  return built('counties', async () => {
    const features = await fetchFeatures(COUNTIES)
    return features.map((f, i) => {
      const name = String(f.properties.name ?? `County ${i}`)
      return candidate(f, `state-${i}`, name, 'state', name)
    })
  })
}

/** One dataset shared by Város and Kerület steps: Budapest's 23 districts
 * plus all 55 Pest county cities with their municipality boundaries. */
export function loadCityCandidates(): Promise<Candidate[]> {
  return built('budapest', async () => {
    const features = await fetchFeatures(BUDAPEST)
    return features.map((f, i) => {
      const name = String(f.properties.name ?? '')
      const isDistrict = /kerület$/.test(name)
      return candidate(f, `city-${i}`, name, 'city', isDistrict ? 'Budapest' : name)
    })
  })
}

export function loadDistrictCandidates(): Promise<Candidate[]> {
  return loadCityCandidates()
}

/** Curated streets around the destination in Budapest's VI. district. */
export function loadStreetCandidates(): Promise<Candidate[]> {
  return built('streets', async () => {
    const features = await fetchFeatures(STREETS)
    return features.map((f, i) => {
      const name = String(f.properties.name ?? `Street ${i}`)
      return candidate(f, `street-${i}`, name, 'street', name)
    })
  })
}

export async function loadStreetBbox(): Promise<[number, number, number, number]> {
  const streets = await loadStreetCandidates()
  return unionBbox(streets.map((street) => street.bbox))
}

export async function loadBudapestBbox(): Promise<[number, number, number, number]> {
  const areas = await loadCityCandidates()
  const districts = areas.filter((a) => a.groupName === 'Budapest')
  return unionBbox(districts.map((d) => d.bbox))
}
