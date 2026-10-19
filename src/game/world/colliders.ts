import {
  COLUMN,
  FOUNTAIN_BASIN,
  GARDEN_HEDGES,
  HERO_OLIVES,
  POTS,
  HOUSE_BLOCKS,
  PERGOLA_DEF,
  PORTICO_WALLS,
  TERRACE_PROPS,
  VIEWPOINT_DEF,
  peristyleColumns,
} from './architecture'
import { ESTATE_BOUNDARY } from './layout'
import {
  AEDICULA,
  ALLEY_HERMS,
  AMPHORAE,
  BEEHIVES,
  BIRD_BATH,
  CITRON_BASKET,
  DOVECOTE,
  EROS_STATUE,
  EXEDRA,
  PORTICO_BENCH,
  studyPlaced,
  SUNDIAL,
  TERRACE_PERGOLA,
  TERRACE_STATUES,
  VIEWPOINT_BENCH,
  WOODEN_BENCH,
} from './props'
import { CYPRESSES, OLIVES, PINES } from './vegetation'
import { CITRUS_TREES } from './citrus'
import { insideEstate } from './vegetation'

/**
 * 2D collision world (XZ). Circles and capsules (segments with radius);
 * the estate boundary polygon keeps the player inside.
 */

interface Circle {
  x: number
  z: number
  r: number
}
interface Capsule {
  ax: number
  az: number
  bx: number
  bz: number
  r: number
}

const circles: Circle[] = []
const capsules: Capsule[] = []

function wallSegments() {
  for (const w of PORTICO_WALLS) {
    const horizontal = w.a[1] === w.b[1]
    const from = horizontal ? w.a[0] : w.a[1]
    const to = horizontal ? w.b[0] : w.b[1]
    // Split around openings (doors are closed for the player — treat as solid,
    // except none are walk-through in this prototype).
    const cuts = [...w.openings].sort((a, b) => a.at - b.at)
    let start = from
    const pieces: [number, number][] = []
    for (const o of cuts) {
      if (o.kind === 'door') continue
      pieces.push([start, o.at - o.width / 2])
      start = o.at + o.width / 2
    }
    pieces.push([start, to])
    for (const [p0, p1] of pieces) {
      if (p1 - p0 < 0.05) continue
      if (horizontal) capsules.push({ ax: p0, az: w.a[1], bx: p1, bz: w.a[1], r: w.thick / 2 })
      else capsules.push({ ax: w.a[0], az: p0, bx: w.a[0], bz: p1, r: w.thick / 2 })
    }
  }
}

function boxAsCapsule(cx: number, cz: number, w: number, d: number, rot: number) {
  // Long axis capsule approximating a box.
  const long = Math.max(w, d)
  const short = Math.min(w, d)
  const ang = rot + (w >= d ? 0 : Math.PI / 2)
  const hx = Math.cos(ang) * (long / 2 - short / 2)
  const hz = -Math.sin(ang) * (long / 2 - short / 2)
  capsules.push({ ax: cx - hx, az: cz - hz, bx: cx + hx, bz: cz + hz, r: short / 2 })
}

function build() {
  for (const [x, z] of peristyleColumns()) circles.push({ x, z, r: COLUMN.plinth * 0.55 })
  wallSegments()
  for (const b of HOUSE_BLOCKS) {
    // Outer faces only where reachable (south faces of the wings, porch side).
    capsules.push({ ax: b.minX, az: b.minZ, bx: b.maxX, bz: b.minZ, r: 0.25 })
    capsules.push({ ax: b.minX, az: b.minZ, bx: b.minX, bz: b.maxZ, r: 0.25 })
    capsules.push({ ax: b.maxX, az: b.minZ, bx: b.maxX, bz: b.maxZ, r: 0.25 })
    capsules.push({ ax: b.minX, az: b.maxZ, bx: b.maxX, bz: b.maxZ, r: 0.25 })
  }
  circles.push({ x: FOUNTAIN_BASIN.x, z: FOUNTAIN_BASIN.z, r: FOUNTAIN_BASIN.outer + 0.05 })
  for (const t of OLIVES) if (insideEstate(t.x, t.z)) circles.push({ x: t.x, z: t.z, r: 0.45 * t.scale })
  for (const t of CYPRESSES) if (insideEstate(t.x, t.z)) circles.push({ x: t.x, z: t.z, r: 0.5 * t.scale })
  for (const t of PINES) if (insideEstate(t.x, t.z)) circles.push({ x: t.x, z: t.z, r: 0.45 })
  for (const [x, z] of POTS) circles.push({ x, z, r: 0.45 })
  for (const [x, z, , sc] of HERO_OLIVES) circles.push({ x, z, r: 0.5 * sc })
  // Citrus: the crown is low, so keep the player at the canopy edge (fruit still within reach).
  for (const t of CITRUS_TREES) circles.push({ x: t.x, z: t.z, r: t.potted ? 0.5 : 0.85 * t.scale })
  for (const h of GARDEN_HEDGES) capsules.push({ ax: h.a[0], az: h.a[1], bx: h.b[0], bz: h.b[1], r: 0.22 })
  for (const [x, z] of TERRACE_PROPS.herms) circles.push({ x, z, r: 0.35 })
  // Pergola posts (4 corners) and the writing table.
  {
    const { x, z, rotY, width, depth } = PERGOLA_DEF
    const c = Math.cos(rotY)
    const s = Math.sin(rotY)
    for (const [lx, lz] of [
      [-width / 2, -depth / 2],
      [width / 2, -depth / 2],
      [-width / 2, depth / 2],
      [width / 2, depth / 2],
    ]) {
      circles.push({ x: x + lx * c + lz * s, z: z - lx * s + lz * c, r: 0.22 })
    }
    boxAsCapsule(PERGOLA_DEF.table.x, PERGOLA_DEF.table.z, 1.5, 0.75, rotY)
  }
  // Viewpoint parapet.
  {
    const { x, z, length, rotY, thick } = VIEWPOINT_DEF
    const hx = (Math.cos(rotY) * length) / 2
    const hz = (-Math.sin(rotY) * length) / 2
    capsules.push({ ax: x - hx, az: z - hz, bx: x + hx, bz: z + hz, r: thick / 2 + 0.05 })
  }
  // Exedra bench (arc of short capsules along the seat + backrest).
  for (let a = EXEDRA.arcFrom; a < EXEDRA.arcTo; a += 10) {
    const a0 = (a * Math.PI) / 180
    const a1 = (Math.min(EXEDRA.arcTo, a + 10) * Math.PI) / 180
    const r = EXEDRA.radius + 0.12
    capsules.push({ ax: EXEDRA.x + Math.cos(a0) * r, az: EXEDRA.z + Math.sin(a0) * r, bx: EXEDRA.x + Math.cos(a1) * r, bz: EXEDRA.z + Math.sin(a1) * r, r: 0.32 })
  }
  circles.push({ x: SUNDIAL.x, z: SUNDIAL.z, r: 0.42 })
  for (const p of TERRACE_STATUES) circles.push({ x: p.x, z: p.z, r: 0.48 })
  for (const px of [TERRACE_PERGOLA.minX, TERRACE_PERGOLA.maxX]) {
    for (const pz of [TERRACE_PERGOLA.minZ, (TERRACE_PERGOLA.minZ + TERRACE_PERGOLA.maxZ) / 2, TERRACE_PERGOLA.maxZ]) circles.push({ x: px, z: pz, r: 0.24 })
  }
  boxAsCapsule(VIEWPOINT_BENCH.x, VIEWPOINT_BENCH.z, 2.0, 0.6, VIEWPOINT_BENCH.rotY)
  // World-fill props (peristyle, walk, study).
  circles.push({ x: BIRD_BATH.x, z: BIRD_BATH.z, r: 0.48 })
  circles.push({ x: EROS_STATUE.x, z: EROS_STATUE.z, r: 0.5 })
  boxAsCapsule(PORTICO_BENCH.x, PORTICO_BENCH.z, 1.5, 0.46, PORTICO_BENCH.rotY)
  circles.push({ x: CITRON_BASKET.x, z: CITRON_BASKET.z, r: 0.28 })
  for (const h of ALLEY_HERMS) circles.push({ x: h.x, z: h.z, r: 0.36 })
  boxAsCapsule(AEDICULA.x, AEDICULA.z, 1.25, 0.85, AEDICULA.rotY)
  for (const a of AMPHORAE) circles.push({ x: a.x, z: a.z, r: 0.22 })
  circles.push({ x: WOODEN_BENCH.x, z: WOODEN_BENCH.z, r: 0.5 })
  circles.push({ x: DOVECOTE.x, z: DOVECOTE.z, r: 1.45 })
  boxAsCapsule(BEEHIVES.x, BEEHIVES.z, 1.8, 0.7, BEEHIVES.rotY)
  for (const item of ['clepsydra', 'bustColumn', 'basket', 'jug'] as const) {
    const p = studyPlaced(item)
    circles.push({ x: p.x, z: p.z, r: item === 'bustColumn' ? 0.3 : 0.24 })
  }
}
build()

/** Push a circle of radius r at (x, z) out of all obstacles; returns corrected position. */
export function resolveCollisions(pos: { x: number; z: number }, r: number) {
  for (let iter = 0; iter < 3; iter++) {
    for (const c of circles) {
      const dx = pos.x - c.x
      const dz = pos.z - c.z
      const min = c.r + r
      const d2 = dx * dx + dz * dz
      if (d2 < min * min) {
        // Exactly at the centre: pick an arbitrary direction instead of dividing by zero.
        const d = Math.sqrt(d2)
        const nx = d > 1e-6 ? dx / d : 1
        const nz = d > 1e-6 ? dz / d : 0
        pos.x = c.x + nx * min
        pos.z = c.z + nz * min
      }
    }
    for (const k of capsules) {
      const ex = k.bx - k.ax
      const ez = k.bz - k.az
      const len2 = ex * ex + ez * ez
      let t = len2 > 0 ? ((pos.x - k.ax) * ex + (pos.z - k.az) * ez) / len2 : 0
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const cx = k.ax + ex * t
      const cz = k.az + ez * t
      const dx = pos.x - cx
      const dz = pos.z - cz
      const min = k.r + r
      const d2 = dx * dx + dz * dz
      if (d2 < min * min) {
        const d = Math.sqrt(d2)
        // On the segment itself: push along the segment's normal.
        const len = Math.sqrt(len2) || 1
        const nx = d > 1e-6 ? dx / d : -ez / len
        const nz = d > 1e-6 ? dz / d : ex / len
        pos.x = cx + nx * min
        pos.z = cz + nz * min
      }
    }
  }
  keepInsideBoundary(pos, r)
  return pos
}

function keepInsideBoundary(pos: { x: number; z: number }, r: number) {
  const poly = ESTATE_BOUNDARY
  const inside = insideEstate(pos.x, pos.z)
  // Find the nearest edge.
  let best = Infinity
  let bx = pos.x
  let bz = pos.z
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i]
    const [cx, cz] = poly[(i + 1) % poly.length]
    const ex = cx - ax
    const ez = cz - az
    const len2 = ex * ex + ez * ez
    let t = ((pos.x - ax) * ex + (pos.z - az) * ez) / len2
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const px = ax + ex * t
    const pz = az + ez * t
    const d = Math.hypot(pos.x - px, pos.z - pz)
    if (d < best) {
      best = d
      bx = px
      bz = pz
    }
  }
  if (!inside || best < r) {
    // Move to r inside from the nearest edge point, toward the interior.
    const dx = pos.x - bx
    const dz = pos.z - bz
    const d = Math.hypot(dx, dz) || 1
    const sign = inside ? 1 : -1
    pos.x = bx + (dx / d) * r * sign
    pos.z = bz + (dz / d) * r * sign
    if (!insideEstate(pos.x, pos.z)) {
      // Degenerate corner: nudge toward the estate centre.
      pos.x += (0 - pos.x) * 0.02
      pos.z += (0 - pos.z) * 0.02
    }
  }
}
