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
  dataKey: string
  wrongGroups: string[]
  solvedGroups: string[]
  fitBounds: [[number, number], [number, number]] | null
  labelClasses: string[] | 'all'
  completed: boolean
  onPick: (candidateId: string, groupName: string | undefined, name: string) => void
}

export function GlobeMap({
  candidates,
  dataKey,
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
  const [debug, setDebug] = useState<{ lastGesture: string; lastError: string; candidates: string }>({
    lastGesture: '-',
    lastError: '',
    candidates: '-',
  })
  const debugOn = typeof window !== 'undefined' && window.location.search.includes('debug')
  const placeLayersRef = useRef<{ id: string; filter: MapLibreGL.FilterSpecification | null }[] | null>(null)
  const pickRef = useRef(onPick)
  pickRef.current = onPick
  const candidatesRef = useRef(candidates)
  candidatesRef.current = candidates
  const appliedDataRef = useRef<{ key: string; data: Candidate[] | null } | null>(null)
  // A tap is only honored once the data for the CURRENT level has been applied.
  // This kills the race where a click at a level switch hits stale polygons.
  const dataReadyRef = useRef<{ key: string; ready: boolean }>({ key: '', ready: false })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
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
        if (!candidatesRef.current) return // data loading for this step — ignore taps
        if (!dataReadyRef.current.ready) return
        try {
          const p = new maplibregl.Point(point.x, point.y)
          let hits = map.queryRenderedFeatures(p, { layers: ['candidates-fill'] })
          if (!hits.length) {
            // forgive near-boundary / tiny-polygon misses with a small padded box
            const pad = 12
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
        } catch (err) {
          setDebug((d) => ({ ...d, lastError: String(err) }))
          console.error('[map] pick failed', err)
        }
      }

      map.on('mousemove', (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: ['candidates-fill'] })
        map.getCanvas().style.cursor = hits.length ? 'pointer' : ''
      })

      // Unified tap detection: capture-phase listeners on `window` so no element
      // (canvas, overlay, or browser quirk) can swallow the gesture. Handles
      // Pointer Events where available and touch events as fallback; browsers
      // that synthesize `click` after a tap are deduped via `lastPickAt`.
      let down: { x: number; y: number; t: number } | null = null
      let lastPickAt = 0

      const isTap = (x: number, y: number) =>
        down !== null &&
        Math.hypot(x - down.x, y - down.y) < 15 &&
        Date.now() - down.t < 1500

      const toCanvasPoint = (clientX: number, clientY: number) => {
        // iOS Safari: fixed canvas can be offset from the visual viewport
        // (toolbars) and the page can be scrolled — always convert to canvas space
        const rect = containerRef.current?.getBoundingClientRect()
        return {
          x: clientX - (rect?.left ?? 0),
          y: clientY - (rect?.top ?? 0),
        }
      }

      const tryPick = (clientX: number, clientY: number) => {
        if (Date.now() - lastPickAt < 500) return
        lastPickAt = Date.now()
        const { x, y } = toCanvasPoint(clientX, clientY)
        setDebug((d) => ({ ...d, lastGesture: `up@${Math.round(x)},${Math.round(y)}` }))
        pickAt({ x, y })
      }

      const onDown = (x: number, y: number) => {
        down = { x, y, t: Date.now() }
        setDebug((d) => ({ ...d, lastGesture: `down@${Math.round(x)},${Math.round(y)}` }))
      }
      const onUp = (x: number, y: number) => {
        if (isTap(x, y)) tryPick(x, y)
        down = null
      }

      const onPointerDown = (e: PointerEvent) => onDown(e.clientX, e.clientY)
      const onPointerUp = (e: PointerEvent) => onUp(e.clientX, e.clientY)
      const onTouchStart = (e: TouchEvent) => {
        const t = e.changedTouches[0]
        if (t) onDown(t.clientX, t.clientY)
      }
      const onTouchEnd = (e: TouchEvent) => {
        const t = e.changedTouches[0]
        if (t) onUp(t.clientX, t.clientY)
      }

      const onViewportResize = () => map.resize()
      window.addEventListener('resize', onViewportResize)
      window.visualViewport?.addEventListener('resize', onViewportResize)

      window.addEventListener('pointerdown', onPointerDown, { capture: true })
      window.addEventListener('pointerup', onPointerUp, { capture: true })
      window.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
      window.addEventListener('touchend', onTouchEnd, { capture: true, passive: true })
      map.on('click', (e) => {
        // pointer/touch listeners above already handled this gesture
        if (Date.now() - lastPickAt < 500) return
        pickAt(e.point)
      })

      cleanupTouch = () => {
        window.removeEventListener('resize', onViewportResize)
        window.visualViewport?.removeEventListener('resize', onViewportResize)
        window.removeEventListener('pointerdown', onPointerDown, { capture: true } as EventListenerOptions)
        window.removeEventListener('pointerup', onPointerUp, { capture: true } as EventListenerOptions)
        window.removeEventListener('touchstart', onTouchStart, { capture: true } as EventListenerOptions)
        window.removeEventListener('touchend', onTouchEnd, { capture: true } as EventListenerOptions)
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
    dataReadyRef.current = { key: dataKey, ready: false }
    const map = mapRef.current
    if (!map) return

    const apply = () => {
      const applied = appliedDataRef.current
      if (!applied || applied.key !== dataKey || applied.data !== candidates) {
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
        setDebug((d) => ({ ...d, candidates: String((candidates ?? []).length) }))
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
      appliedDataRef.current = { key: dataKey, data: candidates }
      dataReadyRef.current = { key: dataKey, ready: true }
    }

    if (map.isStyleLoaded()) {
      apply()
    } else {
      // 'idle' re-fires after every render settle, unlike 'load' which only fires once
      map.once('idle', apply)
    }
  }, [candidates, dataKey])

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
    if (!map || !mapReady || !fitBounds) return
    map.fitBounds(fitBounds, { padding: 60, duration: 1600, maxZoom: 12 })
  }, [fitBounds, mapReady])

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
    <>
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ position: 'absolute' }}
        aria-label="Világtérkép"
      />
      {debugOn && (
        <div className="pointer-events-none absolute bottom-16 left-2 z-20 rounded-lg bg-black/80 px-2 py-1 text-[10px] leading-4 text-lime-300">
          gesture: {debug.lastGesture}
          <br />
          candidates: {debug.candidates}
          <br />
          error: {debug.lastError || 'none'}
        </div>
      )}
    </>
  )
}

export { WORLD_BOUNDS, unionBbox }
