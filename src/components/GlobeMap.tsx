import { useEffect, useRef, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import type * as MapLibreGL from 'maplibre-gl'
import type { Candidate } from '../game/data'
import { unionBbox } from '../game/data'
import type { DestinationConfig } from '../game/config'

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
  minCameraZoom: number
  labelClasses: string[] | 'all'
  completed: boolean
  destination: DestinationConfig
  onFinalFlightEnd: () => void
  onPick: (candidateId: string, groupName: string | undefined, name: string) => void
}

export function isPhoneViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < 640
}

export function GlobeMap({
  candidates,
  dataKey,
  wrongGroups,
  solvedGroups,
  fitBounds,
  minCameraZoom,
  labelClasses,
  completed,
  destination,
  onFinalFlightEnd,
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
  const finalFlightEndRef = useRef(onFinalFlightEnd)
  finalFlightEndRef.current = onFinalFlightEnd
  const candidatesRef = useRef(candidates)
  candidatesRef.current = candidates
  const appliedDataRef = useRef<{ key: string; data: Candidate[] | null } | null>(null)
  const styleReadyRef = useRef(false)

  /** Apply a style-level change immediately once the base style exists.
   *  Never wait on 'idle' — that only fires after ALL tiles load, which on a
   *  slow connection delays paint/label/data changes by many seconds. */
  function runWhenStyled(map: MapLibreGL.Map, fn: () => void) {
    const safe = () => {
      try {
        fn()
      } catch {
        // style mid-reload — retry once it (re)loads
        map.once('style.load', fn)
      }
    }
    if (styleReadyRef.current) safe()
    else map.once('style.load', safe)
  }
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
        zoom: isPhoneViewport() ? 1.05 : 1.4,
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
        styleReadyRef.current = true
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

        const cityAreas = dataKey === 'city'
          ? (candidates ?? []).filter((candidate) => candidate.groupName !== 'Budapest')
          : []
        const districts = dataKey === 'city'
          ? (candidates ?? []).filter((candidate) => candidate.groupName === 'Budapest')
          : []
        const labelAreas = cityAreas.map((candidate) => ({
          name: candidate.name,
          bbox: candidate.bbox,
        }))
        if (districts.length > 0) {
          labelAreas.push({ name: 'Budapest', bbox: unionBbox(districts.map((district) => district.bbox)) })
        }
        const labelCollection: FeatureCollection = {
          type: 'FeatureCollection',
          features: labelAreas.map(({ name, bbox }) => ({
            type: 'Feature',
            properties: { name },
            geometry: {
              type: 'Point',
              coordinates: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
            },
          })),
        }
        const labelSource = map.getSource('candidate-city-labels') as MapLibreGL.GeoJSONSource | undefined
        if (labelSource) {
          labelSource.setData(labelCollection)
        } else {
          map.addSource('candidate-city-labels', { type: 'geojson', data: labelCollection })
          map.addLayer({
            id: 'candidate-city-labels',
            type: 'symbol',
            source: 'candidate-city-labels',
            layout: {
              'text-field': ['get', 'name'],
              'text-size': 12,
              'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
              'text-radial-offset': 0.5,
            },
            paint: {
              'text-color': '#ffffff',
              'text-halo-color': '#101522',
              'text-halo-width': 2,
            },
          })
        }
      }
      appliedDataRef.current = { key: dataKey, data: candidates }
      dataReadyRef.current = { key: dataKey, ready: true }
    }

    runWhenStyled(map, apply)
  }, [candidates, dataKey, mapReady])

  // Red/green paint — cheap paint-property update, no data re-serialization
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    const applyPaint = () => {
      if (!map.getLayer('candidates-fill')) return
      map.setPaintProperty('candidates-fill', 'fill-color', [
        'case',
        [
          'any',
          ['in', ['get', 'groupName'], ['literal', wrongGroups]],
          ['in', ['get', 'name'], ['literal', wrongGroups]],
        ],
        '#ef4444',
        [
          'any',
          ['in', ['get', 'groupName'], ['literal', solvedGroups]],
          ['in', ['get', 'name'], ['literal', solvedGroups]],
        ],
        '#22c55e',
        'rgba(255,255,255,0.10)',
      ])
    }

    runWhenStyled(map, applyPaint)
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

    runWhenStyled(map, applyLabels)
  }, [labelClasses, mapReady])

  // Camera framing
  useEffect(() => {
    const map = mapRef.current
    // Completion has its own destination flight below. Scheduling the normal
    // level camera here would fire later and cancel that final animation.
    if (!map || !mapReady || !fitBounds || completed) return

    // Let the successful pointer/touch gesture and any immediately-following
    // bounds update finish first. Otherwise MapLibre's trailing gesture event
    // cancels the flight almost as soon as it starts.
    const timer = window.setTimeout(() => {
      if (mapRef.current !== map) return
      const camera = map.cameraForBounds(fitBounds, { padding: 60, maxZoom: 12 })
      if (!camera) return

      map.stop()
      map.flyTo({
        center: camera.center,
        // Each game step has a deliberate destination zoom. Using the fitted
        // zoom here made transitions barely visible on tall phone viewports.
        zoom: minCameraZoom,
        bearing: 0,
        pitch: 0,
        duration: 2200,
        essential: true,
      })
    }, 120)

    return () => window.clearTimeout(timer)
  }, [completed, fitBounds, mapReady, minCameraZoom])

  // Final fly-to + marker
  useEffect(() => {
    if (!mapReady || !completed) return
    const map = mapRef.current!
    const maplibregl = maplibreRef.current!
    if (!map || !maplibregl) return

    const finalZoom = destination.mapZoom ?? 17
    const handleMoveEnd = () => {
      const center = map.getCenter()
      const [longitude, latitude] = destination.coordinates
      const arrived =
        Math.abs(center.lng - longitude) < 0.001 &&
        Math.abs(center.lat - latitude) < 0.001 &&
        Math.abs(map.getZoom() - finalZoom) < 0.1
      if (!arrived) return
      map.off('moveend', handleMoveEnd)
      finalFlightEndRef.current()
    }
    // Start after the gesture that solved the last level has fully finished;
    // otherwise its trailing event can consume/cancel the flight's moveend.
    const flightTimer = window.setTimeout(() => {
      // Keep listening until the destination is actually reached; an initial
      // style/load moveend may fire before the flight's own moveend.
      map.on('moveend', handleMoveEnd)
      map.flyTo({
        center: destination.coordinates,
        zoom: finalZoom,
        duration: 4000,
        essential: true,
      })
    }, 120)
    const marker = new maplibregl.Marker({ color: '#f472b6' })
      .setLngLat(destination.coordinates)
      .setPopup(
        new maplibregl.Popup({ offset: 24 }).setHTML(
          `<strong>${escapeHtml(destination.shortName ?? destination.name)}</strong><br/>${escapeHtml(destination.markerMessage ?? 'Ott találkozunk 💛')}`,
        ),
      )
      .addTo(map)
    marker.togglePopup()

    return () => {
      window.clearTimeout(flightTimer)
      map.off('moveend', handleMoveEnd)
      marker.remove()
    }
  }, [completed, destination, mapReady])

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

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }
  return value.replace(/[&<>'"]/g, (character) => entities[character])
}
