/**
 * World layout — the single map of the estate.
 *
 * Units: metres. Y is up. The sea lies toward −Z ("south"), the sun sets to the
 * south-west (−X, −Z). The villa peristyle sits on a plateau at y = 0; the garden
 * path descends gently to a sea terrace at y = TERRACE_Y above a cliff.
 */

export type XZ = readonly [number, number]

export const SEA_LEVEL = -32
export const TERRACE_Y = -5

/* ---------------------------------------------------------------- Villa */

export const PERISTYLE = {
  /** Inner garden rectangle (column line). */
  minX: -10,
  maxX: 10,
  minZ: 22,
  maxZ: 38,
  porticoDepth: 3.4,
  columnSpacing: 2.5,
  columnHeight: 3.6,
  roofHeight: 4.3,
  /** Sides with a solid back wall (house rooms). Open sides are colonnades onto the garden. */
  walledSides: ['north', 'east'] as const,
}

export const FOUNTAIN = { x: 0, z: 30, radius: 1.9 }

/* ---------------------------------------------------------------- Route */

/**
 * Seneca's walking route (also the garden path). Points are [x, z]; Y comes
 * from the terrain. Indices are referenced by STATIONS below.
 */
export const ROUTE: XZ[] = [
  [1.3, 27.2], // 0  start — by the fountain
  [0.3, 24.0], // 1
  [0.0, 20.6], // 2  just past the south colonnade
  [0.0, 15.5], // 3  porch
  [-6.0, 12.0], // 4  cypress alley begins
  [-16.0, 9.0], // 5
  [-24.0, 4.0], // 6  alley turn (view west, toward the sun)
  [-26.0, -3.0], // 7
  [-20.0, -9.0], // 8  olive grove
  [-10.0, -12.0], // 9
  [0.0, -14.0], // 10 viewpoint over the sea
  [10.0, -17.0], // 11
  [17.0, -21.0], // 12 pergola with the writing table
  [18.0, -29.0], // 13
  [12.0, -36.0], // 14
  [5.0, -41.0], // 15 terrace entry
  [-1.8, -45.6], // 16 around the exedra
  [-3.3, -50.4], // 17 by the exedra, looking at the sea
]

export type StationId = 'start' | 'colonnade' | 'alley' | 'grove' | 'viewpoint' | 'pergola' | 'terrace-entry' | 'terrace'

export const STATIONS: Record<StationId, number> = {
  start: 0,
  colonnade: 2,
  alley: 5,
  grove: 8,
  viewpoint: 10,
  pergola: 12,
  'terrace-entry': 15,
  terrace: 17,
}

/** Half-width of the stone/gravel path along the route. */
export const PATH_HALF_WIDTH = 1.15

/* ---------------------------------------------------------------- Player */

export const PLAYER_SPAWN = { x: 0, z: 36.6, yaw: 0 } // yaw 0 = looking toward −Z (the sea)
export const EYE_HEIGHT = 1.62

/* ---------------------------------------------------------------- Props */

export const PERGOLA = { x: 19.5, z: -19.0, rotY: -0.5, table: { x: 19.2, z: -18.4 } }
export const TERRACE = {
  minX: -12,
  maxX: 14,
  minZ: -56,
  maxZ: -40,
  bench: { x: 1.0, z: -49.6, rotY: 0 },
  balustradeZ: -55.6,
}
export const VIEWPOINT_WALL = { x: 0.5, z: -16.6, length: 7, rotY: 0.08 }

/* ---------------------------------------------------------------- Estate boundary */

/**
 * Walkable region (closed polygon, counter-clockwise in XZ). The player is kept
 * inside it. Visually the edge is a dry-stone wall, hedges, or the terrace balustrade.
 */
export const ESTATE_BOUNDARY: XZ[] = [
  [-30, 46],
  [-36, 20],
  [-36, -14],
  [-28, -26],
  [-14, -40],
  [-12.3, -55.3],
  [14.3, -55.3],
  [16, -42],
  [28, -34],
  [32, -12],
  [32, 20],
  [26, 46],
]

/* ---------------------------------------------------------------- Lighting */

/** Unit vector pointing from the scene toward the sun (late afternoon → sunset). */
export function sunDirection(elevationDeg: number, azimuthDeg = 236): [number, number, number] {
  // azimuth measured from +X toward −Z… we use: 180 = −X, 270 = −Z.
  const el = (elevationDeg * Math.PI) / 180
  const az = (azimuthDeg * Math.PI) / 180
  const x = Math.cos(el) * Math.cos(az)
  const z = Math.cos(el) * Math.sin(az)
  return [x, Math.sin(el), z]
}

/** Sun elevation over the course of the walk (narrative progress 0..1). */
export const SUN_ELEVATION_START = 7.5
export const SUN_ELEVATION_END = 1.7
