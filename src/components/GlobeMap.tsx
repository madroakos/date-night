import { useEffect, useRef, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import type * as MapLibreGL from 'maplibre-gl'
import type { Candidate } from '../game/data'
import { unionBbox } from '../game/data'
import { DESTINATION, FINAL_ZOOM } from '../game/config'

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/dark'
const WORLD_BOUNDS: [[number, number], [number, number]] = [
  [-170, -55],
  [170, 75],
]

interface GlobeMapProps {
  candidates: Candidate[] | null
  wrongGroups: string[]
  solvedGroups: string[]
  fitBounds: [[number, number], [number, number]] | null
  labelClasses: string[] | 'all'
  completed: boolean
  onPick: (candidateId: string, groupName: string | undefined, name: string) => void
}

export function GlobeMap({
  candidates,
  wrongGroups,
  solvedGroups,
  fitBounds,
  labelClasses,
  completed,
  onPick,
}: GlobeMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreGL.Map | null>(null)
  const maplibreRef = useRef<typeof MapLibreGL | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const placeLayersRef = useRef<{ id: string; filter: MapLibreGL.FilterSpecification | null }[] | null>(null)
  const pickRef = useRef(onPick)
  pickRef.current = onPick

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let lastTouchPickAt = 0
    let cleanupTouch: (() => void) | null = null

    async function init() {
      const maplibregl = await import('maplibre-gl')
      if (cancelled || !containerRef.current) return
      maplibreRef.current = maplibregl

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center: [8, 12],
        zoom: 1.05,
        minZoom: 0.5,
        maxPitch: 0,
        dragRotate: false,
        touchPitch: false,
        pitchWithRotate: false,
        attributionControl: { compact: true },
      })
      mapRef.current = map
      setMapReady(true)
      ;(window as unknown as Record<string, unknown>).__dateNightMap = map

      map.addControl(
        new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }),
        'top-right',
      )

      map.on('style.load', () => {
        map.setProjection({ type: 'globe' })
        map.setSky({
          'sky-color': '#0a0e1a',
          'horizon-color': '#1c2540',
          'fog-color': '#05070d',
          'fog-ground-blend': 0.5,
          'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.8, 5, 0.4, 7, 0],
        })
      })

      const pickAt = (point: { x: number; y: number }) => {
        const p = new maplibregl.Point(point.x, point.y)
        let hits = map.queryRenderedFeatures(p, { layers: ['candidates-fill'] })
        if (!hits.length) {
          // forgive near-boundary / tiny-polygon misses with a small padded box
          const pad = 8
          hits = map.queryRenderedFeatures(
            [
              [point.x - pad, point.y - pad],
              [point.x + pad, point.y + pad],
            ],
            { layers: ['candidates-fill'] },
          )
        }
        const hit = hits[0]
        if (!hit) return
        pickRef.current(
          String(hit.properties?.candidateId),
          hit.properties?.groupName ? String(hit.properties.groupName) : undefined,
          String(hit.properties?.name ?? ''),
        )
      }

      map.on('mousemove', (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: ['candidates-fill'] })
        map.getCanvas().style.cursor = hits.length ? 'pointer' : ''
      })

      map.on('click', (e) => {
        // Safari touchend already handled the tap — skip the synthesized click
        if (Date.now() - lastTouchPickAt < 700) return
        pickAt(e.point)
      })

      // Some iOS Safari versions never fire the synthesized tap->click, so
      // pick directly from touchend (taps only — not pans/pinches).
      let touchStart: { x: number; y: number; t: number } | null = null
      const onTouchStart = (ev: TouchEvent) => {
        const t = ev.changedTouches[0]
        touchStart = t ? { x: t.clientX, y: t.clientY, t: Date.now() } : null
      }
      const onTouchEnd = (ev: TouchEvent) => {
        const start = touchStart
        const t = ev.changedTouches[0]
        if (!start || !t) return
        const moved = Math.hypot(t.clientX - start.x, t.clientY - start.y)
        if (moved > 12 || Date.now() - start.t > 600) return
        lastTouchPickAt = Date.now()
        pickAt({ x: t.clientX, y: t.clientY })
      }
      const el = containerRef.current
      if (!el) return
      el.addEventListener('touchstart', onTouchStart, { passive: true })
      el.addEventListener('touchend', onTouchEnd, { passive: true })
      cleanupTouch = () => {
        el.removeEventListener('touchstart', onTouchStart)
        el.removeEventListener('touchend', onTouchEnd)
      }
    }

    init()

    return () => {
      cancelled = true
      cleanupTouch?.()
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  // Candidate polygons — data only; coloring is handled by the paint effect below
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const apply = () => {
      const collection: FeatureCollection = {
        type: 'FeatureCollection',
        features: (candidates ?? []).map((c) => ({
          type: 'Feature',
          properties: {
            candidateId: c.id,
            name: c.name,
            groupName: c.groupName ?? '',
          },
          geometry: c.geometry,
        })),
      }

      const source = map.getSource('candidates') as MapLibreGL.GeoJSONSource | undefined
      if (source) {
        source.setData(collection)
      } else {
        map.addSource('candidates', { type: 'geojson', data: collection })
        map.addLayer({
          id: 'candidates-fill',
          type: 'fill',
          source: 'candidates',
          paint: {
            'fill-color': 'rgba(255,255,255,0.10)',
            'fill-outline-color': 'rgba(255,255,255,0.45)',
          },
        })
      }
    }

    if (map.isStyleLoaded()) {
      apply()
    } else {
      // 'idle' re-fires after every render settle, unlike 'load' which only fires once
      map.once('idle', apply)
    }
  }, [candidates])

  // Red/green paint — cheap paint-property update, no data re-serialization
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    const applyPaint = () => {
      if (!map.getLayer('candidates-fill')) return
      map.setPaintProperty('candidates-fill', 'fill-color', [
        'case',
        ['in', ['get', 'groupName'], ['literal', wrongGroups]],
        '#ef4444',
        ['in', ['get', 'groupName'], ['literal', solvedGroups]],
        '#22c55e',
        'rgba(255,255,255,0.10)',
      ])
    }

    if (map.isStyleLoaded()) applyPaint()
    else map.once('idle', applyPaint)
  }, [wrongGroups, solvedGroups, mapReady])

  // Show only place labels relevant to the current level
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    const applyLabels = () => {
      if (!placeLayersRef.current) {
        placeLayersRef.current = map
          .getStyle()
          .layers.filter(
            (l): l is MapLibreGL.LayerSpecification & { 'source-layer': string } =>
              l.type === 'symbol' && 'source-layer' in l && l['source-layer'] === 'place',
          )
          .map((l) => {
            const f = map.getFilter(l.id)
            return {
              id: l.id,
              filter: typeof f === 'boolean' ? null : (f as MapLibreGL.FilterSpecification | null),
            }
          })
      }
      const classes =
        labelClasses === 'all'
          ? ['continent', 'country', 'state', 'city', 'town', 'village', 'suburb', 'neighbourhood']
          : labelClasses
      for (const { id, filter } of placeLayersRef.current) {
        const relevance = ['match', ['get', 'class'], classes, true, false]
        const combined = filter ? ['all', filter, relevance] : relevance
        map.setFilter(id, combined as MapLibreGL.FilterSpecification)
      }
    }

    if (map.isStyleLoaded()) applyLabels()
    else map.once('idle', applyLabels)
  }, [labelClasses, mapReady])

  // Camera framing
  useEffect(() => {
    const map = mapRef.current
    if (!map || !fitBounds) return
    map.fitBounds(fitBounds, { padding: 60, duration: 1600, maxZoom: 12 })
  }, [fitBounds])

  // Final fly-to + marker
  useEffect(() => {
    if (!mapReady || !completed) return
    const map = mapRef.current!
    const maplibregl = maplibreRef.current!
    if (!map || !maplibregl) return

    map.flyTo({ center: DESTINATION.coords, zoom: FINAL_ZOOM, duration: 4000 })
    const marker = new maplibregl.Marker({ color: '#f472b6' })
      .setLngLat(DESTINATION.coords)
      .setPopup(
        new maplibregl.Popup({ offset: 24 }).setHTML(
          `<strong>${DESTINATION.name}</strong><br/>Ott találkozunk 💛`,
        ),
      )
      .addTo(map)
    marker.togglePopup()

    return () => {
      marker.remove()
    }
  }, [completed, mapReady])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ position: 'absolute' }}
      aria-label="Világtérkép"
    />
  )
}

export { WORLD_BOUNDS, unionBbox }
