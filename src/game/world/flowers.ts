import { FOUNTAIN, PATH_HALF_WIDTH } from './layout'
import { GARDEN_FLOOR } from './architecture'
import { CITRUS_TREES } from './citrus'
import { fbm, rng } from './noise'
import { nearestOnPath } from './path'
import { terrainHeight } from './terrain'
import { AEDICULA, BIRD_BATH, BUTTERFLY_ZONES, EROS_STATUE } from './props'
import { blockedByArchitecture, CYPRESSES, insideEstate, OLIVES, PINES } from './vegetation'

/**
 * Flowers (one instanced mesh): bed borders in the peristyle, wild poppies,
 * chamomile and tall fennel in the dry grass along the walk, offerings at the
 * shrine. Pure placement; the scene builds the geometry.
 */

export type FlowerKind = 'poppy' | 'fennel' | 'chamomile' | 'calendula' | 'iris' | 'lily' | 'rose' | 'violet'

export interface FlowerSpec {
  color: string
  center: string
  /** Stem height range (m). */
  h: [number, number]
  /** Head radius range (m). */
  r: [number, number]
  /** Petal cup: rise of the petal tips relative to the head radius. */
  tilt: number
}

export const FLOWER_SPECS: Record<FlowerKind, FlowerSpec> = {
  poppy: { color: '#d0261a', center: '#1d1410', h: [0.32, 0.6], r: [0.032, 0.045], tilt: 0.75 },
  // Umbel: a small umbrella (tips lower than the centre), not a solid cap.
  fennel: { color: '#d8cf4c', center: '#bcb23c', h: [0.95, 1.45], r: [0.045, 0.062], tilt: -0.35 },
  chamomile: { color: '#f4f1e6', center: '#e6b52a', h: [0.18, 0.32], r: [0.016, 0.022], tilt: 0.1 },
  calendula: { color: '#ee8a1a', center: '#8a4a10', h: [0.22, 0.34], r: [0.026, 0.034], tilt: 0.3 },
  iris: { color: '#7656c4', center: '#e2c64a', h: [0.38, 0.55], r: [0.04, 0.055], tilt: 0.9 },
  lily: { color: '#f6f2ea', center: '#e8b23a', h: [0.6, 0.85], r: [0.05, 0.065], tilt: 1.1 },
  rose: { color: '#d55a78', center: '#9a2c44', h: [0.4, 0.62], r: [0.032, 0.042], tilt: 0.8 },
  violet: { color: '#7a4aa8', center: '#f2d24a', h: [0.1, 0.16], r: [0.014, 0.02], tilt: 0.2 },
}

export interface FlowerInstance {
  x: number
  y: number
  z: number
  kind: FlowerKind
  h: number
  r: number
  rot: number
  phase: number
}

const COUNT_SCALE: Record<string, number> = { low: 0.45, medium: 0.75, high: 1 }

function clearOfTrees(x: number, z: number) {
  for (const t of CYPRESSES) if (Math.abs(t.x - x) < 1.2 && Math.abs(t.z - z) < 1.2 && Math.hypot(t.x - x, t.z - z) < 0.9 * t.scale) return false
  for (const t of OLIVES) if (Math.abs(t.x - x) < 2 && Math.abs(t.z - z) < 2 && Math.hypot(t.x - x, t.z - z) < 0.7 * t.scale) return false
  for (const t of PINES) if (Math.hypot(t.x - x, t.z - z) < 0.8) return false
  return true
}

export function buildFlowers(quality: 'low' | 'medium' | 'high' = 'high'): FlowerInstance[] {
  const k = COUNT_SCALE[quality] ?? 1
  const rand = rng(5150)
  const out: FlowerInstance[] = []
  const add = (x: number, y: number, z: number, kind: FlowerKind) => {
    const s = FLOWER_SPECS[kind]
    out.push({
      x,
      y,
      z,
      kind,
      h: s.h[0] + rand() * (s.h[1] - s.h[0]),
      r: s.r[0] + rand() * (s.r[1] - s.r[0]),
      rot: rand() * Math.PI * 2,
      phase: rand() * 6.283,
    })
  }

  /* Peristyle: bed borders just inside the hedges (each bed its own mix). */
  const bedKinds: FlowerKind[][] = [
    ['iris', 'lily'],
    ['rose', 'violet'],
    ['lily', 'calendula'],
    ['iris', 'rose'],
  ]
  let bed = 0
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const kinds = bedKinds[bed++]
      const n = Math.round(90 * k)
      let placed = 0
      let guard = 0
      while (placed < n && guard++ < n * 20) {
        // A point on the bed's border band (outer hedges or inner paths).
        const side = rand()
        let ax: number
        let az: number
        if (side < 0.3) {
          ax = 8.3 + rand() * 0.45
          az = 1.7 + rand() * 5.1
        } else if (side < 0.6) {
          ax = 1.7 + rand() * 7.0
          az = 6.35 + rand() * 0.45
        } else if (side < 0.8) {
          ax = 1.75 + rand() * 0.4
          az = 3.9 + rand() * 2.9
        } else {
          ax = 3.9 + rand() * 4.9
          az = 1.75 + rand() * 0.4
        }
        const x = sx * ax
        const z = FOUNTAIN.z + sz * az
        if (Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) < 3.9) continue
        if (CITRUS_TREES.some((t) => !t.potted && Math.hypot(t.x - x, t.z - z) < 1.25)) continue
        if (Math.hypot(x - BIRD_BATH.x, z - BIRD_BATH.z) < 0.6) continue
        if (Math.hypot(x - EROS_STATUE.x, z - EROS_STATUE.z) < 0.75) continue
        // Small drifts of the same flower.
        const kind = kinds[fbm(x * 0.7 + 4, z * 0.7, 2) > 0 ? 0 : 1]
        add(x, GARDEN_FLOOR - 0.01, z, kind)
        // Cultivated flowers are fuller than the wild ones.
        out[out.length - 1].r *= 1.35
        placed++
      }
    }
  }

  /* The walk: drifts of wild flowers in the dry grass beside the path. */
  {
    const n = Math.round(900 * k)
    let guard = 0
    let placed = 0
    while (placed < n && guard++ < n * 30) {
      const x = -36 + rand() * 68
      const z = -42 + rand() * 88
      if (!insideEstate(x, z)) continue
      if (blockedByArchitecture(x, z, 0.4)) continue
      const d = nearestOnPath(x, z).d
      if (d < PATH_HALF_WIDTH + 0.35 || d > 9) continue
      const patch = fbm(x * 0.11 + 7.3, z * 0.11 - 2.1, 3)
      if (patch < 0.12 + rand() * 0.18) continue
      if (!clearOfTrees(x, z)) continue
      const mix = fbm(x * 0.05 - 3, z * 0.05 + 9, 2)
      const r = rand()
      // Tall fennel stands back from the path (it would be at eye level right beside it).
      const fennel = r < 0.12 && d > PATH_HALF_WIDTH + 2.5
      const kind: FlowerKind = fennel ? 'fennel' : mix > 0.05 ? (r < 0.75 ? 'poppy' : 'chamomile') : r < 0.45 ? 'poppy' : r < 0.85 ? 'chamomile' : 'calendula'
      add(x, terrainHeight(x, z) - 0.01, z, kind)
      placed++
    }
  }

  /* Butterfly spots outside the peristyle: a denser bloom. */
  for (const zone of BUTTERFLY_ZONES) {
    if (blockedByArchitecture(zone.x, zone.z, 0)) continue
    const n = Math.round(40 * k)
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2
      const rr = Math.sqrt(rand()) * zone.radius
      const x = zone.x + Math.cos(a) * rr
      const z = zone.z + Math.sin(a) * rr
      if (!insideEstate(x, z) || blockedByArchitecture(x, z, 0.3)) continue
      if (nearestOnPath(x, z).d < PATH_HALF_WIDTH + 0.3) continue
      const q = rand()
      add(x, terrainHeight(x, z) - 0.01, z, q < 0.5 ? 'poppy' : q < 0.8 ? 'calendula' : 'chamomile')
    }
  }

  /* Offerings at the roadside shrine. */
  {
    const c = Math.cos(AEDICULA.rotY)
    const s = Math.sin(AEDICULA.rotY)
    for (let i = 0; i < 14; i++) {
      const lx = (rand() - 0.5) * 1.3
      const lz = 0.45 + rand() * 0.45
      const x = AEDICULA.x + lx * c + lz * s
      const z = AEDICULA.z - lx * s + lz * c
      add(x, terrainHeight(x, z) - 0.01, z, i % 3 === 0 ? 'violet' : i % 3 === 1 ? 'calendula' : 'rose')
    }
  }
  return out
}
