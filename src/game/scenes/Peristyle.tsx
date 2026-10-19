import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Sphere,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Group,
  type Mesh,
} from 'three'
import { globalUniforms } from '../materials/common'
import { useArchMaterials } from '../materials/library'
import { ENTABLATURE, GARDEN_FLOOR, PORTICO_FLOOR } from '../world/architecture'
import { rng } from '../world/noise'
import { BIRD_BATH, CAT, CITRON_BASKET, EROS_STATUE, OSCILLA, PORTICO_BENCH } from '../world/props'
import { GeoBuilder } from './geom/builder'
import { CullGroup } from './CullGroup'
import { useStaticGeometry } from './staticGeometry'
import { GlbProp, hasModel, modelInfo, modelUrl, Quiet } from './Props'
import { useGame } from '../store'

/**
 * Peristyle life (concept c02): oscilla turning between the columns, a bird
 * bath, a sleeping Eros among the flowers, a marble bench in the north
 * portico with a sleeping cat, and a basket of freshly picked citrons.
 */

/* ------------------------------------------------------------ Oscilla */

let oscillumTex: { map: CanvasTexture; bump: CanvasTexture } | null = null

/** A theatre mask in low relief on a marble disc (colour + bump). */
function oscillumTextures() {
  if (oscillumTex) return oscillumTex
  const draw = (relief: boolean) => {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const g = c.getContext('2d')!
    const tone = (v: number, warm: string) => (relief ? `rgb(${v},${v},${v})` : warm)
    g.fillStyle = tone(110, '#e4dccb')
    g.fillRect(0, 0, 256, 256)
    // Raised moulded rim.
    g.lineWidth = 16
    g.strokeStyle = tone(200, '#f1ece2')
    g.beginPath()
    g.arc(128, 128, 110, 0, Math.PI * 2)
    g.stroke()
    g.lineWidth = 3
    g.strokeStyle = tone(60, '#c9bfac')
    g.beginPath()
    g.arc(128, 128, 99, 0, Math.PI * 2)
    g.stroke()
    // Wreath of hair/ivy around the brow and down the cheeks.
    for (let i = 0; i < 15; i++) {
      const a = Math.PI * (0.92 + (i / 14) * 1.16)
      const r = 64 + (i % 2) * 6
      const cx = 128 + Math.cos(a) * r
      const cy = 126 + Math.sin(a) * r * 1.05
      const grad = g.createRadialGradient(cx - 3, cy - 3, 1, cx, cy, 13)
      grad.addColorStop(0, tone(235, '#f4efe5'))
      grad.addColorStop(1, tone(120, '#d8cebb'))
      g.fillStyle = grad
      g.beginPath()
      g.arc(cx, cy, 12, 0, Math.PI * 2)
      g.fill()
    }
    // Face: soft dome, lit from the upper left.
    const face = g.createRadialGradient(112, 112, 8, 128, 136, 70)
    face.addColorStop(0, tone(245, '#f7f3ea'))
    face.addColorStop(1, tone(150, '#dcd2bf'))
    g.fillStyle = face
    g.beginPath()
    g.ellipse(128, 138, 50, 62, 0, 0, Math.PI * 2)
    g.fill()
    // Brow ridge, nose and cheeks as raised strokes.
    g.lineCap = 'round'
    g.strokeStyle = tone(235, '#f9f6ef')
    g.lineWidth = 5
    g.beginPath()
    g.moveTo(96, 116)
    g.quadraticCurveTo(112, 104, 126, 114)
    g.moveTo(130, 114)
    g.quadraticCurveTo(144, 104, 160, 116)
    g.moveTo(128, 118)
    g.lineTo(125, 148)
    g.stroke()
    // Almond eyes and the wide open mouth (drilled, dark).
    g.fillStyle = tone(30, '#6f6555')
    for (const [ex, flip] of [
      [110, -1],
      [146, 1],
    ]) {
      g.beginPath()
      g.ellipse(ex, 126, 11, 5.5, flip * 0.12, 0, Math.PI * 2)
      g.fill()
    }
    g.beginPath()
    g.moveTo(108, 166)
    g.quadraticCurveTo(128, 154, 148, 166)
    g.quadraticCurveTo(128, 186, 108, 166)
    g.fill()
    // Shadow side of the relief.
    g.strokeStyle = tone(70, 'rgba(120,108,90,0.55)')
    g.lineWidth = 3
    g.beginPath()
    g.ellipse(128, 138, 50, 62, 0, -0.3, Math.PI * 0.75)
    g.stroke()
    const t = new CanvasTexture(c)
    if (!relief) t.colorSpace = SRGBColorSpace
    return t
  }
  oscillumTex = { map: draw(false), bump: draw(true) }
  return oscillumTex
}

const OSC_R = 0.19
const RING_Y_BELOW = 0.62 // ring this far below the entablature soffit

/** Disc meshes driven by Oscilla's frame loop: one InstancedMesh per model sub-mesh (or the procedural ring + disc). */
interface DiscSlot {
  mesh: InstancedMesh
  /** Sub-mesh transform inside the swinging disc frame. */
  rel: Matrix4
}

const OSCILLA_BOUNDS = new Sphere(new Vector3(0, 3, 30), 13)

/** The swinging transforms (plain Object3Ds, not in the scene) and the instanced meshes they drive. */
class OscillaRig {
  readonly pivots: Object3D[] = []
  readonly discs: Object3D[] = []
  /** Disc meshes in use (model or procedural). */
  slots: DiscSlot[] = []
  readonly chains: InstancedMesh
  private readonly m = new Matrix4()

  constructor(top: number, chains: InstancedMesh) {
    this.chains = chains
    for (const o of OSCILLA) {
      const pivot = new Object3D()
      pivot.position.set(o.x, top, o.z)
      const disc = new Object3D()
      disc.position.set(0, -RING_Y_BELOW, 0)
      pivot.add(disc)
      this.pivots.push(pivot)
      this.discs.push(disc)
    }
  }

  update(t: number, wind: number) {
    for (let i = 0; i < OSCILLA.length; i++) {
      const ph = i * 1.7
      const pivot = this.pivots[i]
      const disc = this.discs[i]
      pivot.rotation.z = (0.025 + wind * 0.05) * Math.sin(t * 1.15 + ph) * (0.6 + 0.4 * Math.sin(t * 0.17 + ph))
      pivot.rotation.x = (0.015 + wind * 0.03) * Math.sin(t * 0.93 + ph * 1.3)
      // Oscilla slowly turn in the breeze, flashing their two faces.
      disc.rotation.y = Math.sin(t * 0.21 + ph) * 1.1 + Math.sin(t * 0.07 + ph * 2) * 0.8
      pivot.updateMatrixWorld(true)
      this.chains.setMatrixAt(i, pivot.matrixWorld)
      for (const d of this.slots) d.mesh.setMatrixAt(i, this.m.multiplyMatrices(disc.matrixWorld, d.rel))
    }
    this.chains.instanceMatrix.needsUpdate = true
    for (const d of this.slots) d.mesh.instanceMatrix.needsUpdate = true
  }

  /** Switch the disc meshes being driven (model ↔ procedural) and their shadows. */
  use(slots: DiscSlot[], cast: boolean) {
    this.slots = slots
    for (const d of slots) d.mesh.castShadow = cast
  }
}

/** The Meshy oscillum, instanced: 8 swinging discs in one draw call per sub-mesh. */
function OscillumModel({ onMeshes }: { onMeshes: (slots: DiscSlot[]) => void }) {
  const gltf = useGLTF(modelUrl('oscillum'), false, true)
  const meshes = useMemo(() => {
    const out: DiscSlot[] = []
    const scene = gltf.scene.clone(true)
    scene.updateMatrixWorld(true)
    scene.traverse((o) => {
      const m = o as Mesh
      if (!m.isMesh) return
      const material = (m.material as MeshStandardMaterial).clone()
      if ('roughness' in material) material.roughness = Math.max(material.roughness, 0.55)
      const inst = new InstancedMesh(m.geometry, material, OSCILLA.length)
      inst.receiveShadow = true
      inst.boundingSphere = OSCILLA_BOUNDS
      out.push({ mesh: inst, rel: m.matrixWorld.clone() })
    })
    return out
  }, [gltf])
  useEffect(() => {
    onMeshes(meshes)
    return () => {
      onMeshes([])
      for (const d of meshes) {
        ;(d.mesh.material as MeshStandardMaterial).dispose()
        d.mesh.dispose()
      }
    }
  }, [meshes, onMeshes])
  return (
    <>
      {meshes.map((d) => (
        <primitive key={d.mesh.uuid} object={d.mesh} />
      ))}
    </>
  )
}

/**
 * Oscilla swinging between the columns. The pivots are plain transforms; chains
 * and discs are instanced (2–3 draw calls for all eight instead of sixteen).
 */
function Oscilla() {
  // The light (VR) preset hangs the procedural discs (~300 instead of ~6.6k triangles each) and drops their shadows.
  const light = useGame((s) => s.settings.quality === 'low')
  const useGlb = hasModel('oscillum') && !light
  const top = PORTICO_FLOOR + ENTABLATURE.bottom
  const res = useMemo(() => {
    const { map, bump } = oscillumTextures()
    const marble = new MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 2, roughness: 0.6, metalness: 0 })
    const bronze = new MeshStandardMaterial({ color: '#6b4a2a', roughness: 0.45, metalness: 0.75 })
    const disc = new CylinderGeometry(OSC_R, OSC_R, 0.035, 36)
    disc.rotateX(Math.PI / 2)
    const ring = new TorusGeometry(0.024, 0.005, 6, 16)
    const chain = new CylinderGeometry(0.004, 0.004, RING_Y_BELOW - 0.03, 4)
    chain.translate(0, -(RING_Y_BELOW - 0.03) / 2, 0)
    const chains = new InstancedMesh(chain, bronze, OSCILLA.length)
    chains.boundingSphere = OSCILLA_BOUNDS
    // Procedural stand-in (no model / light preset): ring + relief disc.
    const proc: DiscSlot[] = [
      { mesh: new InstancedMesh(ring, bronze, OSCILLA.length), rel: new Matrix4().makeTranslation(0, -0.012, 0) },
      { mesh: new InstancedMesh(disc, marble, OSCILLA.length), rel: new Matrix4().makeTranslation(0, -0.03 - OSC_R, 0) },
    ]
    proc[1].mesh.castShadow = true
    for (const d of proc) d.mesh.boundingSphere = OSCILLA_BOUNDS
    return { marble, bronze, disc, ring, chain, proc, rig: new OscillaRig(top, chains) }
  }, [top])
  const onMeshes = useCallback(
    (slots: DiscSlot[]) => res.rig.use(slots, !light),
    [res, light],
  )
  useEffect(() => {
    if (!useGlb) onMeshes(res.proc)
  }, [res, useGlb, onMeshes])
  useEffect(
    () => () => {
      res.marble.dispose()
      res.bronze.dispose()
      res.disc.dispose()
      res.ring.dispose()
      res.chain.dispose()
      res.rig.chains.dispose()
      res.proc.forEach((d) => d.mesh.dispose())
    },
    [res],
  )
  useFrame(({ clock }) => res.rig.update(clock.elapsedTime, globalUniforms.uWind.value))
  return (
    <group>
      <primitive object={res.rig.chains} />
      {useGlb ? (
        <Quiet>
          <Suspense fallback={null}>
            <OscillumModel onMeshes={onMeshes} />
          </Suspense>
        </Quiet>
      ) : (
        res.proc.map((d) => <primitive key={d.mesh.uuid} object={d.mesh} />)
      )}
    </group>
  )
}

/* ------------------------------------------------------------ Bird bath */

function BirdBath({ marble }: { marble: MeshStandardMaterial }) {
  const res = useMemo(() => {
    // Profile (radius, height) from the foot up and over the rim into the bowl.
    const prof: [number, number][] = [
      [0.001, 0],
      [0.27, 0],
      [0.27, 0.06],
      [0.21, 0.1],
      [0.12, 0.15],
      [0.095, 0.22],
      [0.088, 0.56],
      [0.1, 0.62],
      [0.15, 0.69],
      [0.3, 0.81],
      [0.41, 0.885],
      [0.445, 0.93],
      [0.445, 0.95],
      [0.41, 0.955],
      [0.37, 0.92],
      [0.22, 0.88],
      [0.001, 0.87],
    ]
    const lathe = new LatheGeometry(
      prof.map(([r, y]) => new Vector2(r, y)),
      40,
    )
    lathe.computeVertexNormals()
    const water = new CircleGeometry(0.385, 40)
    water.rotateX(-Math.PI / 2)
    const waterMat = new MeshStandardMaterial({ color: '#4a6470', roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.86 })
    return { lathe, water, waterMat }
  }, [])
  useEffect(
    () => () => {
      res.lathe.dispose()
      res.water.dispose()
      res.waterMat.dispose()
    },
    [res],
  )
  return (
    <group position={[BIRD_BATH.x, GARDEN_FLOOR, BIRD_BATH.z]}>
      <mesh geometry={res.lathe} material={marble} castShadow receiveShadow />
      <mesh geometry={res.water} material={res.waterMat} position={[0, 0.915, 0]} receiveShadow />
    </group>
  )
}

/* ------------------------------------------------------------ Bench, cat, basket */

const BENCH = { length: 1.5, depth: 0.46, seat: 0.5 }

function buildBench(): Map<string, BufferGeometry> {
  const b = new GeoBuilder()
  const { x, z, rotY } = PORTICO_BENCH
  const c = Math.cos(rotY)
  const s = Math.sin(rotY)
  const L = (lx: number, ly: number, lz: number): [number, number, number] => [x + lx * c + lz * s, ly, z - lx * s + lz * c]
  const y = PORTICO_FLOOR
  b.color = [0.97, 0.95, 0.91]
  b.orientedBox(L(0, y + BENCH.seat - 0.04, 0), [BENCH.length, 0.08, BENCH.depth], rotY, 'marble')
  for (const lx of [-0.58, 0.58]) {
    // Supports carved as lion legs: a block with a scroll on top.
    b.orientedBox(L(lx, y + 0.21, 0), [0.14, 0.42, BENCH.depth - 0.08], rotY, 'marble')
    b.orientedBox(L(lx, y + 0.03, 0.02), [0.2, 0.06, BENCH.depth - 0.02], rotY, 'marble')
  }
  return b.build()
}

/** Citrons heaped in a basket (fallback when the Meshy basket is missing). */
function CitronHeap({ basketH }: { basketH: number }) {
  const res = useMemo(() => {
    const geo = new SphereGeometry(0.045, 12, 9)
    geo.scale(1, 1.35, 1)
    const mat = new MeshStandardMaterial({ color: '#e2bf32', roughness: 0.55 })
    const rand = rng(77)
    const items: { p: [number, number, number]; r: [number, number, number] }[] = []
    for (let i = 0; i < 9; i++) {
      const a = rand() * Math.PI * 2
      const d = Math.sqrt(rand()) * 0.11
      items.push({
        p: [Math.cos(a) * d * 1.3, basketH * 0.75 + 0.03 + (i > 5 ? 0.05 : 0), Math.sin(a) * d],
        r: [rand() * 1.4 + 0.6, rand() * 6, rand() * 0.5],
      })
    }
    return { geo, mat, items }
  }, [basketH])
  useEffect(
    () => () => {
      res.geo.dispose()
      res.mat.dispose()
    },
    [res],
  )
  return (
    <group>
      {res.items.map((it, i) => (
        <mesh key={i} geometry={res.geo} material={res.mat} position={it.p} rotation={it.r} castShadow />
      ))}
    </group>
  )
}

function SleepingCat() {
  const g = useRef<Group>(null)
  // Slow breathing.
  useFrame(({ clock }) => {
    if (g.current) g.current.scale.y = 1 + 0.025 * Math.sin(clock.elapsedTime * 1.7)
  })
  if (!hasModel('cat-sleeping')) return null
  return (
    <group ref={g} position={[CAT.x, PORTICO_FLOOR + BENCH.seat, CAT.z]} rotation={[0, CAT.rotY, 0]}>
      <GlbProp id="cat-sleeping" position={[0, 0, 0]} />
    </group>
  )
}

/** Everything here sits inside the colonnade (12.5 m around the fountain); walls hide it from afar. */
const PERISTYLE_CENTER = [0, 1.5, 30] as const
const PERISTYLE_FAR = { high: Infinity, medium: 100, low: 30 }

export function Peristyle() {
  const mats = useArchMaterials()
  const bench = useMemo(() => buildBench(), [])
  useStaticGeometry(bench)
  const marble = useMemo(() => {
    // Lathe geometry carries no vertex colours.
    const m = mats.marble.clone()
    m.vertexColors = false
    return m
  }, [mats])
  useEffect(
    () => () => {
      bench.forEach((g) => g.dispose())
      marble.dispose()
    },
    [bench, marble],
  )
  const basketH = modelInfo('wicker-basket')?.size?.[1] ?? 0.12
  return (
    <CullGroup center={PERISTYLE_CENTER} radius={13} far={PERISTYLE_FAR}>
      <Oscilla />
      <BirdBath marble={marble} />
      <SleepingCat />
      <GlbProp id="eros-sleeping" position={[EROS_STATUE.x, GARDEN_FLOOR, EROS_STATUE.z]} rotationY={EROS_STATUE.rotY} />
      {hasModel('citron-basket') ? (
        <GlbProp id="citron-basket" position={[CITRON_BASKET.x, PORTICO_FLOOR, CITRON_BASKET.z]} rotationY={CITRON_BASKET.rotY} />
      ) : (
        hasModel('wicker-basket') && (
          <group position={[CITRON_BASKET.x, PORTICO_FLOOR, CITRON_BASKET.z]} rotation={[0, CITRON_BASKET.rotY, 0]}>
            <GlbProp id="wicker-basket" position={[0, 0, 0]} />
            <CitronHeap basketH={basketH} />
          </group>
        )
      )}
    </CullGroup>
  )
}
