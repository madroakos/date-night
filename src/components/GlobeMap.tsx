import { useEffect, useRef } from 'react'
import type * as MapLibreGL from 'maplibre-gl'

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/dark'

export function GlobeMap() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let map: MapLibreGL.Map | null = null
    let cancelled = false

    async function init() {
      const maplibregl = await import('maplibre-gl')
      if (cancelled || !containerRef.current) return

      map = new maplibregl.Map({
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

      map.addControl(
        new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }),
        'top-right',
      )

      map.on('style.load', () => {
        map?.setProjection({ type: 'globe' })
        map?.setSky({
          'sky-color': '#0a0e1a',
          'horizon-color': '#1c2540',
          'fog-color': '#05070d',
          'fog-ground-blend': 0.5,
          'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.8, 5, 0.4, 7, 0],
        })
      })

      map.on('click', (e) => {
        const features = map ? map.queryRenderedFeatures(e.point) : []
        const names = features
          .map((f) => (f.properties?.name as string | undefined) ?? f.layer?.id)
          .filter(Boolean)
        console.log('[map] clicked', names)
      })
    }

    init()

    return () => {
      cancelled = true
      map?.remove()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ position: 'absolute' }}
      aria-label="World map"
    />
  )
}
