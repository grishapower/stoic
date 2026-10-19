import { GARDEN_FLOOR, GARDEN_RECT, FOUNTAIN_BASIN } from './architecture'
import { TERRACE, TERRACE_Y } from './layout'
import { terrainHeight } from './terrain'

/**
 * Walkable floor height (terrain + built floors). Used by the player and Seneca.
 */
const SB = 0.48 // stylobate half width around the column line (x = ±10, z = 22 / 38)

export function groundHeight(x: number, z: number): number {
  if (x > -10 + SB && x < 10 - SB && z > 22 + SB && z < 38 - SB) return GARDEN_FLOOR
  if (x > -10 - SB && x < 10 + SB && z > 22 - SB && z < 38 + SB) return 0.02 // on the stylobate
  if (x > -13.4 && x < 13.4 && z > 21.8 && z < 41.4) return 0 // portico floors
  if (x > TERRACE.minX && x < TERRACE.maxX && z > TERRACE.minZ && z < TERRACE.maxZ) {
    return TERRACE_Y
  }
  return terrainHeight(x, z)
}

export type SurfaceKind = 'stone' | 'gravel' | 'grass' | 'wood'

/** Surface under a point (footstep sounds). */
export function surfaceAt(x: number, z: number, onPath: boolean): SurfaceKind {
  if (x > -13.6 && x < 13.6 && z > 15 && z < 41.6) {
    const inGarden = x > GARDEN_RECT.minX && x < GARDEN_RECT.maxX && z > GARDEN_RECT.minZ && z < GARDEN_RECT.maxZ
    if (!inGarden) return 'stone'
    const df = Math.hypot(x - FOUNTAIN_BASIN.x, z - FOUNTAIN_BASIN.z)
    if (Math.abs(x) < 0.9 || Math.abs(z - FOUNTAIN_BASIN.z) < 0.9 || (df > 1.9 && df < 3.2)) return 'gravel'
    return 'grass'
  }
  if (x > TERRACE.minX && x < TERRACE.maxX && z > TERRACE.minZ && z < TERRACE.maxZ) return 'stone'
  return onPath ? 'gravel' : 'grass'
}
