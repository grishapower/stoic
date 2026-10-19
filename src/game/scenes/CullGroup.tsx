import { useEffect, useRef, type ReactNode } from 'react'
import type { Group } from 'three'
import { useGame, type Quality } from '../store'
import { lodEntry, registerLod } from './lod'

/**
 * A group of small static things (a desk's clutter, a shrine, a bird bath…)
 * hidden beyond `far[quality]` metres; the caller gives the bounding sphere
 * because models inside may still be loading when this mounts.
 */
export function CullGroup({ center, radius, far, children }: { center: readonly [number, number, number]; radius: number; far: Record<Quality, number>; children?: ReactNode }) {
  const quality = useGame((s) => s.settings.quality)
  const ref = useRef<Group>(null)
  const [x, y, z] = center
  const d = far[quality]
  useEffect(() => {
    const g = ref.current
    if (!g || d === Infinity) return
    return registerLod([lodEntry(g, { far: d }, { x, y, z, r: radius })])
  }, [x, y, z, radius, d])
  return <group ref={ref}>{children}</group>
}
