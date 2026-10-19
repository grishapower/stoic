import { CITRUS_POT_LIFT, CITRUS_TREES } from '../world/citrus'
import { FOUNTAIN } from '../world/layout'
import { BIRD_BATH, BEEHIVES, DOVECOTE } from '../world/props'
import { groundHeight } from '../world/ground'
import { CYPRESSES, OLIVES, PINES } from '../world/vegetation'

/**
 * Rough volumes (vertical cylinders) that low-flying life must avoid: tree
 * canopies, the fountain, the bird bath, hives and the dovecote. Sizes are
 * conservative envelopes of the procedural trees in scenes/Vegetation.tsx.
 */

export interface Obstacle {
  x: number
  z: number
  /** Horizontal radius (m). */
  radius: number
  /** Ground height at the base. */
  base: number
  /** Height of the top above the base (m). */
  top: number
  /** Tall and narrow (cypress, dovecote): fliers go around, not over. */
  pillar: boolean
  /** Radius of the solid part below ~1.6 m (trunk, low canopy, basin…) for insects. */
  low: number
}

let cache: Obstacle[] | null = null

export function allObstacles(): Obstacle[] {
  if (cache) return cache
  const out: Obstacle[] = []
  for (const t of OLIVES) out.push({ x: t.x, z: t.z, radius: 3.6 * t.scale, base: t.y, top: 5.8 * t.scale, pillar: false, low: 0.5 * t.scale })
  for (const t of PINES) out.push({ x: t.x, z: t.z, radius: 5.6 * t.scale, base: t.y, top: 10.5 * t.scale, pillar: false, low: 0.6 * t.scale })
  for (const t of CYPRESSES) out.push({ x: t.x, z: t.z, radius: 1.1 * t.scale, base: t.y, top: 12.5 * t.scale, pillar: true, low: 0.8 * t.scale })
  for (const t of CITRUS_TREES) out.push({ x: t.x, z: t.z, radius: 1.6 * t.scale, base: t.y + (t.potted ? CITRUS_POT_LIFT : 0), top: 2.95 * t.scale, pillar: false, low: 1.15 * t.scale })
  out.push({ x: FOUNTAIN.x, z: FOUNTAIN.z, radius: 1.2, base: groundHeight(FOUNTAIN.x, FOUNTAIN.z), top: 2.0, pillar: false, low: 2.0 })
  out.push({ x: BIRD_BATH.x, z: BIRD_BATH.z, radius: 0.5, base: groundHeight(BIRD_BATH.x, BIRD_BATH.z), top: 1.1, pillar: false, low: 0.45 })
  out.push({ x: BEEHIVES.x, z: BEEHIVES.z, radius: 1.4, base: groundHeight(BEEHIVES.x, BEEHIVES.z), top: 1.3, pillar: false, low: 0.9 })
  out.push({ x: DOVECOTE.x, z: DOVECOTE.z, radius: 1.9, base: groundHeight(DOVECOTE.x, DOVECOTE.z), top: 4.8, pillar: true, low: 1.8 })
  cache = out
  return out
}

/**
 * Push (x, z) out of a pillar's keep-out disc with a continuous radial
 * compression (identity outside `keep`), written into `out`.
 */
export function avoidPillar(o: Obstacle, x: number, z: number, keep: number, out: { x: number; z: number }): void {
  const dx = x - o.x
  const dz = z - o.z
  const d = Math.hypot(dx, dz)
  out.x = x
  out.z = z
  if (d >= keep || d < 1e-6) return
  const inner = o.radius + 0.35
  const nd = inner + d * ((keep - inner) / keep)
  out.x = o.x + (dx / d) * nd
  out.z = o.z + (dz / d) * nd
}

/** Obstacles whose footprint comes within `range` of (x, z). */
export function obstaclesNear(x: number, z: number, range: number): Obstacle[] {
  return allObstacles().filter((o) => Math.hypot(o.x - x, o.z - z) < range + o.radius)
}
