import { BufferAttribute, BufferGeometry } from 'three'

/**
 * Procedural low-poly geometry for the creatures. Local frame: +Z forward,
 * +Y up, ±X the sides. Every vertex carries `aPart` for the vertex shader
 * (see material.ts):
 *   x — signed wing span coordinate (0 = body; ±0..1 from shoulder to tip)
 *   y — head weight (turns/pitches with the head)
 *   z — spine coordinate 0..1 from head to tail tip (lizard body wave)
 * Wing hinge/elbow constants are exported per species for the material.
 */

type RGB = [number, number, number]
type Part = [number, number, number, number]

export interface WingRig {
  /** Shoulder x (|x|) and y of the hinge axis (parallel to Z). */
  hingeX: number
  hingeY: number
  /** Elbow x (|x|) and its span coordinate (outer part bends with a lag). */
  elbowX: number
  elbowSpan: number
  /** Head pivot (y, z) for head turns. */
  headY: number
  headZ: number
}

class Builder {
  readonly pos: number[] = []
  readonly nor: number[] = []
  readonly col: number[] = []
  readonly part: number[] = []
  readonly uv: number[] = []
  readonly withUv: boolean

  constructor(withUv = false) {
    this.withUv = withUv
  }

  vert(p: [number, number, number], n: [number, number, number], c: RGB, part: Part, uv: [number, number] = [0, 0]): void {
    this.pos.push(p[0], p[1], p[2])
    this.nor.push(n[0], n[1], n[2])
    this.col.push(c[0], c[1], c[2])
    this.part.push(part[0], part[1], part[2], part[3])
    if (this.withUv) this.uv.push(uv[0], uv[1])
  }

  /**
   * Make every triangle's winding agree with its shading normals: with
   * DoubleSide, three flips the normal of back-facing triangles, so a wrong
   * winding would light the outside of a body as if it were the inside.
   */
  private orient(): void {
    const P = this.pos
    const N = this.nor
    const swap = (arr: number[], size: number, a: number, b: number) => {
      for (let k = 0; k < size; k++) {
        const t = arr[a * size + k]
        arr[a * size + k] = arr[b * size + k]
        arr[b * size + k] = t
      }
    }
    for (let v = 0; v + 2 < P.length / 3; v += 3) {
      const ax = P[v * 3 + 3] - P[v * 3]
      const ay = P[v * 3 + 4] - P[v * 3 + 1]
      const az = P[v * 3 + 5] - P[v * 3 + 2]
      const bx = P[v * 3 + 6] - P[v * 3]
      const by = P[v * 3 + 7] - P[v * 3 + 1]
      const bz = P[v * 3 + 8] - P[v * 3 + 2]
      const gx = ay * bz - az * by
      const gy = az * bx - ax * bz
      const gz = ax * by - ay * bx
      const nx = N[v * 3] + N[v * 3 + 3] + N[v * 3 + 6]
      const ny = N[v * 3 + 1] + N[v * 3 + 4] + N[v * 3 + 7]
      const nz = N[v * 3 + 2] + N[v * 3 + 5] + N[v * 3 + 8]
      if (gx * nx + gy * ny + gz * nz >= 0) continue
      swap(P, 3, v + 1, v + 2)
      swap(N, 3, v + 1, v + 2)
      swap(this.col, 3, v + 1, v + 2)
      swap(this.part, 4, v + 1, v + 2)
      if (this.withUv) swap(this.uv, 2, v + 1, v + 2)
    }
  }

  build(): BufferGeometry {
    this.orient()
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3))
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3))
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3))
    g.setAttribute('aPart', new BufferAttribute(new Float32Array(this.part), 4))
    if (this.withUv) g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2))
    return g
  }
}

interface Ring {
  z: number
  /** Half width (x) and half height (y). */
  rx: number
  ry: number
  /** Centre height. */
  y: number
  /** Optional head weight / spine coordinate. */
  head?: number
  spine?: number
}

/**
 * A closed spindle (body) through elliptical rings along Z, smooth-shaded.
 * Colour by angle (top/bottom) via `color(ring, cosA, sinA)`.
 */
function spindle(b: Builder, rings: Ring[], sides: number, color: (ri: number, ca: number, sa: number) => RGB, uv: [number, number] = [0, 0]): void {
  const pts: [number, number, number][][] = []
  const nrm: [number, number, number][][] = []
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i]
    const prev = rings[Math.max(0, i - 1)]
    const next = rings[Math.min(rings.length - 1, i + 1)]
    const slopeX = (next.rx - prev.rx) / Math.max(1e-4, next.z - prev.z)
    const slopeY = (next.ry - prev.ry) / Math.max(1e-4, next.z - prev.z)
    const row: [number, number, number][] = []
    const nrow: [number, number, number][] = []
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      row.push([ca * r.rx, r.y + sa * r.ry, r.z])
      let nx = ca / Math.max(r.rx, 1e-3)
      let ny = sa / Math.max(r.ry, 1e-3)
      const l = Math.hypot(nx, ny) || 1
      nx /= l
      ny /= l
      const nz = -(Math.abs(ca) * slopeX + Math.abs(sa) * slopeY)
      const ln = Math.hypot(nx, ny, nz) || 1
      nrow.push([nx / ln, ny / ln, nz / ln])
    }
    pts.push(row)
    nrm.push(nrow)
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides
      const quad: [number, number][] = [
        [i, k],
        [i + 1, k],
        [i + 1, k1],
        [i, k1],
      ]
      for (const idx of [0, 1, 2, 0, 2, 3]) {
        const [ri, ki] = quad[idx]
        const a = (ki / sides) * Math.PI * 2
        const r = rings[ri]
        b.vert(pts[ri][ki], nrm[ri][ki], color(ri, Math.cos(a), Math.sin(a)), [0, r.head ?? 0, r.spine ?? 0, 0], uv)
      }
    }
  }
}

interface WingStation {
  /** Span coordinate 0..1. */
  s: number
  /** |x| of the station. */
  x: number
  /** z of the leading and trailing edge. */
  lead: number
  trail: number
  color: RGB
}

/** A flat, double-sided wing (both sides), mirrored for the left (+X) and right (−X) side. */
function wings(b: Builder, st: WingStation[], y: number): void {
  for (const side of [1, -1]) {
    for (let i = 0; i < st.length - 1; i++) {
      const a = st[i]
      const c = st[i + 1]
      const v: [[number, number, number], RGB, number][] = [
        [[side * a.x, y, a.lead], a.color, a.s],
        [[side * a.x, y, a.trail], a.color, a.s],
        [[side * c.x, y, c.trail], c.color, c.s],
        [[side * c.x, y, c.lead], c.color, c.s],
      ]
      for (const idx of side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) {
        const [p, col, s] = v[idx]
        b.vert(p, [0, 1, 0], col, [side * s, 0, 0, 0])
      }
    }
  }
}

/** Flat triangle fan (tail, feet), shading normal up; the material is double-sided. */
function flat(b: Builder, pts: [number, number, number][], color: RGB, part: Part = [0, 0, 0, 0]): void {
  for (let i = 1; i < pts.length - 1; i++) {
    for (const p of [pts[0], pts[i], pts[i + 1]]) b.vert(p, [0, 1, 0], color, part)
  }
}

function mix(a: RGB, c: RGB, t: number): RGB {
  return [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t]
}

/* ================================================================ gull */

/** Gull: wingspan ≈ 1.4 m, white body, pale grey mantle, black wingtips, yellow bill. */
export const GULL_RIG: WingRig = { hingeX: 0.05, hingeY: 0.03, elbowX: 0.33, elbowSpan: 0.43, headY: 0.04, headZ: 0.2 }

export function gullGeometry(): BufferGeometry {
  const b = new Builder()
  const white: RGB = [0.93, 0.93, 0.91]
  const grey: RGB = [0.62, 0.65, 0.7]
  const black: RGB = [0.07, 0.07, 0.08]
  const bill: RGB = [0.92, 0.72, 0.18]
  const rings: Ring[] = [
    { z: -0.3, rx: 0.005, ry: 0.005, y: 0.02 },
    { z: -0.2, rx: 0.045, ry: 0.04, y: 0.015 },
    { z: -0.04, rx: 0.075, ry: 0.07, y: 0 },
    { z: 0.1, rx: 0.065, ry: 0.065, y: 0.01 },
    { z: 0.19, rx: 0.042, ry: 0.045, y: 0.04, head: 1 },
    { z: 0.25, rx: 0.035, ry: 0.035, y: 0.045, head: 1 },
    { z: 0.27, rx: 0.012, ry: 0.012, y: 0.04, head: 1 },
    { z: 0.33, rx: 0.002, ry: 0.003, y: 0.035, head: 1 },
  ]
  spindle(b, rings, 7, (ri, _ca, sa) => (ri >= 6 ? bill : ri <= 1 || sa < 0.3 ? white : mix(white, grey, 0.55)))
  flat(b, [[0, 0.02, -0.2], [0.07, 0.02, -0.36], [0, 0.02, -0.34], [-0.07, 0.02, -0.36]], white)
  wings(
    b,
    [
      { s: 0, x: 0.05, lead: 0.12, trail: -0.1, color: grey },
      { s: 0.43, x: 0.33, lead: 0.11, trail: -0.12, color: grey },
      { s: 0.75, x: 0.53, lead: 0.07, trail: -0.1, color: mix(grey, black, 0.15) },
      { s: 0.8, x: 0.56, lead: 0.06, trail: -0.09, color: black },
      { s: 1, x: 0.7, lead: 0.0, trail: -0.05, color: black },
    ],
    GULL_RIG.hingeY,
  )
  return b.build()
}

/* ================================================================ swallow */

/** Barn swallow: wingspan ≈ 0.33 m, glossy blue-black above, rufous throat, cream belly, tail streamers. */
export const SWALLOW_RIG: WingRig = { hingeX: 0.018, hingeY: 0.01, elbowX: 0.07, elbowSpan: 0.35, headY: 0.01, headZ: 0.05 }

export function swallowGeometry(): BufferGeometry {
  const b = new Builder()
  const dark: RGB = [0.05, 0.07, 0.15]
  const rust: RGB = [0.55, 0.2, 0.09]
  const cream: RGB = [0.88, 0.82, 0.72]
  const rings: Ring[] = [
    { z: -0.07, rx: 0.004, ry: 0.003, y: 0.004 },
    { z: -0.035, rx: 0.016, ry: 0.014, y: 0.003 },
    { z: 0.02, rx: 0.022, ry: 0.02, y: 0 },
    { z: 0.055, rx: 0.017, ry: 0.016, y: 0.006, head: 1 },
    { z: 0.075, rx: 0.01, ry: 0.01, y: 0.007, head: 1 },
    { z: 0.085, rx: 0.002, ry: 0.002, y: 0.006, head: 1 },
  ]
  spindle(b, rings, 6, (ri, _ca, sa) => (sa > -0.1 ? dark : ri >= 3 ? rust : cream))
  // Forked tail with long outer streamers.
  flat(b, [[0, 0.004, -0.06], [0.03, 0.004, -0.14], [0.012, 0.004, -0.095], [0, 0.004, -0.085], [-0.012, 0.004, -0.095], [-0.03, 0.004, -0.14]], dark)
  // Long scythe wings, swept back.
  wings(
    b,
    [
      { s: 0, x: 0.018, lead: 0.035, trail: -0.02, color: dark },
      { s: 0.35, x: 0.07, lead: 0.03, trail: -0.03, color: dark },
      { s: 0.75, x: 0.13, lead: 0.0, trail: -0.035, color: dark },
      { s: 1, x: 0.165, lead: -0.035, trail: -0.05, color: dark },
    ],
    SWALLOW_RIG.hingeY,
  )
  return b.build()
}

/* ================================================================ dove */

/** Dove: wingspan ≈ 0.6 m, plump. Colour comes mostly from the instance tint (white … blue-grey). */
export const DOVE_RIG: WingRig = { hingeX: 0.045, hingeY: 0.075, elbowX: 0.16, elbowSpan: 0.42, headY: 0.11, headZ: 0.08 }

export function doveGeometry(): BufferGeometry {
  const b = new Builder()
  const body: RGB = [1, 1, 1]
  const neck: RGB = [0.88, 0.92, 0.9]
  const bar: RGB = [0.68, 0.68, 0.72]
  const tip: RGB = [0.55, 0.55, 0.6]
  const bill: RGB = [0.35, 0.28, 0.26]
  const rings: Ring[] = [
    { z: -0.13, rx: 0.006, ry: 0.006, y: 0.08 },
    { z: -0.08, rx: 0.038, ry: 0.035, y: 0.075 },
    { z: -0.02, rx: 0.06, ry: 0.06, y: 0.07 },
    { z: 0.04, rx: 0.058, ry: 0.065, y: 0.075 },
    { z: 0.075, rx: 0.036, ry: 0.04, y: 0.11, head: 0.5 },
    { z: 0.1, rx: 0.028, ry: 0.032, y: 0.15, head: 1 },
    { z: 0.13, rx: 0.028, ry: 0.03, y: 0.16, head: 1 },
    { z: 0.155, rx: 0.014, ry: 0.014, y: 0.157, head: 1 },
    { z: 0.165, rx: 0.006, ry: 0.006, y: 0.153, head: 1 },
    { z: 0.185, rx: 0.002, ry: 0.002, y: 0.148, head: 1 },
  ]
  spindle(b, rings, 8, (ri) => (ri >= 8 ? bill : ri === 4 ? neck : body))
  // Tail: a short fan, darker band at the end.
  flat(b, [[0, 0.08, -0.1], [0.045, 0.075, -0.2], [0, 0.075, -0.215], [-0.045, 0.075, -0.2]], mix(body, tip, 0.3))
  // Little feet.
  for (const sx of [-1, 1]) flat(b, [[sx * 0.02, 0.0, 0.02], [sx * 0.03, 0.0, 0.05], [sx * 0.01, 0.0, 0.05], [sx * 0.018, 0.03, 0.015]], [0.7, 0.35, 0.35])
  wings(
    b,
    [
      { s: 0, x: 0.045, lead: 0.06, trail: -0.07, color: body },
      { s: 0.42, x: 0.16, lead: 0.06, trail: -0.08, color: bar },
      { s: 0.72, x: 0.24, lead: 0.04, trail: -0.075, color: body },
      { s: 1, x: 0.31, lead: 0.0, trail: -0.05, color: tip },
    ],
    DOVE_RIG.hingeY,
  )
  return b.build()
}

/* ================================================================ butterfly */

/** Butterfly: wingspan ≈ 8 cm (×species scale); wings are textured quads hinged on the body axis. */
export const BUTTERFLY_RIG: WingRig = { hingeX: 0.002, hingeY: 0, elbowX: 1, elbowSpan: 2, headY: 0, headZ: 0 }

export function butterflyGeometry(): BufferGeometry {
  const b = new Builder(true)
  const body: RGB = [1, 1, 1]
  // Body: thin dark spindle sampling the opaque corner of the atlas cell.
  spindle(
    b,
    [
      { z: -0.022, rx: 0.001, ry: 0.001, y: 0 },
      { z: -0.012, rx: 0.003, ry: 0.003, y: 0 },
      { z: 0.008, rx: 0.0035, ry: 0.0035, y: 0 },
      { z: 0.015, rx: 0.003, ry: 0.003, y: 0.0005 },
      { z: 0.019, rx: 0.001, ry: 0.001, y: 0.001 },
    ],
    5,
    () => body,
    [0.03, 0.03],
  )
  // Antennae: two thin triangles.
  for (const sx of [-1, 1]) {
    const pts: [number, number, number][] = [
      [sx * 0.001, 0.001, 0.017],
      [sx * 0.009, 0.006, 0.035],
      [sx * 0.0015, 0.0015, 0.018],
    ]
    for (const p of pts) b.vert(p, [0, 1, 0], body, [0, 0, 0, 0], [0.03, 0.03])
  }
  // Wings: one quad per side; u = 0 at the body → 1 at the tip, v = 0 rear → 1 front.
  const span = 0.042
  const zf = 0.03
  const zr = -0.03
  for (const side of [1, -1]) {
    const v: [[number, number, number], [number, number], number][] = [
      [[side * 0.002, 0, zf], [0, 1], 0],
      [[side * 0.002, 0, zr], [0, 0], 0],
      [[side * span, 0, zr], [1, 0], 1],
      [[side * span, 0, zf], [1, 1], 1],
    ]
    for (const idx of side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) {
      const [p, uv, s] = v[idx]
      b.vert(p, [0, 1, 0], body, [side * Math.max(s, 0.02), 0, 0, 0], uv)
    }
  }
  return b.build()
}

/* ================================================================ bee */

export const BEE_RIG: WingRig = { hingeX: 0.002, hingeY: 0.003, elbowX: 1, elbowSpan: 2, headY: 0, headZ: 0 }

export function beeGeometry(): BufferGeometry {
  const b = new Builder()
  const yellow: RGB = [0.85, 0.6, 0.12]
  const brown: RGB = [0.12, 0.08, 0.05]
  const wing: RGB = [0.82, 0.86, 0.9]
  spindle(
    b,
    [
      { z: -0.008, rx: 0.0008, ry: 0.0008, y: 0 },
      { z: -0.005, rx: 0.0032, ry: 0.003, y: 0 },
      { z: -0.0015, rx: 0.0038, ry: 0.0036, y: 0 },
      { z: 0.002, rx: 0.0032, ry: 0.003, y: 0.0003 },
      { z: 0.005, rx: 0.0024, ry: 0.0024, y: 0.0005 },
      { z: 0.0075, rx: 0.0008, ry: 0.0008, y: 0.0005 },
    ],
    5,
    (ri) => (ri % 2 === 1 ? yellow : brown),
  )
  wings(
    b,
    [
      { s: 0, x: 0.002, lead: 0.003, trail: -0.002, color: wing },
      { s: 1, x: 0.009, lead: 0.0, trail: -0.004, color: wing },
    ],
    BEE_RIG.hingeY,
  )
  return b.build()
}

/* ================================================================ lizard */

/** Wall lizard (Podarcis): ≈ 20 cm with the tail. Spine coordinate drives the body wave. */
export const LIZARD_RIG: WingRig = { hingeX: 1, hingeY: 0, elbowX: 2, elbowSpan: 2, headY: 0.008, headZ: 0.05 }

export function lizardGeometry(): BufferGeometry {
  const b = new Builder()
  const back: RGB = [0.42, 0.4, 0.24]
  const spots: RGB = [0.22, 0.2, 0.13]
  const belly: RGB = [0.7, 0.64, 0.46]
  const green: RGB = [0.36, 0.45, 0.24]
  const len = 0.2
  const rings: Ring[] = []
  const prof: [number, number, number, number][] = [
    // [z, rx, ry, head]
    [0.085, 0.0015, 0.0012, 1],
    [0.078, 0.005, 0.0035, 1],
    [0.068, 0.008, 0.005, 1],
    [0.055, 0.007, 0.0055, 0.6],
    [0.045, 0.0085, 0.006, 0],
    [0.02, 0.011, 0.007, 0],
    [-0.005, 0.0105, 0.0068, 0],
    [-0.02, 0.008, 0.006, 0],
    [-0.04, 0.005, 0.0045, 0],
    [-0.065, 0.0035, 0.0032, 0],
    [-0.09, 0.0022, 0.0022, 0],
    [-0.115, 0.0008, 0.0008, 0],
  ]
  for (const [z, rx, ry, head] of prof) rings.push({ z, rx, ry, y: ry, head, spine: Math.max(0, (0.06 - z) / len) })
  spindle(b, rings, 6, (ri, ca, sa) => {
    if (sa < -0.2) return belly
    const k = Math.sin(ri * 2.3 + ca * 3) > 0.55 ? spots : ri >= 2 && ri <= 6 ? mix(back, green, 0.35) : back
    return k
  })
  // Four splayed legs (flat, with the body's spine coordinate so they ride the wave).
  const leg = (z: number, sx: number, forward: number) => {
    const sp = Math.max(0, (0.06 - z) / len)
    const pts: [number, number, number][] = [
      [sx * 0.007, 0.004, z + 0.004],
      [sx * 0.022, 0.0005, z + forward * 0.012],
      [sx * 0.026, 0.0005, z + forward * 0.006],
      [sx * 0.007, 0.004, z - 0.004],
    ]
    flat(b, pts, back, [0, 0, sp, 0])
  }
  for (const sx of [-1, 1]) {
    leg(0.035, sx, 1)
    leg(-0.012, sx, -1)
  }
  return b.build()
}
