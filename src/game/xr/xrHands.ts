import { Quaternion, Vector3 } from 'three'
import { hand, REACH } from '../interaction/hand'
import { FRUIT_RADIUS, fruits, grabFruit, pickFruit, releaseFruit, type Fruit } from '../interaction/fruits'
import { FRUIT_INFO, FRUIT_KIND } from '../world/citrus'
import { SIDES, xr, type Side } from './xrState'

/**
 * Picking fruit with your own hands (VR). Each hand can hold one fruit.
 *  - Near grab: close the hand (grip / fist / pinch) within ~10 cm of a fruit.
 *  - Far grab: point at a fruit within reach and close the hand (or pull the
 *    trigger / pinch): the fruit flies into the palm.
 *  - Open the hand to let go; the hand's motion throws it.
 * Feeds the shared `hand` state, so the narrative (Seneca's remark) and the
 * highlight work exactly as on desktop.
 */

/** Grab radius around the grab point (beyond the fruit's own radius). */
export const NEAR_GRAB = 0.075
const FLY_TIME = 0.22
const MAX_THROW = 7

interface Holding {
  fruit: Fruit | null
  /** Fruit centre in the hand's frame. */
  offset: Vector3
  rot: Quaternion
  /** Fly-in from a distant tree: 0..1. */
  fly: number
  flyFrom: Vector3
  heldTime: number
}

export const holding: Record<Side, Holding> = {
  left: { fruit: null, offset: new Vector3(), rot: new Quaternion(), fly: 1, flyFrom: new Vector3(), heldTime: 0 },
  right: { fruit: null, offset: new Vector3(), rot: new Quaternion(), fly: 1, flyFrom: new Vector3(), heldTime: 0 },
}

/** Fruit each hand would take now (for highlights / prompts). */
export const reachable: Record<Side, Fruit | null> = { left: null, right: null }
/** True when the candidate is reached by the pointing ray (draw the ray). */
export const viaRay: Record<Side, boolean> = { left: false, right: false }

const inv = new Quaternion()
const tmp = new Vector3()
const v = new Vector3()

export function resetXRHands() {
  for (const s of SIDES) {
    holding[s].fruit = null
    holding[s].fly = 1
    holding[s].heldTime = 0
    reachable[s] = null
    viaRay[s] = false
  }
}

/** Release everything (e.g. leaving VR) — fruit drops where it is. */
export function dropAll() {
  for (const s of SIDES) {
    const hd = holding[s]
    if (hd.fruit) releaseFruit(hd.fruit, hd.fruit.pos, v.set(0, 0, 0))
    hd.fruit = null
  }
  hand.held = null
}

function nearest(point: Vector3, exclude: Fruit | null): Fruit | null {
  let best: Fruit | null = null
  let bestD = FRUIT_RADIUS + NEAR_GRAB
  for (const f of fruits) {
    if (f.state === 'held' || f === exclude) continue
    const d = f.pos.distanceTo(point)
    if (d < bestD) {
      bestD = d
      best = f
    }
  }
  return best
}

/** Seat the fruit in the palm: centre slightly toward the fingers. */
function seatOffset(side: Side, out: Vector3) {
  // Grab point is already in front of the palm; keep the fruit centred on it.
  return out.set(side === 'left' ? 0.004 : -0.004, 0, 0)
}

export function updateXRHands(dt: number, frozen: boolean): string | null {
  let prompt: string | null = null
  const name = FRUIT_INFO[FRUIT_KIND].nameAcc
  hand.target = null
  for (const side of SIDES) {
    const h = xr.hands[side]
    const hd = holding[side]
    reachable[side] = null
    viaRay[side] = false
    if (!h.connected) {
      if (hd.fruit) {
        releaseFruit(hd.fruit, hd.fruit.pos, v.set(0, 0, 0))
        hd.fruit = null
      }
      continue
    }

    if (hd.fruit) {
      const f = hd.fruit
      hd.heldTime += dt
      // Follow the hand (with the fly-in from a distant branch).
      tmp.copy(hd.offset).applyQuaternion(h.quat).add(h.grabPoint)
      if (hd.fly < 1) {
        hd.fly = Math.min(1, hd.fly + dt / FLY_TIME)
        const k = 1 - (1 - hd.fly) ** 3
        f.pos.lerpVectors(hd.flyFrom, tmp, k)
      } else f.pos.copy(tmp)
      f.rot.multiplyQuaternions(h.quat, hd.rot)
      f.version++
      if (h.gripReleased && !frozen) {
        v.copy(h.velocity)
        if (v.length() > MAX_THROW) v.setLength(MAX_THROW)
        releaseFruit(f, f.pos, v)
        hd.fruit = null
        hd.heldTime = 0
        h.pulse(0.15, 20)
      }
      continue
    }

    // Candidate: within the palm, else along the pointing ray.
    let cand = nearest(h.grabPoint, null)
    if (!cand && !frozen) {
      cand = pickFruit(h.rayOrigin, h.rayDir, REACH)
      viaRay[side] = !!cand
    }
    reachable[side] = cand
    if (cand && !hand.target) hand.target = cand
    if (!cand || frozen) continue
    if (h.gripPressed || (viaRay[side] && h.selectPressed)) {
      const fromTree = cand.state === 'tree'
      grabFruit(cand)
      hd.fruit = cand
      hd.heldTime = 0
      if (viaRay[side]) {
        hd.fly = 0
        hd.flyFrom.copy(cand.pos)
        seatOffset(side, hd.offset)
      } else {
        hd.fly = 1
        // Keep it where the fingers met it (clamped into the palm).
        inv.copy(h.quat).invert()
        hd.offset.copy(cand.pos).sub(h.grabPoint).applyQuaternion(inv)
        if (hd.offset.length() > FRUIT_RADIUS * 0.6) hd.offset.setLength(FRUIT_RADIUS * 0.6)
      }
      hd.rot.copy(h.quat).invert().multiply(cand.rot)
      hand.picked++
      h.pulse(fromTree ? 0.5 : 0.3, fromTree ? 45 : 25)
      xrEvents.onGrab?.(cand, fromTree)
    }
  }

  // The shared hand state: the narrative reacts to "holding a fruit".
  const held = holding.right.fruit ?? holding.left.fruit
  const heldTime = Math.max(holding.right.fruit ? holding.right.heldTime : 0, holding.left.fruit ? holding.left.heldTime : 0)
  hand.held = held
  hand.heldTime = heldTime
  hand.inspecting = false
  if (!held && hand.target) {
    const anyHand = xr.hands.right.connected ? xr.hands.right : xr.hands.left
    const ray = viaRay.right || viaRay.left
    if (anyHand.kind === 'hand') prompt = ray ? `Укажите и сведите пальцы — ${name}` : `Сожмите пальцы — сорвать ${name}`
    else prompt = ray ? `Нажмите хват — ${name} прилетит в руку` : `Хват — сорвать ${name}`
  }
  hand.prompt = prompt
  return prompt
}

export const xrEvents = {
  onGrab: null as null | ((f: Fruit, fromTree: boolean) => void),
}
