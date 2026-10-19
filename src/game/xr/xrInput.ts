import { Quaternion, Vector3, type Group, type XRGripSpace, type XRHandSpace, type XRTargetRaySpace } from 'three'
import { SIDES, xr, type Side, type XRHandState } from './xrState'

/**
 * Reads the WebXR input sources (via three's controller/grip/hand groups,
 * which live under the rig) into the device-agnostic hand states.
 *
 * Controllers (xr-standard mapping): trigger = select, squeeze = grip,
 * thumbstick axes 2/3, A/X = button 4, B/Y = button 5.
 * Tracked hands: grip = max(fist, pinch); select = pinch.
 */

export interface XRSlot {
  ray: XRTargetRaySpace
  grip: XRGripSpace
  hand: XRHandSpace
  source: XRInputSource | null
}

/** Filled by XRSupport (one slot per three.js controller index). */
export const slots: XRSlot[] = []

const GRIP_ON = 0.6
const GRIP_OFF = 0.35
/** Grab point in front of the fist, in grip space (controller). */
const CONTROLLER_GRAB = new Vector3(0, -0.005, -0.035)

const tmp = new Vector3()
const tmpB = new Vector3()
const tmpQ = new Quaternion()
const prevGrab: Record<Side, Vector3> = { left: new Vector3(), right: new Vector3() }
const prevValid: Record<Side, boolean> = { left: false, right: false }
const prevButtons: Record<Side, { a: boolean; b: boolean }> = { left: { a: false, b: false }, right: { a: false, b: false } }

const TIPS = ['index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'] as const

function joint(hand: XRHandSpace, name: string): Group | undefined {
  return (hand.joints as Record<string, Group | undefined>)[name]
}

function edgeGrip(h: XRHandState, value: number) {
  const was = h.gripping
  h.grip = value
  h.gripping = was ? value > GRIP_OFF : value > GRIP_ON
  h.gripPressed = !was && h.gripping
  h.gripReleased = was && !h.gripping
}

function edgeSelect(h: XRHandState, value: number) {
  const was = h.selecting
  h.selecting = was ? value > GRIP_OFF : value > GRIP_ON
  h.selectPressed = !was && h.selecting
}

function readHand(h: XRHandState, slot: XRSlot): boolean {
  const hand = slot.hand
  const wrist = joint(hand, 'wrist')
  const palm = joint(hand, 'middle-finger-metacarpal')
  const thumb = joint(hand, 'thumb-tip')
  const index = joint(hand, 'index-finger-tip')
  const proximal = joint(hand, 'middle-finger-phalanx-proximal')
  if (!wrist || !palm || !thumb || !index || !proximal || !wrist.visible) return false
  palm.getWorldPosition(tmpB)
  let curl = 0
  let n = 0
  for (const t of TIPS) {
    const j = joint(hand, t)
    if (!j) continue
    curl += j.getWorldPosition(tmp).distanceTo(tmpB)
    n++
  }
  curl = n ? curl / n : 0.1
  const fist = Math.min(1, Math.max(0, (0.095 - curl) / 0.045))
  thumb.getWorldPosition(tmp)
  index.getWorldPosition(tmpB)
  const pinchD = tmp.distanceTo(tmpB)
  const pinch = Math.min(1, Math.max(0, (0.05 - pinchD) / 0.03))
  edgeGrip(h, Math.max(fist, pinch))
  edgeSelect(h, pinch)
  // Fruit sits between thumb and index when pinching, in the curled fingers otherwise.
  if (pinch >= fist) h.grabPoint.copy(tmp).add(tmpB).multiplyScalar(0.5)
  else proximal.getWorldPosition(h.grabPoint).lerp(palm.getWorldPosition(tmp), 0.35)
  wrist.getWorldQuaternion(h.quat)
  h.stick.x = h.stick.y = 0
  h.primaryPressed = h.secondaryPressed = false
  return true
}

function readController(h: XRHandState, slot: XRSlot, gp: Gamepad | undefined): boolean {
  if (!slot.grip.visible) return false
  slot.grip.getWorldQuaternion(h.quat)
  slot.grip.getWorldPosition(h.grabPoint)
  h.grabPoint.add(tmp.copy(CONTROLLER_GRAB).applyQuaternion(h.quat))
  const b = gp?.buttons ?? []
  edgeGrip(h, b[1]?.value ?? 0)
  edgeSelect(h, b[0]?.value ?? 0)
  const ax = gp?.axes ?? []
  const sx = ax.length >= 4 ? ax[2] : (ax[0] ?? 0)
  const sy = ax.length >= 4 ? ax[3] : (ax[1] ?? 0)
  h.stick.x = Math.abs(sx) > 0.12 ? sx : 0
  // Stick forward is negative y in the Gamepad API; store "forward = +1".
  h.stick.y = Math.abs(sy) > 0.12 ? -sy : 0
  const a = !!b[4]?.pressed
  const bb = !!b[5]?.pressed
  const prev = prevButtons[h.side]
  h.primaryPressed = a && !prev.a
  h.secondaryPressed = bb && !prev.b
  prev.a = a
  prev.b = bb
  return true
}

const noPulse = () => {}
const pulses = new WeakMap<Gamepad, (intensity: number, ms: number) => void>()

/** One haptics closure per gamepad (no per-frame allocation). */
function pulseFor(gp: Gamepad | undefined) {
  if (!gp) return noPulse
  let f = pulses.get(gp)
  if (!f) {
    f = makePulse(gp)
    pulses.set(gp, f)
  }
  return f
}

function makePulse(gp: Gamepad | undefined) {
  return (intensity: number, ms: number) => {
    if (!gp) return
    const act = (gp as Gamepad & { hapticActuators?: { pulse?: (v: number, d: number) => Promise<boolean> }[] }).hapticActuators?.[0]
    if (act?.pulse) void act.pulse(intensity, ms).catch(() => {})
    else void gp.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: intensity, weakMagnitude: intensity })?.catch(() => {})
  }
}

const seen: Record<Side, boolean> = { left: false, right: false }

export function updateXRInput(dt: number) {
  seen.left = seen.right = false
  for (const slot of slots) {
    const src = slot.source
    if (!src || (src.handedness !== 'left' && src.handedness !== 'right')) continue
    const side = src.handedness
    const h = xr.hands[side]
    const ok = src.hand ? readHand(h, slot) : readController(h, slot, src.gamepad ?? undefined)
    if (!ok) continue
    seen[side] = true
    h.kind = src.hand ? 'hand' : 'controller'
    h.pulse = pulseFor(src.gamepad ?? undefined)
    slot.ray.getWorldPosition(h.rayOrigin)
    slot.ray.getWorldQuaternion(tmpQ)
    h.rayDir.set(0, 0, -1).applyQuaternion(tmpQ)
  }
  for (const side of SIDES) {
    const h = xr.hands[side]
    h.connected = seen[side]
    if (!h.connected) {
      edgeGrip(h, 0)
      edgeSelect(h, 0)
      h.stick.x = h.stick.y = 0
      h.primaryPressed = h.secondaryPressed = false
      prevValid[side] = false
      continue
    }
    // Smoothed velocity of the grab point (for throwing).
    if (prevValid[side] && dt > 0) {
      tmp.copy(h.grabPoint).sub(prevGrab[side]).divideScalar(dt)
      if (tmp.lengthSq() > 64) tmp.setLength(8)
      h.velocity.lerp(tmp, 0.45)
    } else h.velocity.set(0, 0, 0)
    prevGrab[side].copy(h.grabPoint)
    prevValid[side] = true
  }
}
