import { Quaternion, Vector3, type Group, type WebGLRenderer } from 'three'

/**
 * WebXR runtime state, written once per frame by xrInput.ts and read by the
 * XR player/hand systems and the in-headset HUD. Two hands, each either a
 * tracked controller or a tracked hand; the game only sees this abstraction.
 */

export type Side = 'left' | 'right'
export type HandKind = 'controller' | 'hand' | null

export interface XRHandState {
  side: Side
  connected: boolean
  kind: HandKind
  /** Where things are grabbed (palm / pinch point), world space. */
  grabPoint: Vector3
  /** Hand orientation (grip space), world space. */
  quat: Quaternion
  /** Pointing ray, world space. */
  rayOrigin: Vector3
  rayDir: Vector3
  /** 0..1: squeeze button, or how closed the tracked hand is. */
  grip: number
  /** Grip held (with hysteresis) and its edges this frame. */
  gripping: boolean
  gripPressed: boolean
  gripReleased: boolean
  /** "Select": trigger, or pinch for tracked hands (UI clicks, distant fruit). */
  selecting: boolean
  selectPressed: boolean
  /** Thumbstick (controllers only). */
  stick: { x: number; y: number }
  /** Primary (A/X) and secondary (B/Y) face buttons: pressed this frame. */
  primaryPressed: boolean
  secondaryPressed: boolean
  /** Smoothed world velocity of the grab point (for throwing). */
  velocity: Vector3
  /** Haptics (controllers). */
  pulse: (intensity: number, ms: number) => void
}

function makeHand(side: Side): XRHandState {
  return {
    side,
    connected: false,
    kind: null,
    grabPoint: new Vector3(),
    quat: new Quaternion(),
    rayOrigin: new Vector3(),
    rayDir: new Vector3(0, 0, -1),
    grip: 0,
    gripping: false,
    gripPressed: false,
    gripReleased: false,
    selecting: false,
    selectPressed: false,
    stick: { x: 0, y: 0 },
    primaryPressed: false,
    secondaryPressed: false,
    velocity: new Vector3(),
    pulse: () => {},
  }
}

export const xr = {
  /** An immersive session is running. */
  presenting: false,
  /** navigator.xr reports immersive-vr support (set at startup). */
  supported: false,
  /** Standalone headset browser (Quest): use the light quality preset. */
  standalone: false,
  /** Raise the rig by this much when the session has no floor-level space ('local'). */
  floorOffset: 0,
  gl: null as WebGLRenderer | null,
  /** The player's play-space origin; the XR camera and controllers live under it. */
  rig: null as Group | null,
  hands: { left: makeHand('left'), right: makeHand('right') } as Record<Side, XRHandState>,
  /** performance.now() when the current session started (onboarding hint). */
  sessionStart: 0,
  /** 0..1 how much the stick is moving the player (comfort vignette). */
  gliding: 0,
  /** Head pose in world space (updated every frame while presenting). */
  head: new Vector3(),
  headQuat: new Quaternion(),
}

export const SIDES: Side[] = ['right', 'left']

/** Distance along each hand's ray to the panel button it points at (0 = none). Set by the HUD. */
export const uiRay: Record<Side, number> = { left: 0, right: 0 }

export function resetHands() {
  for (const s of SIDES) {
    const h = xr.hands[s]
    h.connected = false
    h.kind = null
    h.grip = 0
    h.gripping = h.gripPressed = h.gripReleased = false
    h.selecting = h.selectPressed = false
    h.stick.x = h.stick.y = 0
    h.primaryPressed = h.secondaryPressed = false
    h.velocity.set(0, 0, 0)
  }
}
