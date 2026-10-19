import { Vector3, type Camera } from 'three'
import { audio } from '../audio/engine'
import { runtime } from '../runtime'
import { game } from '../store'
import { resolveCollisions } from '../world/colliders'
import { groundHeight, surfaceAt } from '../world/ground'
import { EYE_HEIGHT } from '../world/layout'
import { damp } from '../world/noise'
import { nearestOnPath } from '../world/path'
import { EXEDRA_SEAT } from '../world/props'
import { xr } from './xrState'

/**
 * VR locomotion. The rig is the play-space origin (local-floor): physical
 * walking moves the head inside it, the left stick glides the rig along the
 * head's heading, the right stick snap-turns around the head. The head is the
 * body for collisions, the ground and the narrative ("where is the player").
 */

const WALK = 1.35
const RADIUS = 0.3
const SNAP = Math.PI / 6
const STEP_LEN = 0.74
/** Sitting on the exedra while standing in the room: the world rises by this much. */
const SEAT_DROP = EYE_HEIGHT - 1.12
/** Playing seated in a chair: lift the eye to standing height. */
const SEATED_PLAY_LIFT = 0.42

const state = { snapArmed: true, groundY: 0, stepAcc: 0, seatBlend: 0, init: false }
const fwd = new Vector3()
const head = new Vector3()
const before = new Vector3()

/** Place the rig so the head stands where the desktop player stood, facing the same way. */
export function placeRigAtPlayer() {
  const rig = xr.rig
  if (!rig) return
  const p = runtime.player
  rig.position.set(p.pos.x, groundHeight(p.pos.x, p.pos.z) + xr.floorOffset, p.pos.z)
  rig.rotation.set(0, p.yaw, 0)
  state.groundY = rig.position.y - xr.floorOffset
  state.init = true
}

export function updateXRPlayer(dt: number, camera: Camera, frozen: boolean) {
  const rig = xr.rig
  if (!rig) return
  if (!state.init) placeRigAtPlayer()
  const s = game()
  const p = runtime.player

  camera.getWorldPosition(head)
  camera.getWorldQuaternion(xr.headQuat)
  fwd.set(0, 0, -1).applyQuaternion(xr.headQuat)
  const yaw = Math.atan2(-fwd.x, -fwd.z)
  before.copy(head)

  // Move: left stick (or the right one if only one controller is held).
  const st = xr.hands.left.connected && xr.hands.left.kind === 'controller' ? xr.hands.left.stick : xr.hands.right.stick
  const seated = s.playerSeated
  const moving = !frozen && (st.x !== 0 || st.y !== 0)
  xr.gliding += ((moving && !seated ? Math.min(1, Math.hypot(st.x, st.y)) : 0) - xr.gliding) * damp(8, dt)
  if (seated && moving) s.setPlayerSeated(false)
  if (moving && !seated) {
    const k = Math.min(1, Math.hypot(st.x, st.y)) * WALK * dt
    const len = Math.hypot(st.x, st.y) || 1
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    const rx = Math.cos(yaw)
    const rz = -Math.sin(yaw)
    rig.position.x += ((fx * st.y + rx * st.x) / len) * k
    rig.position.z += ((fz * st.y + rz * st.x) / len) * k
  }

  // Snap turn around the head (right stick).
  const turn = xr.hands.right.kind === 'controller' ? xr.hands.right.stick.x : 0
  if (state.snapArmed && Math.abs(turn) > 0.65 && !frozen) {
    const a = -Math.sign(turn) * SNAP
    camera.getWorldPosition(head)
    const dx = rig.position.x - head.x
    const dz = rig.position.z - head.z
    const c = Math.cos(a)
    const sn = Math.sin(a)
    rig.position.x = head.x + dx * c + dz * sn
    rig.position.z = head.z - dx * sn + dz * c
    rig.rotation.y += a
    rig.updateMatrixWorld()
    state.snapArmed = false
  } else if (Math.abs(turn) < 0.3) state.snapArmed = true

  // Collisions: the head is the body; push the rig by the correction.
  rig.updateMatrixWorld()
  camera.getWorldPosition(head)
  const pos = { x: head.x, z: head.z }
  resolveCollisions(pos, RADIUS)
  rig.position.x += pos.x - head.x
  rig.position.z += pos.z - head.z

  // Sitting on the exedra: glide the head onto the seat and lower the eye.
  state.seatBlend += ((seated ? 1 : 0) - state.seatBlend) * damp(2.2, dt)
  if (seated) {
    rig.position.x += (EXEDRA_SEAT.x - head.x) * damp(3, dt)
    rig.position.z += (EXEDRA_SEAT.z - head.z) * damp(3, dt)
  }

  // Ground under the head (smoothed steps).
  rig.updateMatrixWorld()
  camera.getWorldPosition(head)
  const gy = groundHeight(head.x, head.z)
  state.groundY += (gy - state.groundY) * damp(gy > state.groundY ? 12 : 9, dt)
  const lift = s.settings.vrSeated ? SEATED_PLAY_LIFT : 0
  rig.position.y = state.groundY + xr.floorOffset + lift - SEAT_DROP * state.seatBlend
  rig.updateMatrixWorld()

  // Publish the player for the rest of the game (narrative, Seneca, audio).
  camera.getWorldPosition(xr.head)
  const moved = Math.hypot(xr.head.x - before.x, xr.head.z - before.z)
  p.speed = dt > 0 ? Math.min(3, moved / dt) : 0
  p.idleTime = p.speed > 0.2 ? 0 : p.idleTime + dt
  p.pos.set(xr.head.x, state.groundY, xr.head.z)
  p.eye.copy(xr.head)
  p.yaw = yaw
  p.pitch = Math.asin(Math.max(-1, Math.min(1, fwd.y)))

  // Footsteps for gliding (physical steps are silent — the player hears their own).
  if (moving && !seated) {
    state.stepAcc += moved
    if (state.stepAcc >= STEP_LEN) {
      state.stepAcc -= STEP_LEN
      const onPath = nearestOnPath(p.pos.x, p.pos.z).d < 1.3
      audio.footsteps.step(p.pos, surfaceAt(p.pos.x, p.pos.z, onPath), 'player', Math.min(1, p.speed / WALK))
    }
  }
}

/** Next session starts from the player's current position again. */
export function resetXRPlayer() {
  state.init = false
  state.seatBlend = 0
}
