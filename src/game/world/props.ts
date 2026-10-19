import { PERGOLA, SEA_LEVEL, TERRACE_Y } from './layout'

/**
 * World-fill pass (concept board: https://claude.ai/artifact/Ssczu2xgRiQnpwsRRE4xp7).
 * Placement of every new prop and "life" spot, shared by scenes, colliders,
 * ambient-life systems and audio. Units: metres; Y comes from groundHeight
 * unless given. rotY: 0 = model's +Z facing +Z.
 */

export type XZ = [number, number]
export interface Placed {
  x: number
  z: number
  rotY: number
  scale?: number
  /** Explicit height (otherwise ground). */
  y?: number
}

/* ------------------------------------------------------------ Terrace (phase 1) */

/**
 * Semicircular exedra bench (x, z = arc centre), open toward the sea; sitters face −Z.
 * The Meshy model is an exact 180° arc, inner radius 2.1 m, back wall to 2.65 m.
 */
export const EXEDRA = { x: 1.0, z: -52.0, radius: 2.35, arcFrom: 0, arcTo: 180, seatHeight: 0.46 }
/** Where the player sits on the exedra (middle of the seat; eye looks toward the sea). */
export const EXEDRA_SEAT = { x: 1.0, z: -52.0 + 2.3, yaw: 0 }
/** Roman hemicyclium sundial on a pedestal, in front of the exedra. */
export const SUNDIAL = { x: 5.9, z: -51.4, rotY: 0, height: 1.05 }
/** The round-1 Meshy stone bench moves to the viewpoint, facing the sea. */
export const VIEWPOINT_BENCH: Placed = { x: -3.6, z: -15.45, rotY: Math.PI }
/** Vine pergola on the terrace's west side. */
export const TERRACE_PERGOLA = { minX: -11.2, maxX: -6.4, minZ: -53.8, maxZ: -45.2, height: 2.7 }
/** Statues on pedestals along the parapet. */
export const TERRACE_STATUES: Placed[] = [
  { x: -3.6, z: -54.7, rotY: 0 },
  { x: 6.4, z: -54.7, rotY: 0 },
]
/** Gap in the parapet (east end) where the rock stair starts; a chain closes it. */
export const COVE_STAIR_TOP = { x: 12.6, z: -55.6, y: TERRACE_Y }
/** The little cove at the foot of the cliff (visual only). */
export const COVE = { x: 19.5, z: -79, radius: 9, beachY: SEA_LEVEL + 0.55 }
export const COVE_BOAT: Placed = { x: COVE.x - 2, z: COVE.z + 0.5, rotY: 0.6 }

/* ------------------------------------------------------------ Bay (phase 1) */

/** Somma-Vesuvius before 79 AD: broad green mountain across the bay (to the right of the sunset). */
export const VESUVIUS = { x: 3000, z: -3800, height: 1050, radius: 3200 }
/** Harbour town on the coastal plain at the mountain's foot, facing the villa. */
export const HARBOUR = { x: 1380, z: -1760, radius: 240 }
/** Lighthouse on a rocky headland in front of the harbour. */
export const LIGHTHOUSE = { x: 1100, z: -1540, height: 34 }
/** Boat routes on the bay (XZ waypoints); boats move along them with the walk's progress. */
export const BOAT_ROUTES: { kind: 'fishing' | 'merchant'; path: XZ[]; loop?: boolean }[] = [
  { kind: 'fishing', path: [[-320, -360], [60, -560], [520, -940], [940, -1330], [1180, -1560]] },
  { kind: 'fishing', path: [[-120, -230], [240, -420], [680, -860], [1030, -1290], [1230, -1590]] },
  { kind: 'fishing', path: [[-620, -700], [-250, -820], [300, -1060], [880, -1400], [1150, -1610]] },
  { kind: 'merchant', path: [[-2200, -1700], [-900, -1250], [200, -1150], [900, -1300], [1300, -1640]], loop: false },
  // A boat at anchor closer in, two fishermen hauling nets in the last light.
  { kind: 'fishing', path: [[-170, -330]] },
]

/* ------------------------------------------------------------ Peristyle (phase 2) */

export const BIRD_BATH = { x: -6.6, z: 25.2 }
export const EROS_STATUE: Placed = { x: 6.5, z: 34.9, rotY: Math.PI * 0.85 }
/** Marble bench in the north portico where the cat sleeps. */
export const PORTICO_BENCH: Placed = { x: -6.2, z: 40.55, rotY: Math.PI }
export const CAT: Placed = { x: -6.5, z: 40.55, rotY: Math.PI * 0.9 }
/** On the portico floor at the end of the bench: someone has been picking citrons. */
export const CITRON_BASKET: Placed = { x: -4.85, z: 40.6, rotY: 0.4 }
/** Oscilla hang in the north and south intercolumniations (x positions; z = column line). */
export const OSCILLA: { x: number; z: number }[] = [
  { x: -8.55, z: 38 }, { x: -5.7, z: 38 }, { x: 5.7, z: 38 }, { x: 8.55, z: 38 },
  { x: -8.55, z: 22 }, { x: -5.7, z: 22 }, { x: 5.7, z: 22 }, { x: 8.55, z: 22 },
]

/* ------------------------------------------------------------ Walk (phase 3) */

/** Herms along the cypress alley, in the gaps between the trees (alternating sides; they face the path). */
export const ALLEY_HERMS: Placed[] = [
  { x: -8.95, z: 8.15, rotY: 0 },
  { x: -15.57, z: 12.18, rotY: 0 },
  { x: -18.04, z: 4.96, rotY: 0 },
  { x: -25.63, z: 6.41, rotY: 0 },
]
/** Roadside shrine (aedicula) at the alley turn, with a burning lamp; its front faces the path (east). */
export const AEDICULA: Placed = { x: -28.8, z: 2.4, rotY: 1.85 }
export const AMPHORAE: Placed[] = [
  { x: -12.6, z: 17.2, rotY: 0.3 }, { x: -12.0, z: 17.6, rotY: 1.2 }, { x: -11.4, z: 17.3, rotY: 2.1 },
]
export const WOODEN_BENCH: Placed = { x: -20.6, z: 8.7, rotY: 2.86 }
export const DOVECOTE: Placed = { x: -31.2, z: -14.5, rotY: 0.4 }
export const BEEHIVES: Placed = { x: 26.8, z: 12.6, rotY: -1.2 }
/** Goats grazing beyond the west wall (outside the estate). */
export const GOATS: Placed[] = [
  { x: -42.5, z: 16.0, rotY: 1.2 },
  { x: -44.8, z: 11.5, rotY: 2.4 },
  { x: -40.6, z: 6.8, rotY: 0.2 },
]

/* ------------------------------------------------------------ Study (phase 4) */

/**
 * Seneca's open-air study under the pergola, in the writing table's frame
 * (lx along the table, lz toward the writer's side; rotY relative to the table).
 */
export const STUDY_LOCAL = {
  lamp: { lx: 0.4, lz: -0.2, rotY: 0.5 },
  clepsydra: { lx: 1.2, lz: 0.25, rotY: -Math.PI / 2 },
  chair: { lx: 0.1, lz: 0.8, rotY: Math.PI },
  bustColumn: { lx: -1.75, lz: -1.15, rotY: 0.5 },
  jug: { lx: -1.05, lz: 0.4, rotY: 0.2 },
  basket: { lx: -1.0, lz: 1.05, rotY: 0.9 },
}
export type StudyItem = keyof typeof STUDY_LOCAL

/** World placement of a study item (the table frame comes from PERGOLA). */
export function studyPlaced(item: StudyItem): Placed {
  const t = PERGOLA.table
  const rot = PERGOLA.rotY
  const { lx, lz, rotY } = STUDY_LOCAL[item]
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  return { x: t.x + lx * c + lz * s, z: t.z - lx * s + lz * c, rotY: rot + rotY }
}

/* ------------------------------------------------------------ Ambient life spots */

/** Gulls circle over the water in front of the terrace. */
export const GULL_ZONE = { x: 10, z: -130, radius: 70, minY: SEA_LEVEL + 14, maxY: SEA_LEVEL + 46 }
/** Swallows swoop low over open lawns. */
export const SWALLOW_ZONES: { x: number; z: number; radius: number }[] = [
  { x: 18, z: 2, radius: 12 },
  { x: -14, z: -12, radius: 12 },
  { x: 0, z: 30, radius: 8 },
]
/** Butterfly areas (flowers, lavender, poppies). */
export const BUTTERFLY_ZONES: { x: number; z: number; radius: number }[] = [
  { x: -5, z: 34, radius: 3 },
  { x: 5, z: 26, radius: 3 },
  { x: -9, z: 13, radius: 3 },
  { x: -26, z: -2, radius: 4 },
  { x: 14, z: -22, radius: 4 },
]
