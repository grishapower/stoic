import { groundHeight } from '../world/ground'
import { SWALLOW_ZONES } from '../world/props'
import { clamp, damp, HeightField, lerp, randIn, rng, setColor, smax, TAU, wrapAngle, writeAnim, writeAnim2, writeTRS, type InstanceBuffers, type Rand } from './math'
import { avoidPillar, obstaclesNear, type Obstacle } from './obstacles'

/**
 * Swallows: fast figure-eight swoops low over the lawns (1–4 m), rising
 * smoothly over trees. Each bird follows its own wobbling figure eight, which
 * slowly rotates, so paths never repeat exactly. Activity follows the walk's
 * progress: early on most hawk high above the zone; as the sun sinks they come
 * down to hunt low and fly faster.
 */

/* ------------------------------------------------------------- tuning */

const SPEED: [number, number] = [7, 10]
/** Fraction of the zone radius the figure eight may use. */
const REACH = 0.82
/** Low flight height above ground (m). */
const LOW: [number, number] = [1.0, 3.6]
/** Height while "hawking high" (m above ground). */
const HIGH: [number, number] = [11, 18]
/** Clearance kept above obstacles (m). */
const CLEARANCE = 0.7
const FLAP_HZ = 9
const FLAP_AMP = 0.85
const SCALE = 1.1
/** Keep-out margin around pillars (m beyond their radius). */
const PILLAR_KEEP = 1.6

const tmpP = { x: 0, z: 0 }

interface Zone {
  x: number
  z: number
  radius: number
  floor: HeightField
  ground: HeightField
  pillars: Obstacle[]
}

interface Swallow {
  zone: Zone
  theta: number
  omega: number
  /** Figure-eight wobble phases. */
  a: number
  b: number
  c: number
  h1: number
  h2: number
  alpha0: number
  alphaRate: number
  /** Personal activity threshold: comes down when activity exceeds it. */
  threshold: number
  high: number
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  roll: number
  yawRate: number
  flapPhase: number
  flapAmp: number
  flapping: boolean
  flapTimer: number
  primed: boolean
}

/** Swallow activity for a walk progress (0..1+): more and lower as the sun sets. */
export function swallowActivity(progress: number): number {
  return clamp(0.3 + 0.7 * ((progress - 0.15) / 0.85), 0.3, 1)
}

export class Swallows {
  readonly list: Swallow[] = []
  private readonly rand: Rand
  private time = 0

  constructor(perZone: number, seed: number) {
    this.rand = rng(seed)
    const r = this.rand
    for (const zd of SWALLOW_ZONES) {
      const obs = obstaclesNear(zd.x, zd.z, zd.radius + 4)
      const half = zd.radius + 1
      const zone: Zone = {
        x: zd.x,
        z: zd.z,
        radius: zd.radius,
        ground: new HeightField(zd.x, zd.z, half, 1, groundHeight),
        floor: new HeightField(zd.x, zd.z, half, 0.75, (x, z) => floorAt(x, z, obs)),
        pillars: obs.filter((o) => o.pillar),
      }
      for (let i = 0; i < perZone; i++) {
        const speed = randIn(r, SPEED[0], SPEED[1])
        const R = zd.radius * REACH
        this.list.push({
          zone,
          theta: r() * TAU,
          omega: speed / (0.8 * R),
          a: r() * TAU,
          b: r() * TAU,
          c: r() * TAU,
          h1: r() * TAU,
          h2: r() * TAU,
          alpha0: r() * TAU,
          alphaRate: (r() < 0.5 ? -1 : 1) * randIn(r, 0.02, 0.06),
          threshold: 0.2 + (i / Math.max(1, perZone)) * 0.7 + r() * 0.08,
          high: 1,
          x: zd.x,
          y: 0,
          z: zd.z,
          yaw: 0,
          pitch: 0,
          roll: 0,
          yawRate: 0,
          flapPhase: r() * TAU,
          flapAmp: 0,
          flapping: true,
          flapTimer: r(),
          primed: false,
        })
      }
    }
  }

  get count(): number {
    return this.list.length
  }

  update(dt: number, progress: number): void {
    if (dt <= 0) return
    this.time += dt
    const t = this.time
    const activity = swallowActivity(progress)
    const r = this.rand
    for (const s of this.list) {
      const zone = s.zone
      const wantHigh = activity < s.threshold ? 1 : 0
      if (!s.primed) s.high = wantHigh
      s.high += (wantHigh - s.high) * damp(0.35, dt)
      const speedMul = lerp(0.75, 1.15, activity) * (1 + 0.22 * Math.sin(t * 0.7 + s.a)) * lerp(1, 0.55, s.high)
      s.theta += s.omega * speedMul * dt
      const th = s.theta
      // Wobbling figure eight in the unit disc (|u| ≤ 0.75, |v| ≤ 0.6).
      const u = 0.62 * Math.sin(th) + 0.13 * Math.sin(2.7 * th + s.a)
      const v = 0.45 * Math.sin(2 * th + s.b) + 0.15 * Math.sin(1.9 * th + s.c)
      const al = s.alpha0 + t * s.alphaRate
      const ca = Math.cos(al)
      const sa = Math.sin(al)
      const R = zone.radius * REACH
      tmpP.x = zone.x + R * (u * ca - v * sa)
      tmpP.z = zone.z + R * (u * sa + v * ca)
      // Swerve around tall narrow trees (cypresses) instead of climbing over them.
      for (const o of zone.pillars) avoidPillar(o, tmpP.x, tmpP.z, o.radius + PILLAR_KEEP, tmpP)
      const x = tmpP.x
      const z = tmpP.z
      const g = zone.ground.sample(x, z)
      const low = LOW[0] + (LOW[1] - LOW[0]) * (0.5 + 0.5 * Math.sin(1.7 * th + s.h1)) * (0.65 + 0.35 * Math.sin(0.31 * t + s.h2))
      const yLow = smax(g + low, zone.floor.sample(x, z), 0.8)
      const yHigh = g + HIGH[0] + (HIGH[1] - HIGH[0]) * (0.5 + 0.5 * Math.sin(0.4 * th + s.h2))
      const y = lerp(yLow, yHigh, s.high)

      // Orientation from the motion.
      if (s.primed) {
        const dx = x - s.x
        const dy = y - s.y
        const dz = z - s.z
        const h = Math.hypot(dx, dz)
        if (h > 1e-5) {
          const yaw = Math.atan2(dx, dz)
          const rate = wrapAngle(yaw - s.yaw) / dt
          s.yawRate += (clamp(rate, -6, 6) - s.yawRate) * damp(10, dt)
          s.yaw = yaw
          s.pitch += (Math.atan2(dy, h) - s.pitch) * damp(8, dt)
          const sp = h / dt
          const bank = clamp(-Math.atan((sp * s.yawRate) / 9.81), -1.2, 1.2)
          s.roll += (bank - s.roll) * damp(10, dt)
        }
      } else {
        s.primed = true
      }
      s.x = x
      s.y = y
      s.z = z

      // Flap bursts (3–6 beats) alternating with swept-wing glides.
      s.flapTimer -= dt
      if (s.flapTimer <= 0) {
        s.flapping = !s.flapping
        s.flapTimer = s.flapping ? randIn(r, 0.3, 0.7) : randIn(r, 0.25, 0.9) * lerp(1, 1.6, s.high)
      }
      s.flapAmp += ((s.flapping ? FLAP_AMP : 0.05) - s.flapAmp) * damp(14, dt)
      if (s.flapping || s.flapAmp > 0.1) s.flapPhase = (s.flapPhase + TAU * FLAP_HZ * dt) % TAU
    }
  }

  write(b: InstanceBuffers): void {
    for (let i = 0; i < this.list.length; i++) {
      const s = this.list[i]
      writeTRS(b.matrix, i, s.x, s.y, s.z, s.yaw, s.pitch, s.roll, SCALE)
      // Gliding: wings swept back (partial fold) and slightly lowered.
      const glide = 1 - clamp(s.flapAmp / FLAP_AMP, 0, 1)
      writeAnim(b, i, s.flapPhase, s.flapAmp, 0.05 - 0.12 * glide, 0.38 * glide)
      writeAnim2(b, i, 0, 0, 0, 0)
    }
  }

  writeColors(b: InstanceBuffers): void {
    for (let i = 0; i < this.list.length; i++) setColor(b, i, 1, 1, 1)
  }
}

/** Ground + clearance, raised smoothly over trees and other obstacles. */
function floorAt(x: number, z: number, obs: readonly Obstacle[]): number {
  let f = groundHeight(x, z) + LOW[0]
  for (const o of obs) {
    if (o.pillar) continue
    const d = Math.hypot(x - o.x, z - o.z)
    const k = 1 - clamp((d - o.radius * 0.55) / (o.radius * 0.45 + 1.8), 0, 1)
    if (k <= 0) continue
    const s = k * k * (3 - 2 * k)
    f = Math.max(f, o.base + (o.top + CLEARANCE) * s)
  }
  return f
}
