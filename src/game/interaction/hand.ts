import { Vector3 } from 'three'
import { FRUIT_INFO, FRUIT_KIND } from '../world/citrus'
import { fruits, grabFruit, pickFruit, releaseFruit, type Fruit } from './fruits'

/**
 * The player's hand — device-agnostic.
 *
 * Desktop feeds it a ray from the camera centre and key presses; a VR version
 * would feed the controller/hand pose and grip button instead (see
 * docs/ARCHITECTURE.md → "Взаимодействие и VR"). Nothing here knows about
 * cameras, keyboards or rendering.
 */

export interface HandInput {
  /** Pointing ray (desktop: camera centre; VR: controller aim or palm). */
  origin: Vector3
  direction: Vector3
  /** Grab requested this frame (desktop: E; VR: grip pressed). */
  grab: boolean
  /** Release requested this frame (desktop: Q; VR: grip released). */
  release: boolean
  /** Toggle "look closely" (desktop: R; VR: natural — bring hand to the face). */
  inspect: boolean
  /** Velocity of the hand in world space (for tossing). */
  handVelocity: Vector3
  /** Where the hand is in world space (release point). */
  handPosition: Vector3
}

export const REACH = 2.3

export const hand = {
  held: null as Fruit | null,
  /** Fruit currently aimed at (for the prompt / highlight). */
  target: null as Fruit | null,
  inspecting: false,
  /** Seconds the current fruit has been held. */
  heldTime: 0,
  /** Total fruits picked in this walk. */
  picked: 0,
  /** Prompt for the UI (null = none); merged with other prompts by the director. */
  prompt: null as string | null,
  /** True if the last update used the grab input (so other systems should ignore it). */
  usedGrab: false,
}

export function resetHand() {
  hand.held = null
  hand.target = null
  hand.inspecting = false
  hand.heldTime = 0
  hand.picked = 0
  hand.prompt = null
  hand.usedGrab = false
}

const tossV = new Vector3()

/** Updates the hand; sets hand.prompt / hand.usedGrab. */
export function updateHand(dt: number, input: HandInput) {
  hand.usedGrab = false
  hand.prompt = handLogic(dt, input)
}

function handLogic(dt: number, input: HandInput): string | null {
  const name = FRUIT_INFO[FRUIT_KIND].nameAcc
  if (hand.held) {
    hand.heldTime += dt
    hand.target = null
    if (input.inspect) hand.inspecting = !hand.inspecting
    if (input.release) {
      // A gentle toss forward and slightly up, plus the hand's own motion.
      tossV.copy(input.direction).multiplyScalar(1.6).add(input.handVelocity)
      tossV.y += 0.9
      releaseFruit(hand.held, input.handPosition, tossV)
      hand.held = null
      hand.inspecting = false
      hand.heldTime = 0
      return null
    }
    return hand.inspecting ? 'R — опустить руку · Q — отпустить' : 'R — рассмотреть · Q — отпустить'
  }
  hand.target = pickFruit(input.origin, input.direction, REACH)
  if (hand.target && input.grab) {
    hand.usedGrab = true
    grabFruit(hand.target)
    hand.held = hand.target
    hand.target = null
    hand.heldTime = 0
    hand.picked++
    return 'R — рассмотреть · Q — отпустить'
  }
  if (hand.target) return hand.target.state === 'tree' ? `E — сорвать ${name}` : `E — поднять ${name}`
  return null
}

/** For tests/debug. */
export function fruitCount() {
  return fruits.length
}
