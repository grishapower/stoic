import { DOVE_FLEE_RADIUS } from './config'
import {
  bezier,
  bezierTangent,
  clamp,
  damp,
  dist3,
  lerpAngle,
  randIn,
  rng,
  setColor,
  TAU,
  wrapAngle,
  writeAnim,
  writeAnim2,
  writeHidden,
  writeTRS,
  type InstanceBuffers,
  type Rand,
  type Vec3Like,
} from './math'
import type { Perch, PerchGroup } from './perches'

/**
 * Doves on the roofs, the bird-bath rim and the dovecote. Perched doves turn
 * their heads, peck, shuffle and hop; one coos now and then. When the player
 * comes within DOVE_FLEE_RADIUS they burst off (neighbours follow a moment
 * later), fly an arc and land on another free perch. After the letter
 * (progress ≥ 1) the bath empties and more doves arrive to roost on the
 * dovecote and the roofs.
 */

/* ------------------------------------------------------------- tuning */

const FLY_SPEED = 6.5
const FLIGHT_TIME: [number, number] = [1.3, 9]
/** New perches must be at least this far from the threat (m). */
const SAFE_DISTANCE = 6.5
/** Perch preference falls off with distance from the dove (m). */
const PERCH_PREF = 14
/** Perched neighbours within this radius take off too (m), after a short delay (s). */
const STARTLE_RADIUS = 1.8
const STARTLE_DELAY: [number, number] = [0.06, 0.4]
/** A random relaxed dove changes perch every so often (s), if the player is not near. */
const RELOCATE_EVERY: [number, number] = [18, 50]
/** Evening: a dove leaves the bath for the roost every so often (s); arrivals are staggered (s). */
const ROOST_EVERY: [number, number] = [4, 10]
const ARRIVAL_DELAY: [number, number] = [2, 45]
/** Coos: global gap (s) and the audible range (m) worth reporting. */
const COO_EVERY: [number, number] = [10, 26]
const COO_RANGE = 32
const COO_BOW = 1.6
const FLAP_HZ = 8.5
/** Initial roof doves sit within 13 m of here (the peristyle, where the walk begins). */
const GARDEN_CENTRE = { x: 0, z: 30 }
const SCALE = 1

type State = 'away' | 'perched' | 'flying'

interface Dove {
  id: number
  state: State
  /** Current perch, or the reserved target while flying (−1 = none). */
  perch: number
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  roll: number
  /* perched idle */
  bodyYaw: number
  bodyYawTarget: number
  nextTurn: number
  headYaw: number
  headYawTarget: number
  nextLook: number
  headPitch: number
  pecks: number
  peckT: number
  nextPeck: number
  hopT: number
  hopFrom: number
  hopTo: number
  hopOff: number
  nextHop: number
  bowT: number
  fold: number
  /** Time at which a startled dove takes off (−1 = not startled). */
  startleAt: number
  /* flight */
  cp: Float64Array
  t: number
  dur: number
  flapPhase: number
  flapAmp: number
  wingBias: number
  /** Arrives for the night (starts away). */
  evening: boolean
  arriveAt: number
  tint: [number, number, number]
}

export interface DoveEvents {
  coo?(p: Vec3Like): void
  flutter?(p: Vec3Like, n: number): void
}

const TINTS: [number, number, number][] = [
  [0.96, 0.95, 0.93], // white
  [0.93, 0.92, 0.9],
  [0.78, 0.8, 0.85], // pale grey
  [0.62, 0.65, 0.72], // blue-grey rock dove
]

const tmpA: Vec3Like = { x: 0, y: 0, z: 0 }
const tmpB: Vec3Like = { x: 0, y: 0, z: 0 }

export class Doves {
  readonly list: Dove[] = []
  readonly perches: readonly Perch[]
  /** Occupant (dove id) of each perch, or −1. A flying dove reserves its target. */
  readonly occupant: Int16Array
  private readonly rand: Rand
  private time = 0
  private nextRelocate: number
  private nextRoost = 0
  private nextCoo: number
  private night = false
  private readonly roostRef: Vec3Like

  constructor(perches: readonly Perch[], dayCount: number, eveningCount: number, seed: number) {
    this.perches = perches
    this.occupant = new Int16Array(perches.length).fill(-1)
    this.rand = rng(seed)
    const r = this.rand
    const cote = perches.find((p) => p.group === 'dovecote') ?? perches[0]
    this.roostRef = { x: cote?.x ?? 0, y: cote?.y ?? 0, z: cote?.z ?? 0 }
    const total = dayCount + eveningCount
    for (let i = 0; i < total; i++) {
      const evening = i >= dayCount
      this.list.push({
        id: i,
        state: evening ? 'away' : 'perched',
        perch: -1,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        pitch: 0,
        roll: 0,
        bodyYaw: 0,
        bodyYawTarget: 0,
        nextTurn: randIn(r, 2, 12),
        headYaw: 0,
        headYawTarget: 0,
        nextLook: r() * 2,
        headPitch: 0,
        pecks: 0,
        peckT: 0,
        nextPeck: randIn(r, 1, 8),
        hopT: -1,
        hopFrom: 0,
        hopTo: 0,
        hopOff: 0,
        nextHop: randIn(r, 5, 25),
        bowT: -1,
        fold: 1,
        startleAt: -1,
        cp: new Float64Array(12),
        t: 0,
        dur: 1,
        flapPhase: r() * TAU,
        flapAmp: 0,
        wingBias: 0,
        evening,
        arriveAt: -1,
        tint: TINTS[Math.floor(r() * TINTS.length) % TINTS.length],
      })
    }
    // Initial seating: a few at the bath, a few on the dovecote, the rest on the peristyle roofs.
    const day = this.list.filter((d) => !d.evening)
    const wantBath = Math.min(3, Math.round(day.length * 0.25))
    const wantCote = Math.min(4, Math.round(day.length * 0.3))
    let k = 0
    for (const d of day) {
      const group: PerchGroup = k < wantBath ? 'bath' : k < wantBath + wantCote ? 'dovecote' : 'roof'
      k++
      // Roof doves start where the walk starts: around the peristyle.
      const p = this.randomFree(group, d.id, group === 'roof' ? (q) => Math.hypot(q.x - GARDEN_CENTRE.x, q.z - GARDEN_CENTRE.z) < 13 : undefined)
      if (p < 0) continue
      this.seat(d, p)
    }
    this.nextRelocate = randIn(r, RELOCATE_EVERY[0], RELOCATE_EVERY[1])
    this.nextCoo = randIn(r, 3, COO_EVERY[0])
  }

  get count(): number {
    return this.list.length
  }

  /** A random free perch of `group` (optionally only those passing `ok`); reserves it. */
  private randomFree(group: PerchGroup, id: number, ok?: (p: Perch) => boolean): number {
    const r = this.rand
    const fits = (i: number) => this.perches[i].group === group && this.occupant[i] < 0 && (!ok || ok(this.perches[i]))
    let n = 0
    for (let i = 0; i < this.perches.length; i++) if (fits(i)) n++
    // Nothing passes the filter: any free perch of the group.
    if (n === 0) return ok ? this.randomFree(group, id) : -1
    let pick = Math.floor(r() * n) % n
    for (let i = 0; i < this.perches.length; i++) {
      if (!fits(i)) continue
      if (pick-- === 0) {
        this.occupant[i] = id
        return i
      }
    }
    return -1
  }

  private seat(d: Dove, perch: number): void {
    const p = this.perches[perch]
    d.perch = perch
    d.state = 'perched'
    d.x = p.x
    d.y = p.y
    d.z = p.z
    d.yaw = p.yaw
    d.bodyYaw = 0
    d.bodyYawTarget = 0
    d.hopOff = 0
    d.pitch = 0
    d.roll = 0
  }

  /**
   * Choose a free perch for `d`: away from the threat, preferring nearby ones;
   * at night only the dovecote and roofs (dovecote preferred). Returns −1 if none.
   */
  pickPerch(d: Dove, threat: Vec3Like | null, night: boolean): number {
    const r = this.rand
    let total = 0
    let last = -1
    for (let pass = 0; pass < 2; pass++) {
      let acc = 0
      const target = pass === 1 ? r() * total : 0
      for (let i = 0; i < this.perches.length; i++) {
        const w = this.perchWeight(d, i, threat, night)
        if (w <= 0) continue
        if (pass === 0) total += w
        else {
          acc += w
          last = i
          if (acc >= target) return i
        }
      }
      if (total <= 0) return -1
    }
    return last
  }

  private perchWeight(d: Dove, i: number, threat: Vec3Like | null, night: boolean): number {
    if (this.occupant[i] >= 0 || i === d.perch) return 0
    const p = this.perches[i]
    if (threat && dist3(threat, p.x, p.y, p.z) < SAFE_DISTANCE) return 0
    if (night && p.group === 'bath') return 0
    const dd = Math.hypot(p.x - d.x, p.z - d.z)
    let w = 1 / (1 + (dd / PERCH_PREF) ** 2)
    if (night && p.group === 'dovecote') w *= 4
    if (p.group === 'bath') w *= 1.5
    return w
  }

  /** Take off toward `perch` (already chosen). `away` biases the climb out away from a threat. */
  private takeOff(d: Dove, perch: number, away: Vec3Like | null): void {
    if (d.perch >= 0 && this.occupant[d.perch] === d.id) this.occupant[d.perch] = -1
    this.occupant[perch] = d.id
    d.perch = perch
    const p = this.perches[perch]
    this.planFlight(d, d.x, d.y, d.z, p, away)
    d.state = 'flying'
    d.startleAt = -1
    d.bowT = -1
    d.hopT = -1
    d.pecks = 0
  }

  private planFlight(d: Dove, sx: number, sy: number, sz: number, p: Perch, away: Vec3Like | null): void {
    const cp = d.cp
    let dx = p.x - sx
    let dz = p.z - sz
    const h = Math.hypot(dx, dz)
    if (h > 1e-3) {
      dx /= h
      dz /= h
    } else {
      dx = Math.sin(d.yaw)
      dz = Math.cos(d.yaw)
    }
    let ax = dx
    let az = dz
    if (away) {
      const ux = sx - away.x
      const uz = sz - away.z
      const ul = Math.hypot(ux, uz)
      if (ul > 1e-3) {
        ax = ux / ul
        az = uz / ul
      }
    }
    const lift = clamp(h * 0.3, 1.3, 6) + Math.max(0, p.y - sy) * 0.5
    const lead = Math.min(2.2, Math.max(0.8, h * 0.3))
    cp[0] = sx
    cp[1] = sy
    cp[2] = sz
    cp[3] = sx + ax * lead
    cp[4] = sy + lift * 0.9
    cp[5] = sz + az * lead
    cp[6] = p.x - dx * lead
    cp[7] = p.y + lift * 0.6 + 0.4
    cp[8] = p.z - dz * lead
    cp[9] = p.x
    cp[10] = p.y
    cp[11] = p.z
    d.t = 0
    d.dur = clamp((h + lift * 1.6) / FLY_SPEED, FLIGHT_TIME[0], FLIGHT_TIME[1])
  }

  update(dt: number, threat: Vec3Like, progress: number, events: DoveEvents): void {
    this.time += dt
    const now = this.time
    const r = this.rand
    this.night = progress >= 1

    // Threat: take off, and startle close neighbours.
    for (const d of this.list) {
      if (d.state !== 'perched') continue
      const close = dist3(threat, d.x, d.y, d.z) < DOVE_FLEE_RADIUS
      // Already reacting to a neighbour's take-off: its flutter covers this one.
      const pending = d.startleAt >= 0
      const startled = pending && now >= d.startleAt
      if (!close && !startled) continue
      const target = this.pickPerch(d, threat, this.night)
      if (target < 0) {
        d.startleAt = -1 // nowhere to go: it stays put
        continue
      }
      let n = 1
      if (!pending) {
        for (const o of this.list) {
          if (o === d || o.state !== 'perched' || o.startleAt >= 0) continue
          if (Math.hypot(o.x - d.x, o.y - d.y, o.z - d.z) < STARTLE_RADIUS) {
            o.startleAt = now + randIn(r, STARTLE_DELAY[0], STARTLE_DELAY[1])
            n++
          }
        }
        tmpA.x = d.x
        tmpA.y = d.y
        tmpA.z = d.z
        events.flutter?.(tmpA, n)
      }
      this.takeOff(d, target, threat)
    }

    // Relaxed relocations (only far from the player, so it never looks like fleeing for no reason).
    if (now >= this.nextRelocate) {
      this.nextRelocate = now + randIn(r, RELOCATE_EVERY[0], RELOCATE_EVERY[1])
      const d = this.randomPerched((x) => dist3(threat, x.x, x.y, x.z) > 10)
      if (d) {
        const target = this.pickPerch(d, threat, this.night)
        if (target >= 0) {
          tmpA.x = d.x
          tmpA.y = d.y
          tmpA.z = d.z
          events.flutter?.(tmpA, 1)
          this.takeOff(d, target, null)
        }
      }
    }

    // Evening: bath doves leave for the roost; extra doves fly in.
    if (this.night) {
      if (now >= this.nextRoost) {
        this.nextRoost = now + randIn(r, ROOST_EVERY[0], ROOST_EVERY[1])
        const d = this.randomPerched((x) => this.perches[x.perch].group === 'bath')
        if (d) {
          const target = this.pickPerch(d, threat, true)
          if (target >= 0) this.takeOff(d, target, null)
        }
      }
      for (const d of this.list) {
        if (d.state !== 'away') continue
        if (d.arriveAt < 0) d.arriveAt = now + randIn(r, ARRIVAL_DELAY[0], ARRIVAL_DELAY[1])
        if (now < d.arriveAt) continue
        // Choose as if seen from the dovecote: roosting doves prefer it.
        d.x = this.roostRef.x
        d.y = this.roostRef.y
        d.z = this.roostRef.z
        const target = this.pickPerch(d, threat, true)
        if (target < 0) {
          d.arriveAt = now + 10
          continue
        }
        this.occupant[target] = d.id
        d.perch = target
        const p = this.perches[target]
        // Fly in from afar, high over the land side.
        const a = r() * TAU
        const sx = p.x + Math.cos(a) * 45
        const sz = p.z + Math.abs(Math.sin(a)) * 40
        this.planFlight(d, sx, p.y + 16, sz, p, null)
        d.dur = clamp(d.dur * 1.2, 5, 12)
        d.yaw = Math.atan2(p.x - sx, p.z - sz)
        d.state = 'flying'
      }
    }

    // Coo: one dove near the player, now and then.
    if (now >= this.nextCoo) {
      this.nextCoo = now + randIn(r, COO_EVERY[0], COO_EVERY[1]) * (this.night ? 0.8 : 1)
      const d = this.randomPerched((x) => dist3(threat, x.x, x.y, x.z) < COO_RANGE)
      if (d) {
        d.bowT = 0
        tmpA.x = d.x
        tmpA.y = d.y + 0.15
        tmpA.z = d.z
        events.coo?.(tmpA)
      }
    }

    for (const d of this.list) {
      if (d.state === 'perched') this.idle(d, dt, now)
      else if (d.state === 'flying') this.fly(d, dt)
    }
  }

  private randomPerched(ok: (d: Dove) => boolean): Dove | null {
    const r = this.rand
    let n = 0
    for (const d of this.list) if (d.state === 'perched' && d.startleAt < 0 && ok(d)) n++
    if (n === 0) return null
    let pick = Math.floor(r() * n) % n
    for (const d of this.list) {
      if (d.state !== 'perched' || d.startleAt >= 0 || !ok(d)) continue
      if (pick-- === 0) return d
    }
    return null
  }

  private idle(d: Dove, dt: number, now: number): void {
    const r = this.rand
    const p = this.perches[d.perch]
    // Look around: quick head turns between still moments.
    if (now >= d.nextLook) {
      d.nextLook = now + randIn(r, 0.5, 2.6)
      d.headYawTarget = (r() - 0.5) * 1.9
    }
    d.headYaw += (d.headYawTarget - d.headYaw) * damp(16, dt)
    // Turn the body now and then (ridge doves sometimes turn right round).
    if (now >= d.nextTurn) {
      d.nextTurn = now + randIn(r, 5, 16)
      d.bodyYawTarget = r() < 0.15 && p.group === 'roof' ? (d.bodyYawTarget === 0 ? Math.PI : 0) : (r() - 0.5) * 1.6
    }
    d.bodyYaw = lerpAngle(d.bodyYaw, d.bodyYawTarget, damp(5, dt))
    // Pecking (drinking at the bath, preening on roofs).
    if (d.pecks === 0 && now >= d.nextPeck) {
      d.pecks = 1 + Math.floor(r() * 3)
      d.peckT = 0
      d.nextPeck = now + randIn(r, p.group === 'bath' ? 2 : 4, p.group === 'bath' ? 7 : 14)
    }
    let pitch = 0
    if (d.pecks > 0) {
      d.peckT += dt
      const k = d.peckT / 0.3
      pitch = Math.sin(Math.min(1, k) * Math.PI) * (p.group === 'bath' ? 1.05 : 0.75)
      if (k >= 1) {
        d.pecks--
        d.peckT = 0
      }
    }
    // Cooing bow: the head bobs with the notes.
    if (d.bowT >= 0) {
      d.bowT += dt
      pitch += Math.max(0, Math.sin(d.bowT * TAU * 1.4)) * 0.45
      if (d.bowT > COO_BOW) d.bowT = -1
    }
    d.headPitch += (pitch - d.headPitch) * damp(20, dt)
    // Short hops along the perch.
    let hopY = 0
    if (d.hopT < 0 && now >= d.nextHop && p.hop > 0) {
      d.nextHop = now + randIn(r, 6, 22)
      d.hopT = 0
      d.hopFrom = d.hopOff
      d.hopTo = clamp(d.hopOff + (r() - 0.5) * 2 * p.hop, -p.hop, p.hop)
    }
    if (d.hopT >= 0) {
      d.hopT += dt / 0.3
      const k = Math.min(1, d.hopT)
      d.hopOff = d.hopFrom + (d.hopTo - d.hopFrom) * k
      hopY = 4 * 0.07 * k * (1 - k)
      if (d.hopT >= 1) d.hopT = -1
    }
    d.x = p.x + p.tx * d.hopOff
    d.z = p.z + p.tz * d.hopOff
    d.y = p.y + hopY
    d.yaw = wrapAngle(p.yaw + d.bodyYaw)
    d.pitch += (0 - d.pitch) * damp(10, dt)
    d.roll += (0 - d.roll) * damp(10, dt)
    // Fold the wings away after landing; a little flick during a hop.
    d.fold += (1 - d.fold) * damp(6, dt)
    d.flapAmp += ((d.hopT >= 0 ? 0.35 : 0) - d.flapAmp) * damp(12, dt)
    d.flapPhase = (d.flapPhase + TAU * FLAP_HZ * dt) % TAU
    d.wingBias = -0.3
  }

  private fly(d: Dove, dt: number): void {
    d.t += dt / d.dur
    const u = Math.min(1, d.t)
    const e = u * u * (3 - 2 * u)
    bezier(d.cp, e, tmpA)
    bezierTangent(d.cp, e, tmpB)
    d.x = tmpA.x
    d.y = tmpA.y
    d.z = tmpA.z
    const h = Math.hypot(tmpB.x, tmpB.z)
    if (h > 1e-3) {
      const want = Math.atan2(tmpB.x, tmpB.z)
      const rate = wrapAngle(want - d.yaw)
      d.yaw = wrapAngle(d.yaw + rate * damp(10, dt))
      d.roll += (clamp(-rate * 2, -0.7, 0.7) - d.roll) * damp(6, dt)
    }
    // Nose up on the climb, level on the glide, flared for landing.
    const climb = Math.atan2(tmpB.y, Math.max(h, 1e-3))
    const flare = u > 0.85 ? (u - 0.85) / 0.15 : 0
    d.pitch += (clamp(climb * 0.6, -0.5, 0.6) + flare * 0.5 - d.pitch) * damp(8, dt)
    if (u > 0.8) {
      // Line up with the perch for touchdown.
      const p = this.perches[d.perch]
      d.yaw = lerpAngle(d.yaw, p.yaw, damp(6, dt))
    }
    // Wings: hard flapping at take-off and landing, gliding on long middles.
    const glide = d.dur > 2.4 && u > 0.35 && u < 0.78
    d.fold += (0 - d.fold) * damp(18, dt)
    d.flapAmp += ((glide ? 0.1 : 1.0) - d.flapAmp) * damp(glide ? 3 : 10, dt)
    d.wingBias += ((glide ? 0.18 : 0.3 + flare * 0.25) - d.wingBias) * damp(6, dt)
    d.flapPhase = (d.flapPhase + TAU * (glide ? 2 : u < 0.2 ? FLAP_HZ * 1.15 : FLAP_HZ) * dt) % TAU
    if (d.t >= 1) {
      const p = this.perches[d.perch]
      d.state = 'perched'
      d.x = p.x
      d.y = p.y
      d.z = p.z
      d.bodyYaw = wrapAngle(d.yaw - p.yaw)
      d.bodyYawTarget = 0
      d.hopOff = 0
      d.nextHop = this.time + randIn(this.rand, 4, 15)
    }
  }

  /** Dove index on a perch (for tests/debug). */
  isFlying(i: number): boolean {
    return this.list[i].state === 'flying'
  }

  write(b: InstanceBuffers): void {
    for (let i = 0; i < this.list.length; i++) {
      const d = this.list[i]
      if (d.state === 'away') {
        writeHidden(b.matrix, i)
        continue
      }
      writeTRS(b.matrix, i, d.x, d.y, d.z, d.yaw, d.pitch, d.roll, SCALE)
      writeAnim(b, i, d.flapPhase, d.flapAmp, d.wingBias, d.fold)
      writeAnim2(b, i, d.headYaw * (1 - Math.min(1, d.flapAmp)), d.headPitch, 0, 0)
    }
  }

  writeColors(b: InstanceBuffers): void {
    for (let i = 0; i < this.list.length; i++) {
      const t = this.list[i].tint
      setColor(b, i, t[0], t[1], t[2])
    }
  }
}
