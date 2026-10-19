import { useEffect } from 'react'
import type { BufferGeometry } from 'three'

/** Registry of GeoBuilder outputs drawn together by <StaticBatch /> (staticBatch.tsx). */

type Geos = Map<string, BufferGeometry>

const sources = new Set<Geos>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Every registered builder output. */
export function staticSources(): Iterable<Geos> {
  return sources
}

/** Listen for (un)registrations; calls back once immediately. Returns the unsubscribe. */
export function subscribeStatic(l: () => void) {
  listeners.add(l)
  l()
  return () => void listeners.delete(l)
}

/** Hand a builder's output (material key → geometry) to the batch while the component is mounted. */
export function useStaticGeometry(geos: Geos | null) {
  useEffect(() => {
    if (!geos) return
    sources.add(geos)
    emit()
    return () => {
      sources.delete(geos)
      emit()
    }
  }, [geos])
}
