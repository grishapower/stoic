import { PORCH_RECT, VIEWPOINT_DEF } from '../world/architecture'
import { groundHeight } from '../world/ground'
import { terrainHeight } from '../world/terrain'
import { LIZARD_FLEE_RADIUS } from './config'
import { clamp, damp, dist3, randIn, rng, setColor, TAU, writeAnim, writeAnim2, writeHidden, writeTRS, type InstanceBuffers, type Rand, type Vec3Like } from './math'

/**
 * Wall lizards basking on sunny stone: the viewpoint parapet and the porch
 * kerb. Near the player they dart along the wall and slip over its edge; a
 * while after the player has gone they come back, stop-and-go.
 */

/* ------------------------------------------------------------- tuning */

const RUN_SPEED = 2.6
const WALK_SPEED = 0.55
const DROP_TIME = 0.35
const HIDE_TIME: [number, number] = [8, 20]
/** The lizard only comes back when the player is at least this far (m). */
const RETURN_CLEAR = 5
const SCALE = 1.15

export interface LizardSpot {
  /** Bask point on the top surface. */
  x: number
  y: number
  z: number
  /** Unit direction along the wall (the escape direction). */
  ax: number
  az: number
  /** Unit direction toward the side it slips down. */
  sx: number
  sz: number
  /** Distance run along the wall before slipping over the edge (m). */
  run: number
  /** Half width of the top surface (m) and depth it drops to hide (m). */
  halfWidth: number
  drop: number
}

/** The two sunny spots (derived from architecture.ts). */
export function lizardSpots(): LizardSpot[] {
  const v = VIEWPOINT_DEF
  const c = Math.cos(v.rotY)
  const s = Math.sin(v.rotY)
  // Local X along the parapet; sea side is local −Z. Cap top as built in Grounds.tsx.
  // Near the west end: ~2.8 m off the path, so it only bolts when you step up to the parapet.
  const lx = -2.8
  const vx = v.x + lx * c
  const vz = v.z - lx * s
  const capTop = terrainHeight(v.x, v.z) + v.height + 0.09
  const kerbTop = 0.12
  const kx = 7.6
  const kz = PORCH_RECT.minZ - 0.1
  return [
    { x: vx, y: capTop, z: vz, ax: -c, az: s, sx: -s, sz: -c, run: 0.55, halfWidth: (v.thick + 0.12) / 2, drop: 0.45 },
    { x: kx, y: kerbTop, z: kz, ax: 1, az: 0, sx: 0, sz: -1, run: 1.1, halfWidth: 0.15, drop: Math.max(0.12, kerbTop - groundHeight(kx, kz - 0.4) + 0.04) },
  ]
}

type State = 'bask' | 'flee' | 'drop' | 'hidden' | 'climb' | 'return'

interface Lizard {
  spot: LizardSpot
  state: State
  /** Position along the wall from the bask point (m). */
  s: number
  /** 0..1 over the edge (drop/climb). */
  edge: number
  stateT: number
  hiddenUntil: number
  /** Return walk: moving or pausing. */
  moving: boolean
  moveUntil: number
  headYaw: number
  headTarget: number
  nextLook: number
  pushups: number
  pushT: number
  nextPush: number
  spinePhase: number
  spineAmp: number
  /** Bask heading offset (it lies a little askew). */
  skew: number
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
}

export class Lizards {
  readonly list: Lizard[] = []
  private readonly rand: Rand
  private time = 0

  constructor(seed: number) {
    this.rand = rng(seed)
    const r = this.rand
    for (const spot of lizardSpots()) {
      this.list.push({
        spot,
        state: 'bask',
        s: 0,
        edge: 0,
        stateT: 0,
        hiddenUntil: 0,
        moving: false,
        moveUntil: 0,
        headYaw: 0,
        headTarget: 0,
        nextLook: randIn(r, 1, 4),
        pushups: 0,
        pushT: 0,
        nextPush: randIn(r, 6, 20),
        spinePhase: 0,
        spineAmp: 0,
        skew: (r() - 0.5) * 0.7,
        x: spot.x,
        y: spot.y,
        z: spot.z,
        yaw: 0,
        pitch: 0,
      })
    }
  }

  get count(): number {
    return this.list.length
  }

  update(dt: number, threat: Vec3Like): void {
    this.time += dt
    const now = this.time
    const r = this.rand
    for (const L of this.list) {
      const sp = L.spot
      const near = dist3(threat, L.x, L.y, L.z) < LIZARD_FLEE_RADIUS
      let speed = 0
      switch (L.state) {
        case 'bask':
        case 'return':
          if (near) {
            L.state = 'flee'
            L.pushups = 0
          }
          break
        case 'climb':
          if (near) L.state = 'drop'
          break
      }
      switch (L.state) {
        case 'bask': {
          if (now >= L.nextLook) {
            L.nextLook = now + randIn(r, 1.5, 5)
            L.headTarget = (r() - 0.5) * 1.1
          }
          if (L.pushups === 0 && now >= L.nextPush) {
            L.pushups = 2 + Math.floor(r() * 3)
            L.pushT = 0
            L.nextPush = now + randIn(r, 10, 30)
          }
          break
        }
        case 'flee': {
          speed = RUN_SPEED
          L.s += RUN_SPEED * dt
          L.headTarget = 0
          if (L.s >= sp.run) {
            L.s = sp.run
            L.state = 'drop'
          }
          break
        }
        case 'drop': {
          speed = RUN_SPEED * 0.6
          L.edge = Math.min(1, L.edge + dt / DROP_TIME)
          if (L.edge >= 1) {
            L.state = 'hidden'
            L.hiddenUntil = now + randIn(r, HIDE_TIME[0], HIDE_TIME[1])
          }
          break
        }
        case 'hidden': {
          if (now >= L.hiddenUntil && dist3(threat, sp.x, sp.y, sp.z) > RETURN_CLEAR) {
            L.state = 'climb'
            L.moving = true
          }
          break
        }
        case 'climb': {
          speed = WALK_SPEED
          L.edge = Math.max(0, L.edge - (dt / DROP_TIME) * 0.5)
          if (L.edge <= 0) {
            L.state = 'return'
            L.moveUntil = now + randIn(r, 0.2, 0.6)
          }
          break
        }
        case 'return': {
          // Stop-and-go back to the sunny spot.
          if (now >= L.moveUntil) {
            L.moving = !L.moving
            L.moveUntil = now + (L.moving ? randIn(r, 0.25, 0.7) : randIn(r, 0.3, 1.2))
            if (!L.moving) L.headTarget = (r() - 0.5) * 0.9
          }
          if (L.moving) {
            speed = WALK_SPEED
            L.s = Math.max(0, L.s - WALK_SPEED * dt)
          }
          if (L.s <= 0) {
            L.state = 'bask'
            L.nextPush = now + randIn(r, 4, 12)
          }
          break
        }
      }
      // Push-up display while basking.
      let lift = 0
      if (L.pushups > 0) {
        L.pushT += dt / 0.35
        lift = Math.sin(Math.min(1, L.pushT) * Math.PI) * 0.012
        if (L.pushT >= 1) {
          L.pushups--
          L.pushT = 0
        }
      }
      L.headYaw += (L.headTarget - L.headYaw) * damp(9, dt)
      // Body wave: fast while running, a lazy tail sway at rest.
      const wantAmp = speed > 1 ? 0.035 : speed > 0 ? 0.02 : 0.006
      L.spineAmp += (wantAmp - L.spineAmp) * damp(10, dt)
      L.spinePhase = (L.spinePhase + (speed > 0 ? 6 + speed * 10 : 1.2) * dt) % TAU

      // Pose: along the wall, then over the edge (pitching down the side face).
      const goingBack = L.state === 'return' || (L.state === 'climb' && L.edge < 0.5)
      const heading = Math.atan2(sp.ax, sp.az)
      const e = L.edge
      const reach = sp.halfWidth * clamp(e * 2, 0, 1)
      L.x = sp.x + sp.ax * L.s + sp.sx * (reach + 0.04 * e)
      L.z = sp.z + sp.az * L.s + sp.sz * (reach + 0.04 * e)
      L.y = sp.y + lift - sp.drop * clamp(e * 1.4 - 0.4, 0, 1)
      if (e > 0) {
        // Face the edge and tip over it head-first.
        L.yaw = Math.atan2(sp.sx, sp.sz)
        L.pitch = -1.35 * clamp(e * 1.6, 0, 1)
      } else {
        L.yaw = L.state === 'bask' ? heading + L.skew : goingBack ? heading + Math.PI : heading
        L.pitch = 0
      }
    }
  }

  write(b: InstanceBuffers): void {
    for (let i = 0; i < this.list.length; i++) {
      const L = this.list[i]
      if (L.state === 'hidden' || (L.edge >= 0.98 && L.state !== 'climb')) {
        writeHidden(b.matrix, i)
        continue
      }
      writeTRS(b.matrix, i, L.x, L.y, L.z, L.yaw, L.pitch, 0, SCALE)
      writeAnim(b, i, 0, 0, 0, 0)
      writeAnim2(b, i, L.headYaw, 0, L.spinePhase, L.spineAmp)
    }
  }

  writeColors(b: InstanceBuffers): void {
    for (let i = 0; i < this.list.length; i++) setColor(b, i, i === 0 ? 1 : 0.92, 1, i === 0 ? 0.95 : 1)
  }

  isHidden(i: number): boolean {
    return this.list[i].state === 'hidden'
  }
}
