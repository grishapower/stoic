import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  SphereGeometry,
  Vector2,
  Vector3,
  type Material,
  type Object3D,
} from 'three'
import { fruits, fruitView } from '../interaction/fruits'
import { hand } from '../interaction/hand'
import { useGame } from '../store'
import { FRUIT_INFO, FRUIT_KIND } from '../world/citrus'
import { rng } from '../world/noise'
import { QUALITY } from './quality'

/**
 * Renders every fruit that is not in the hand (on trees, falling, on the ground)
 * as instanced meshes (full model near the camera, a light sphere further
 * away). Uses the Meshy fruit model when available, otherwise a procedural
 * dimpled citrus.
 */

const modelsModules = import.meta.glob('../../data/generated/models.json', { eager: true, import: 'default' })
const models = (Object.values(modelsModules)[0] ?? {}) as Record<string, { file: string }>
const MODEL_ID = FRUIT_KIND === 'citron' ? 'citron-fruit' : 'mandarin-fruit'
export const FRUIT_MODEL_URL = models[MODEL_ID] ? import.meta.env.BASE_URL + models[MODEL_ID].file : null

/** Tileable dimpled-peel normal map. */
function peelNormalMap(): CanvasTexture {
  const s = 128
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  g.fillStyle = 'rgb(128,128,255)'
  g.fillRect(0, 0, s, s)
  const rand = rng(5)
  for (let i = 0; i < 420; i++) {
    const x = rand() * s
    const y = rand() * s
    const r = 1.5 + rand() * 2.5
    for (const [ox, oy] of [[0, 0], [-s, 0], [s, 0], [0, -s], [0, s]]) {
      const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r)
      grd.addColorStop(0, 'rgb(128,128,235)')
      grd.addColorStop(0.6, 'rgb(150,150,255)')
      grd.addColorStop(1, 'rgba(128,128,255,0)')
      g.fillStyle = grd
      g.beginPath()
      g.arc(x + ox, y + oy, r, 0, Math.PI * 2)
      g.fill()
    }
  }
  const t = new CanvasTexture(c)
  t.colorSpace = NoColorSpace
  t.wrapS = t.wrapT = RepeatWrapping
  t.repeat.set(4, 2)
  return t
}

export interface FruitLook {
  geometry: BufferGeometry
  material: Material
}

export function proceduralFruit(): FruitLook {
  const info = FRUIT_INFO[FRUIT_KIND]
  const g = new SphereGeometry(info.radius, 24, 16)
  g.scale(1, info.elong, 1)
  // Gentle irregularity (citrons are knobbly).
  const p = g.getAttribute('position')
  const bump = FRUIT_KIND === 'citron' ? 0.08 : 0.025
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    const k = 1 + bump * Math.sin(x * 140) * Math.sin(y * 120) * Math.sin(z * 150)
    p.setXYZ(i, x * k, y * k, z * k)
  }
  g.computeVertexNormals()
  const m = new MeshStandardMaterial({
    color: new Color(info.color),
    roughness: 0.42,
    metalness: 0,
    normalMap: peelNormalMap(),
    normalScale: new Vector2(0.45, 0.45),
  })
  return { geometry: g, material: m }
}

function firstMesh(root: Object3D): Mesh | null {
  let found: Mesh | null = null
  root.traverse((o) => {
    if (!found && (o as Mesh).isMesh) found = o as Mesh
  })
  return found
}

const m4 = new Matrix4()
const white = new Color(1, 1, 1)
const glow = new Color()
const tmpScale = new Vector3(1, 1, 1)
const camPos = new Vector3()
const lastCam = new Vector3(Infinity, 0, 0)

/**
 * Light stand-in for distant fruit: a low sphere fitted to the model's bounds
 * in the fruit's plain peel colour — at a few metres a fruit is a few pixels.
 */
function farFruit(look: FruitLook): FruitLook {
  const src = look.geometry
  if (!src.boundingBox) src.computeBoundingBox()
  const bb = src.boundingBox!
  const g = new SphereGeometry(1, 7, 5)
  g.scale((bb.max.x - bb.min.x) * 0.47, (bb.max.y - bb.min.y) * 0.47, (bb.max.z - bb.min.z) * 0.47)
  g.translate((bb.max.x + bb.min.x) / 2, (bb.max.y + bb.min.y) / 2, (bb.max.z + bb.min.z) / 2)
  const material = new MeshStandardMaterial({ color: new Color(FRUIT_INFO[FRUIT_KIND].color), roughness: 0.45, metalness: 0 })
  return { geometry: g, material }
}

function finishPack(m: InstancedMesh) {
  m.instanceMatrix.needsUpdate = true
  m.instanceColor!.needsUpdate = true
  m.computeBoundingSphere()
  m.visible = m.count > 0
}

/**
 * Every fruit not in the hand, in two instanced meshes: the full model close to
 * the camera (casts shadows) and a light sphere beyond `fruitDetail`
 * (quality.ts). Slots are re-packed only when a fruit moved, the camera moved
 * or the highlighted fruit changed.
 */
function FruitInstances({ look }: { look: FruitLook }) {
  const quality = useGame((s) => s.settings.quality)
  const res = useMemo(() => {
    const lo = farFruit(look)
    const make = (l: FruitLook, cast: boolean, name: string) => {
      const inst = new InstancedMesh(l.geometry, l.material, fruits.length)
      inst.castShadow = cast
      inst.receiveShadow = true
      inst.name = name
      for (let i = 0; i < fruits.length; i++) inst.setColorAt(i, white)
      inst.count = 0
      return inst
    }
    return { near: make(look, true, 'fruit:near'), far: make(lo, false, 'fruit:far'), lo }
  }, [look])
  const versions = useRef<number[]>(fruits.map(() => -1))
  const slot = useRef<{ mesh: InstancedMesh | null; i: number }[]>(fruits.map(() => ({ mesh: null, i: 0 })))
  const lastTarget = useRef<number>(-1)
  const lastQuality = useRef<string>('')

  useEffect(
    () => () => {
      res.near.dispose()
      res.far.dispose()
      res.lo.geometry.dispose()
      res.lo.material.dispose()
    },
    [res],
  )

  useFrame((state) => {
    const { near, far } = res
    state.camera.getWorldPosition(camPos)
    let dirty = lastQuality.current !== quality || camPos.distanceToSquared(lastCam) > 0.09
    for (const f of fruits) {
      if (versions.current[f.id] === f.version) continue
      versions.current[f.id] = f.version
      dirty = true
    }
    const tid = hand.target ? hand.target.id : -1
    if (tid !== lastTarget.current) dirty = true
    if (dirty) {
      lastQuality.current = quality
      lastCam.copy(camPos)
      const r2 = QUALITY[quality].fruitDetail ** 2
      let nn = 0
      let nf = 0
      for (const f of fruits) {
        const sl = slot.current[f.id]
        if (f.state === 'held' && !fruitView.showHeld) {
          sl.mesh = null
          continue
        }
        m4.compose(f.pos, f.rot, tmpScale)
        // The fruit in the hand / under the cursor is always the full model.
        const full = f.state === 'held' || f.id === tid || f.pos.distanceToSquared(camPos) < r2
        const mesh = full ? near : far
        const i = full ? nn++ : nf++
        mesh.setMatrixAt(i, m4)
        mesh.setColorAt(i, white)
        sl.mesh = mesh
        sl.i = i
      }
      near.count = nn
      far.count = nf
      finishPack(near)
      finishPack(far)
    }
    // Soft pulse on the fruit under the cursor (a re-pack above restores the others' colour).
    if (tid >= 0) {
      const sl = slot.current[tid]
      if (sl.mesh) {
        sl.mesh.setColorAt(sl.i, glow.setScalar(1.25 + 0.2 * Math.sin(state.clock.elapsedTime * 5)))
        sl.mesh.instanceColor!.needsUpdate = true
      }
    }
    lastTarget.current = tid
  })

  return (
    <>
      <primitive object={res.near} />
      <primitive object={res.far} />
    </>
  )
}

function GltfFruits({ url }: { url: string }) {
  const gltf = useGLTF(url, false, true)
  const look = useMemo<FruitLook>(() => {
    const m = firstMesh(gltf.scene)
    if (!m) return proceduralFruit()
    m.updateWorldMatrix(true, false)
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld)
    return { geometry: g, material: m.material as Material }
  }, [gltf])
  return <FruitInstances look={look} />
}

class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function ProceduralFruits() {
  const look = useMemo(() => proceduralFruit(), [])
  useEffect(
    () => () => {
      look.geometry.dispose()
      look.material.dispose()
    },
    [look],
  )
  return <FruitInstances look={look} />
}

export function Fruits() {
  if (!FRUIT_MODEL_URL) return <ProceduralFruits />
  return (
    <Fallback fallback={<ProceduralFruits />}>
      <Suspense fallback={<ProceduralFruits />}>
        <GltfFruits url={FRUIT_MODEL_URL} />
      </Suspense>
    </Fallback>
  )
}
