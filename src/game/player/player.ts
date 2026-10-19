import type { PerspectiveCamera } from 'three'
import { audio } from '../audio/engine'
import { input } from '../input/input'
import { runtime } from '../runtime'
import { game } from '../store'
import { resolveCollisions } from '../world/colliders'
import { groundHeight, surfaceAt } from '../world/ground'
import { EYE_HEIGHT, PLAYER_SPAWN, TERRACE_Y } from '../world/layout'
import { EXEDRA_SEAT } from '../world/props'
import { damp } from '../world/noise'
import { nearestOnPath } from '../world/path'

/**
 * First-person walker: calm speeds, smooth acceleration, gentle head bob,
 * collision against the estate, footsteps, sitting on the terrace bench.
 */

const WALK = 1.45
const FAST = 2.3
const RADIUS = 0.32
const STEP_LEN = 0.74
const SEATED_EYE = 1.12

const state = {
  vx: 0,
  vz: 0,
  y: 0,
  bobPhase: 0,
  stepAcc: 0,
  lastStepSide: 1,
  seatBlend: 0,
  lookYaw: 0,
  lookPitch: 0,
}

export function resetPlayer() {
  const p = runtime.player
  p.pos.set(PLAYER_SPAWN.x, groundHeight(PLAYER_SPAWN.x, PLAYER_SPAWN.z), PLAYER_SPAWN.z)
  p.yaw = PLAYER_SPAWN.yaw
  p.pitch = -0.04
  state.lookYaw = p.yaw
  state.lookPitch = p.pitch
  state.vx = state.vz = 0
  state.y = p.pos.y
  state.seatBlend = 0
  p.speed = 0
  p.idleTime = 0
}

/** Seat position on the terrace bench (looking at the sea). */
const SEAT = EXEDRA_SEAT

export function updatePlayer(dt: number, camera: PerspectiveCamera, frozen: boolean) {
  const p = runtime.player
  const s = game()
  const settings = s.settings

  // Mouse look (smoothed a little for calm motion).
  const [mdx, mdy] = input.consumeMouse()
  if (!frozen && s.pointerLocked) {
    const sens = 0.0021 * settings.mouseSensitivity
    state.lookYaw -= mdx * sens
    state.lookPitch -= mdy * sens * (settings.invertY ? -1 : 1)
    state.lookPitch = Math.max(-1.3, Math.min(1.3, state.lookPitch))
  }
  const lk = damp(28, dt)
  p.yaw += (state.lookYaw - p.yaw) * lk
  p.pitch += (state.lookPitch - p.pitch) * lk

  // Movement.
  const ax = frozen ? { x: 0, y: 0 } : input.axes()
  const seated = s.playerSeated
  if (seated && (ax.x !== 0 || ax.y !== 0)) s.setPlayerSeated(false)
  let tx = 0
  let tz = 0
  if (!seated && (ax.x !== 0 || ax.y !== 0)) {
    const len = Math.hypot(ax.x, ax.y)
    const speed = input.fast() ? FAST : WALK
    const fx = -Math.sin(p.yaw)
    const fz = -Math.cos(p.yaw)
    const rx = Math.cos(p.yaw)
    const rz = -Math.sin(p.yaw)
    tx = ((fx * ax.y + rx * ax.x) / len) * speed
    tz = ((fz * ax.y + rz * ax.x) / len) * speed
  }
  const acc = damp(tx === 0 && tz === 0 ? 7 : 4.5, dt)
  state.vx += (tx - state.vx) * acc
  state.vz += (tz - state.vz) * acc
  const prevX = p.pos.x
  const prevZ = p.pos.z
  if (!seated) {
    p.pos.x += state.vx * dt
    p.pos.z += state.vz * dt
    resolveCollisions(p.pos, RADIUS)
  }
  const moved = Math.hypot(p.pos.x - prevX, p.pos.z - prevZ)
  p.speed = dt > 0 ? moved / dt : 0
  p.idleTime = p.speed > 0.2 ? 0 : p.idleTime + dt

  // Seated blend (move to the bench and lower the eye).
  state.seatBlend += ((seated ? 1 : 0) - state.seatBlend) * damp(2.2, dt)
  if (seated) {
    p.pos.x += (SEAT.x - p.pos.x) * damp(3, dt)
    p.pos.z += (SEAT.z - p.pos.z) * damp(3, dt)
  }

  // Ground following with smoothed steps.
  const gy = groundHeight(p.pos.x, p.pos.z)
  state.y += (gy - state.y) * damp(gy > state.y ? 14 : 10, dt)
  p.pos.y = state.y

  // Footsteps and head bob.
  const onPath = nearestOnPath(p.pos.x, p.pos.z).d < 1.3
  if (p.speed > 0.25 && !seated) {
    state.stepAcc += moved
    state.bobPhase += (moved / STEP_LEN) * Math.PI
    if (state.stepAcc >= STEP_LEN) {
      state.stepAcc -= STEP_LEN
      state.lastStepSide *= -1
      audio.footsteps.step(p.pos, surfaceAt(p.pos.x, p.pos.z, onPath), 'player', Math.min(1, p.speed / WALK))
    }
  } else {
    state.stepAcc = Math.min(state.stepAcc, STEP_LEN * 0.6)
  }
  const bobAmt = settings.headBob ? Math.min(1, p.speed / WALK) : 0
  const bobY = Math.abs(Math.sin(state.bobPhase)) * 0.028 * bobAmt - 0.014 * bobAmt
  const roll = Math.sin(state.bobPhase) * 0.0035 * bobAmt

  const eye = EYE_HEIGHT + (SEATED_EYE - EYE_HEIGHT) * state.seatBlend
  p.eye.set(p.pos.x, p.pos.y + eye + bobY, p.pos.z)
  camera.position.copy(p.eye)
  camera.rotation.set(p.pitch, p.yaw, roll, 'YXZ')
  // Seated: the view gently "leans in" so the bay reads like a painting.
  const fov = settings.fov * (1 - 0.2 * state.seatBlend)
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov
    camera.updateProjectionMatrix()
  }
}

export function playerNearBench() {
  const p = runtime.player
  return Math.abs(p.pos.y - TERRACE_Y) < 1 && Math.hypot(p.pos.x - SEAT.x, p.pos.z - SEAT.z) < 1.9
}

export function sitOnBench() {
  game().setPlayerSeated(true)
  // Turn toward the sea along the shortest arc.
  const yaw = runtime.player.yaw
  const diff = Math.atan2(Math.sin(SEAT.yaw - yaw), Math.cos(SEAT.yaw - yaw))
  state.lookYaw = yaw + diff
  state.lookPitch = -0.02
}

/** Dev/test helper: point the view (used by window.__dbg.look). */
export function setLook(yaw: number, pitch: number) {
  state.lookYaw = yaw
  state.lookPitch = pitch
  runtime.player.yaw = yaw
  runtime.player.pitch = pitch
}
