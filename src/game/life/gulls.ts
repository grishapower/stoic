import { TERRACE, TERRACE_Y } from '../world/layout'
import { GULL_ZONE } from '../world/props'
import { clamp, damp, randIn, rng, setColor, TAU, wrapAngle, writeAnim, writeAnim2, writeTRS, type InstanceBuffers, type Rand, type Vec3Like } from './math'

/**
 * Gulls over the bay: wide lazy circles (steered, banking into the turn),
 * glides with the occasional flap burst, transits between "thermals", and now
 * and then one gull drifting in past the terrace before returning to the zone.
 */

/* ------------------------------------------------------------- tuning */

const SPEED: [number, number] = [7.2, 9.2]
const CIRCLE_R: [number, number] = [15, 30]
/** Max turn rate (rad/s) — sets the tightest possible turn. */
const MAX_TURN = 0.55
/** Seconds spent circling one thermal before moving on. */
const CIRCLE_TIME: [number, number] = [25, 70]
const ALT_CHANGE: [number, number] = [9, 22]
const CLIMB_MAX = 1.3
const SINK_MAX = 1.1
/** Flap bursts (s) and the gaps between them. */
const FLAP_BURST: [number, number] = [1.2, 3.4]
const FLAP_GAP: [number, number] = [5, 18]
const FLAP_HZ = 2.7
const FLAP_AMP = 0.72
const GLIDE_DIHEDRAL = 0.13
/** A gull visits the terrace every so often (s). */
const VISIT_FIRST: [number, number] = [25, 55]
const VISIT_EVERY: [number, number] = [55, 120]
/** Visit path past the terrace (x, y, z): ~9–20 m off the parapet, near eye level. */
const VISIT_PATH: [number, number, number][] = [
  [52, TERRACE_Y + 4, -84],
  [22, TERRACE_Y + 2.2, -66],
  [0, TERRACE_Y + 1.6, -64],
  [-22, TERRACE_Y + 2.6, -67],
  [-52, TERRACE_Y + 5, -86],
]
/** Distant cries (s between calls). */
const CRY_EVERY: [number, number] = [20, 60]
const SCALE = 1
/** Pursuit lookahead along the circle (m). */
const LOOKAHEAD = 16

type Mode = 'circle' | 'transit' | 'visit'

interface Gull {
  x: number
  y: number
  z: number
  yaw: number
  yawRate: number
  vy: number
  roll: number
  speed: number
  mode: Mode
  /** Current thermal (circle centre/radius/direction). */
  cx: number
  cz: number
  r: number
  dir: number
  altTarget: number
  nextAlt: number
  modeUntil: number
  flapPhase: number
  flapAmp: number
  flapUntil: number
  nextFlap: number
  visitIdx: number
  visitReverse: boolean
  /** True after a visit until the gull is back inside the zone. */
  outside: boolean
  cried: boolean
  tint: number
}

export interface GullEvents {
  gull?(p: Vec3Like, near: boolean): void
}

const tmp: Vec3Like = { x: 0, y: 0, z: 0 }
const TERRACE_CX = (TERRACE.minX + TERRACE.maxX) / 2
const TERRACE_CZ = TERRACE.balustradeZ

export class Gulls {
  readonly list: Gull[] = []
  private readonly rand: Rand
  private time = 0
  private nextVisit: number
  private nextCry: number

  constructor(count: number, seed: number) {
    this.rand = rng(seed)
    const r = this.rand
    for (let i = 0; i < count; i++) {
      const g: Gull = {
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        yawRate: 0,
        vy: 0,
        roll: 0,
        speed: randIn(r, SPEED[0], SPEED[1]),
        mode: 'circle',
        cx: 0,
        cz: 0,
        r: 20,
        dir: r() < 0.5 ? -1 : 1,
        altTarget: 0,
        nextAlt: randIn(r, 0, ALT_CHANGE[1]),
        modeUntil: randIn(r, 5, CIRCLE_TIME[1]),
        flapPhase: r() * TAU,
        flapAmp: 0,
        flapUntil: 0,
        nextFlap: randIn(r, 0, FLAP_GAP[1]),
        visitIdx: 0,
        visitReverse: false,
        outside: false,
        cried: false,
        tint: 0.92 + r() * 0.08,
      }
      this.pickThermal(g)
      // Start on the circle, heading along it.
      const a = r() * TAU
      g.x = g.cx + Math.cos(a) * g.r
      g.z = g.cz + Math.sin(a) * g.r
      g.yaw = Math.atan2(-Math.sin(a) * g.dir, Math.cos(a) * g.dir)
      g.y = randIn(r, GULL_ZONE.minY + 3, GULL_ZONE.maxY - 3)
      g.altTarget = g.y
      this.list.push(g)
    }
    this.nextVisit = randIn(this.rand, VISIT_FIRST[0], VISIT_FIRST[1])
    this.nextCry = randIn(this.rand, 6, CRY_EVERY[0])
  }

  get count(): number {
    return this.list.length
  }

  /**
   * A new thermal fully inside the zone, preferably ahead of the gull so it
   * glides over without a U-turn (a U-turn at the zone edge would carry it out).
   */
  private pickThermal(g: Gull): void {
    const r = this.rand
    g.r = randIn(r, CIRCLE_R[0], CIRCLE_R[1])
    // Steady circles settle ~15 % wider than r: keep them inside the zone.
    const maxD = Math.max(0, GULL_ZONE.radius - g.r * 1.3 - 4)
    const hx = Math.sin(g.yaw)
    const hz = Math.cos(g.yaw)
    let bestX = GULL_ZONE.x
    let bestZ = GULL_ZONE.z
    let bestDot = -2
    for (let k = 0; k < 10; k++) {
      const a = r() * TAU
      const d = Math.sqrt(r()) * maxD
      const cx = GULL_ZONE.x + Math.cos(a) * d
      const cz = GULL_ZONE.z + Math.sin(a) * d
      const l = Math.hypot(cx - g.x, cz - g.z) || 1
      const dot = ((cx - g.x) * hx + (cz - g.z) * hz) / l
      if (dot > bestDot) {
        bestDot = dot
        bestX = cx
        bestZ = cz
      }
      if (dot > 0.5) break
    }
    g.cx = bestX
    g.cz = bestZ
    // Circle the new thermal in the sense the gull is already turning (no U-turns).
    const cross = (g.x - g.cx) * hz - (g.z - g.cz) * hx
    g.dir = cross >= 0 ? 1 : -1
  }

  update(dt: number, events: GullEvents): void {
    this.time += dt
    const now = this.time
    const r = this.rand
    if (now >= this.nextVisit) {
      this.nextVisit = now + randIn(r, VISIT_EVERY[0], VISIT_EVERY[1])
      // The circling gull nearest the terrace side of the zone comes in.
      let best: Gull | null = null
      let bestD = Infinity
      for (const g of this.list) {
        if (g.mode === 'visit' || g.outside) continue
        const d = Math.hypot(g.x - TERRACE_CX, g.z - TERRACE_CZ)
        if (d < bestD) {
          bestD = d
          best = g
        }
      }
      if (best) {
        best.mode = 'visit'
        best.visitReverse = best.x < TERRACE_CX
        best.visitIdx = 0
        best.cried = false
        best.outside = true
      }
    }
    if (now >= this.nextCry && this.list.length > 0) {
      this.nextCry = now + randIn(r, CRY_EVERY[0], CRY_EVERY[1])
      const g = this.list[Math.floor(r() * this.list.length) % this.list.length]
      tmp.x = g.x
      tmp.y = g.y
      tmp.z = g.z
      events.gull?.(tmp, false)
    }
    for (const g of this.list) this.step(g, dt, now, events)
  }

  private step(g: Gull, dt: number, now: number, events: GullEvents): void {
    const r = this.rand
    let desired = g.yaw
    if (g.mode !== 'visit') {
      // Pure pursuit of a carrot running ahead on the thermal's circle: stable
      // circling, and from afar (transit) a smooth spiral in without overshoot.
      const dx = g.x - g.cx
      const dz = g.z - g.cz
      const d = Math.hypot(dx, dz) || 1
      const a = Math.atan2(dz, dx) + (g.dir * LOOKAHEAD) / g.r
      desired = Math.atan2(g.cx + Math.cos(a) * g.r - g.x, g.cz + Math.sin(a) * g.r - g.z)
      if (g.mode === 'transit' && d < g.r * 1.3) {
        g.mode = 'circle'
        g.modeUntil = now + randIn(r, CIRCLE_TIME[0], CIRCLE_TIME[1])
      } else if (g.mode === 'circle' && now >= g.modeUntil) {
        this.pickThermal(g)
        g.mode = 'transit'
      }
    } else {
      const idx = g.visitReverse ? VISIT_PATH.length - 1 - g.visitIdx : g.visitIdx
      const w = VISIT_PATH[idx]
      const dx = w[0] - g.x
      const dz = w[2] - g.z
      desired = Math.atan2(dx, dz)
      g.altTarget = w[1]
      const near = Math.hypot(dx, dz)
      if (!g.cried && Math.abs(g.x - TERRACE_CX) < 8) {
        g.cried = true
        tmp.x = g.x
        tmp.y = g.y
        tmp.z = g.z
        events.gull?.(tmp, true)
      }
      if (near < 9) {
        g.visitIdx++
        if (g.visitIdx >= VISIT_PATH.length) {
          this.pickThermal(g)
          g.mode = 'transit'
          g.nextAlt = now
        }
      }
    }
    if (g.outside && g.mode !== 'visit' && Math.hypot(g.x - GULL_ZONE.x, g.z - GULL_ZONE.z) < GULL_ZONE.radius - 2) g.outside = false

    // Turn toward the desired heading with a limited, smoothed rate.
    const want = clamp(wrapAngle(desired - g.yaw) * 1.4, -MAX_TURN, MAX_TURN)
    g.yawRate += (want - g.yawRate) * damp(3, dt)
    g.yaw = wrapAngle(g.yaw + g.yawRate * dt)

    // Altitude: slow drift between targets; climbing needs flapping.
    if (g.mode !== 'visit' && now >= g.nextAlt) {
      g.nextAlt = now + randIn(r, ALT_CHANGE[0], ALT_CHANGE[1])
      g.altTarget = randIn(r, GULL_ZONE.minY + 2, GULL_ZONE.maxY - 2)
    }
    const wantVy = clamp((g.altTarget - g.y) * 0.25, g.mode === 'visit' ? -SINK_MAX * 2 : -SINK_MAX, CLIMB_MAX)
    g.vy += (wantVy - g.vy) * damp(0.8, dt)

    const v = g.speed * (1 + 0.06 * Math.sin(now * 0.3 + g.tint * 40))
    g.x += Math.sin(g.yaw) * v * dt
    g.z += Math.cos(g.yaw) * v * dt
    g.y += g.vy * dt

    // Bank into the turn (local +X is the gull's left; a left turn has yawRate > 0).
    const bank = clamp(-Math.atan((v * g.yawRate) / 9.81) * 1.2, -0.65, 0.65)
    g.roll += (bank - g.roll) * damp(2.5, dt)

    // Flap bursts: random, and whenever climbing.
    if (now >= g.nextFlap) {
      g.flapUntil = now + randIn(r, FLAP_BURST[0], FLAP_BURST[1])
      g.nextFlap = g.flapUntil + randIn(r, FLAP_GAP[0], FLAP_GAP[1])
    }
    const flapping = now < g.flapUntil || g.vy > 0.6
    g.flapAmp += ((flapping ? FLAP_AMP : 0.03) - g.flapAmp) * damp(flapping ? 5 : 2.2, dt)
    g.flapPhase = (g.flapPhase + TAU * FLAP_HZ * (flapping ? 1 : 0.35) * dt) % TAU
  }

  write(b: InstanceBuffers): void {
    for (let i = 0; i < this.list.length; i++) {
      const g = this.list[i]
      const pitch = Math.atan2(g.vy, g.speed) * 0.8
      // Bob slightly with each downstroke.
      const bob = -Math.sin(g.flapPhase) * g.flapAmp * 0.06
      writeTRS(b.matrix, i, g.x, g.y + bob, g.z, g.yaw, pitch, g.roll, SCALE)
      writeAnim(b, i, g.flapPhase, g.flapAmp, GLIDE_DIHEDRAL, 0)
      writeAnim2(b, i, 0, 0, 0, 0)
    }
  }

  writeColors(b: InstanceBuffers): void {
    for (let i = 0; i < this.list.length; i++) {
      const t = this.list[i].tint
      setColor(b, i, t, t, t)
    }
  }
}
