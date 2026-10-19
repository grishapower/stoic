import { PERGOLA, SEA_LEVEL, TERRACE, TERRACE_Y, VIEWPOINT_WALL, PATH_HALF_WIDTH } from './layout'
import { GARDEN_FLOOR, GARDEN_RECT } from './architecture'
import { COVE } from './props'
import { fbm, lerp, smoothstep } from './noise'
import { nearestOnPath, type PathHit } from './path'

/**
 * Analytic terrain height. Shared by the terrain mesh, the player, Seneca and
 * vegetation placement so everything stands on the same ground.
 */

/** Areas that must stay flat (architecture). */
const FLAT_RECTS = [
  { minX: -15.5, maxX: 15.5, minZ: 16, maxZ: 44 }, // villa + peristyle
  { minX: TERRACE.minX - 1, maxX: TERRACE.maxX + 1, minZ: TERRACE.minZ - 1, maxZ: TERRACE.maxZ + 1 },
]
const FLAT_CIRCLES = [
  { x: PERGOLA.x, z: PERGOLA.z, r: 6.5 },
  { x: VIEWPOINT_WALL.x, z: VIEWPOINT_WALL.z, r: 5.5 },
]

function rectMask(x: number, z: number, r: { minX: number; maxX: number; minZ: number; maxZ: number }, feather: number) {
  const dx = Math.max(r.minX - x, 0, x - r.maxX)
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ)
  return smoothstep(0, feather, Math.hypot(dx, dz))
}

/** 0 = must be flat (architecture/path), 1 = free natural ground. */
function naturalMask(x: number, z: number, hit: PathHit) {
  let m = smoothstep(PATH_HALF_WIDTH + 0.4, PATH_HALF_WIDTH + 5, hit.d)
  for (const r of FLAT_RECTS) m = Math.min(m, rectMask(x, z, r, 5))
  for (const c of FLAT_CIRCLES) m = Math.min(m, smoothstep(c.r * 0.6, c.r + 3, Math.hypot(x - c.x, z - c.z)))
  return m
}

/** Smooth large-scale landform without detail noise. */
export function baseHeight(x: number, z: number): number {
  // Gentle descent from the villa plateau to the terrace level.
  let h = TERRACE_Y * smoothstep(14, -42, z)
  // Hills rising behind the villa and to the east.
  h += smoothstep(46, 100, z) * 16 + smoothstep(34, 110, x) * 12
  // Cliffs to the south and west down to the sea.
  const south = smoothstep(-57.5, -74, z + 5 * fbm(x * 0.045 + 3.1, 1.7, 3))
  const west = smoothstep(-44, -66, x + 5 * fbm(2.3, z * 0.045 + 5.2, 3))
  // Below the terrace front, over the cove, the rock falls away right at the retaining
  // wall (no rounded shelf) so the beach is visible from the parapet.
  const sector = smoothstep(COVE.x - 21, COVE.x - 13, x) * (1 - smoothstep(COVE.x + 11, COVE.x + 18, x))
  const drop = sector > 0 ? Math.pow(Math.min(1, Math.max(0, (-56.5 - z) / 13.5)), 0.6) * sector : 0
  const cliff = Math.max(south, west, drop)
  h = lerp(h, SEA_LEVEL - 6, cliff)
  // A little sandy cove at the cliff foot below the terrace (beach rises toward the cliff).
  const cd = Math.hypot(x - COVE.x, (z - COVE.z) * 1.15)
  const coveMask = smoothstep(COVE.radius, COVE.radius * 0.45, cd)
  if (coveMask > 0) {
    const beach = COVE.beachY + (z - COVE.z) * 0.2
    h = lerp(h, Math.max(h, beach), coveMask)
  }
  return h
}

const tmpHit: PathHit = { d: 0, s: 0, x: 0, z: 0 }

export function terrainHeight(x: number, z: number): number {
  // Sunken peristyle garden (the stylobate hides the step).
  if (x > GARDEN_RECT.minX - 0.3 && x < GARDEN_RECT.maxX + 0.3 && z > GARDEN_RECT.minZ - 0.3 && z < GARDEN_RECT.maxZ + 0.3) return GARDEN_FLOOR
  const hit = nearestOnPath(x, z, tmpHit)
  const base = baseHeight(x, z)
  const m = naturalMask(x, z, hit)
  // Gentle undulation inside the estate, more relief outside.
  const outside = smoothstep(30, 60, Math.hypot(x, z * 0.9))
  let n = fbm(x * 0.06, z * 0.06, 4) * (0.7 + outside * 2.4) + fbm(x * 0.31 + 11, z * 0.31 - 7, 2) * 0.12
  // Rugged cliff faces.
  const cliffBand = smoothstep(SEA_LEVEL - 2, SEA_LEVEL + 6, base) * (1 - smoothstep(TERRACE_Y - 3, TERRACE_Y + 0.5, base))
  n += cliffBand * fbm(x * 0.12 + 40, z * 0.12, 4) * 5
  // Rock strata and ledges on the cliff faces (breaks the smooth "wall" look).
  n += cliffBand * (fbm(x * 0.35 - 13, z * 0.35 + 21, 3) * 1.6 + Math.sin(base * 0.9 + fbm(x * 0.05, z * 0.05, 2) * 3) * 0.9)
  return base + n * m
}

/** Approximate surface normal via central differences. */
export function terrainNormal(x: number, z: number, out: [number, number, number] = [0, 1, 0]): [number, number, number] {
  const e = 0.35
  const hx = terrainHeight(x + e, z) - terrainHeight(x - e, z)
  const hz = terrainHeight(x, z + e) - terrainHeight(x, z - e)
  const nx = -hx
  const ny = 2 * e
  const nz = -hz
  const l = Math.hypot(nx, ny, nz)
  out[0] = nx / l
  out[1] = ny / l
  out[2] = nz / l
  return out
}

/** Distance from (x, z) to the garden path centre line (handy for placement). */
export function distanceToPath(x: number, z: number): number {
  return nearestOnPath(x, z, tmpHit).d
}
