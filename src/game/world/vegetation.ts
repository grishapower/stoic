import { ESTATE_BOUNDARY, TERRACE } from './layout'
import { GARDEN_TREES, HOUSE_BLOCKS, POTS, PORCH_RECT, PERGOLA_DEF, VIEWPOINT_DEF } from './architecture'
import { groundHeight } from './ground'
import { CITRUS_TREES } from './citrus'
import { rng } from './noise'
import { nearestOnPath, pathPointAt, pathTangentAt, ROUTE_POINT_S } from './path'
import { baseHeight, terrainHeight } from './terrain'

/**
 * Deterministic vegetation placement (shared by visuals, colliders, ground mask
 * and audio emitters).
 */

export interface TreeInstance {
  x: number
  y: number
  z: number
  scale: number
  rot: number
  /** Variation seed 0..1 */
  v: number
}

function pointInPolygon(x: number, z: number, poly: readonly (readonly [number, number])[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

export function insideEstate(x: number, z: number) {
  return pointInPolygon(x, z, ESTATE_BOUNDARY)
}

export function blockedByArchitecture(x: number, z: number, margin: number) {
  for (const b of HOUSE_BLOCKS) {
    if (x > b.minX - margin && x < b.maxX + margin && z > b.minZ - margin && z < b.maxZ + margin) return true
  }
  // Peristyle + porch
  if (x > -14 - margin && x < 14 + margin && z > PORCH_RECT.minZ - margin && z < 42 + margin) return true
  if (x > TERRACE.minX - margin && x < TERRACE.maxX + margin && z > TERRACE.minZ - margin && z < TERRACE.maxZ + margin) return true
  if (Math.hypot(x - PERGOLA_DEF.x, z - PERGOLA_DEF.z) < 4.6 + margin) return true
  if (Math.hypot(x - VIEWPOINT_DEF.x, z - VIEWPOINT_DEF.z) < 4.2 + margin) return true
  return false
}

const placed: { x: number; z: number; r: number }[] = []
function farFromOthers(x: number, z: number, r: number) {
  for (const p of placed) if (Math.hypot(p.x - x, p.z - z) < p.r + r) return false
  return true
}

function make(x: number, z: number, scale: number, rand: () => number): TreeInstance {
  return { x, y: terrainHeight(x, z), z, scale, rot: rand() * Math.PI * 2, v: rand() }
}

/* ------------------------------------------------------------- Cypresses */

function buildCypresses(): TreeInstance[] {
  const rand = rng(1701)
  const out: TreeInstance[] = []
  // Alley along the route from the porch to the turn.
  const s0 = ROUTE_POINT_S[3] + 3
  const s1 = ROUTE_POINT_S[7] - 1
  const p: [number, number] = [0, 0]
  const t: [number, number] = [0, 0]
  for (let s = s0; s < s1; s += 5.2) {
    pathPointAt(s, p)
    pathTangentAt(s, t)
    for (const side of [-1, 1]) {
      const off = 2.7 + rand() * 0.25
      const x = p[0] - t[1] * off * side
      const z = p[1] + t[0] * off * side
      if (blockedByArchitecture(x, z, 0.5)) continue
      if (nearestOnPath(x, z).d < 2.2) continue
      out.push(make(x, z, 0.92 + rand() * 0.22, rand))
      placed.push({ x, z, r: 1.4 })
    }
  }
  // Framing cypresses near the villa and the estate edge.
  const extra: [number, number][] = [
    [-22, 28], [-23, 36], [-24, 44], [23, 28], [24, 37], [22, 45],
    [-15.5, 16.5], [15.5, 16.5], [-30, 8], [29, 2], [30, -8], [24, -30],
    [-20, -30], [-26, -20], [8, -38], [-8, -36],
  ]
  for (const [x, z] of extra) {
    if (blockedByArchitecture(x, z, 0.3) || !farFromOthers(x, z, 1.4)) continue
    out.push(make(x, z, 0.9 + rand() * 0.35, rand))
    placed.push({ x, z, r: 1.4 })
  }
  // Distant cypress clusters on the hills behind (outside the estate, visual only).
  for (let i = 0; i < 260; i++) {
    const x = -160 + rand() * 360
    const z = 48 + rand() * 230
    if (blockedByArchitecture(x, z, 3)) continue
    if (baseHeight(x, z) < -2) continue
    out.push(make(x, z, 0.8 + rand() * 0.5, rand))
  }
  return out
}

/* ------------------------------------------------------------- Olives */

function buildOlives(): TreeInstance[] {
  const rand = rng(2024)
  const out: TreeInstance[] = []
  // The grove between the alley turn and the viewpoint.
  let tries = 0
  while (out.length < 26 && tries++ < 2000) {
    const x = -34 + rand() * 40
    const z = -26 + rand() * 26
    if (!insideEstate(x, z)) continue
    if (blockedByArchitecture(x, z, 1.5)) continue
    const d = nearestOnPath(x, z).d
    if (d < 3.6) continue
    if (!farFromOthers(x, z, 3.3)) continue
    out.push(make(x, z, 0.85 + rand() * 0.35, rand))
    placed.push({ x, z, r: 3.3 })
  }
  // A few on the eastern lawns.
  tries = 0
  let east = 0
  while (east < 9 && tries++ < 1500) {
    const x = 6 + rand() * 25
    const z = -10 + rand() * 24
    if (!insideEstate(x, z) || blockedByArchitecture(x, z, 1.5)) continue
    if (nearestOnPath(x, z).d < 3.6 || !farFromOthers(x, z, 3.6)) continue
    out.push(make(x, z, 0.8 + rand() * 0.3, rand))
    placed.push({ x, z, r: 3.6 })
    east++
  }
  return out
}

/* ------------------------------------------------------------- Umbrella pines */

function buildPines(): TreeInstance[] {
  const rand = rng(77)
  const spots: [number, number][] = [
    [22, -40], [-18, -44], [29, -18], [-31, -12], [26, 10], [-34, 14], [18, -50],
  ]
  const out: TreeInstance[] = []
  for (const [x, z] of spots) {
    if (blockedByArchitecture(x, z, 1) || !farFromOthers(x, z, 2)) continue
    out.push(make(x, z, 0.9 + rand() * 0.3, rand))
    placed.push({ x, z, r: 2 })
  }
  // Distant pines along the coast (outside, visual only).
  for (let i = 0; i < 70; i++) {
    const x = 40 + rand() * 200
    const z = -60 + rand() * 300
    if (baseHeight(x, z) < -3) continue
    out.push(make(x, z, 0.9 + rand() * 0.5, rand))
  }
  return out
}

/* ------------------------------------------------------------- Shrubs */

export interface ShrubInstance extends TreeInstance {
  kind: 'myrtle' | 'oleander' | 'rosemary'
}

function buildShrubs(): ShrubInstance[] {
  const rand = rng(31337)
  const out: ShrubInstance[] = []
  // Along the estate boundary (a living edge), slightly inside.
  for (let i = 0; i < ESTATE_BOUNDARY.length; i++) {
    const [ax, az] = ESTATE_BOUNDARY[i]
    const [bx, bz] = ESTATE_BOUNDARY[(i + 1) % ESTATE_BOUNDARY.length]
    const len = Math.hypot(bx - ax, bz - az)
    // Skip the terrace front (balustrade).
    if (az < -54 && bz < -54) continue
    for (let d = 1; d < len - 1; d += 2.6 + rand() * 1.6) {
      const t = d / len
      const nx = -(bz - az) / len
      const nz = (bx - ax) / len
      const inset = 0.8 + rand() * 1.2
      const x = ax + (bx - ax) * t + nx * inset
      const z = az + (bz - az) * t + nz * inset
      if (blockedByArchitecture(x, z, 0.4) || !insideEstate(x, z)) continue
      const r = rand()
      out.push({ ...make(x, z, 0.8 + rand() * 0.7, rand), kind: r < 0.22 ? 'oleander' : r < 0.6 ? 'myrtle' : 'rosemary' })
    }
  }
  // Clumps along the path edges.
  let tries = 0
  let n = 0
  while (n < 70 && tries++ < 4000) {
    const x = -34 + rand() * 66
    const z = -44 + rand() * 62
    if (!insideEstate(x, z) || blockedByArchitecture(x, z, 0.6)) continue
    const d = nearestOnPath(x, z).d
    if (d < 1.9 || d > 4.5) continue
    if (!farFromOthers(x, z, 1.0)) continue
    const r = rand()
    out.push({ ...make(x, z, 0.6 + rand() * 0.5, rand), kind: r < 0.25 ? 'oleander' : r < 0.55 ? 'rosemary' : 'myrtle' })
    placed.push({ x, z, r: 0.9 })
    n++
  }
  return out
}

/** Garden shrubs inside the peristyle beds + plants in pots. */
function buildGardenPlants(): ShrubInstance[] {
  const rand = rng(909)
  const out: ShrubInstance[] = []
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const x = sx * (1.9 + rand() * 6.6)
        const z = 30 + sz * (1.9 + rand() * 4.8)
        if (Math.hypot(x, z - 30) < 4.1) continue
        if (GARDEN_TREES.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 1.4)) continue
        if (CITRUS_TREES.some((t) => Math.hypot(t.x - x, t.z - z) < 1.7)) continue
        const r = rand()
        out.push({ x, y: -0.25, z, scale: 0.45 + rand() * 0.3, rot: rand() * 6.28, v: rand(), kind: r < 0.4 ? 'oleander' : r < 0.7 ? 'rosemary' : 'myrtle' })
      }
    }
  }
  for (const [x, z] of POTS) {
    out.push({ x, y: groundHeight(x, z) + 0.3, z, scale: 0.4 + rand() * 0.08, rot: rand() * 6.28, v: rand(), kind: rand() < 0.5 ? 'myrtle' : 'oleander' })
  }
  return out
}

function buildGardenTrees(): TreeInstance[] {
  const rand = rng(4242)
  return GARDEN_TREES.map(([x, z]) => ({ x, y: -0.25, z, scale: 0.5 + rand() * 0.06, rot: rand() * 6.28, v: rand() }))
}

/** Cultivated olive terraces on the hills outside the estate (visual only). */
function buildFarOlives(): TreeInstance[] {
  const rand = rng(6060)
  const out: TreeInstance[] = []
  for (let x = 38; x < 120; x += 7.5) {
    for (let z = -46; z < 70; z += 7.5) {
      const jx = x + (rand() - 0.5) * 2.2
      const jz = z + (rand() - 0.5) * 2.2
      if (rand() < 0.12) continue
      if (baseHeight(jx, jz) < -6) continue
      out.push(make(jx, jz, 0.75 + rand() * 0.3, rand))
    }
  }
  // A few beyond the western boundary and north of the villa.
  for (let i = 0; i < 40; i++) {
    const x = -90 + rand() * 50
    const z = -10 + rand() * 80
    if (baseHeight(x, z) < -6 || insideEstate(x, z)) continue
    out.push(make(x, z, 0.75 + rand() * 0.3, rand))
  }
  return out
}

/** Maquis scrub scattered outside the estate (visual only). */
function buildMaquis(): ShrubInstance[] {
  const rand = rng(7171)
  const out: ShrubInstance[] = []
  for (let i = 0; i < 520; i++) {
    const a = rand() * Math.PI * 2
    const r = 36 + rand() * 70
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r * 1.1 + 5
    if (insideEstate(x, z) || baseHeight(x, z) < -9) continue
    if (blockedByArchitecture(x, z, 2)) continue
    const k = rand()
    out.push({ ...make(x, z, 0.8 + rand() * 0.9, rand), kind: k < 0.15 ? 'oleander' : k < 0.5 ? 'rosemary' : 'myrtle' })
  }
  return out
}

export const CYPRESSES = buildCypresses()
export const OLIVES = [...buildOlives(), ...buildGardenTrees(), ...buildFarOlives()]
export const PINES = buildPines()
export const SHRUBS = [...buildShrubs(), ...buildGardenPlants(), ...buildMaquis()]
