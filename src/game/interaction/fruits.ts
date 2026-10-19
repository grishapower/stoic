import { Quaternion, Vector3 } from 'three'
import { FRUIT_HOMES, FRUIT_INFO, FRUIT_KIND } from '../world/citrus'
import { groundHeight } from '../world/ground'

/**
 * Fruit state & tiny physics. Pure logic (no rendering), so the same module
 * serves the desktop hand (camera ray) and a future VR hand (controller pose).
 */

export type FruitState = 'tree' | 'held' | 'falling' | 'ground'

export interface Fruit {
  id: number
  treeId: number
  home: Vector3
  pos: Vector3
  vel: Vector3
  rot: Quaternion
  spin: Vector3
  state: FruitState
  /** Bumped whenever the transform changes (renderer uploads only dirty ones). */
  version: number
}

export const FRUIT_RADIUS = FRUIT_INFO[FRUIT_KIND].radius

/** Rendering hint: in VR a held fruit is drawn in the world (in the hand); on desktop the camera-attached hand draws it. */
export const fruitView = { showHeld: false }

/** Switch where held fruit is drawn (marks held fruit dirty). */
export function setShowHeld(v: boolean) {
  fruitView.showHeld = v
  for (const f of fruits) if (f.state === 'held') f.version++
}

/** Optional hook for impact sounds: (fruit, impact speed m/s). */
export const fruitEvents = {
  onImpact: null as null | ((f: Fruit, speed: number) => void),
}

const GRAVITY = -9.81
const RESTITUTION = 0.32
const ROLL_DAMP = 2.2
const SLEEP_SPEED = 0.06

export const fruits: Fruit[] = FRUIT_HOMES.map((h, id) => {
  const home = new Vector3(h.x, h.y, h.z)
  const rot = new Quaternion().setFromAxisAngle(new Vector3(Math.sin(id), 0.3, Math.cos(id)).normalize(), id * 1.7)
  return { id, treeId: h.treeId, home, pos: home.clone(), vel: new Vector3(), rot, spin: new Vector3(), state: 'tree' as FruitState, version: 0 }
})

/** Put every fruit back on its tree (new walk). */
export function resetFruits() {
  for (const f of fruits) {
    f.pos.copy(f.home)
    f.vel.set(0, 0, 0)
    f.spin.set(0, 0, 0)
    f.state = 'tree'
    f.version++
  }
}

const tmpQ = new Quaternion()
const tmpAxis = new Vector3()

/** Integrate falling fruit; settles on the ground. */
export function updateFruits(dt: number) {
  if (dt <= 0) return
  for (const f of fruits) {
    if (f.state !== 'falling') continue
    f.vel.y += GRAVITY * dt
    f.pos.addScaledVector(f.vel, dt)
    // Spin in the direction of travel.
    const sp = f.spin.length()
    if (sp > 1e-4) {
      tmpAxis.copy(f.spin).divideScalar(sp)
      tmpQ.setFromAxisAngle(tmpAxis, sp * dt)
      f.rot.premultiply(tmpQ)
    }
    const floor = groundHeight(f.pos.x, f.pos.z) + FRUIT_RADIUS * 0.9
    if (f.pos.y <= floor) {
      f.pos.y = floor
      if (f.vel.y < -0.6) fruitEvents.onImpact?.(f, -f.vel.y)
      if (f.vel.y < 0) f.vel.y = -f.vel.y * RESTITUTION
      // Rolling friction on contact.
      const k = Math.exp(-ROLL_DAMP * dt * 6)
      f.vel.x *= k
      f.vel.z *= k
      // Spin matches rolling: ω = up × v / r.
      f.spin.set(f.vel.z / FRUIT_RADIUS, 0, -f.vel.x / FRUIT_RADIUS)
      if (Math.abs(f.vel.y) < 0.35 && Math.hypot(f.vel.x, f.vel.z) < SLEEP_SPEED) {
        f.vel.set(0, 0, 0)
        f.spin.set(0, 0, 0)
        f.state = 'ground'
      }
    }
    f.version++
  }
}

/** Ray–sphere pick: nearest grabbable fruit along a ray within maxDist. */
export function pickFruit(origin: Vector3, dir: Vector3, maxDist: number, slack = 0.05): Fruit | null {
  let best: Fruit | null = null
  let bestT = maxDist
  const r = FRUIT_RADIUS + slack
  for (const f of fruits) {
    if (f.state === 'held') continue
    const ox = f.pos.x - origin.x
    const oy = f.pos.y - origin.y
    const oz = f.pos.z - origin.z
    const t = ox * dir.x + oy * dir.y + oz * dir.z
    if (t < 0 || t > bestT) continue
    const d2 = ox * ox + oy * oy + oz * oz - t * t
    // Slightly larger tolerance further away so small fruit stays easy to aim at.
    const tol = r + t * 0.012
    if (d2 <= tol * tol) {
      best = f
      bestT = t
    }
  }
  return best
}

export function grabFruit(f: Fruit) {
  f.state = 'held'
  f.vel.set(0, 0, 0)
  f.spin.set(0, 0, 0)
  f.version++
}

/** Release from the hand at a world position with a velocity (drop / toss). */
export function releaseFruit(f: Fruit, at: Vector3, velocity: Vector3) {
  f.pos.copy(at)
  f.vel.copy(velocity)
  f.spin.set(velocity.z * 8, 0, -velocity.x * 8)
  f.state = 'falling'
  f.version++
}
