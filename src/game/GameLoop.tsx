import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Quaternion, Vector3, type PerspectiveCamera } from 'three'
import { audio } from './audio/engine'
import { debugState, installDebug } from './debug'
import { seneca, updateSeneca } from './characters/senecaController'
import { input, installInput } from './input/input'
import { hand, updateHand, type HandInput } from './interaction/hand'
import { fruitEvents, updateFruits } from './interaction/fruits'
import { installPointerLockListeners } from './input/pointerLock'
import { globalUniforms } from './materials/common'
import { debugJump, updateDirector } from './narrative/director'
import { SEQUENCE } from './narrative/sequence'
import { setLook, updatePlayer } from './player/player'
import { fruits } from './interaction/fruits'
import { runtime } from './runtime'
import { foliageUniforms } from './scenes/geom/foliage'
import { sky } from './scenes/atmosphere'
import { game, useGame } from './store'
import { FOUNTAIN, SEA_LEVEL } from './world/layout'
import { groundHeight, surfaceAt } from './world/ground'
import { nearestOnPath } from './world/path'
import { CYPRESSES, OLIVES, PINES } from './world/vegetation'
import { toggleNarrationPause } from './session'
import { updateXRHands, xrEvents } from './xr/xrHands'
import { updateXRInput } from './xr/xrInput'
import { updateXRPlayer } from './xr/xrPlayer'
import { exitVR } from './xr/xrSession'
import { xr } from './xr/xrState'

/**
 * The single per-frame orchestrator (runs before rendering):
 * input → player → director → Seneca → audio listener/emitters.
 */

const fwd = new Vector3()
const upV = new Vector3()
const camPos = new Vector3()
const camQuat = new Quaternion()

/** Desktop adapter for the device-agnostic hand: camera ray + keys. */
const handInput: HandInput = {
  origin: new Vector3(),
  direction: new Vector3(),
  grab: false,
  release: false,
  inspect: false,
  handVelocity: new Vector3(),
  handPosition: new Vector3(),
}
const HAND_OFFSET = new Vector3(0.2, -0.22, -0.42)
const prevHandPos = new Vector3()

/** Slow cinematic drift for the title screen: the sea terrace at sunset. */
function titleCamera(cam: PerspectiveCamera, t: number) {
  const a = Math.sin(t * 0.03) * 0.5 + 0.5
  cam.position.set(7.5 - a * 4, -3.25 + a * 0.15, -43.5 - a * 1.2)
  cam.lookAt(-16 + a * 5, -6.5, -120)
  runtime.player.eye.copy(cam.position)
}

export function GameLoop() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const scene = useThree((s) => s.scene)
  const gl = useThree((s) => s.gl)
  const lastStride = useRef(0)
  const settings = useGame((s) => s.settings)

  useEffect(() => {
    installInput()
    installPointerLockListeners()
    fruitEvents.onImpact = (f, speed) => audio.footsteps.step(f.pos, 'fruit', 'world', Math.min(1.2, speed / 3))
    xrEvents.onGrab = (f, fromTree) => audio.footsteps.step(f.pos, fromTree ? 'leaves' : 'fruit', 'world', fromTree ? 1 : 0.5)
    installDebug({ audio, jump: debugJump, sequence: SEQUENCE, scene, gl, look: setLook, fruits, hand, xr })
    audio.ambience.configure({
      fountain: { x: FOUNTAIN.x, y: 0.9, z: FOUNTAIN.z },
      sea: [
        { x: -60, y: SEA_LEVEL + 1, z: -85 },
        { x: -15, y: SEA_LEVEL + 1, z: -82 },
        { x: 30, y: SEA_LEVEL + 1, z: -80 },
        { x: -75, y: SEA_LEVEL + 1, z: -35 },
      ],
      birdPerches: [
        ...OLIVES.filter((_, i) => i % 3 === 0).map((t) => ({ x: t.x, y: t.y + 3.5 * t.scale, z: t.z })),
        ...CYPRESSES.filter((t) => Math.hypot(t.x, t.z) < 60).filter((_, i) => i % 3 === 0).map((t) => ({ x: t.x, y: t.y + 8 * t.scale, z: t.z })),
        ...PINES.filter((t) => Math.hypot(t.x, t.z) < 70).map((t) => ({ x: t.x, y: t.y + 9 * t.scale, z: t.z })),
      ],
      foliage: [
        { x: -15, y: 3, z: -12 },
        { x: -14, y: 4, z: 8 },
        { x: 15, y: 3, z: 0 },
        { x: 0, y: 2, z: 30 },
        { x: 20, y: 5, z: -40 },
      ],
    })
  }, [scene, gl])

  // Settings → mixer.
  useEffect(() => {
    audio.setBusVolume('master', settings.masterVolume)
    audio.setBusVolume('voice', settings.voiceVolume)
    audio.setBusVolume('ambience', settings.ambienceVolume)
    audio.setBusVolume('music', settings.musicVolume)
  }, [settings.masterVolume, settings.voiceVolume, settings.ambienceVolume, settings.musicVolume])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 20)
    runtime.time += dt
    globalUniforms.uTime.value += dt
    // Slowly breathing wind.
    const t = runtime.time
    globalUniforms.uWind.value = 0.38 + 0.22 * Math.sin(t * 0.07) * Math.sin(t * 0.031 + 1.3) + 0.08 * Math.sin(t * 0.23)
    foliageUniforms.uSunDirW.value.copy(sky.sunDir)
    foliageUniforms.uSunColorF.value.copy(sky.sunColor)

    const s = game()
    if (xr.presenting) {
      // In the headset: head + hands drive the player (see src/game/xr).
      if (s.phase === 'title') exitVR()
      const frozen = s.overlay !== null
      updateXRInput(dt)
      updateXRPlayer(dt, camera, frozen)
      updateFruits(frozen ? 0 : dt)
      updateXRHands(dt, frozen)
      if (!frozen) {
        // A/X: interact (sit on the exedra…); B/Y: pause/resume the reading.
        if (xr.hands.left.primaryPressed || xr.hands.right.primaryPressed) input.queueInteract()
        if (xr.hands.left.secondaryPressed || xr.hands.right.secondaryPressed) toggleNarrationPause()
      }
      updateDirector(dt)
      updateSeneca(dt)
    } else if (debugState.camOverride) {
      updateDirector(dt)
      updateSeneca(dt)
      camera.position.copy(debugState.camOverride.pos)
      camera.lookAt(debugState.camOverride.target)
      runtime.player.eye.copy(camera.position)
    } else if (s.phase === 'title') {
      titleCamera(camera, state.clock.elapsedTime)
      updateDirector(dt)
      updateSeneca(dt)
    } else {
      const frozen = s.overlay !== null
      updatePlayer(dt, camera, frozen)
      // Hand / fruit interaction runs before the director so E goes to the fruit first.
      updateFruits(frozen ? 0 : dt)
      if (!frozen) {
        camera.getWorldDirection(handInput.direction)
        handInput.origin.copy(camera.position)
        handInput.grab = input.peekInteract()
        handInput.release = input.consumePress('KeyQ')
        handInput.inspect = input.consumePress('KeyR')
        handInput.handPosition.copy(HAND_OFFSET).applyQuaternion(camera.quaternion).add(camera.position)
        handInput.handVelocity.copy(handInput.handPosition).sub(prevHandPos).divideScalar(Math.max(dt, 1e-3))
        if (handInput.handVelocity.lengthSq() > 25) handInput.handVelocity.setLength(5)
        prevHandPos.copy(handInput.handPosition)
        updateHand(dt, handInput)
        if (hand.usedGrab) {
          input.consumeInteract()
          if (hand.held) audio.footsteps.step(hand.held.pos, 'leaves', 'world', 1)
        }
      }
      updateDirector(dt)
      updateSeneca(dt)
    }
    input.endFrame()

    // Seneca's footsteps (one per half gait cycle).
    if (seneca.speed > 0.15 && Math.floor(seneca.stride / Math.PI) !== Math.floor(lastStride.current / Math.PI)) {
      const onPath = nearestOnPath(seneca.pos.x, seneca.pos.z).d < 1.4
      audio.footsteps.step(seneca.pos, surfaceAt(seneca.pos.x, seneca.pos.z, onPath), 'seneca', Math.min(1, seneca.speed / 0.8))
    }
    lastStride.current = seneca.stride

    // Audio listener (world pose: in VR the camera lives under the rig) & the voice emitter.
    camera.getWorldPosition(camPos)
    camera.getWorldQuaternion(camQuat)
    fwd.set(0, 0, -1).applyQuaternion(camQuat)
    upV.set(0, 1, 0).applyQuaternion(camQuat)
    audio.updateListener(camPos, fwd, upV)
    audio.voice.setSourcePosition(runtime.seneca.head)
    void groundHeight
  }, -1)

  return null
}
