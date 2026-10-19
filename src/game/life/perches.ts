import { ENTABLATURE, GARDEN_FLOOR, HOUSE_BLOCKS, WALL_EW_X, WALL_N_Z } from '../world/architecture'
import { groundHeight } from '../world/ground'
import { BIRD_BATH, DOVECOTE } from '../world/props'
import { rng } from './math'

/**
 * Dove perches derived from the architecture data (the same numbers Villa.tsx
 * builds the roofs from), the bird bath rim and the dovecote roof.
 */

export type PerchGroup = 'roof' | 'bath' | 'dovecote'

export interface Perch {
  x: number
  y: number
  z: number
  /** Facing direction of a dove sitting here. */
  yaw: number
  /** Unit tangent (XZ) along which short hops may move the dove. */
  tx: number
  tz: number
  /** Max hop offset along the tangent (m). */
  hop: number
  group: PerchGroup
}

/** Bird-bath rim (the prop is modelled elsewhere; keep in sync with it). */
export const BATH_RIM = { radius: 0.43, y: GARDEN_FLOOR + 0.955, perches: 5 }
/** Dovecote roof, heights relative to the ground at DOVECOTE. */
// Matches the Meshy dovecote (sunk 0.1 m): eave ledge r ≈ 1.05 at 2.8, cone roof to the finial at 4.4 above the ground.
export const DOVECOTE_ROOF = { eaveRadius: 0.98, eaveY: 2.92, midRadius: 0.55, midY: 3.42, apexY: 4.4, eavePerches: 9, midPerches: 4 }

/** Same constants as Villa.tsx (hip roofs: +0.5 m overhang, pitch 0.42; portico roofs). */
const HIP_OVERHANG = 0.5
const HIP_PITCH = 0.42
const PORTICO_EAVE_Y = ENTABLATURE.top + 0.02 - 0.12
const PORTICO_RIDGE_Y = 5.25
const PORTICO_OVER = 0.55
const COLUMN_LINE = { minX: -10, maxX: 10, minZ: 22, maxZ: 38 }
/** Perch spacing along ridges/eaves (m) and how far in from an eave edge doves sit. */
const SPACING = 1.6
const EAVE_INSET = 0.14

function line(
  out: Perch[],
  rand: () => number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  yAt: (x: number, z: number) => number,
  facing: (i: number) => number,
) {
  const len = Math.hypot(bx - ax, bz - az)
  const n = Math.max(1, Math.floor(len / SPACING))
  const tx = (bx - ax) / len
  const tz = (bz - az) / len
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5 + (rand() - 0.5) * 0.5) / n
    const x = ax + (bx - ax) * t
    const z = az + (bz - az) * t
    out.push({ x, y: yAt(x, z), z, yaw: facing(i), tx, tz, hop: 0.25, group: 'roof' })
  }
}

export function buildPerches(): Perch[] {
  const rand = rng(4242)
  const out: Perch[] = []
  const alt = (a: number) => (i: number) => (i % 2 === 0 ? a : a + Math.PI) + (rand() - 0.5) * 0.6
  const fixed = (a: number) => () => a + (rand() - 0.5) * 0.5

  /* ---------------- House hip roofs: ridges and the eaves visible from the gardens */
  for (const h of HOUSE_BLOCKS) {
    const x0 = h.minX - HIP_OVERHANG
    const x1 = h.maxX + HIP_OVERHANG
    const z0 = h.minZ - HIP_OVERHANG
    const z1 = h.maxZ + HIP_OVERHANG
    const w = x1 - x0
    const d = z1 - z0
    const rise = (Math.min(w, d) / 2) * HIP_PITCH
    const top = h.height + rise
    const eaveY = () => h.height + EAVE_INSET * HIP_PITCH
    if (w >= d) {
      // North house block: ridge along X; south eave above the north portico (between the wings).
      const zc = (z0 + z1) / 2
      line(out, rand, x0 + d / 2, zc, x1 - d / 2, zc, () => top, alt(0))
      line(out, rand, -WALL_EW_X + 1, z0 + EAVE_INSET, WALL_EW_X - 1, z0 + EAVE_INSET, eaveY, fixed(Math.PI))
    } else {
      // East/west wings: ridge along Z; the eave facing the peristyle and the south eave over the porch.
      const xc = (x0 + x1) / 2
      line(out, rand, xc, z0 + w / 2, xc, z1 - w / 2, () => top, alt(Math.PI / 2))
      const east = h.minX >= WALL_EW_X - 0.01
      const innerX = east ? x0 + EAVE_INSET : x1 - EAVE_INSET
      line(out, rand, innerX, 22.5, innerX, WALL_N_Z - 1.5, eaveY, fixed(east ? -Math.PI / 2 : Math.PI / 2))
      line(out, rand, x0 + 0.6, z0 + EAVE_INSET, x1 - 0.6, z0 + EAVE_INSET, eaveY, fixed(Math.PI))
    }
  }

  /* ---------------- Portico roofs (mono-pitch toward the garden): low eaves */
  const slope = (PORTICO_RIDGE_Y - PORTICO_EAVE_Y) / (WALL_N_Z + 0.25 - (COLUMN_LINE.maxZ - PORTICO_OVER))
  const porticoEaveY = () => PORTICO_EAVE_Y + EAVE_INSET * slope
  const nz = COLUMN_LINE.maxZ - PORTICO_OVER + EAVE_INSET
  line(out, rand, -9.4, nz, 9.4, nz, porticoEaveY, fixed(Math.PI))
  const ex = COLUMN_LINE.maxX - PORTICO_OVER + EAVE_INSET
  line(out, rand, ex, 22.6, ex, 37, porticoEaveY, fixed(-Math.PI / 2))
  line(out, rand, -ex, 22.6, -ex, 37, porticoEaveY, fixed(Math.PI / 2))
  /* ---------------- South colonnade: the open entablature */
  line(out, rand, -9.4, COLUMN_LINE.minZ, 9.4, COLUMN_LINE.minZ, () => ENTABLATURE.top, alt(Math.PI))

  /* ---------------- Bird-bath rim */
  for (let i = 0; i < BATH_RIM.perches; i++) {
    const a = (i / BATH_RIM.perches) * Math.PI * 2 + 0.3
    const x = BIRD_BATH.x + Math.cos(a) * BATH_RIM.radius
    const z = BIRD_BATH.z + Math.sin(a) * BATH_RIM.radius
    // Facing the water (inward) or out over the garden.
    const inward = Math.atan2(-Math.cos(a), -Math.sin(a))
    out.push({ x, y: BATH_RIM.y, z, yaw: i % 2 === 0 ? inward : inward + Math.PI, tx: -Math.sin(a), tz: Math.cos(a), hop: 0.06, group: 'bath' })
  }

  /* ---------------- Dovecote roof: eave ring, a higher ring and the apex */
  const g = groundHeight(DOVECOTE.x, DOVECOTE.z)
  const ring = (n: number, r: number, y: number, phase: number) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + phase
      const ox = Math.cos(a)
      const oz = Math.sin(a)
      out.push({ x: DOVECOTE.x + ox * r, y: g + y, z: DOVECOTE.z + oz * r, yaw: Math.atan2(ox, oz), tx: -oz, tz: ox, hop: 0.12, group: 'dovecote' })
    }
  }
  ring(DOVECOTE_ROOF.eavePerches, DOVECOTE_ROOF.eaveRadius, DOVECOTE_ROOF.eaveY, DOVECOTE.rotY)
  ring(DOVECOTE_ROOF.midPerches, DOVECOTE_ROOF.midRadius, DOVECOTE_ROOF.midY, DOVECOTE.rotY + 0.4)
  out.push({ x: DOVECOTE.x, y: g + DOVECOTE_ROOF.apexY, z: DOVECOTE.z, yaw: DOVECOTE.rotY + 2.2, tx: 1, tz: 0, hop: 0, group: 'dovecote' })
  return out
}
