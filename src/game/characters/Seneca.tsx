import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  AnimationClip,
  AnimationMixer,
  Bone,
  CylinderGeometry,
  Group,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type AnimationAction,
  type Object3D,
} from 'three'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import type { Gesture } from '../../data/narration/types'
import { ProceduralSeneca } from './ProceduralSeneca'
import { seneca } from './senecaController'
import { debugFlags } from '../debug'

/**
 * Seneca's visual. Uses the Meshy-generated rigged character when available
 * (public/assets/models/seneca.glb), otherwise the procedural stand-in.
 */

interface ModelEntry {
  file: string
  animations?: { name: string; walkSpeedMps?: number }[]
}

const modelsModules = import.meta.glob('../../data/generated/models.json', { eager: true, import: 'default' })
const models = (Object.values(modelsModules)[0] ?? {}) as Record<string, ModelEntry>
const SENECA_ENTRY = models['seneca']
const FORCE_PROCEDURAL = typeof location !== 'undefined' && new URLSearchParams(location.search).get('seneca') === 'procedural'
export const SENECA_URL = SENECA_ENTRY && !FORCE_PROCEDURAL ? import.meta.env.BASE_URL + SENECA_ENTRY.file : null

const MODEL_YAW_OFFSET = Math.PI

const UPPER_BODY = /^(Spine|Spine01|Spine02|neck|Head|head_end|headfront|LeftShoulder|LeftArm|LeftForeArm|LeftHand|RightShoulder|RightArm|RightForeArm|RightHand)\./

/** Copy of a clip keeping only upper-body tracks (for gestures while walking). */
function upperBody(clip: AnimationClip, name: string) {
  return new AnimationClip(
    name,
    clip.duration,
    clip.tracks.filter((t) => UPPER_BODY.test(t.name) && !t.name.endsWith('.position')),
  )
}

function talkClipFor(g: Gesture): string {
  switch (g) {
    case 'open-hand':
    case 'welcome':
    case 'grasp':
      return 'talk_open'
    case 'toward-sea':
    case 'toward-table':
    case 'point-back':
    case 'scroll-show':
      return 'talk_right'
    default:
      return 'talk_chat'
  }
}

const qTmp = new Quaternion()
const qParent = new Quaternion()
const qYaw = new Quaternion()
const qPitch = new Quaternion()
const up = new Vector3(0, 1, 0)
const right = new Vector3()

function GltfSeneca({ url }: { url: string }) {
  const gltf = useGLTF(url, false, true)
  const root = useRef<Group>(null)

  const rig = useMemo(() => {
    const scene = cloneSkinned(gltf.scene) as Group
    let head: Bone | null = null
    let neck: Bone | null = null
    let leftHand: Bone | null = null
    scene.traverse((o: Object3D) => {
      const m = o as Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = true
        m.frustumCulled = false
        const mat = m.material as MeshStandardMaterial
        if (mat && 'roughness' in mat) {
          mat.envMapIntensity = 0.9
          // Meshy textures can be a touch glossy; cloth and skin should stay soft.
          mat.roughness = Math.max(mat.roughness, 0.6)
        }
      }
      if ((o as Bone).isBone) {
        if (o.name === 'Head') head = o as Bone
        if (o.name === 'neck') neck = o as Bone
        if (o.name === 'LeftHand') leftHand = o as Bone
      }
    })
    const mixer = new AnimationMixer(scene)
    const clips = new Map(gltf.animations.map((c) => [c.name, c]))
    const actions = new Map<string, AnimationAction>()
    const add = (name: string, clip: AnimationClip | undefined, loop = true) => {
      if (!clip) return
      const a = mixer.clipAction(clip)
      a.setLoop(loop ? LoopRepeat : LoopOnce, Infinity)
      a.clampWhenFinished = !loop
      a.enabled = true
      a.setEffectiveWeight(0)
      a.play()
      actions.set(name, a)
    }
    add('idle', clips.get('idle'))
    // The thoughtful stroll (0.59 m/s) matches Seneca's pace best.
    add('walk', clips.get('walk_thoughtful') ?? clips.get('walk') ?? clips.get('walk_basic'))
    add('talk_open', clips.get('talk_open'))
    add('talk_right', clips.get('talk_right'))
    add('talk_chat', clips.get('talk_chat'))
    add('listen', clips.get('listen'))
    for (const n of ['talk_open', 'talk_right', 'talk_chat']) {
      const c = clips.get(n)
      if (c) add(`${n}_upper`, upperBody(c, `${n}_upper`))
    }
    add('shrug', clips.get('shrug'), false)
    add('look_around', clips.get('look_around'), false)
    // Desynchronise loops a little.
    actions.forEach((a, n) => (a.time = (n.length * 0.37) % a.getClip().duration))
    // A scroll held in the left hand.
    const scroll = new Mesh(new CylinderGeometry(0.028, 0.028, 0.26, 12), new MeshStandardMaterial({ color: '#e6d6b0', roughness: 0.85 }))
    scroll.castShadow = true
    if (leftHand) {
      ;(leftHand as Bone).add(scroll)
      scroll.position.set(0, 0.08, 0.03)
      scroll.rotation.set(0, 0, Math.PI / 2)
      // Bone units may be scaled (armature in cm) — compensate to keep the scroll metric.
      const s = new Vector3()
      ;(leftHand as Bone).getWorldScale(s)
      if (s.x > 0) scroll.scale.setScalar(1 / s.x)
    }
    const walkEntry = SENECA_ENTRY?.animations?.find((a) => a.name === 'walk_thoughtful') ?? SENECA_ENTRY?.animations?.find((a) => a.name === 'walk')
    const walkSpeed = walkEntry?.walkSpeedMps ?? 0.6
    const headB = head as Bone | null
    const neckB = neck as Bone | null
    return {
      scene,
      mixer,
      actions,
      head: headB,
      neck: neckB,
      headBase: headB ? headB.quaternion.clone() : null,
      neckBase: neckB ? neckB.quaternion.clone() : null,
      scroll,
      walkSpeed,
    }
  }, [gltf])

  useEffect(
    () => () => {
      rig.mixer.stopAllAction()
      rig.scroll.geometry.dispose()
      ;(rig.scroll.material as MeshStandardMaterial).dispose()
    },
    [rig],
  )

  const weights = useRef(new Map<string, number>())
  const oneShot = useRef<{ name: string; t: number } | null>(null)
  const lastGestureTimer = useRef(0)
  const contemplateTimer = useRef(8)

  useFrame((_, dt) => {
    if (!root.current) return
    root.current.position.copy(seneca.pos)
    // The exported character faces +Z; yaw 0 means facing −Z, hence the π offset.
    root.current.rotation.y = seneca.yaw + MODEL_YAW_OFFSET
    const frozen = seneca.frozen
    const A = rig.actions

    // Target weights.
    const target = new Map<string, number>()
    const walkW = Math.min(1, seneca.speed / 0.35)
    const stand = 1 - walkW
    const talkClip = talkClipFor(seneca.gesture)
    const talking = seneca.talkEnergy
    target.set('walk', walkW)
    target.set(`${talkClip}_upper`, walkW * talking * 0.55)
    target.set(talkClip, stand * talking * 0.9)
    const waiting = seneca.waitingForPlayer && !seneca.talking
    target.set('listen', stand * (1 - talking) * (waiting ? 0.7 : 0))
    target.set('idle', stand * (1 - talking * 0.9) * (waiting ? 0.3 : 1) + 0.0001)

    // One-shots: shrug on the shrug gesture; look-around while contemplating in silence.
    if (seneca.gesture === 'shrug' && seneca.gestureTimer > lastGestureTimer.current + 0.5 && A.get('shrug')) {
      oneShot.current = { name: 'shrug', t: 0 }
      const a = A.get('shrug')!
      a.reset().play()
    }
    lastGestureTimer.current = seneca.gestureTimer
    if (seneca.mode === 'contemplating' && !seneca.talking && seneca.speed < 0.05) {
      contemplateTimer.current -= dt
      if (contemplateTimer.current <= 0 && A.get('look_around') && !oneShot.current) {
        contemplateTimer.current = 18 + Math.random() * 14
        oneShot.current = { name: 'look_around', t: 0 }
        A.get('look_around')!.reset().play()
      }
    }
    if (oneShot.current) {
      const os = oneShot.current
      os.t += dt
      const a = A.get(os.name)
      const dur = a ? a.getClip().duration : 0
      const env = Math.min(1, os.t / 0.4) * Math.min(1, Math.max(0, (dur - os.t) / 0.5))
      target.set(os.name, env * stand * 0.95)
      if (os.t >= dur) oneShot.current = null
    }

    // Smoothly move weights.
    const k = Math.min(1, dt * 4)
    for (const [name, a] of A) {
      const cur = weights.current.get(name) ?? 0
      const tw = target.get(name) ?? 0
      const w = cur + (tw - cur) * k
      weights.current.set(name, w)
      a.setEffectiveWeight(w)
    }
    const walk = A.get('walk')
    if (walk) walk.timeScale = Math.max(0.55, Math.min(1.35, seneca.speed / rig.walkSpeed))
    // Restore the animated pose before the mixer runs: bones without tracks would
    // otherwise accumulate the procedural look rotation frame after frame.
    if (rig.neck && rig.neckBase) rig.neck.quaternion.copy(rig.neckBase)
    if (rig.head && rig.headBase) rig.head.quaternion.copy(rig.headBase)
    rig.mixer.update(frozen ? 0 : dt)
    rig.neckBase?.copy(rig.neck!.quaternion)
    rig.headBase?.copy(rig.head!.quaternion)

    // Procedural head look on top of the animation (world-space, axis-agnostic).
    root.current.updateMatrixWorld(true)
    const yawAmt = seneca.headYaw
    const pitchAmt = -seneca.headPitch
    right.set(Math.cos(seneca.yaw), 0, -Math.sin(seneca.yaw))
    const applyLook = (bone: Bone | null, share: number) => {
      if (!bone || !bone.parent) return
      qYaw.setFromAxisAngle(up, yawAmt * share)
      qPitch.setFromAxisAngle(right, -pitchAmt * share)
      bone.getWorldQuaternion(qTmp)
      qTmp.premultiply(qPitch).premultiply(qYaw)
      bone.parent.getWorldQuaternion(qParent)
      bone.quaternion.copy(qParent.invert().multiply(qTmp))
      bone.updateMatrixWorld(true)
    }
    if (!debugFlags.noHeadLook) {
      applyLook(rig.neck, 0.35)
      applyLook(rig.head, 0.5)
    }
    rig.scroll.visible = seneca.holdingScroll
  })

  return (
    <group ref={root}>
      <primitive object={rig.scene} />
    </group>
  )
}

class FallbackBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch(err: unknown) {
    console.warn('[seneca] character model failed to load, using the procedural stand-in.', err)
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export function Seneca() {
  if (!SENECA_URL) return <ProceduralSeneca />
  return (
    <FallbackBoundary fallback={<ProceduralSeneca />}>
      <Suspense fallback={<ProceduralSeneca />}>
        <GltfSeneca url={SENECA_URL} />
      </Suspense>
    </FallbackBoundary>
  )
}
