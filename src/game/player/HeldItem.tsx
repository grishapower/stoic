import { useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector3,
  DoubleSide,
  type Material,
  type Object3D,
} from 'three'
import { hand } from '../interaction/hand'
import { xr } from '../xr/xrState'
import { runtime } from '../runtime'
import { FRUIT_INFO, FRUIT_KIND } from '../world/citrus'
import { damp } from '../world/noise'
import { FRUIT_MODEL_URL, proceduralFruit } from '../scenes/Fruits'

/**
 * First-person hand holding the picked fruit (desktop presentation).
 * Attached to the camera; slides in on grab, out on release; "R" brings it
 * closer and turns it slowly so the fruit can be looked at.
 */

interface HandEntry {
  file: string
  gripPoint?: [number, number, number]
  fruitRadius?: number
  fruitCenter?: [number, number, number]
  fruitSeats?: Record<string, { position: [number, number, number]; rotationDeg: [number, number, number] }>
}
const modelsModules = import.meta.glob('../../data/generated/models.json', { eager: true, import: 'default' })
const models = (Object.values(modelsModules)[0] ?? {}) as Record<string, HandEntry>
const HAND = models['hand-fp']
const HAND_URL = HAND ? import.meta.env.BASE_URL + HAND.file : null

const REST = new Vector3(0.19, -0.205, -0.44)
const INSPECT = new Vector3(0.03, -0.09, -0.31)
const HIDDEN = new Vector3(0.24, -0.62, -0.44)

/** Procedural cupped right hand (fallback): palm up (+Y), fingers toward −Z, thumb toward +X. */
function ProceduralHand() {
  const res = useMemo(() => {
    const skin = new MeshStandardMaterial({ color: '#c4987c', roughness: 0.62 })
    const palm = new CapsuleGeometry(0.036, 0.03, 6, 12)
    palm.rotateX(Math.PI / 2)
    palm.scale(1.15, 0.42, 1)
    const phal = [new CapsuleGeometry(0.0098, 0.03, 4, 8), new CapsuleGeometry(0.009, 0.018, 4, 8), new CapsuleGeometry(0.0082, 0.012, 4, 8)]
    for (const g of phal) g.rotateX(Math.PI / 2)
    const wrist = new CylinderGeometry(0.029, 0.033, 0.09, 14)
    wrist.rotateX(Math.PI / 2)
    return { skin, palm, phal, wrist }
  }, [])
  useEffect(
    () => () => {
      res.skin.dispose()
      res.palm.dispose()
      res.phal.forEach((g) => g.dispose())
      res.wrist.dispose()
    },
    [res],
  )
  // Finger bases along the front edge of the palm (index on the thumb side).
  const fingers: { x: number; len: number; curl: number }[] = [
    { x: 0.029, len: 1.0, curl: 0.55 },
    { x: 0.01, len: 1.08, curl: 0.6 },
    { x: -0.009, len: 1.03, curl: 0.62 },
    { x: -0.027, len: 0.86, curl: 0.66 },
  ]
  const seg = [0.03, 0.022, 0.016]
  const finger = (f: { x: number; len: number; curl: number }, i: number) => (
    <group key={i} position={[f.x, -0.006, -0.036]} rotation={[f.curl * 0.6, 0, 0]}>
      <mesh geometry={res.phal[0]} material={res.skin} position={[0, 0, (-seg[0] * f.len) / 2]} />
      <group position={[0, 0, -seg[0] * f.len]} rotation={[f.curl, 0, 0]}>
        <mesh geometry={res.phal[1]} material={res.skin} position={[0, 0, (-seg[1] * f.len) / 2]} />
        <group position={[0, 0, -seg[1] * f.len]} rotation={[f.curl * 0.8, 0, 0]}>
          <mesh geometry={res.phal[2]} material={res.skin} position={[0, 0, (-seg[2] * f.len) / 2]} />
        </group>
      </group>
    </group>
  )
  return (
    <group>
      <mesh geometry={res.palm} material={res.skin} position={[0, -0.012, 0.004]} />
      <mesh geometry={res.wrist} material={res.skin} position={[0.002, -0.016, 0.075]} />
      {fingers.map(finger)}
      {/* Thumb: out to +X, slightly forward, curling up. */}
      <group position={[0.038, -0.008, 0.012]} rotation={[0.25, -1.0, 0.35]}>
        <mesh geometry={res.phal[0]} material={res.skin} position={[0, 0, -0.016]} />
        <group position={[0, 0, -0.03]} rotation={[0.45, 0, 0]}>
          <mesh geometry={res.phal[1]} material={res.skin} position={[0, 0, -0.011]} />
        </group>
      </group>
    </group>
  )
}

function GltfHand({ url }: { url: string }) {
  const gltf = useGLTF(url, false, true)
  const obj = useMemo(() => {
    const g = gltf.scene.clone(true)
    g.traverse((o: Object3D) => {
      const m = o as Mesh
      if (m.isMesh) {
        m.castShadow = false
        m.receiveShadow = true
        m.frustumCulled = false
      }
    })
    return g
  }, [gltf])
  return <primitive object={obj} />
}

class Quiet extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function HeldFruit() {
  const gltf = FRUIT_MODEL_URL ? <GltfHeldFruit url={FRUIT_MODEL_URL} /> : null
  return gltf ? (
    <Quiet fallback={<ProceduralHeldFruit />}>
      <Suspense fallback={<ProceduralHeldFruit />}>{gltf}</Suspense>
    </Quiet>
  ) : (
    <ProceduralHeldFruit />
  )
}

function GltfHeldFruit({ url }: { url: string }) {
  const gltf = useGLTF(url, false, true)
  const obj = useMemo(() => gltf.scene.clone(true), [gltf])
  return <primitive object={obj} />
}

function ProceduralHeldFruit() {
  const res = useMemo(() => {
    const f = proceduralFruit()
    const leafMat = new MeshStandardMaterial({ color: '#2f5a28', roughness: 0.5, side: DoubleSide })
    const stemMat = new MeshStandardMaterial({ color: '#4b5a2a', roughness: 0.8 })
    const leaf = new PlaneGeometry(0.03, 0.06)
    const stem = new ConeGeometry(0.004, 0.012, 6)
    return { f, leafMat, stemMat, leaf, stem }
  }, [])
  useEffect(
    () => () => {
      res.f.geometry.dispose()
      res.f.material.dispose()
      res.leafMat.dispose()
      res.stemMat.dispose()
      res.leaf.dispose()
      res.stem.dispose()
    },
    [res],
  )
  const r = FRUIT_INFO[FRUIT_KIND].radius * FRUIT_INFO[FRUIT_KIND].elong
  return (
    <group>
      <mesh geometry={res.f.geometry} material={res.f.material as Material} />
      <mesh geometry={res.stem} material={res.stemMat} position={[0, r + 0.004, 0]} />
      <mesh geometry={res.leaf} material={res.leafMat} position={[0.012, r + 0.02, 0.006]} rotation={[0.5, 0.4, -0.7]} />
    </group>
  )
}

export function HeldItem() {
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const root = useRef<Group>(null)
  const fruitRef = useRef<Group>(null)
  const shown = useRef(0)
  const pos = useRef(HIDDEN.clone())
  const target = useRef(new Vector3())

  // The camera must be in the scene graph for its children to render.
  useEffect(() => {
    if (!camera.parent) scene.add(camera)
    const g = root.current
    if (g) camera.add(g)
    return () => {
      if (g) camera.remove(g)
    }
  }, [camera, scene])

  // Where the fruit rests in the palm: measured seat for the Meshy hand+fruit, else on the grip point.
  const seat = HAND_URL && FRUIT_MODEL_URL ? HAND?.fruitSeats?.[FRUIT_KIND === 'citron' ? 'citron-fruit' : 'mandarin-fruit'] : undefined
  const r = FRUIT_INFO[FRUIT_KIND].radius * FRUIT_INFO[FRUIT_KIND].elong
  const fruitPos: [number, number, number] = seat?.position ?? (HAND?.fruitCenter as [number, number, number] | undefined) ?? [0, r + 0.004, 0]
  const d2r = Math.PI / 180
  // Mandarin leaves stick out along ±X; turn them along the fingers so they don't clip the thumb.
  const fruitRot: [number, number, number] = seat
    ? [seat.rotationDeg[0] * d2r, seat.rotationDeg[1] * d2r + (FRUIT_KIND === 'mandarin' ? Math.PI / 2 : 0), seat.rotationDeg[2] * d2r]
    : [0, Math.PI / 2, 0]

  useFrame((state, dt) => {
    const g = root.current
    if (!g) return
    // In VR the fruit is held by the tracked hands instead (src/game/xr).
    const holding = !!hand.held && !xr.presenting
    shown.current += ((holding ? 1 : 0) - shown.current) * damp(9, dt)
    g.visible = shown.current > 0.01
    if (!g.visible) return
    target.current.copy(hand.inspecting ? INSPECT : REST)
    if (!holding) target.current.copy(HIDDEN)
    // Gentle bob while walking, slow breathing sway otherwise.
    const t = state.clock.elapsedTime
    const walk = Math.min(1, runtime.player.speed / 1.45)
    target.current.y += Math.sin(t * 6.2) * 0.006 * walk + Math.sin(t * 1.3) * 0.002
    target.current.x += Math.sin(t * 3.1) * 0.004 * walk
    pos.current.lerp(target.current, damp(hand.inspecting ? 5 : 8, dt))
    g.position.copy(pos.current)
    // Present the palm a bit toward the viewer; turn it more when inspecting.
    const insp = hand.inspecting ? 1 : 0
    g.rotation.set(0.32 + insp * 0.35, -0.25 + insp * 0.15, -0.12 + insp * 0.1)
    if (fruitRef.current) fruitRef.current.rotation.y += dt * (hand.inspecting ? 0.6 : 0)
  })

  return (
    <group ref={root} visible={false}>
      {HAND_URL ? (
        <Quiet fallback={<ProceduralHand />}>
          <Suspense fallback={<ProceduralHand />}>
            <GltfHand url={HAND_URL} />
          </Suspense>
        </Quiet>
      ) : (
        <ProceduralHand />
      )}
      <group position={fruitPos}>
        <group ref={fruitRef} rotation={fruitRot}>
          <HeldFruit />
        </group>
      </group>
    </group>
  )
}
