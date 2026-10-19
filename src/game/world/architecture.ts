import { PERGOLA, TERRACE, VIEWPOINT_WALL, FOUNTAIN } from './layout'

/**
 * Architectural layout data shared by visuals and colliders.
 * Peristyle: porticos with back walls on the north, east and west sides; the
 * south side is an open colonnade facing the gardens and the sea.
 */

export const GARDEN_FLOOR = -0.25
export const PORTICO_FLOOR = 0

/** Sunken garden inside the stylobate. */
export const GARDEN_RECT = { minX: -9.6, maxX: 9.6, minZ: 22.4, maxZ: 37.6 }

export const COLUMN_XS = [-10, -7.1, -4.3, -1.5, 1.5, 4.3, 7.1, 10]
export const COLUMN_ZS = [22, 24.67, 27.33, 30, 32.67, 35.33, 38]

export const COLUMN = { height: 3.55, radius: 0.27, plinth: 0.78 }
export const ENTABLATURE = { bottom: 3.55, top: 4.15, depth: 0.62 }

/** Portico back walls (outer face of the porticos). */
export const WALL_N_Z = 41.4
export const WALL_EW_X = 13.4
export const WALL_HEIGHT = 5.0
export const WALL_THICK = 0.5

export interface Opening {
  /** Centre along the wall axis. */
  at: number
  width: number
  height: number
  kind: 'door' | 'doorway'
}

export interface WallDef {
  /** Axis-aligned wall from a to b in XZ. */
  a: [number, number]
  b: [number, number]
  height: number
  thick: number
  /** Which side faces the portico/garden (gets the fresco). */
  innerSide: 1 | -1
  openings: Opening[]
  fresco: boolean
}

export const PORTICO_WALLS: WallDef[] = [
  {
    a: [-WALL_EW_X, WALL_N_Z],
    b: [WALL_EW_X, WALL_N_Z],
    height: WALL_HEIGHT,
    thick: WALL_THICK,
    innerSide: -1,
    fresco: true,
    openings: [
      { at: 0, width: 1.9, height: 3.1, kind: 'door' },
      { at: -7.5, width: 1.3, height: 2.6, kind: 'door' },
      { at: 7.5, width: 1.3, height: 2.6, kind: 'door' },
    ],
  },
  {
    a: [WALL_EW_X, 21.8],
    b: [WALL_EW_X, WALL_N_Z],
    height: WALL_HEIGHT,
    thick: WALL_THICK,
    innerSide: -1,
    fresco: true,
    openings: [{ at: 30, width: 1.3, height: 2.6, kind: 'door' }],
  },
  {
    a: [-WALL_EW_X, 21.8],
    b: [-WALL_EW_X, WALL_N_Z],
    height: WALL_HEIGHT,
    thick: WALL_THICK,
    innerSide: 1,
    fresco: true,
    openings: [{ at: 30, width: 1.3, height: 2.6, kind: 'door' }],
  },
  // Short return walls closing the side porticos at the south.
  { a: [10.45, 21.8], b: [WALL_EW_X, 21.8], height: WALL_HEIGHT, thick: 0.4, innerSide: 1, fresco: true, openings: [] },
  { a: [-WALL_EW_X, 21.8], b: [-10.45, 21.8], height: WALL_HEIGHT, thick: 0.4, innerSide: 1, fresco: true, openings: [] },
]

/** Solid house volumes behind the porticos (exterior only). */
export const HOUSE_BLOCKS = [
  { minX: -19.5, maxX: 19.5, minZ: WALL_N_Z, maxZ: 51, height: 6.2, roof: 'hip' as const },
  { minX: WALL_EW_X, maxX: 19.5, minZ: 21.6, maxZ: WALL_N_Z, height: 5.6, roof: 'hip' as const },
  { minX: -19.5, maxX: -WALL_EW_X, minZ: 21.6, maxZ: WALL_N_Z, height: 5.6, roof: 'hip' as const },
]

/** Paved porch outside the south colonnade. */
export const PORCH_RECT = { minX: -13, maxX: 13, minZ: 15.2, maxZ: 21.8 }

export function peristyleColumns(): [number, number][] {
  const out: [number, number][] = []
  for (const x of COLUMN_XS) {
    out.push([x, COLUMN_ZS[0]])
    out.push([x, COLUMN_ZS[COLUMN_ZS.length - 1]])
  }
  for (const z of COLUMN_ZS.slice(1, -1)) {
    out.push([COLUMN_XS[0], z])
    out.push([COLUMN_XS[COLUMN_XS.length - 1], z])
  }
  return out
}

/* --------------------------------------------------------------- Garden */

export const FOUNTAIN_BASIN = { x: FOUNTAIN.x, z: FOUNTAIN.z, outer: 1.95, inner: 1.7, rimHeight: 0.55 }
export const FOUNTAIN_PATH = { inner: 1.95, outer: 3.15 }
/** Cross paths in the garden (half widths). */
export const GARDEN_PATH_HALF = 0.85

/* --------------------------------------------------------------- Pergola & terrace */

export const PERGOLA_DEF = {
  ...PERGOLA,
  width: 5.2,
  depth: 3.6,
  height: 2.75,
}

export const TERRACE_DEF = {
  ...TERRACE,
  balustradeHeight: 0.95,
}

export const VIEWPOINT_DEF = { ...VIEWPOINT_WALL, height: 0.85, thick: 0.45 }

/** Herm and planters on the terrace (positions). */
export const TERRACE_PROPS = {
  herms: [
    [-9.5, -47.5],
    [11.5, -47.5],
  ] as [number, number][],
  planters: [
    [-6.5, -54.4],
    [8.5, -54.4],
    [-11, -42.2],
    [13, -42.2],
  ] as [number, number][],
}

export const PORCH_PLANTERS: [number, number][] = [
  [-11.5, 16.0],
  [-7.0, 15.6],
  [5.0, 15.6],
  [11.5, 16.0],
]

/* --------------------------------------------------------------- Garden hedges & pots */

export interface HedgeSeg {
  a: [number, number]
  b: [number, number]
}

/** Low boxwood borders around the four garden beds (segments; arcs are tessellated). */
function buildHedges(): HedgeSeg[] {
  const out: HedgeSeg[] = []
  const cz = FOUNTAIN.z
  const inner = 1.25
  const arcR = FOUNTAIN_PATH.outer + 0.3
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const xIn = sx * inner
      const zIn = cz + sz * inner
      const xOut = sx * 9.15
      const zOut = cz + sz * 7.2
      const zArc = cz + sz * Math.sqrt(arcR * arcR - inner * inner)
      const xArc = sx * Math.sqrt(arcR * arcR - inner * inner)
      out.push({ a: [xIn, zArc], b: [xIn, zOut] })
      out.push({ a: [xArc, zIn], b: [xOut, zIn] })
      out.push({ a: [xOut, zIn], b: [xOut, zOut] })
      out.push({ a: [xIn, zOut], b: [xOut, zOut] })
      // Arc around the fountain path.
      const a0 = Math.atan2(zIn - cz, xArc)
      const a1 = Math.atan2(zArc - cz, xIn)
      const steps = 6
      for (let i = 0; i < steps; i++) {
        const t0 = a0 + ((a1 - a0) * i) / steps
        const t1 = a0 + ((a1 - a0) * (i + 1)) / steps
        out.push({ a: [Math.cos(t0) * arcR, cz + Math.sin(t0) * arcR], b: [Math.cos(t1) * arcR, cz + Math.sin(t1) * arcR] })
      }
    }
  }
  return out
}
export const GARDEN_HEDGES = buildHedges()

/** Small trees at the bed centres. */
// The beds now hold citrus trees (see world/citrus.ts); no extra small trees.
export const GARDEN_TREES: [number, number][] = []

/** Terracotta pots (with plants) — porch, porticos, terrace. y is computed from the ground. */
export const POTS: [number, number][] = [
  ...PORCH_PLANTERS,
  ...TERRACE_PROPS.planters,
  [-12.6, 39.6],
  [12.6, 39.6],
  [-12.6, 23.2],
  [12.6, 23.2],
]

/** Meshy olive trees placed by hand near the viewpoint (x, z, rotY, scale). */
// The round-1 Meshy olive read as "melted" in-engine; disabled until a better asset exists.
export const HERO_OLIVES: [number, number, number, number][] = []
