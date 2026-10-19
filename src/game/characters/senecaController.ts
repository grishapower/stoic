import { Vector3 } from 'three'
import type { Gesture, LookTarget } from '../../data/narration/types'
import { runtime, type SenecaMode } from '../runtime'
import { groundHeight } from '../world/ground'
import { PERGOLA, ROUTE, SEA_LEVEL } from '../world/layout'
import { damp } from '../world/noise'
import { PATH_LENGTH, nearestOnPath, pathPointAt, pathTangentAt } from '../world/path'

/**
 * Seneca's behaviour: where he is, how fast he walks, where he looks, which
 * gesture he makes. Pure logic — visuals read `seneca` every frame.
 *
 * Walking rules (calm companion):
 *  - never runs away: slows down when the player lags, stops and waits beyond ~7 m;
 *  - stops if the player stands right in front of him;
 *  - turns smoothly, never snaps;
 *  - while speaking glances at the player now and then.
 */

const LATERAL = 0.45 // walks slightly to the right of the path centre
const FOLLOW_SLOW = 5
const FOLLOW_STOP = 7.5
const MAX_TURN = 1.7 // rad/s

export const seneca = {
  s: 0,
  allowance: 0,
  desiredSpeed: 0.75,
  speed: 0,
  pos: new Vector3(),
  yaw: 0,
  mode: 'idle' as SenecaMode,
  /** Look target kind requested by the current line. */
  look: 'player' as LookTarget,
  /** Head orientation relative to the body (radians). */
  headYaw: 0,
  headPitch: 0,
  lookPoint: new Vector3(),
  gesture: 'none' as Gesture,
  gestureWeight: 0,
  gestureTarget: 0,
  gestureTimer: 0,
  talking: false,
  talkEnergy: 0,
  holdingScroll: false,
  /** Gait phase in radians (for procedural legs). */
  stride: 0,
  /** True while the player is too far / blocking and Seneca waits. */
  waitingForPlayer: false,
  /** Seconds Seneca has been waiting for the player. */
  waitTime: 0,
  /** Force facing the player (greeting, user pause). */
  facePlayer: false,
  frozen: false,
  glanceTimer: 4,
  glanceLeft: 0,
  idleLookTimer: 3,
  idleLookYaw: 0,
  bodyFacing: null as null | 'player' | 'sea' | 'fountain',
}

const tmp2: [number, number] = [0, 0]
const tan: [number, number] = [0, 0]
const v = new Vector3()

export function resetSeneca() {
  seneca.s = 0
  seneca.allowance = 0
  seneca.speed = 0
  seneca.mode = 'idle'
  seneca.look = 'path'
  seneca.gesture = 'none'
  seneca.gestureWeight = 0
  seneca.gestureTarget = 0
  seneca.talking = false
  seneca.holdingScroll = true
  seneca.waitingForPlayer = false
  seneca.waitTime = 0
  seneca.facePlayer = false
  seneca.bodyFacing = 'fountain'
  placeAt(0)
  // Initially facing the fountain.
  seneca.yaw = Math.atan2(-(0 - ROUTE[0][0]), -(30 - ROUTE[0][1]))
  seneca.headYaw = 0
  seneca.headPitch = -0.15
}

function placeAt(s: number) {
  pathPointAt(s, tmp2)
  pathTangentAt(s, tan)
  // Right of the travel direction (tx, tz) is (−tz, tx) in three.js XZ.
  const rx = -tan[1]
  const rz = tan[0]
  const lat = s < 3 ? (s / 3) * LATERAL : LATERAL
  const x = tmp2[0] + rx * lat
  const z = tmp2[1] + rz * lat
  seneca.pos.x = x
  seneca.pos.z = z
}

/** Yaw (three.js convention: 0 looks toward −Z) facing from a to b. */
function yawTo(ax: number, az: number, bx: number, bz: number) {
  return Math.atan2(-(bx - ax), -(bz - az))
}

function angleDiff(a: number, b: number) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

export function triggerGesture(g: Gesture, strength = 1) {
  if (g === 'none') return
  seneca.gesture = g
  seneca.gestureTarget = strength
  seneca.gestureTimer = g.startsWith('scroll') ? 3.2 : 2.4 + Math.random() * 1.2
}

export function updateSeneca(dt: number) {
  if (seneca.frozen) dt = 0
  const p = runtime.player
  const dx = p.pos.x - seneca.pos.x
  const dz = p.pos.z - seneca.pos.z
  const dist = Math.hypot(dx, dz)

  /* ---------------- Locomotion */
  const playerS = nearestOnPath(p.pos.x, p.pos.z).s
  const playerAhead = playerS > seneca.s + 1.5 && dist < 12
  let follow = 1
  if (!playerAhead) {
    if (dist > FOLLOW_STOP) follow = 0
    else if (dist > FOLLOW_SLOW) follow = 1 - (dist - FOLLOW_SLOW) / (FOLLOW_STOP - FOLLOW_SLOW)
  }
  // Player blocking the way in front.
  pathTangentAt(seneca.s, tan)
  const ahead = (dx * tan[0] + dz * tan[1]) / Math.max(dist, 1e-3)
  if (dist < 1.25 && ahead > 0.5) follow = 0

  const remaining = seneca.allowance - seneca.s
  const wantsWalk = remaining > 0.05 && (seneca.mode === 'walking' || seneca.mode === 'waiting')
  let target = wantsWalk && !seneca.facePlayer ? seneca.desiredSpeed * follow : 0
  // Ease into stops at the allowance (stations).
  if (wantsWalk) target = Math.min(target, Math.max(0.12, remaining * 0.6))
  const accel = target > seneca.speed ? 0.55 : 1.1
  seneca.speed += Math.sign(target - seneca.speed) * Math.min(Math.abs(target - seneca.speed), accel * dt)
  if (remaining <= 0.02 && seneca.speed < 0.05) seneca.speed = 0
  seneca.s = Math.min(seneca.allowance, Math.min(PATH_LENGTH, seneca.s + seneca.speed * dt))
  if (seneca.mode !== 'idle' && seneca.mode !== 'greeting') placeAt(seneca.s)
  seneca.pos.y += (groundHeight(seneca.pos.x, seneca.pos.z) - seneca.pos.y) * (dt > 0 ? damp(10, dt) : 0)
  if (Math.abs(seneca.pos.y - groundHeight(seneca.pos.x, seneca.pos.z)) > 1) seneca.pos.y = groundHeight(seneca.pos.x, seneca.pos.z)
  seneca.stride += (seneca.speed / 0.72) * Math.PI * dt

  const waiting = wantsWalk && follow < 0.05 && !playerAhead
  seneca.waitingForPlayer = waiting || (seneca.facePlayer && dist > 3)
  seneca.waitTime = seneca.waitingForPlayer ? seneca.waitTime + dt : 0

  /* ---------------- Body yaw */
  let desiredYaw = seneca.yaw
  if (seneca.speed > 0.12) {
    desiredYaw = Math.atan2(-tan[0], -tan[1])
  } else {
    const face = seneca.facePlayer || seneca.waitingForPlayer ? 'player' : seneca.bodyFacing
    if (face === 'player') {
      const toP = yawTo(seneca.pos.x, seneca.pos.z, p.pos.x, p.pos.z)
      // Turn the body only when the head would have to twist too far.
      if (Math.abs(angleDiff(toP, seneca.yaw)) > 0.6 || seneca.facePlayer) desiredYaw = toP
    } else if (face === 'sea') {
      desiredYaw = yawTo(seneca.pos.x, seneca.pos.z, seneca.pos.x - 0.35, seneca.pos.z - 1)
    } else if (face === 'fountain') {
      desiredYaw = yawTo(seneca.pos.x, seneca.pos.z, 0, 30)
    }
  }
  const dy = angleDiff(desiredYaw, seneca.yaw)
  const turn = Math.sign(dy) * Math.min(Math.abs(dy), MAX_TURN * dt, Math.abs(dy) * damp(3, dt))
  seneca.yaw += turn

  /* ---------------- Look target */
  let kind: LookTarget = seneca.look
  seneca.glanceTimer -= dt
  if (seneca.glanceLeft > 0) {
    seneca.glanceLeft -= dt
    kind = 'player'
  } else if (seneca.glanceTimer <= 0 && dist < 9) {
    seneca.glanceLeft = 1.4 + Math.random() * 1.2
    seneca.glanceTimer = (seneca.talking ? 6 : 10) + Math.random() * 5
  }
  if (seneca.facePlayer || seneca.waitingForPlayer) kind = 'player'
  resolveLookPoint(kind)

  // Head orientation relative to the body.
  const headY = seneca.pos.y + 1.6
  v.copy(seneca.lookPoint).sub(seneca.pos)
  v.y = seneca.lookPoint.y - headY
  let hy = angleDiff(Math.atan2(-v.x, -v.z), seneca.yaw)
  let hp = Math.atan2(v.y, Math.hypot(v.x, v.z))
  // Occasional idle look-around when standing silent.
  if (!seneca.talking && seneca.speed < 0.1 && kind !== 'player') {
    seneca.idleLookTimer -= dt
    if (seneca.idleLookTimer <= 0) {
      seneca.idleLookTimer = 3 + Math.random() * 5
      seneca.idleLookYaw = (Math.random() - 0.5) * 1.1
    }
    hy += seneca.idleLookYaw
  }
  hy = Math.max(-1.25, Math.min(1.25, hy))
  hp = Math.max(-0.55, Math.min(0.45, hp))
  const hk = damp(3.2, dt)
  seneca.headYaw += (hy - seneca.headYaw) * hk
  seneca.headPitch += (hp - seneca.headPitch) * hk

  /* ---------------- Gestures & talk energy */
  if (seneca.gestureTimer > 0) {
    seneca.gestureTimer -= dt
    if (seneca.gestureTimer <= 0) seneca.gestureTarget = 0
  }
  seneca.gestureWeight += (seneca.gestureTarget - seneca.gestureWeight) * damp(seneca.gestureTarget > seneca.gestureWeight ? 2.6 : 1.6, dt)
  seneca.talkEnergy += ((seneca.talking ? 1 : 0) - seneca.talkEnergy) * damp(4, dt)

  /* ---------------- Publish */
  const r = runtime.seneca
  r.pos.copy(seneca.pos)
  r.head.set(seneca.pos.x, seneca.pos.y + 1.62, seneca.pos.z)
  r.yaw = seneca.yaw
  r.routeS = seneca.s
  r.speed = seneca.speed
  r.mode = seneca.mode
  r.talking = seneca.talking
}

function resolveLookPoint(kind: LookTarget) {
  const p = runtime.player
  const lp = seneca.lookPoint
  const fx = -Math.sin(seneca.yaw)
  const fz = -Math.cos(seneca.yaw)
  switch (kind) {
    case 'player':
      lp.copy(p.eye)
      break
    case 'path': {
      pathPointAt(Math.min(PATH_LENGTH, seneca.s + 6), tmp2)
      lp.set(tmp2[0], groundHeight(tmp2[0], tmp2[1]) + 1.0, tmp2[1])
      break
    }
    case 'back': {
      pathPointAt(Math.max(0, seneca.s - 8), tmp2)
      lp.set(tmp2[0], groundHeight(tmp2[0], tmp2[1]) + 1.2, tmp2[1])
      break
    }
    case 'sea':
      lp.set(seneca.pos.x - 18, SEA_LEVEL + 22, seneca.pos.z - 60)
      break
    case 'scroll':
      lp.set(seneca.pos.x + fx * 0.45, seneca.pos.y + 1.0, seneca.pos.z + fz * 0.45)
      break
    case 'trees':
      lp.set(seneca.pos.x + fx * 3 - fz * 2.5, seneca.pos.y + 3.6, seneca.pos.z + fz * 3 + fx * 2.5)
      break
    case 'table':
      lp.set(PERGOLA.table.x, groundHeight(PERGOLA.table.x, PERGOLA.table.z) + 0.8, PERGOLA.table.z)
      break
  }
}

export function setSenecaMode(mode: SenecaMode) {
  seneca.mode = mode
  if (mode === 'contemplating') seneca.bodyFacing = 'sea'
  if (mode === 'walking') seneca.bodyFacing = 'player'
}
