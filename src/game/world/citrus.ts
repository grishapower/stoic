import { FOUNTAIN } from './layout'
import { groundHeight } from './ground'
import { rng } from './noise'

/**
 * Citrus trees with pickable fruit.
 *
 * Fruit kind: the user asked for mandarins. Historical note — mandarins only
 * reached Europe in the 19th century; the citron (Citrus medica) is the citrus
 * a 1st-century Roman garden would plausibly have (it appears on Pompeian
 * frescoes). Switch FRUIT_KIND to 'citron' for the historically accurate variant.
 */
export type FruitKind = 'mandarin' | 'citron'
export const FRUIT_KIND: FruitKind = 'mandarin'

export const FRUIT_INFO: Record<FruitKind, { nameAcc: string; radius: number; color: string; elong: number }> = {
  mandarin: { nameAcc: 'мандарин', radius: 0.034, color: '#f08a1c', elong: 0.86 },
  citron: { nameAcc: 'цитрон', radius: 0.045, color: '#e9cf3a', elong: 1.45 },
}

export interface CitrusClump {
  /** Local centre (tree space, metres before instance scale). */
  c: [number, number, number]
  r: number
  sy: number
}

export interface CitrusTree {
  id: number
  x: number
  y: number
  z: number
  rot: number
  scale: number
  /** Planted in a big terracotta pot (porch). */
  potted: boolean
  variant: number
}

/** Canopy layout of a citrus variant — shared by the geometry and fruit placement. */
export function citrusCanopy(variant: number): { clumps: CitrusClump[]; trunkTop: [number, number, number] } {
  const rand = rng(900 + variant * 31)
  // Bushy, low-crowned citrus: canopy from ~0.6 m to ~2.6 m.
  const trunkTop: [number, number, number] = [(rand() - 0.5) * 0.15, 0.62 + rand() * 0.1, (rand() - 0.5) * 0.15]
  const clumps: CitrusClump[] = [{ c: [trunkTop[0], 1.55, trunkTop[2]], r: 0.95, sy: 0.9 }]
  const n = 6
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.5
    const d = 0.6 + rand() * 0.25
    clumps.push({ c: [trunkTop[0] + Math.cos(a) * d, 1.15 + rand() * 0.75, trunkTop[2] + Math.sin(a) * d], r: 0.55 + rand() * 0.2, sy: 0.85 })
  }
  clumps.push({ c: [trunkTop[0] + (rand() - 0.5) * 0.3, 2.2, trunkTop[2] + (rand() - 0.5) * 0.3], r: 0.62, sy: 0.85 })
  return { clumps, trunkTop }
}

function buildTrees(): CitrusTree[] {
  const rand = rng(31415)
  const out: CitrusTree[] = []
  const add = (x: number, z: number, scale: number, potted = false) =>
    out.push({ id: out.length, x, y: groundHeight(x, z), z, rot: rand() * Math.PI * 2, scale, potted, variant: out.length % 3 })
  // Peristyle beds: on the diagonals just beyond the hedge ring, reachable from the fountain path.
  const d = 3.3
  add(FOUNTAIN.x - d, FOUNTAIN.z - d, 0.92)
  add(FOUNTAIN.x + d, FOUNTAIN.z - d, 0.95)
  add(FOUNTAIN.x - d, FOUNTAIN.z + d, 0.9)
  add(FOUNTAIN.x + d, FOUNTAIN.z + d, 0.96)
  // A small orchard around the pergola.
  add(13.6, -24.2, 1.0)
  add(24.4, -14.6, 1.05)
  add(24.6, -24.6, 0.98)
  add(14.2, -13.2, 0.95)
  // Potted citrus on the porch, by the south colonnade.
  add(-8.6, 18.4, 0.62, true)
  add(8.6, 18.4, 0.62, true)
  return out
}

export const CITRUS_TREES = buildTrees()

/** Pot height (metres) for potted trees; the tree stands on the soil inside. */
export const CITRUS_POT_LIFT = 0.62

export interface FruitHome {
  treeId: number
  x: number
  y: number
  z: number
}

/** Deterministic fruit positions on the outer/lower canopy (world space). */
function buildFruitHomes(): FruitHome[] {
  const out: FruitHome[] = []
  for (const t of CITRUS_TREES) {
    const rand = rng(777 + t.id * 13)
    const { clumps } = citrusCanopy(t.variant)
    const cos = Math.cos(t.rot)
    const sin = Math.sin(t.rot)
    const lift = t.potted ? CITRUS_POT_LIFT : 0
    const count = t.potted ? 9 : 20
    let guard = 0
    let placed = 0
    while (placed < count && guard++ < 400) {
      const cl = clumps[Math.floor(rand() * clumps.length)]
      // Mostly sideways/below: fruit hangs on the outside of the foliage.
      const a = rand() * Math.PI * 2
      const vy = -0.65 + rand() * 0.95
      const h = Math.sqrt(Math.max(0, 1 - vy * vy))
      // Just outside the foliage surface so the fruit reads clearly.
      const outward = 0.97 + rand() * 0.06
      const lx = cl.c[0] + Math.cos(a) * h * cl.r * outward
      const ly = cl.c[1] + vy * cl.r * cl.sy * outward
      const lz = cl.c[2] + Math.sin(a) * h * cl.r * outward
      // Keep fruit outside every other clump (visible) — skip if buried.
      let buried = false
      for (const o of clumps) {
        if (o === cl) continue
        const dx = lx - o.c[0]
        const dy = (ly - o.c[1]) / o.sy
        const dz = lz - o.c[2]
        if (Math.hypot(dx, dy, dz) < o.r * 0.98) buried = true
      }
      if (buried) continue
      const sx = lx * t.scale
      const sy = ly * t.scale
      const sz = lz * t.scale
      const wx = t.x + sx * cos + sz * sin
      const wz = t.z - sx * sin + sz * cos
      const wy = t.y + lift + sy
      // Within reach of a standing person.
      if (wy - t.y < 0.7 || wy - t.y > 2.7) continue
      out.push({ treeId: t.id, x: wx, y: wy, z: wz })
      placed++
    }
  }
  return out
}

export const FRUIT_HOMES = buildFruitHomes()
