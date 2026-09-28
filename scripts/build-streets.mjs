import { readFileSync, writeFileSync } from 'node:fs'

const [osmPath, districtPath, outputPath] = process.argv.slice(2)

if (!osmPath || !districtPath || !outputPath) {
  throw new Error('Usage: node scripts/build-streets.mjs <input.osm> <districts.json> <output.json>')
}

const decodeXml = (value) =>
  value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')

const attribute = (attributes, name) => {
  const match = attributes.match(new RegExp(`\\b${name}="([^"]*)"`))
  return match?.[1]
}

const osm = readFileSync(osmPath, 'utf8')
const nodes = new Map()

for (const match of osm.matchAll(/<node\b([^>]*)>/g)) {
  const id = attribute(match[1], 'id')
  const lat = Number(attribute(match[1], 'lat'))
  const lon = Number(attribute(match[1], 'lon'))
  if (id && Number.isFinite(lat) && Number.isFinite(lon)) nodes.set(id, [lon, lat])
}

const districtData = JSON.parse(readFileSync(districtPath, 'utf8'))
const district = districtData.features.find((feature) => feature.properties.name === 'VI. kerület')
if (!district || district.geometry.type !== 'Polygon') throw new Error('VI. kerület polygon not found')
const ring = district.geometry.coordinates[0]

const pointInside = ([x, y]) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const segmentIntersection = (a, b, c, d) => {
  const r = [b[0] - a[0], b[1] - a[1]]
  const s = [d[0] - c[0], d[1] - c[1]]
  const cross = r[0] * s[1] - r[1] * s[0]
  if (Math.abs(cross) < 1e-14) return null
  const q = [c[0] - a[0], c[1] - a[1]]
  const t = (q[0] * s[1] - q[1] * s[0]) / cross
  const u = (q[0] * r[1] - q[1] * r[0]) / cross
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { t, point: [a[0] + t * r[0], a[1] + t * r[1]] }
}

const samePoint = (a, b) => Math.abs(a[0] - b[0]) < 1e-8 && Math.abs(a[1] - b[1]) < 1e-8

const clipSegment = (a, b) => {
  const cuts = [{ t: 0, point: a }, { t: 1, point: b }]
  for (let i = 1; i < ring.length; i += 1) {
    const hit = segmentIntersection(a, b, ring[i - 1], ring[i])
    if (hit && !cuts.some((cut) => Math.abs(cut.t - hit.t) < 1e-10)) cuts.push(hit)
  }
  cuts.sort((left, right) => left.t - right.t)

  const parts = []
  for (let i = 1; i < cuts.length; i += 1) {
    const start = cuts[i - 1].point
    const end = cuts[i].point
    const midpoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
    if (pointInside(midpoint)) parts.push([start, end])
  }
  return parts
}

const clipLine = (coordinates) => {
  const lines = []
  let current = null
  for (let i = 1; i < coordinates.length; i += 1) {
    for (const [start, end] of clipSegment(coordinates[i - 1], coordinates[i])) {
      if (current && samePoint(current.at(-1), start)) current.push(end)
      else {
        current = [start, end]
        lines.push(current)
      }
    }
  }
  return lines
}

const mergeLines = (input) => {
  const lines = input.map((line) => [...line])
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < lines.length; i += 1) {
      for (let j = i + 1; j < lines.length; j += 1) {
        const a = lines[i]
        const b = lines[j]
        let merged
        if (samePoint(a.at(-1), b[0])) merged = [...a, ...b.slice(1)]
        else if (samePoint(a.at(-1), b.at(-1))) merged = [...a, ...b.toReversed().slice(1)]
        else if (samePoint(a[0], b.at(-1))) merged = [...b, ...a.slice(1)]
        else if (samePoint(a[0], b[0])) merged = [...b.toReversed(), ...a.slice(1)]
        if (merged) {
          lines[i] = merged
          lines.splice(j, 1)
          changed = true
          break outer
        }
      }
    }
  }
  return lines
}

const streetHighways = new Set([
  'living_street',
  'pedestrian',
  'primary',
  'primary_link',
  'residential',
  'secondary',
  'secondary_link',
  'service',
  'tertiary',
  'tertiary_link',
  'unclassified',
])
const streets = new Map()

for (const match of osm.matchAll(/<way\b[^>]*>([\s\S]*?)<\/way>/g)) {
  const body = match[1]
  const tags = Object.fromEntries(
    [...body.matchAll(/<tag k="([^"]+)" v="([^"]*)"\s*\/>/g)].map((tag) => [decodeXml(tag[1]), decodeXml(tag[2])]),
  )
  if (!tags.name || !streetHighways.has(tags.highway) || tags.name.includes(' / ')) continue

  const coordinates = [...body.matchAll(/<nd ref="([^"]+)"\s*\/>/g)]
    .map((node) => nodes.get(node[1]))
    .filter(Boolean)
  if (coordinates.length < 2) continue

  const clipped = clipLine(coordinates)
  if (clipped.length === 0) continue
  const existing = streets.get(tags.name) ?? []
  existing.push(...clipped)
  streets.set(tags.name, existing)
}

const roundPoint = (point) => point.map((value) => Number(value.toFixed(7)))
const features = [...streets.entries()]
  .sort(([left], [right]) => left.localeCompare(right, 'hu'))
  .map(([name, rawLines]) => {
    const lines = mergeLines(rawLines).map((line) => line.map(roundPoint))
    return {
      type: 'Feature',
      properties: { name },
      geometry:
        lines.length === 1
          ? { type: 'LineString', coordinates: lines[0] }
          : { type: 'MultiLineString', coordinates: lines },
    }
  })

writeFileSync(
  outputPath,
  `${JSON.stringify({
    type: 'FeatureCollection',
    attribution: 'Street geometry © OpenStreetMap contributors',
    features,
  })}\n`,
)

console.log(`Wrote ${features.length} named streets to ${outputPath}`)
