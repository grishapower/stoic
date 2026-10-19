import { Group, Quaternion, Vector3, type XRGripSpace, type XRHandSpace, type XRTargetRaySpace } from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { fruits, resetFruits, updateFruits } from '../game/interaction/fruits'
import { hand, resetHand } from '../game/interaction/hand'
import { holding, resetXRHands, updateXRHands } from '../game/xr/xrHands'
import { slots, updateXRInput } from '../game/xr/xrInput'
import { resetHands, xr, type Side } from '../game/xr/xrState'

const DT = 1 / 72

function setHand(side: Side, over: Partial<(typeof xr.hands)['right']>) {
  const h = xr.hands[side]
  h.connected = true
  h.kind = 'controller'
  h.gripPressed = h.gripReleased = h.selectPressed = false
  Object.assign(h, over)
}

/** Clear one-frame edges (as xrInput does every frame). */
function frame(frozen = false) {
  const p = updateXRHands(DT, frozen)
  for (const s of ['left', 'right'] as const) {
    const h = xr.hands[s]
    h.gripPressed = h.gripReleased = h.selectPressed = false
  }
  updateFruits(DT)
  return p
}

beforeEach(() => {
  resetFruits()
  resetHand()
  resetXRHands()
  resetHands()
  xr.hands.right.quat.identity()
  xr.hands.left.quat.identity()
})

describe('VR hands: picking fruit', () => {
  it('takes a fruit when the hand closes around it, and the fruit follows the hand', () => {
    const f = fruits[0]
    setHand('right', { grabPoint: f.pos.clone().add(new Vector3(0.02, 0, 0)), rayOrigin: new Vector3(0, -100, 0) })
    expect(frame()).toMatch(/сорвать/)
    expect(hand.target).toBe(f)
    setHand('right', { gripPressed: true, gripping: true })
    frame()
    expect(f.state).toBe('held')
    expect(hand.held).toBe(f)
    expect(hand.picked).toBe(1)
    // Move the hand: the fruit comes along.
    const to = xr.hands.right.grabPoint.clone().add(new Vector3(0.3, 0.2, -0.1))
    setHand('right', { grabPoint: to, gripping: true })
    frame()
    expect(f.pos.distanceTo(to)).toBeLessThan(0.03)
  })

  it('throws the fruit with the hand’s motion when the hand opens', () => {
    const f = fruits[3]
    setHand('right', { grabPoint: f.pos.clone(), gripPressed: true, gripping: true })
    frame()
    setHand('right', { gripping: false, gripReleased: true, velocity: new Vector3(0, 1, -3) })
    frame()
    expect(f.state).toBe('falling')
    expect(f.vel.z).toBeLessThan(-2.5)
    expect(hand.held).toBe(null)
    // It lands eventually.
    for (let i = 0; i < 72 * 6 && f.state === 'falling'; i++) updateFruits(DT)
    expect(f.state).toBe('ground')
  })

  it('pulls a distant fruit along the pointing ray into the palm', () => {
    const f = fruits[10]
    const palm = f.pos.clone().add(new Vector3(0, -0.3, 1.4))
    setHand('right', { grabPoint: palm, rayOrigin: palm.clone(), rayDir: f.pos.clone().sub(palm).normalize() })
    frame()
    expect(hand.target).toBe(f)
    setHand('right', { selectPressed: true })
    frame()
    expect(f.state).toBe('held')
    expect(f.pos.distanceTo(palm)).toBeGreaterThan(0.2) // still flying
    for (let i = 0; i < 30; i++) frame()
    expect(f.pos.distanceTo(palm)).toBeLessThan(0.01)
  })

  it('holds one fruit per hand; the narrative sees the right hand first', () => {
    const a = fruits[0]
    const b = fruits[25]
    setHand('left', { grabPoint: a.pos.clone(), gripPressed: true, gripping: true })
    setHand('right', { grabPoint: b.pos.clone(), gripPressed: true, gripping: true })
    frame()
    expect(holding.left.fruit).toBe(a)
    expect(holding.right.fruit).toBe(b)
    expect(hand.held).toBe(b)
    for (let i = 0; i < 72 * 2.5; i++) frame()
    expect(hand.heldTime).toBeGreaterThan(2)
  })

  it('ignores grabs while a menu freezes the game, and drops the fruit if the hand is lost', () => {
    const f = fruits[5]
    setHand('right', { grabPoint: f.pos.clone(), gripPressed: true, gripping: true })
    frame(true)
    expect(f.state).toBe('tree')
    setHand('right', { gripPressed: true, gripping: true })
    frame()
    expect(f.state).toBe('held')
    xr.hands.right.connected = false
    updateXRHands(DT, false)
    expect(f.state).toBe('falling')
  })
})

describe('VR input: tracked hands', () => {
  function fakeHand(side: Side, thumbTip: Vector3, indexTip: Vector3, curled: boolean) {
    const hand = new Group() as unknown as XRHandSpace
    const joints: Record<string, Group> = {}
    const put = (name: string, p: Vector3) => {
      const j = new Group()
      j.position.copy(p)
      joints[name] = j
      hand.add(j)
    }
    put('wrist', new Vector3(0, 0, 0))
    put('middle-finger-metacarpal', new Vector3(0, 0, -0.03))
    put('middle-finger-phalanx-proximal', new Vector3(0, 0, -0.08))
    put('thumb-tip', thumbTip)
    put('index-finger-tip', indexTip)
    const tip = curled ? new Vector3(0, -0.02, -0.05) : new Vector3(0, 0, -0.17)
    for (const n of ['middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip']) put(n, tip)
    ;(hand as unknown as { joints: Record<string, Group> }).joints = joints
    hand.updateMatrixWorld(true)
    const ray = new Group() as unknown as XRTargetRaySpace
    const grip = new Group() as unknown as XRGripSpace
    return { ray, grip, hand, source: { handedness: side, hand: {} } as unknown as XRInputSource }
  }

  it('reads a pinch as grip + select and puts the grab point between the fingertips', () => {
    slots.splice(0, slots.length, fakeHand('right', new Vector3(0.01, 0, -0.1), new Vector3(0.0, 0, -0.105), false))
    updateXRInput(DT)
    const h = xr.hands.right
    expect(h.connected).toBe(true)
    expect(h.kind).toBe('hand')
    expect(h.gripPressed).toBe(true)
    expect(h.selectPressed).toBe(true)
    expect(h.grabPoint.distanceTo(new Vector3(0.005, 0, -0.1025))).toBeLessThan(1e-6)
    slots.length = 0
  })

  it('reads an open hand as not gripping and a fist as gripping', () => {
    slots.splice(0, slots.length, fakeHand('left', new Vector3(0.06, 0, -0.05), new Vector3(0, 0, -0.17), false))
    updateXRInput(DT)
    expect(xr.hands.left.gripping).toBe(false)
    slots.splice(0, slots.length, fakeHand('left', new Vector3(0.06, 0, -0.05), new Vector3(0, -0.02, -0.05), true))
    updateXRInput(DT)
    expect(xr.hands.left.gripping).toBe(true)
    expect(new Quaternion().angleTo(xr.hands.left.quat)).toBeLessThan(1e-6)
    slots.length = 0
  })
})
