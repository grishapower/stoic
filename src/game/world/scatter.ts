import { PATH_HALF_WIDTH, SEA_LEVEL } from './layout'
import { fbm, rng } from './noise'
import { nearestOnPath } from './path'
import { COVE } from './props'
import { terrainHeight } from './terrain'
import { blockedByArchitecture, CYPRESSES, insideEstate, OLIVES } from './vegetation'

/**
 * Placements for the open CC0 models (Poly Haven, see docs/assets/open-models.md):
 * rocks, a jetty and a fishermen's fire in the cove below the terrace; dry
 * garrigue, helichrysum and wild marigolds along the walk. Rendered instanced per variant node (OpenScatter.tsx).
 */

export interface ScatterItem {
  /** Variant node (or undefined for single-object models). */
  node?: string
  x: number
  y: number
  z: number
  rotY: number
  scale: number
}

export interface ScatterSet {
  id: string
  items: ScatterItem[]
  castShadow: boolean
}

const one = (id: string, x: number, z: number, rotY: number, scale = 1, dy = 0, node?: string): ScatterItem & { id: string } => ({
  id,
  node,
  x,
  y: terrainHeight(x, z) + dy,
  z,
  rotY,
  scale,
})

/** First point (marching seaward from the cliff) where the ground is at the waterline. */
export function shoreZ(x: number, fromZ = -58, toZ = -110) {
  for (let z = fromZ; z > toZ; z -= 0.25) if (terrainHeight(x, z) < SEA_LEVEL + 0.6) return z
  return toZ
}

/** The cove at the foot of the cliff: what the terrace looks down on (offsets from COVE). */
export const COVE_FIRE = { x: COVE.x + 3.1, z: COVE.z + 1.1 }
export const COVE_JETTY = { x: COVE.x + 5, step: -2.91, sections: 2, deckAboveSea: 1.0, deckHeight: 3.61 }

function coveItems() {
  const c = (id: string, dx: number, dz: number, rotY: number, scale = 1, dy = 0, node?: string) => one(id, COVE.x + dx, COVE.z + dz, rotY, scale, dy, node)
  /** At the waterline at this x (dz: + toward the cliff, − out to sea). */
  const shore = (id: string, x: number, dz: number, rotY: number, scale = 1, dy = 0) => one(id, x, shoreZ(x) + dz, rotY, scale, dy)
  const items = [
    c('beach-pebble-patch', 1.1, -1.1, 0.3, 1, -0.05),
    shore('rock-coast-ledge', COVE.x - 6.2, 0.4, 1.2, 1.1, -0.2),
    shore('rock-coast-ledge', COVE.x + 7.0, 0.2, -0.9, 1.0, -0.25),
    shore('rock-boulder-block', 10.0, 0.8, 0.7, 1.25, -0.4),
    shore('rock-boulder-block', 29.6, 0.6, 2.1, 1.1, -0.5),
    shore('rock-rubble-cluster', 6.5, 1.0, 2.6, 1.0, -0.2),
    shore('rock-rubble-cluster', 32.5, 1.0, 1.4, 1.1, -0.2),
    shore('rock-boulder-jagged', 3.5, -0.8, 1.6, 1.3, -0.6),
    shore('rock-boulder-jagged', 35.0, -1.2, 0.3, 1.2, -0.6),
    c('rock-rubble-cluster', -0.6, 6.6, 0.1, 1.2, -0.2),
    c('rock-boulder-jagged', 8.4, -5.2, 0.8, 1.4, -0.7),
    c('rock-boulder-jagged', -6.9, -3.0, 2.2, 1.15, -0.5),
    c('rock-limestone-slab', -3.1, -3.9, 0.5, 1.0, -0.35),
    c('rock-boulder-pale', 2.4, 4.6, 0.4, 1.0, -0.1),
    c('rock-boulder-pale', -4.3, 3.9, 2.4, 0.8, -0.1),
    c('driftwood', 3.8, -1.9, 0.4, 1, -0.02, 'driftwood_a'),
    c('driftwood', -3.5, -1.7, 2.0, 1, -0.02, 'driftwood_b'),
    c('stone-fire-pit', 3.1, 1.1, 0.2, 0.75, 0),
    c('wooden-tub', -4.1, 0.8, 0.8, 1, -0.03),
  ]
  // Jetty sections chained out into the water from the beach edge.
  const z0 = shoreZ(COVE_JETTY.x, COVE.z + 4) - 0.6
  for (let i = 0; i < COVE_JETTY.sections; i++) {
    items.push({
      id: 'jetty-section',
      node: undefined,
      x: COVE_JETTY.x,
      y: SEA_LEVEL + COVE_JETTY.deckAboveSea - COVE_JETTY.deckHeight,
      z: z0 + i * COVE_JETTY.step,
      rotY: 0,
      scale: 1,
    })
  }
  // Ice plant on the sand and rocks just above the water.
  const rand = rng(8181)
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2
    const r = 2 + rand() * (COVE.radius - 2)
    const x = COVE.x + Math.cos(a) * r
    const z = COVE.z + Math.sin(a) * r * 0.8
    const h = terrainHeight(x, z)
    if (h < SEA_LEVEL + 0.5 || h > SEA_LEVEL + 3) continue
    items.push(one('iceplant-coastal', x, z, rand() * 6.28, 1.8 + rand() * 1.4, -0.01, `iceplant-coastal_${'abcdefgh'[i % 8]}`))
  }
  return items
}

/** Plants along the walk and the estate wall. `k` scales counts by quality. */
function walkPlants(k: number) {
  const rand = rng(2323)
  const items: (ScatterItem & { id: string })[] = []
  const clear = (x: number, z: number) => {
    for (const t of CYPRESSES) if (Math.abs(t.x - x) < 1.5 && Math.abs(t.z - z) < 1.5) return false
    for (const t of OLIVES) if (Math.abs(t.x - x) < 1.4 && Math.abs(t.z - z) < 1.4) return false
    return true
  }
  // Helichrysum and wild marigold right at the path edge.
  let guard = 0
  let n = 0
  const want = Math.round(110 * k)
  while (n < want && guard++ < want * 40) {
    const x = -36 + rand() * 68
    const z = -42 + rand() * 88
    if (!insideEstate(x, z) || blockedByArchitecture(x, z, 0.3)) continue
    const d = nearestOnPath(x, z).d
    if (d < PATH_HALF_WIDTH + 0.15 || d > PATH_HALF_WIDTH + 1.6) continue
    if (fbm(x * 0.2 + 1.3, z * 0.2 - 4.1, 2) < -0.05) continue
    if (!clear(x, z)) continue
    const heli = rand() < 0.6
    const v = heli ? 'abcd'[Math.floor(rand() * 4)] : 'abcde'[Math.floor(rand() * 5)]
    items.push(one(heli ? 'helichrysum-clump' : 'calendula-wild', x, z, rand() * 6.28, heli ? 1.6 + rand() * 1.2 : 1.3 + rand() * 0.9, -0.02, `${heli ? 'helichrysum-clump' : 'calendula-wild'}_${v}`))
    n++
  }
  // Garrigue (dry scrub) hugging the estate's dry-stone wall, inside and out.
  guard = 0
  n = 0
  const wantScrub = Math.round(70 * k)
  while (n < wantScrub && guard++ < wantScrub * 60) {
    const x = -48 + rand() * 92
    const z = -50 + rand() * 105
    const inside = insideEstate(x, z)
    // Near the boundary only: test a ring of points around.
    let nearEdge = false
    for (let a = 0; a < 6 && !nearEdge; a++) {
      const r = 2.2
      if (insideEstate(x + Math.cos(a) * r, z + Math.sin(a) * r) !== inside) nearEdge = true
    }
    if (!nearEdge || blockedByArchitecture(x, z, 1)) continue
    const h = terrainHeight(x, z)
    if (h < -8) continue // keep off the cliff face
    if (nearestOnPath(x, z).d < 3.5) continue
    if (!clear(x, z)) continue
    items.push(one('dry-scrub', x, z, rand() * 6.28, 0.9 + rand() * 0.5, -0.05, `dry-scrub_${'abc'[Math.floor(rand() * 3)]}`))
    n++
  }
  return items
}

const SHADOW_IDS = new Set(['rock-coast-ledge', 'rock-boulder-block', 'rock-rubble-cluster', 'rock-boulder-jagged', 'rock-limestone-slab', 'rock-boulder-pale', 'jetty-section', 'dry-scrub', 'wooden-tub'])

/** Share of the walk's plants placed per quality (draw distances are in scenes/quality.ts). */
export const SCATTER_SCALE: Record<'low' | 'medium' | 'high', number> = { low: 0.4, medium: 0.7, high: 1 }

export function buildScatter(quality: 'low' | 'medium' | 'high' = 'high'): ScatterSet[] {
  const k = SCATTER_SCALE[quality]
  const all = [...coveItems(), ...walkPlants(k)]
  const byId = new Map<string, ScatterItem[]>()
  for (const { id, ...it } of all) {
    if (!byId.has(id)) byId.set(id, [])
    byId.get(id)!.push(it)
  }
  return [...byId].map(([id, items]) => ({ id, items, castShadow: SHADOW_IDS.has(id) }))
}
