/**
 * Spatial helpers: panner creation, smoothed positioning (AudioParams when
 * available, legacy setters otherwise), the listener driver and small
 * allocation-free geometry utilities.
 */
import type { Vec3Like } from './contract'
import { setParam } from './synth'

/** Listener smoothing time constant (s). Small: follows mouse-look without zipper noise. */
const LISTENER_TC = 0.025
/** A jump larger than this (m) is treated as a teleport and applied instantly. */
const TELEPORT_DISTANCE = 6

export interface PannerSpec {
  refDistance: number
  rolloff: number
  maxDistance?: number
  model?: PanningModelType
}

/** Shared, mutable listener position (read by the ambience control loop). */
export interface ListenerState {
  x: number
  y: number
  z: number
  /** False until the first updateListener() call. */
  valid: boolean
}

interface LegacyPanner {
  setPosition?: (x: number, y: number, z: number) => void
}

interface LegacyListener {
  setPosition?: (x: number, y: number, z: number) => void
  setOrientation?: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void
}

export function createPanner(ctx: BaseAudioContext, spec: PannerSpec, at?: Vec3Like): PannerNode {
  const p = ctx.createPanner()
  p.panningModel = spec.model ?? 'HRTF'
  p.distanceModel = 'inverse'
  p.refDistance = spec.refDistance
  p.rolloffFactor = spec.rolloff
  p.maxDistance = spec.maxDistance ?? 10000
  if (at) placePanner(p, at.x, at.y, at.z, ctx.currentTime, 0)
  return p
}

function hasParamPosition(p: PannerNode): boolean {
  return (p as { positionX?: AudioParam }).positionX !== undefined
}

/** Move a panner; tc ≤ 0 jumps instantly, otherwise glides with time constant tc. */
export function placePanner(p: PannerNode, x: number, y: number, z: number, now: number, tc: number): void {
  if (!Number.isFinite(x + y + z)) return
  if (hasParamPosition(p)) {
    setParam(p.positionX, x, now, tc)
    setParam(p.positionY, y, now, tc)
    setParam(p.positionZ, z, now, tc)
  } else {
    ;(p as unknown as LegacyPanner).setPosition?.(x, y, z)
  }
}

/**
 * Drives the AudioListener from camera pose. Uses AudioParams with a short time
 * constant (Chrome/Safari) or the legacy setters (Firefox).
 */
export class ListenerDriver {
  private readonly listener: AudioListener
  private readonly modern: boolean
  private first = true
  private lx = 0
  private ly = 0
  private lz = 0

  constructor(listener: AudioListener) {
    this.listener = listener
    this.modern = (listener as { positionX?: AudioParam }).positionX !== undefined && (listener as { forwardX?: AudioParam }).forwardX !== undefined
  }

  update(px: number, py: number, pz: number, fx: number, fy: number, fz: number, ux: number, uy: number, uz: number, now: number): void {
    // Sum is finite iff every component is (no allocation per frame).
    if (!Number.isFinite(px + py + pz + fx + fy + fz + ux + uy + uz)) return
    const dx = px - this.lx
    const dy = py - this.ly
    const dz = pz - this.lz
    const jump = this.first || dx * dx + dy * dy + dz * dz > TELEPORT_DISTANCE * TELEPORT_DISTANCE
    this.first = false
    this.lx = px
    this.ly = py
    this.lz = pz
    const l = this.listener
    if (this.modern) {
      const tc = jump ? 0 : LISTENER_TC
      setParam(l.positionX, px, now, tc)
      setParam(l.positionY, py, now, tc)
      setParam(l.positionZ, pz, now, tc)
      setParam(l.forwardX, fx, now, tc)
      setParam(l.forwardY, fy, now, tc)
      setParam(l.forwardZ, fz, now, tc)
      setParam(l.upX, ux, now, tc)
      setParam(l.upY, uy, now, tc)
      setParam(l.upZ, uz, now, tc)
    } else {
      const legacy = l as unknown as LegacyListener
      legacy.setPosition?.(px, py, pz)
      legacy.setOrientation?.(fx, fy, fz, ux, uy, uz)
    }
  }
}

/**
 * Tracks a moving point source (e.g. Seneca's head) with glide smoothing and
 * teleport detection. Keeps the last position so it can be re-applied on unlock.
 */
export class SmoothedEmitter {
  x = 0
  y = 0
  z = 0
  known = false
  private placed = false
  private ax = 0
  private ay = 0
  private az = 0
  private readonly tc: number

  constructor(tc: number) {
    this.tc = tc
  }

  set(p: Vec3Like): void {
    if (!Number.isFinite(p.x + p.y + p.z)) return
    this.x = p.x
    this.y = p.y
    this.z = p.z
    this.known = true
  }

  /** Push the stored position to `panner`. Jumps on first use or teleport. */
  apply(panner: PannerNode, now: number): void {
    if (!this.known) return
    const dx = this.x - this.ax
    const dy = this.y - this.ay
    const dz = this.z - this.az
    const jump = !this.placed || dx * dx + dy * dy + dz * dz > TELEPORT_DISTANCE * TELEPORT_DISTANCE
    placePanner(panner, this.x, this.y, this.z, now, jump ? 0 : this.tc)
    this.placed = true
    this.ax = this.x
    this.ay = this.y
    this.az = this.z
  }

  /** Forget that a panner was placed (new graph after re-unlock). */
  reset(): void {
    this.placed = false
  }
}

export function distanceTo(p: Vec3Like, x: number, y: number, z: number): number {
  const dx = p.x - x
  const dy = p.y - y
  const dz = p.z - z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/**
 * Indices of the `k` points nearest to (x, y, z), ascending, written into `out`.
 * Returns the count. O(n·k), no allocations.
 */
export function nearestIndices(points: readonly Vec3Like[], x: number, y: number, z: number, k: number, out: Int32Array): number {
  const n = Math.min(k, points.length, out.length)
  for (let slot = 0; slot < n; slot++) {
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < points.length; i++) {
      let taken = false
      for (let s = 0; s < slot; s++) {
        if (out[s] === i) {
          taken = true
          break
        }
      }
      if (taken) continue
      const p = points[i]
      const dx = p.x - x
      const dy = p.y - y
      const dz = p.z - z
      const d = dx * dx + dy * dy + dz * dz
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    out[slot] = best
  }
  return n
}

export function copyVec(p: Vec3Like): Vec3Like {
  return { x: p.x, y: p.y, z: p.z }
}
