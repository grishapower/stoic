/**
 * Small allocation-free helpers shared by the ambient-life systems: angles,
 * smoothing, a cubic Bézier, a cached height field and the instance-matrix
 * writer. No three.js here, so the logic stays testable in node.
 */

export { rng } from '../world/noise'

export type Rand = () => number

export const TAU = Math.PI * 2

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Hermite smoothstep; edges may be descending. */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Frame-rate independent exponential smoothing factor. */
export function damp(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * dt)
}

/** Wrap to (−π, π]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU
  if (a < 0) a += TAU
  return a - Math.PI
}

/** Move angle `a` toward `b` by the fraction `t` along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t
}

/** Smooth maximum (k = blend width). */
export function smax(a: number, b: number, k: number): number {
  const d = a - b
  return (a + b + Math.sqrt(d * d + k * k)) * 0.5
}

export function randIn(r: Rand, lo: number, hi: number): number {
  return lo + r() * (hi - lo)
}

export interface Vec3Like {
  x: number
  y: number
  z: number
}

export function dist3(a: Vec3Like, x: number, y: number, z: number): number {
  const dx = a.x - x
  const dy = a.y - y
  const dz = a.z - z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/* ------------------------------------------------------------- Bézier */

/** Cubic Bézier through 4 control points stored flat [p0, c1, c2, p3] (12 numbers). */
export function bezier(cp: Float64Array | number[], t: number, out: Vec3Like): Vec3Like {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  out.x = a * cp[0] + b * cp[3] + c * cp[6] + d * cp[9]
  out.y = a * cp[1] + b * cp[4] + c * cp[7] + d * cp[10]
  out.z = a * cp[2] + b * cp[5] + c * cp[8] + d * cp[11]
  return out
}

/** Derivative of the cubic Bézier (direction of travel). */
export function bezierTangent(cp: Float64Array | number[], t: number, out: Vec3Like): Vec3Like {
  const u = 1 - t
  const a = 3 * u * u
  const b = 6 * u * t
  const c = 3 * t * t
  out.x = a * (cp[3] - cp[0]) + b * (cp[6] - cp[3]) + c * (cp[9] - cp[6])
  out.y = a * (cp[4] - cp[1]) + b * (cp[7] - cp[4]) + c * (cp[10] - cp[7])
  out.z = a * (cp[5] - cp[2]) + b * (cp[8] - cp[5]) + c * (cp[11] - cp[8])
  return out
}

/* ------------------------------------------------------------- height field */

/**
 * A square grid of heights sampled once (e.g. ground + obstacle clearance) and
 * read back with bilinear interpolation — cheap enough for every agent, every frame.
 */
export class HeightField {
  readonly x0: number
  readonly z0: number
  readonly cell: number
  readonly n: number
  private readonly h: Float32Array

  constructor(cx: number, cz: number, halfSize: number, cell: number, fn: (x: number, z: number) => number) {
    this.cell = cell
    this.n = Math.ceil((halfSize * 2) / cell) + 1
    this.x0 = cx - halfSize
    this.z0 = cz - halfSize
    this.h = new Float32Array(this.n * this.n)
    for (let j = 0; j < this.n; j++) {
      for (let i = 0; i < this.n; i++) this.h[j * this.n + i] = fn(this.x0 + i * cell, this.z0 + j * cell)
    }
  }

  sample(x: number, z: number): number {
    const n = this.n
    const fx = clamp((x - this.x0) / this.cell, 0, n - 1.0001)
    const fz = clamp((z - this.z0) / this.cell, 0, n - 1.0001)
    const i = Math.floor(fx)
    const j = Math.floor(fz)
    const tx = fx - i
    const tz = fz - j
    const k = j * n + i
    const a = this.h[k] + (this.h[k + 1] - this.h[k]) * tx
    const b = this.h[k + n] + (this.h[k + n + 1] - this.h[k + n]) * tx
    return a + (b - a) * tz
  }
}

/* ------------------------------------------------------------- instance buffers */

/** Per-mesh instance data, shared directly with the GPU attributes (no copies). */
export interface InstanceBuffers {
  count: number
  /** 16 floats per instance (column-major Matrix4). */
  matrix: Float32Array
  /** aAnim: flap phase, flap amplitude, wing bias (dihedral), wing fold 0..1. */
  anim: Float32Array
  /** aAnim2: head yaw, head pitch, spine phase, spine amplitude. */
  anim2: Float32Array
  /** Instance colour (linear RGB). */
  color: Float32Array
  /** Optional per-instance atlas cell (butterfly species). */
  atlas: Float32Array
}

export function createBuffers(count: number): InstanceBuffers {
  const color = new Float32Array(count * 3).fill(1)
  return {
    count,
    matrix: new Float32Array(count * 16),
    anim: new Float32Array(count * 4),
    anim2: new Float32Array(count * 4),
    color,
    atlas: new Float32Array(count),
  }
}

/**
 * Write a TRS matrix: R = Ry(yaw) · Rx(−pitch) · Rz(roll), local +Z = forward.
 * yaw: heading (forward = (sin yaw, 0, cos yaw)); pitch: nose-up positive;
 * roll: positive lifts local +X (the animal's left side).
 */
export function writeTRS(m: Float32Array, i: number, x: number, y: number, z: number, yaw: number, pitch: number, roll: number, s: number): void {
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const ca = Math.cos(-pitch)
  const sa = Math.sin(-pitch)
  const cr = Math.cos(roll)
  const sr = Math.sin(roll)
  const o = i * 16
  // Column 0 (local X).
  m[o] = (cy * cr + sy * sa * sr) * s
  m[o + 1] = ca * sr * s
  m[o + 2] = (-sy * cr + cy * sa * sr) * s
  m[o + 3] = 0
  // Column 1 (local Y).
  m[o + 4] = (-cy * sr + sy * sa * cr) * s
  m[o + 5] = ca * cr * s
  m[o + 6] = (sy * sr + cy * sa * cr) * s
  m[o + 7] = 0
  // Column 2 (local Z = forward).
  m[o + 8] = sy * ca * s
  m[o + 9] = -sa * s
  m[o + 10] = cy * ca * s
  m[o + 11] = 0
  m[o + 12] = x
  m[o + 13] = y
  m[o + 14] = z
  m[o + 15] = 1
}

/** Hide an instance: zero scale, parked far below the world (degenerate triangles are never rasterised). */
export function writeHidden(m: Float32Array, i: number): void {
  const o = i * 16
  for (let k = 0; k < 16; k++) m[o + k] = 0
  m[o + 13] = -1e4
  m[o + 15] = 1
}

export function writeAnim(b: InstanceBuffers, i: number, phase: number, amp: number, bias: number, fold: number): void {
  const o = i * 4
  b.anim[o] = phase
  b.anim[o + 1] = amp
  b.anim[o + 2] = bias
  b.anim[o + 3] = fold
}

export function writeAnim2(b: InstanceBuffers, i: number, headYaw: number, headPitch: number, spinePhase: number, spineAmp: number): void {
  const o = i * 4
  b.anim2[o] = headYaw
  b.anim2[o + 1] = headPitch
  b.anim2[o + 2] = spinePhase
  b.anim2[o + 3] = spineAmp
}

export function setColor(b: InstanceBuffers, i: number, r: number, g: number, bl: number): void {
  b.color[i * 3] = r
  b.color[i * 3 + 1] = g
  b.color[i * 3 + 2] = bl
}
