import { groundHeight } from '../world/ground'
import { BEEHIVES, BUTTERFLY_ZONES } from '../world/props'
import { clamp, damp, HeightField, lerp, lerpAngle, randIn, rng, setColor, TAU, writeAnim, writeAnim2, writeTRS, type InstanceBuffers, type Rand } from './math'
import { obstaclesNear, type Obstacle } from './obstacles'

/**
 * Butterflies over the flower zones and bees: a swarm around the hives, a few
 * bees working the flowers and some commuting between the two.
 */

/* ------------------------------------------------------------- tuning */

/** Butterfly flight band above ground (m). */
const BF_LOW = 0.2
const BF_HIGH = 1.6
const BF_MAX_SPEED = 1.5
/** Steering gains: seek target, damping, erratic jitter. */
const BF_SEEK = 2.2
const BF_DRAG = 1.4
const BF_JITTER = 5.5
/** Chance a new target is a flower to settle on, and how long they rest (s). */
const BF_LAND_CHANCE = 0.3
const BF_REST: [number, number] = [2, 7]

export const BUTTERFLY_SPECIES = ['cabbage-white', 'swallowtail', 'red-admiral', 'common-blue'] as const
/** Wingbeat (Hz) and size per species. */
const BF_HZ = [11, 7, 9, 12]
const BF_SCALE = [1, 1.3, 1.12, 0.85]
/** Relative frequency of each species. */
const BF_WEIGHT = [0.4, 0.2, 0.28, 0.12]

/** Hive swarm: radius around the hives (m) and height band above ground (m). */
const HIVE_RADIUS: [number, number] = [0.25, 1.7]
const HIVE_HEIGHT: [number, number] = [0.5, 1.6]
const BEE_HZ = 23
const BEE_SCALE = 1.5
const FLOWER_HOVER: [number, number] = [1.2, 4.5]
const BEE_DART_SPEED = 1.8
const COMMUTE_SPEED = 3.6
const COMMUTE_FORAGE: [number, number] = [6, 16]
const COMMUTE_HOME: [number, number] = [3, 10]

interface FlowerZone {
  x: number
  z: number
  radius: number
  ground: HeightField
  obstacles: Obstacle[]
}

function flowerZones(): FlowerZone[] {
  return BUTTERFLY_ZONES.map((z) => ({
    x: z.x,
    z: z.z,
    radius: z.radius,
    ground: new HeightField(z.x, z.z, z.radius + 1.5, 0.5, groundHeight),
    obstacles: obstaclesNear(z.x, z.z, z.radius + 1).filter((o) => o.low > 0),
  }))
}

/** Random point in a zone (uniform in the disc, r ≤ `frac`·radius). */
function pointIn(z: FlowerZone, r: Rand, frac: number, out: { x: number; z: number }): void {
  const a = r() * TAU
  const d = Math.sqrt(r()) * z.radius * frac
  out.x = z.x + Math.cos(a) * d
  out.z = z.z + Math.sin(a) * d
}

/** Keep (x, z) outside the low parts of obstacles. Returns true if it was pushed. */
function pushOut(obs: readonly Obstacle[], p: { x: number; z: number }, margin: number): boolean {
  let pushed = false
  for (const o of obs) {
    const dx = p.x - o.x
    const dz = p.z - o.z
    const d = Math.hypot(dx, dz)
    const R = o.low + margin
    if (d < R && d > 1e-6) {
      p.x = o.x + (dx / d) * R
      p.z = o.z + (dz / d) * R
      pushed = true
    }
  }
  return pushed
}

const tmpP = { x: 0, z: 0 }

/* ================================================================ butterflies */

interface Butterfly {
  zone: FlowerZone
  species: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  tx: number
  ty: number
  tz: number
  retargetAt: number
  resting: boolean
  landing: boolean
  restUntil: number
  flapPhase: number
  flapAmp: number
  glideUntil: number
  yaw: number
  pitch: number
  n1: number
  n2: number
  n3: number
}

export class Butterflies {
  readonly list: Butterfly[] = []
  private readonly rand: Rand
  private time = 0

  constructor(perZone: number, seed: number) {
    this.rand = rng(seed)
    const r = this.rand
    for (const zone of flowerZones()) {
      for (let i = 0; i < perZone; i++) {
        let species = 0
        let pick = r()
        for (let k = 0; k < BF_WEIGHT.length; k++) {
          pick -= BF_WEIGHT[k]
          if (pick <= 0) {
            species = k
            break
          }
        }
        pointIn(zone, r, 0.8, tmpP)
        const g = zone.ground.sample(tmpP.x, tmpP.z)
        const b: Butterfly = {
          zone,
          species,
          x: tmpP.x,
          y: g + randIn(r, 0.4, 1.2),
          z: tmpP.z,
          vx: 0,
          vy: 0,
          vz: 0,
          tx: tmpP.x,
          ty: g + 0.8,
          tz: tmpP.z,
          retargetAt: 0,
          resting: false,
          landing: false,
          restUntil: 0,
          flapPhase: r() * TAU,
          flapAmp: 1,
          glideUntil: 0,
          yaw: r() * TAU,
          pitch: 0,
          n1: r() * TAU,
          n2: r() * TAU,
          n3: r() * TAU,
        }
        this.retarget(b, 0)
        this.list.push(b)
      }
    }
  }

  get count(): number {
    return this.list.length
  }

  private retarget(b: Butterfly, now: number): void {
    const r = this.rand
    pointIn(b.zone, r, 0.9, tmpP)
    pushOut(b.zone.obstacles, tmpP, 0.3)
    const g = b.zone.ground.sample(tmpP.x, tmpP.z)
    b.landing = r() < BF_LAND_CHANCE
    b.tx = tmpP.x
    b.tz = tmpP.z
    b.ty = g + (b.landing ? randIn(r, 0.22, 0.45) : randIn(r, 0.35, 1.45))
    b.retargetAt = now + randIn(r, 1.2, 4)
  }

  update(dt: number): void {
    if (dt <= 0) return
    this.time += dt
    const now = this.time
    const r = this.rand
    for (const b of this.list) {
      const hz = BF_HZ[b.species]
      if (b.resting) {
        // Wings slowly open and close while sitting on a flower.
        b.flapAmp += (0.35 - b.flapAmp) * damp(4, dt)
        b.flapPhase = (b.flapPhase + TAU * 0.6 * dt) % TAU
        b.pitch += (0 - b.pitch) * damp(4, dt)
        if (now >= b.restUntil) {
          b.resting = false
          this.retarget(b, now)
          b.vy = 0.6
        }
        continue
      }
      // Steering: seek the target, with damping and an erratic, smooth jitter.
      const jx = Math.sin(now * 3.1 + b.n1) + Math.sin(now * 7.3 + b.n2) * 0.6
      const jy = Math.sin(now * 4.3 + b.n3) + Math.sin(now * 9.1 + b.n1) * 0.5
      const jz = Math.cos(now * 2.7 + b.n2) + Math.sin(now * 6.1 + b.n3) * 0.6
      const seek = b.landing ? BF_SEEK * 1.4 : BF_SEEK
      b.vx += ((b.tx - b.x) * seek - b.vx * BF_DRAG + jx * BF_JITTER * 0.35) * dt
      b.vy += ((b.ty - b.y) * seek - b.vy * BF_DRAG + jy * BF_JITTER * 0.3) * dt
      b.vz += ((b.tz - b.z) * seek - b.vz * BF_DRAG + jz * BF_JITTER * 0.35) * dt
      const sp = Math.hypot(b.vx, b.vy, b.vz)
      if (sp > BF_MAX_SPEED) {
        const k = BF_MAX_SPEED / sp
        b.vx *= k
        b.vy *= k
        b.vz *= k
      }
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.z += b.vz * dt
      // Stay in the zone, out of trunks/canopies and within the height band.
      tmpP.x = b.x
      tmpP.z = b.z
      const dz = Math.hypot(b.x - b.zone.x, b.z - b.zone.z)
      if (dz > b.zone.radius) {
        tmpP.x = b.zone.x + ((b.x - b.zone.x) / dz) * b.zone.radius
        tmpP.z = b.zone.z + ((b.z - b.zone.z) / dz) * b.zone.radius
      }
      pushOut(b.zone.obstacles, tmpP, 0.12)
      b.x = tmpP.x
      b.z = tmpP.z
      const g = b.zone.ground.sample(b.x, b.z)
      if (b.y < g + BF_LOW) {
        b.y = g + BF_LOW
        if (b.vy < 0) b.vy = 0
      } else if (b.y > g + BF_HIGH) {
        b.y = g + BF_HIGH
        if (b.vy > 0) b.vy = 0
      }
      // Arrived: settle on the flower, or pick a new target.
      const toT = Math.hypot(b.tx - b.x, b.ty - b.y, b.tz - b.z)
      if (b.landing && toT < 0.1) {
        b.resting = true
        b.restUntil = now + randIn(r, BF_REST[0], BF_REST[1])
        b.vx = b.vy = b.vz = 0
        continue
      }
      if ((!b.landing && toT < 0.25) || now >= b.retargetAt + (b.landing ? 4 : 0)) this.retarget(b, now)
      // Heading follows the motion; bigger species glide now and then.
      const h = Math.hypot(b.vx, b.vz)
      if (h > 0.05) b.yaw = lerpAngle(b.yaw, Math.atan2(b.vx, b.vz), damp(7, dt))
      b.pitch += (clamp(Math.atan2(b.vy, Math.max(h, 0.1)) * 0.5, -0.4, 0.5) + 0.12 - b.pitch) * damp(6, dt)
      if (b.species === 1 && now >= b.glideUntil + 2 && r() < dt * 0.5) b.glideUntil = now + randIn(r, 0.4, 1.0)
      const gliding = now < b.glideUntil
      b.flapAmp += ((gliding ? 0.12 : 0.95) - b.flapAmp) * damp(10, dt)
      b.flapPhase = (b.flapPhase + TAU * hz * (gliding ? 0.2 : 1) * dt) % TAU
    }
  }

  write(buf: InstanceBuffers): void {
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i]
      // Each downstroke lifts the body a little (the typical bobbing flight).
      const bob = b.resting ? 0 : Math.sin(b.flapPhase) * 0.025 * b.flapAmp
      writeTRS(buf.matrix, i, b.x, b.y + bob, b.z, b.yaw, b.pitch, 0, BF_SCALE[b.species])
      // Resting: wings held up (bias ≈ 1.1) and slowly opening; flying: big strokes around 0.5 rad.
      writeAnim(buf, i, b.flapPhase, b.flapAmp, b.resting ? 1.05 : 0.5, 0)
      writeAnim2(buf, i, 0, 0, 0, 0)
    }
  }

  writeColors(buf: InstanceBuffers): void {
    for (let i = 0; i < this.list.length; i++) {
      setColor(buf, i, 1, 1, 1)
      buf.atlas[i] = this.list[i].species
    }
  }
}

/* ================================================================ bees */

type BeeKind = 'hive' | 'flower' | 'commuter'
type CommuteState = 'out' | 'forage' | 'back' | 'home'

interface Bee {
  kind: BeeKind
  x: number
  y: number
  z: number
  px: number
  py: number
  pz: number
  yaw: number
  pitch: number
  /* hive orbit */
  ra: number
  rb: number
  h0: number
  w1: number
  w2: number
  w3: number
  p1: number
  p2: number
  p3: number
  /* flower hovering / darting */
  zone: FlowerZone | null
  hx: number
  hy: number
  hz: number
  fromX: number
  fromY: number
  fromZ: number
  moveT: number
  moveDur: number
  hoverUntil: number
  /* commuting */
  state: CommuteState
  stateUntil: number
  flapPhase: number
}

export class Bees {
  readonly list: Bee[] = []
  private readonly rand: Rand
  private readonly zones: FlowerZone[]
  private readonly hx: number
  private readonly hy: number
  private readonly hz: number
  private time = 0

  constructor(hiveCount: number, flowerCount: number, commuterCount: number, seed: number) {
    this.rand = rng(seed)
    const r = this.rand
    this.zones = flowerZones()
    this.hx = BEEHIVES.x
    this.hz = BEEHIVES.z
    this.hy = groundHeight(BEEHIVES.x, BEEHIVES.z)
    const make = (kind: BeeKind): Bee => ({
      kind,
      x: this.hx,
      y: this.hy + 1,
      z: this.hz,
      px: this.hx,
      py: this.hy + 1,
      pz: this.hz,
      yaw: r() * TAU,
      pitch: 0,
      ra: randIn(r, HIVE_RADIUS[0], HIVE_RADIUS[1]),
      rb: randIn(r, HIVE_RADIUS[0], HIVE_RADIUS[1]),
      h0: randIn(r, HIVE_HEIGHT[0], HIVE_HEIGHT[1]),
      w1: randIn(r, 0.7, 2.2) * (r() < 0.5 ? -1 : 1),
      w2: randIn(r, 0.9, 2.6),
      w3: randIn(r, 0.6, 1.9),
      p1: r() * TAU,
      p2: r() * TAU,
      p3: r() * TAU,
      zone: null,
      hx: 0,
      hy: 0,
      hz: 0,
      fromX: 0,
      fromY: 0,
      fromZ: 0,
      moveT: 1,
      moveDur: 1,
      hoverUntil: 0,
      state: 'home',
      stateUntil: randIn(r, 0, 8),
      flapPhase: r() * TAU,
    })
    for (let i = 0; i < hiveCount; i++) this.list.push(make('hive'))
    for (let i = 0; i < flowerCount; i++) {
      const b = make('flower')
      b.zone = this.zones[i % this.zones.length]
      this.newFlower(b, b.zone)
      b.x = b.hx
      b.y = b.hy
      b.z = b.hz
      b.moveT = 1
      this.list.push(b)
    }
    for (let i = 0; i < commuterCount; i++) this.list.push(make('commuter'))
  }

  get count(): number {
    return this.list.length
  }

  private newFlower(b: Bee, zone: FlowerZone): void {
    const r = this.rand
    pointIn(zone, r, 0.95, tmpP)
    pushOut(zone.obstacles, tmpP, 0.15)
    b.fromX = b.x
    b.fromY = b.y
    b.fromZ = b.z
    b.hx = tmpP.x
    b.hz = tmpP.z
    b.hy = zone.ground.sample(tmpP.x, tmpP.z) + randIn(r, 0.22, 0.7)
    const d = Math.hypot(b.hx - b.fromX, b.hy - b.fromY, b.hz - b.fromZ)
    b.moveT = 0
    b.moveDur = Math.max(0.15, d / BEE_DART_SPEED)
    b.hoverUntil = -1
  }

  /** Start a straight-ish trip from the current position to (x, y, z). */
  private trip(b: Bee, x: number, y: number, z: number): void {
    b.fromX = b.x
    b.fromY = b.y
    b.fromZ = b.z
    b.hx = x
    b.hy = y
    b.hz = z
    b.moveT = 0
    b.moveDur = Math.max(0.5, Math.hypot(x - b.x, z - b.z) / COMMUTE_SPEED)
  }

  update(dt: number): void {
    if (dt <= 0) return
    this.time += dt
    const t = this.time
    const r = this.rand
    for (const b of this.list) {
      b.px = b.x
      b.py = b.y
      b.pz = b.z
      if (b.kind === 'hive') {
        // Looping, wobbling orbits around the hives (sum of incommensurate sines).
        const a = t * b.w1 + b.p1
        b.x = this.hx + Math.cos(a) * b.ra + Math.sin(t * b.w3 * 2.3 + b.p2) * 0.18
        b.z = this.hz + Math.sin(a) * b.rb + Math.cos(t * b.w2 * 1.7 + b.p3) * 0.18
        b.y = this.hy + b.h0 + Math.sin(t * b.w2 + b.p2) * 0.28 + Math.sin(t * 7.7 + b.p3) * 0.03
      } else if (b.kind === 'flower') {
        this.hoverAndDart(b, b.zone!, t, dt)
      } else {
        this.commute(b, t, dt, r)
      }
      const vx = b.x - b.px
      const vy = b.y - b.py
      const vz = b.z - b.pz
      const h = Math.hypot(vx, vz)
      if (h > 1e-4) b.yaw = lerpAngle(b.yaw, Math.atan2(vx, vz), damp(14, dt))
      b.pitch += (clamp(Math.atan2(vy, Math.max(h, 1e-3)) * 0.5, -0.5, 0.5) - b.pitch) * damp(8, dt)
      b.flapPhase = (b.flapPhase + TAU * BEE_HZ * dt) % TAU
    }
  }

  private hoverAndDart(b: Bee, zone: FlowerZone, t: number, dt: number): void {
    if (b.moveT < 1) {
      b.moveT = Math.min(1, b.moveT + dt / b.moveDur)
      const e = b.moveT * b.moveT * (3 - 2 * b.moveT)
      b.x = lerp(b.fromX, b.hx, e)
      b.y = lerp(b.fromY, b.hy, e) + Math.sin(b.moveT * Math.PI) * 0.15
      b.z = lerp(b.fromZ, b.hz, e)
      if (b.moveT >= 1) b.hoverUntil = t + randIn(this.rand, FLOWER_HOVER[0], FLOWER_HOVER[1])
      return
    }
    // Hover over the flower with a small, quick jitter.
    b.x = b.hx + Math.sin(t * 5.3 + b.p1) * 0.035
    b.y = b.hy + Math.sin(t * 4.1 + b.p2) * 0.03
    b.z = b.hz + Math.cos(t * 6.1 + b.p3) * 0.035
    if (t >= b.hoverUntil) this.newFlower(b, zone)
  }

  private commute(b: Bee, t: number, dt: number, r: Rand): void {
    switch (b.state) {
      case 'home': {
        // Orbit close to the hive until it is time to go out.
        const a = t * b.w1 + b.p1
        b.x = this.hx + Math.cos(a) * 0.35
        b.z = this.hz + Math.sin(a) * 0.35
        b.y = this.hy + 0.55 + Math.sin(t * b.w2) * 0.1
        if (t >= b.stateUntil) {
          b.zone = this.zones[Math.floor(r() * this.zones.length) % this.zones.length]
          pointIn(b.zone, r, 0.7, tmpP)
          b.state = 'out'
          this.trip(b, tmpP.x, b.zone.ground.sample(tmpP.x, tmpP.z) + 0.5, tmpP.z)
        }
        break
      }
      case 'out':
      case 'back': {
        b.moveT = Math.min(1, b.moveT + dt / b.moveDur)
        const e = b.moveT
        // Arc up over the garden with a slight weave.
        const arc = Math.sin(e * Math.PI) * 2.2
        const weave = Math.sin(e * 23 + b.p2) * 0.12
        const dx = b.hx - b.fromX
        const dz = b.hz - b.fromZ
        const l = Math.hypot(dx, dz) || 1
        b.x = lerp(b.fromX, b.hx, e) - (dz / l) * weave
        b.y = lerp(b.fromY, b.hy, e) + arc
        b.z = lerp(b.fromZ, b.hz, e) + (dx / l) * weave
        if (b.moveT >= 1) {
          if (b.state === 'out') {
            b.state = 'forage'
            b.stateUntil = t + randIn(r, COMMUTE_FORAGE[0], COMMUTE_FORAGE[1])
            b.moveT = 1
            b.hoverUntil = t + randIn(r, FLOWER_HOVER[0], FLOWER_HOVER[1])
          } else {
            b.state = 'home'
            b.stateUntil = t + randIn(r, COMMUTE_HOME[0], COMMUTE_HOME[1])
          }
        }
        break
      }
      case 'forage': {
        this.hoverAndDart(b, b.zone!, t, dt)
        if (t >= b.stateUntil && b.moveT >= 1) {
          b.state = 'back'
          this.trip(b, this.hx, this.hy + 0.6, this.hz)
        }
        break
      }
    }
  }

  write(buf: InstanceBuffers): void {
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i]
      writeTRS(buf.matrix, i, b.x, b.y, b.z, b.yaw, b.pitch, 0, BEE_SCALE)
      writeAnim(buf, i, b.flapPhase, 0.8, 0.35, 0)
      writeAnim2(buf, i, 0, 0, 0, 0)
    }
  }

  writeColors(buf: InstanceBuffers): void {
    for (let i = 0; i < this.list.length; i++) setColor(buf, i, 1, 1, 1)
  }
}
