import { useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import {
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Object3D,
} from 'three'
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js'
import { hand as deskHand } from '../interaction/hand'
import { releaseFruit, setShowHeld } from '../interaction/fruits'
import { openOverlay } from '../session'
import { game } from '../store'
import { hasModel, modelUrl, Quiet } from '../scenes/Props'
import { slots, type XRSlot } from './xrInput'
import { dropAll, reachable, resetXRHands, viaRay } from './xrHands'
import { placeRigAtPlayer, resetXRPlayer } from './xrPlayer'
import { detectXR } from './xrSession'
import { resetHands, SIDES, uiRay, xr, type Side } from './xrState'

/**
 * WebXR plumbing inside the R3F scene: the play-space rig (camera +
 * controllers live under it), session start/end, and how the hands look —
 * the hand model on controllers, a jointed hand for hand tracking, and a
 * faint pointing ray when reaching for a distant fruit or a panel button.
 */

const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'] as const
const JOINTS = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  ...FINGERS.flatMap((f) => [`${f}-metacarpal`, `${f}-phalanx-proximal`, `${f}-phalanx-intermediate`, `${f}-phalanx-distal`, `${f}-tip`]),
]
const BONES: [string, string][] = [
  ['wrist', 'thumb-metacarpal'],
  ['thumb-metacarpal', 'thumb-phalanx-proximal'],
  ['thumb-phalanx-proximal', 'thumb-phalanx-distal'],
  ['thumb-phalanx-distal', 'thumb-tip'],
  ...FINGERS.flatMap((f): [string, string][] => [
    ['wrist', `${f}-metacarpal`],
    [`${f}-metacarpal`, `${f}-phalanx-proximal`],
    [`${f}-phalanx-proximal`, `${f}-phalanx-intermediate`],
    [`${f}-phalanx-intermediate`, `${f}-phalanx-distal`],
    [`${f}-phalanx-distal`, `${f}-tip`],
  ]),
]

const m4 = new Matrix4()
const q = new Quaternion()
const a = new Vector3()
const b = new Vector3()
const s3 = new Vector3()
const dir = new Vector3()
const Y = new Vector3(0, 1, 0)
const ZERO = new Matrix4().makeScale(0, 0, 0)

function markDirty(im: InstancedMesh) {
  im.instanceMatrix.needsUpdate = true
}

/** Skinned hand model per side is ready (WebXR Input Profiles "generic-hand", MIT). */
const handMeshReady: Record<Side, boolean> = { left: false, right: false }
const HAND_MESH_PATH = `${import.meta.env.BASE_URL}assets/models/xr/generic-hand/`

/** Fallback for hand tracking until/unless the skinned model loads: spheres at the joints, tapered bones between them. */
function TrackedHands({ skin }: { skin: MeshStandardMaterial }) {
  const res = useMemo(() => {
    const joints = new InstancedMesh(new SphereGeometry(1, 10, 8), skin, JOINTS.length * 2)
    const bones = new InstancedMesh(new CylinderGeometry(1, 1, 1, 8), skin, BONES.length * 2)
    for (const im of [joints, bones]) {
      im.frustumCulled = false
      im.castShadow = false
      for (let i = 0; i < im.count; i++) im.setMatrixAt(i, ZERO)
    }
    return { joints, bones }
  }, [skin])
  useEffect(
    () => () => {
      res.joints.geometry.dispose()
      res.bones.geometry.dispose()
      res.joints.dispose()
      res.bones.dispose()
    },
    [res],
  )
  useFrame(() => {
    SIDES.forEach((side, k) => {
      const h = xr.hands[side]
      const slot = slots.find((sl) => sl.source?.handedness === side)
      const show = xr.presenting && h.connected && h.kind === 'hand' && !!slot && !handMeshReady[side]
      const js = slot ? (slot.hand.joints as Record<string, (Object3D & { jointRadius?: number }) | undefined>) : {}
      JOINTS.forEach((name, i) => {
        const j = js[name]
        if (!show || !j || !j.visible) return res.joints.setMatrixAt(k * JOINTS.length + i, ZERO)
        j.getWorldPosition(a)
        const r = (j.jointRadius ?? 0.008) * 0.95
        res.joints.setMatrixAt(k * JOINTS.length + i, m4.compose(a, q.identity(), s3.setScalar(r)))
      })
      BONES.forEach(([from, to], i) => {
        const ja = js[from]
        const jb = js[to]
        if (!show || !ja || !jb || !ja.visible || !jb.visible) return res.bones.setMatrixAt(k * BONES.length + i, ZERO)
        ja.getWorldPosition(a)
        jb.getWorldPosition(b)
        const len = a.distanceTo(b)
        const r = Math.min(ja.jointRadius ?? 0.008, jb.jointRadius ?? 0.008) * 0.85
        q.setFromUnitVectors(Y, dir.copy(b).sub(a).normalize())
        res.bones.setMatrixAt(k * BONES.length + i, m4.compose(a.add(b).multiplyScalar(0.5), q, s3.set(r, len, r)))
      })
    })
    markDirty(res.joints)
    markDirty(res.bones)
  }, -0.8)
  return (
    <>
      <primitive object={res.joints} />
      <primitive object={res.bones} />
    </>
  )
}

/** The game's hand model, held as if around the controller. */
function ControllerHand({ side, skin }: { side: Side; skin: MeshStandardMaterial }) {
  const gltf = useGLTF(modelUrl('hand-fp'), false, true)
  const g = useRef<Group>(null)
  const obj = useMemo(() => {
    const o = gltf.scene.clone(true)
    o.traverse((c) => {
      const m = c as Mesh
      if (m.isMesh) {
        m.castShadow = false
        m.material = skin
      }
    })
    // Model: right hand, palm up (+Y), fingers −Z, thumb +X. Roll it so the palm faces the
    // controller; the left hand is the mirror image.
    o.rotation.z = side === 'right' ? Math.PI / 2 : -Math.PI / 2
    if (side === 'left') o.scale.x = -1
    o.position.x = side === 'right' ? 0.034 : -0.034
    return o
  }, [gltf, side, skin])
  useFrame(() => {
    const h = xr.hands[side]
    const grp = g.current
    if (!grp) return
    grp.visible = xr.presenting && h.connected && h.kind === 'controller'
    if (!grp.visible) return
    grp.position.copy(h.grabPoint)
    grp.quaternion.copy(h.quat)
  }, -0.8)
  return (
    <group ref={g} visible={false}>
      <primitive object={obj} />
    </group>
  )
}

/** Faint pointing ray (distant fruit or a panel button). */
function Rays() {
  const res = useMemo(() => {
    const geo = new CylinderGeometry(0.0018, 0.0018, 1, 6, 1, true)
    geo.translate(0, 0.5, 0)
    const mat = new MeshBasicMaterial({ color: '#fff4dc', transparent: true, opacity: 0.38, depthWrite: false })
    return { geo, mat }
  }, [])
  const refs = useRef<Record<Side, Mesh | null>>({ left: null, right: null })
  useEffect(
    () => () => {
      res.geo.dispose()
      res.mat.dispose()
    },
    [res],
  )
  useFrame(() => {
    for (const side of SIDES) {
      const mesh = refs.current[side]
      if (!mesh) continue
      const h = xr.hands[side]
      const f = reachable[side]
      const len = viaRay[side] && f ? f.pos.distanceTo(h.rayOrigin) : uiRay[side]
      mesh.visible = xr.presenting && h.connected && len > 0
      if (!mesh.visible) continue
      mesh.position.copy(h.rayOrigin)
      mesh.quaternion.setFromUnitVectors(Y, h.rayDir)
      mesh.scale.set(1, len, 1)
    }
  }, -0.7)
  return (
    <>
      {SIDES.map((s) => (
        <mesh key={s} ref={(m) => void (refs.current[s] = m)} geometry={res.geo} material={res.mat} visible={false} renderOrder={10} />
      ))}
    </>
  )
}

export function XRSupport() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const rig = useRef<Group>(null)
  const skin = useMemo(() => new MeshStandardMaterial({ color: '#c99a7d', roughness: 0.6, metalness: 0 }), [])
  useEffect(() => () => skin.dispose(), [skin])

  useEffect(() => {
    xr.gl = gl
    void detectXR()
    const r = rig.current
    if (!r) return
    xr.rig = r
    const handFactory = new XRHandModelFactory(null, (obj: Object3D) => {
      obj.traverse((c) => {
        const m = c as Mesh
        if (m.isMesh) {
          m.material = skin
          m.castShadow = false
        }
      })
      const side = (obj.parent as (Object3D & { xrInputSource?: XRInputSource }) | null)?.xrInputSource?.handedness
      if (side === 'left' || side === 'right') handMeshReady[side] = true
    }).setPath(HAND_MESH_PATH)
    // One slot per three.js controller index; handedness arrives with 'connected'.
    const made: XRSlot[] = []
    const listeners: (() => void)[] = []
    for (let i = 0; i < 2; i++) {
      const slot: XRSlot = { ray: gl.xr.getController(i), grip: gl.xr.getControllerGrip(i), hand: gl.xr.getHand(i), source: null }
      r.add(slot.ray, slot.grip, slot.hand)
      // Skinned hand driven by the tracked joints (three's XRHandMeshModel), recoloured to skin.
      const handModel = handFactory.createHandModel(slot.hand, 'mesh')
      slot.hand.add(handModel)
      const onConnected = (e: { data?: XRInputSource }) => void (slot.source = e.data ?? null)
      const onDisconnected = () => void (slot.source = null)
      slot.ray.addEventListener('connected', onConnected)
      slot.ray.addEventListener('disconnected', onDisconnected)
      listeners.push(() => {
        slot.ray.removeEventListener('connected', onConnected)
        slot.ray.removeEventListener('disconnected', onDisconnected)
        r.remove(slot.ray, slot.grip, slot.hand)
      })
      made.push(slot)
    }
    slots.splice(0, slots.length, ...made)

    const onStart = () => {
      xr.presenting = true
      xr.sessionStart = performance.now()
      // A fruit held in the desktop hand drops at the player's feet.
      if (deskHand.held) {
        releaseFruit(deskHand.held, deskHand.held.pos.copy(camera.position).add(a.set(0, -0.6, 0)), b.set(0, 0, 0))
        deskHand.held = null
      }
      r.add(camera)
      camera.position.set(0, 0, 0)
      camera.rotation.set(0, 0, 0)
      placeRigAtPlayer()
      setShowHeld(true)
      game().setXR({ xrPresenting: true })
      if (xr.standalone && game().settings.quality !== 'low') game().updateSettings({ quality: 'low' })
    }
    const onEnd = () => {
      xr.presenting = false
      dropAll()
      resetXRHands()
      resetHands()
      resetXRPlayer()
      setShowHeld(false)
      scene.add(camera)
      game().setXR({ xrPresenting: false })
      const s = game()
      // Back on the desktop mid-walk: wait in the pause menu (the mouse is free).
      if (s.phase !== 'title' && s.overlay === null && !s.reflectionPromptVisible && !s.endingVisible) openOverlay('pause')
    }
    gl.xr.addEventListener('sessionstart', onStart)
    gl.xr.addEventListener('sessionend', onEnd)
    return () => {
      gl.xr.removeEventListener('sessionstart', onStart)
      gl.xr.removeEventListener('sessionend', onEnd)
      listeners.forEach((f) => f())
      slots.length = 0
      xr.rig = null
    }
  }, [gl, camera, scene, skin])

  // The rig only carries the camera and controller spaces; the hand visuals are
  // posed in world space, so they live beside it.
  return (
    <>
      <group ref={rig} name="xr-rig" />
      <TrackedHands skin={skin} />
      {hasModel('hand-fp') &&
        (['left', 'right'] as const).map((s) => (
          <Quiet key={s}>
            <Suspense fallback={null}>
              <ControllerHand side={s} skin={skin} />
            </Suspense>
          </Quiet>
        ))}
      <Rays />
    </>
  )
}
