import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  Points,
  PointsMaterial,
  Quaternion,
  Sphere,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Material,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { game, useGame } from '../store'
import { evening } from '../world/evening'
import { SEA_LEVEL } from '../world/layout'
import { fbm, rng, smoothstep } from '../world/noise'
import { BOAT_ROUTES, HARBOUR, LIGHTHOUSE, VESUVIUS } from '../world/props'
import { applyDirectionalFog } from './atmosphere'
import { GeoBuilder } from './geom/builder'
import { Puffs } from './geom/puffs'
import { hasModel } from './Props'
import { QUALITY } from './quality'

/**
 * The bay seen from the terrace: Somma-Vesuvius before 79 AD, the harbour town
 * on its coastal plain (windows light up as the sun sets), a lighthouse whose
 * fire is lit at dusk, hearth smoke, and boats heading home.
 */

/* ------------------------------------------------------------ Landmass */

/** Height of the far shore (Vesuvius + coastal plain + lighthouse headland). */
export function vesuviusHeight(x: number, z: number) {
  const dx = x - VESUVIUS.x
  const dz = z - VESUVIUS.z
  const r = Math.hypot(dx, dz) / VESUVIUS.radius
  const ang = Math.atan2(dz, dx)
  const n = fbm(x * 0.0012 + 3, z * 0.0012 - 1, 5)
  const n2 = fbm(x * 0.004 - 7, z * 0.004 + 2, 3)
  // Asymmetric broad cone: the summit is offset away from the bay.
  const sx = dx - VESUVIUS.radius * 0.08
  const sz = dz - VESUVIUS.radius * 0.1
  const rs = Math.hypot(sx, sz) / VESUVIUS.radius
  const cone = Math.pow(smoothstep(0.9, 0.03, rs + n * 0.05), 1.7)
  // Monte Somma: an older ridge arcing around the far side of the summit, a second peak.
  const somma = 0.35 * Math.exp(-Math.pow((rs - 0.2) / 0.07, 2)) * smoothstep(-0.2, 0.9, Math.cos(ang - 0.9))
  const mountain = VESUVIUS.height * (cone + somma) * (0.9 + 0.16 * n)
  // Coastal plain at the foot, then the shore.
  const plain = 9 * smoothstep(0.935, 0.86, r) + 14 * smoothstep(0.9, 0.7, r)
  const shore = -14 * smoothstep(0.92, 1.0, r)
  // Ravines (barrancos) down the slopes and gentle undulation.
  const rv = Math.pow(Math.abs(Math.sin(ang * 11 + n * 4 + rs * 6)), 10)
  const ravine = -70 * rv * smoothstep(0.85, 0.25, rs) * smoothstep(0.04, 0.22, rs)
  const bumps = n2 * 22 * smoothstep(0.92, 0.5, r)
  // Rocky headland for the lighthouse.
  const hd = Math.hypot(x - LIGHTHOUSE.x, z - LIGHTHOUSE.z)
  const headland = 26 * Math.exp(-(hd * hd) / (85 * 85))
  return SEA_LEVEL - 2 + mountain + plain + shore + ravine + bumps + headland
}

function buildLandmass(N = 150): BufferGeometry {
  const R = VESUVIUS.radius * 1.03
  const step = (R * 2) / N
  const pos: number[] = []
  const col: number[] = []
  const x0 = VESUVIUS.x - R
  const z0 = VESUVIUS.z - R
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = x0 + i * step
      const z = z0 + j * step
      const y = vesuviusHeight(x, z)
      pos.push(x, y, z)
      const r = Math.hypot(x - VESUVIUS.x, z - VESUVIUS.z) / VESUVIUS.radius
      const above = y - SEA_LEVEL
      // Vineyards (striped light green) low, forest above, bare rock near the top.
      const stripe = 0.85 + 0.15 * Math.sin((x + z) * 0.09)
      const patch = fbm(x * 0.0025 + 11, z * 0.0025 - 4, 3)
      let c: [number, number, number] = patch > 0.08 ? [0.22, 0.3, 0.15] : [0.4 * stripe, 0.44 * stripe, 0.2]
      if (r < 0.5) c = patch > -0.15 ? [0.17, 0.25, 0.13] : [0.3, 0.33, 0.18]
      if (r < 0.14) c = [0.4, 0.35, 0.28]
      if (above < 10) c = [0.46, 0.43, 0.27]
      if (above < 2) c = [0.55, 0.5, 0.38]
      const v = 0.85 + 0.25 * fbm(x * 0.004, z * 0.004, 3)
      col.push(c[0] * v, c[1] * v, c[2] * v)
    }
  }
  const idx: number[] = []
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i
      idx.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/* ------------------------------------------------------------ Harbour town */

interface House {
  x: number
  y: number
  z: number
  w: number
  d: number
  h: number
  rot: number
  tint: number
}

function buildHouses(): House[] {
  const rand = rng(1717)
  const out: House[] = []
  let tries = 0
  while (out.length < 110 && tries++ < 6000) {
    const a = rand() * Math.PI * 2
    const r = Math.sqrt(rand()) * HARBOUR.radius
    const x = HARBOUR.x + Math.cos(a) * r
    const z = HARBOUR.z + Math.sin(a) * r
    const y = vesuviusHeight(x, z)
    if (y < SEA_LEVEL + 1.5 || y > SEA_LEVEL + 60) continue
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 15)) continue
    // Face the bay (roughly toward the villa).
    const rot = Math.atan2(-x, -(z + 50)) + (rand() - 0.5) * 0.5
    out.push({ x, y, z, w: 10 + rand() * 12, d: 9 + rand() * 9, h: 7 + rand() * 9, rot, tint: rand() })
  }
  return out
}

function houseGeometry() {
  // Unit house: walls 1×1×1 (bottom at 0) + hip roof on top (separate geometries for two materials).
  const b = new GeoBuilder()
  b.box([-0.5, -0.4, -0.5], [0.5, 1, 0.5], (f) => (f === 'ny' ? null : 'wall'))
  const geos = b.build()
  const wall = geos.get('wall')!
  const roof = new ConeGeometry(0.78, 0.38, 4, 1)
  roof.rotateY(Math.PI / 4)
  roof.translate(0, 1.19, 0)
  return { wall, roof }
}

/* ------------------------------------------------------------ Glow textures */

function glowTexture(inner: string, outer: string) {
  const s = 64
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  grd.addColorStop(0, inner)
  grd.addColorStop(0.35, outer)
  grd.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, s, s)
  return new CanvasTexture(c)
}

export function smokeTexture() {
  const s = 64
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  const rand = rng(8)
  for (let i = 0; i < 14; i++) {
    const x = s / 2 + (rand() - 0.5) * 18
    const y = s / 2 + (rand() - 0.5) * 18
    const r = 10 + rand() * 14
    const grd = g.createRadialGradient(x, y, 0, x, y, r)
    grd.addColorStop(0, 'rgba(230,226,220,0.22)')
    grd.addColorStop(1, 'rgba(230,226,220,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, s, s)
  }
  return new CanvasTexture(c)
}

/* ------------------------------------------------------------ Boats */

/** A light boat as ONE mesh (vertex colours): hull, mast, sail and, on a fishing boat, two fishermen. */
function proceduralBoat(kind: 'fishing' | 'merchant'): Group {
  const L = kind === 'fishing' ? 8 : 22
  const parts: BufferGeometry[] = []
  const tmp = new Object3D()
  const add = (geo: BufferGeometry, color: string, place: (o: Object3D) => void) => {
    tmp.position.set(0, 0, 0)
    tmp.rotation.set(0, 0, 0)
    tmp.scale.set(1, 1, 1)
    place(tmp)
    tmp.updateMatrix()
    const g = (geo.index ? geo.toNonIndexed() : geo).applyMatrix4(tmp.matrix)
    if (g !== geo) geo.dispose()
    g.deleteAttribute('uv')
    if (!g.getAttribute('normal')) g.computeVertexNormals()
    const c = new Color(color)
    const n = g.getAttribute('position').count
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3)
    g.setAttribute('color', new BufferAttribute(col, 3))
    parts.push(g)
  }
  const hullC = kind === 'fishing' ? '#5a3d28' : '#4a3020'
  add(new SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), hullC, (o) => o.scale.set(L * 0.16, L * 0.12, L * 0.5))
  add(new CylinderGeometry(0.05 * (L / 6), 0.07 * (L / 6), L * 0.75, 6), hullC, (o) => o.position.set(0, L * 0.37, kind === 'fishing' ? L * 0.08 : 0))
  if (kind === 'fishing') {
    // Lateen sail: a long triangle on a slanted yard.
    const tri = new BufferGeometry()
    tri.setAttribute('position', new BufferAttribute(new Float32Array([0, 0.6, -2.6, 0, 4.4, 1.6, 0, 0.7, 1.9]), 3))
    add(tri, '#e6dcc4', (o) => o.position.set(0.05, 0, 0))
    // Two fishermen (tiny silhouettes).
    add(new CylinderGeometry(0.17, 0.2, 1.05, 6), '#6b5a48', (o) => o.position.set(0, 0.55, -1.6))
    add(new CylinderGeometry(0.17, 0.2, 1.05, 6), '#6b5a48', (o) => o.position.set(0.2, 0.5, 1.2))
  } else {
    add(new CylinderGeometry(4.6, 4.6, 7.5, 12, 1, true, -0.5, 1.0), '#a5432c', (o) => {
      o.rotation.set(0, Math.PI, 0)
      o.position.set(0, L * 0.42, -3.6)
      o.scale.set(1, 1, 0.9)
    })
  }
  const geo = mergeGeometries(parts, false)!
  parts.forEach((p) => p.dispose())
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: DoubleSide })
  const g = new Group()
  g.add(new Mesh(geo, mat))
  return g
}

interface BoatProps {
  kind: 'fishing' | 'merchant'
  path: [number, number][]
  index: number
}

function BoatModel({ kind }: { kind: 'fishing' | 'merchant' }) {
  const id = kind === 'fishing' ? 'fishing-boat' : 'merchant-ship'
  // Hundreds of metres out a boat is a few pixels: the light procedural one on low quality.
  const models = useGame((s) => QUALITY[s.settings.quality].bayModels)
  if (models && hasModel(id)) {
    return (
      <Quiet fallback={<ProceduralBoat kind={kind} />}>
        <Suspense fallback={<ProceduralBoat kind={kind} />}>
          <GltfBoat id={id} />
        </Suspense>
      </Quiet>
    )
  }
  return <ProceduralBoat kind={kind} />
}

function ProceduralBoat({ kind }: { kind: 'fishing' | 'merchant' }) {
  const obj = useMemo(() => proceduralBoat(kind), [kind])
  useEffect(
    () => () =>
      obj.traverse((o) => {
        const m = o as Mesh
        if (m.isMesh) {
          m.geometry.dispose()
          ;(m.material as Material).dispose()
        }
      }),
    [obj],
  )
  return <primitive object={obj} />
}

const modelsModules = import.meta.glob('../../data/generated/models.json', { eager: true, import: 'default' })
const models = (Object.values(modelsModules)[0] ?? {}) as Record<string, { file: string; waterline?: number }>

function GltfBoat({ id }: { id: string }) {
  const gltf = useGLTF(import.meta.env.BASE_URL + models[id].file, false, true)
  const obj = useMemo(() => gltf.scene.clone(true), [gltf])
  const waterline = models[id].waterline ?? 0
  return <primitive object={obj} position={[0, -waterline, 0]} />
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

const tmpV = new Vector3()
const tmpT = new Vector3()

function Boat({ kind, path, index }: BoatProps) {
  const ref = useRef<Group>(null)
  const anchored = path.length === 1
  const curve = useMemo(
    () => new CatmullRomCurve3((anchored ? [path[0], [path[0][0] + 1, path[0][1] + 1] as [number, number]] : path).map(([x, z]) => new Vector3(x, SEA_LEVEL, z))),
    [path, anchored],
  )
  useFrame((state) => {
    const g = ref.current
    if (!g) return
    const t = state.clock.elapsedTime
    const ev = evening(game().progress)
    // Fishing boats follow the evening (home by the end); the merchant ship crosses slowly on its own.
    // Fishing boats come home with the evening; the merchant ship crosses the sun's path near the end.
    let u = anchored
      ? 0
      : kind === 'merchant'
        ? 0.04 + Math.min(1.4, game().progress) * 0.24 + t * 0.00004
        : Math.min(0.995, ev.boatsHome * (0.82 + index * 0.06) + Math.sin(t * 0.01 + index) * 0.01)
    u = Math.max(0, Math.min(0.999, u))
    curve.getPointAt(u, tmpV)
    curve.getTangentAt(u, tmpT)
    g.position.set(tmpV.x, SEA_LEVEL + Math.sin(t * 0.9 + index * 2) * 0.12, tmpV.z)
    const heading = anchored ? 0.9 + Math.sin(t * 0.05) * 0.3 : Math.atan2(tmpT.x, tmpT.z)
    g.rotation.set(Math.sin(t * 0.7 + index) * 0.035, heading, Math.sin(t * 0.55 + index * 3) * 0.05)
  })
  return (
    <group ref={ref}>
      <BoatModel kind={kind} />
    </group>
  )
}

/* ------------------------------------------------------------ The bay */

const SMOKE_PUFFS = 5

export function Bay() {
  // ~43 m grid on the light preset (the mountain is kilometres away), ~28 m otherwise.
  const coarse = useGame((s) => s.settings.quality === 'low')
  const land = useMemo(() => {
    const geo = buildLandmass(coarse ? 100 : 150)
    const mat = new MeshLambertMaterial({ vertexColors: true })
    applyDirectionalFog(mat, undefined, 0.55)
    return { geo, mat }
  }, [coarse])

  const town = useMemo(() => {
    const houses = buildHouses()
    const { wall, roof } = houseGeometry()
    const wallMat = new MeshLambertMaterial({ color: '#e8d6b8' })
    const roofMat = new MeshLambertMaterial({ color: '#a8543a' })
    applyDirectionalFog(wallMat, undefined, 0.6)
    applyDirectionalFog(roofMat, undefined, 0.6)
    const walls = new InstancedMesh(wall, wallMat, houses.length)
    const roofs = new InstancedMesh(roof, roofMat, houses.length)
    const m = new Matrix4()
    const q = new Quaternion()
    const c = new Color()
    houses.forEach((h, i) => {
      q.setFromAxisAngle(new Vector3(0, 1, 0), h.rot)
      m.compose(new Vector3(h.x, h.y, h.z), q, new Vector3(h.w, h.h, h.d))
      walls.setMatrixAt(i, m)
      roofs.setMatrixAt(i, m)
      c.setHSL(0.08 + h.tint * 0.05, 0.35 + h.tint * 0.25, 0.7 + h.tint * 0.12)
      walls.setColorAt(i, c)
    })
    walls.computeBoundingSphere()
    roofs.computeBoundingSphere()
    // Temple on a podium and a portico, plus breakwaters.
    const b = new GeoBuilder()
    const ty = vesuviusHeight(HARBOUR.x + 90, HARBOUR.z - 120)
    const T = (lx: number, ly: number, lz: number): [number, number, number] => [HARBOUR.x + 90 + lx, ty + ly, HARBOUR.z - 120 + lz]
    b.box(T(-14, -2, -9), T(14, 4, 9), () => 'stone')
    for (let i = 0; i < 6; i++) b.box(T(-11 + i * 4.4, 4, 6.5), T(-10 + i * 4.4, 13, 7.5), () => 'stone')
    b.box(T(-13, 13, -8), T(13, 15, 8.5), () => 'stone')
    b.box(T(-12, 4, -8), T(12, 13, 4), () => 'stone')
    const mole = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0)
      b.orientedBox([(x0 + x1) / 2, SEA_LEVEL + 0.5, (z0 + z1) / 2], [len, 3, 9], -Math.atan2(z1 - z0, x1 - x0), 'stone')
    }
    mole(HARBOUR.x - 120, HARBOUR.z + 170, HARBOUR.x - 260, HARBOUR.z + 40)
    mole(HARBOUR.x + 40, HARBOUR.z + 210, HARBOUR.x - 70, HARBOUR.z + 300)
    const stoneGeo = b.build().get('stone')!
    const stoneMat = new MeshLambertMaterial({ color: '#e2d6c0', vertexColors: true })
    applyDirectionalFog(stoneMat, undefined, 0.6)
    // Window lights: points on the bay-facing walls.
    const rand = rng(42)
    const lp: number[] = []
    for (const h of houses) {
      const n = 1 + Math.floor(rand() * 3)
      const fx = Math.sin(h.rot)
      const fz = Math.cos(h.rot)
      for (let k = 0; k < n; k++) {
        const side = (rand() - 0.5) * h.w * 0.7
        lp.push(h.x + fx * h.d * 0.52 + fz * side, h.y + h.h * (0.3 + rand() * 0.45), h.z + fz * h.d * 0.52 - fx * side)
      }
    }
    // Scattered farmhouse lights on the lower slopes.
    for (let k = 0; k < 40; k++) {
      const a = rand() * Math.PI * 2
      const rr = (0.45 + rand() * 0.4) * VESUVIUS.radius
      const x = VESUVIUS.x + Math.cos(a) * rr
      const z = VESUVIUS.z + Math.sin(a) * rr
      // Only the slopes facing the villa.
      if ((x - VESUVIUS.x) * -0.62 + (z - VESUVIUS.z) * 0.78 < 0) continue
      lp.push(x, vesuviusHeight(x, z) + 6, z)
    }
    const lightGeo = new BufferGeometry()
    lightGeo.setAttribute('position', new BufferAttribute(new Float32Array(lp), 3))
    const lightMat = new PointsMaterial({
      size: 13,
      map: glowTexture('rgba(255,236,190,1)', 'rgba(255,170,80,0.55)'),
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      sizeAttenuation: true,
      color: new Color('#ffb46a'),
      opacity: 0,
      fog: false,
    })
    const lights = new Points(lightGeo, lightMat)
    return { walls, roofs, stoneGeo, stoneMat, lights, lightMat, houses }
  }, [])

  const tower = useMemo(() => {
    const b = new GeoBuilder()
    const y = vesuviusHeight(LIGHTHOUSE.x, LIGHTHOUSE.z)
    const L = (lx: number, ly: number, lz: number): [number, number, number] => [LIGHTHOUSE.x + lx, y + ly, LIGHTHOUSE.z + lz]
    b.box(L(-5, -3, -5), L(5, 14, 5), () => 'stone')
    b.box(L(-3.5, 14, -3.5), L(3.5, 25, 3.5), () => 'stone')
    b.box(L(-2.2, 25, -2.2), L(2.2, 32, 2.2), () => 'stone')
    const geo = b.build().get('stone')!
    const mat = new MeshLambertMaterial({ color: '#e8dcc6', vertexColors: true })
    applyDirectionalFog(mat, undefined, 0.6)
    const fireMat = new SpriteMaterial({ map: glowTexture('rgba(255,240,200,1)', 'rgba(255,140,40,0.6)'), color: '#ffb060', blending: AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0 })
    const fire = new Sprite(fireMat)
    fire.position.set(LIGHTHOUSE.x, y + 34, LIGHTHOUSE.z)
    fire.scale.setScalar(40)
    return { geo, mat, fire, fireMat }
  }, [])

  // Hearth smoke over the town: every puff of every plume in one instanced draw call.
  const smoke = useMemo(() => {
    const tex = smokeTexture()
    const rand = rng(9)
    const bases: Vector3[] = []
    for (let i = 0; i < 6; i++) {
      const h = town.houses[Math.floor(rand() * town.houses.length)]
      bases.push(new Vector3(h.x, h.y + h.h + 2, h.z))
    }
    const puffs = new Puffs(bases.length * SMOKE_PUFFS, tex, '#d8d0c4', new Sphere(new Vector3(HARBOUR.x + 11, SEA_LEVEL + 60, HARBOUR.z - 4), HARBOUR.radius + 90))
    return { bases, puffs, tex }
  }, [town])

  useEffect(
    () => () => {
      land.geo.dispose()
      land.mat.dispose()
      town.walls.dispose()
      town.roofs.dispose()
      town.walls.geometry.dispose()
      town.roofs.geometry.dispose()
      ;(town.walls.material as Material).dispose()
      ;(town.roofs.material as Material).dispose()
      town.stoneGeo.dispose()
      town.stoneMat.dispose()
      town.lights.geometry.dispose()
      town.lightMat.map?.dispose()
      town.lightMat.dispose()
      tower.geo.dispose()
      tower.mat.dispose()
      tower.fireMat.map?.dispose()
      tower.fireMat.dispose()
      smoke.puffs.dispose()
      smoke.tex.dispose()
    },
    [land, town, tower, smoke],
  )

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const ev = evening(game().progress)
    town.lightMat.opacity = ev.harbourLights * (0.9 + 0.1 * Math.sin(t * 3.1))
    tower.fireMat.opacity = ev.lighthouse * (0.85 + 0.15 * Math.sin(t * 7.3) * Math.sin(t * 3.7))
    tower.fire.scale.setScalar(34 + 14 * ev.lighthouse + Math.sin(t * 5.1) * 2)
    // Hearth smoke: puffs rising and drifting with the evening breeze.
    for (let pi = 0; pi < smoke.bases.length; pi++) {
      const b = smoke.bases[pi]
      for (let k = 0; k < SMOKE_PUFFS; k++) {
        const life = (t * 0.035 + k / SMOKE_PUFFS + pi * 0.17) % 1
        smoke.puffs.set(pi * SMOKE_PUFFS + k, b.x + life * 22 + Math.sin(life * 6 + pi) * 3, b.y + life * 55, b.z - life * 8, 6 + life * 26, 0.32)
      }
    }
    smoke.puffs.commit()
  })

  return (
    <group>
      <mesh geometry={land.geo} material={land.mat} />
      <primitive object={town.walls} />
      <primitive object={town.roofs} />
      <mesh geometry={town.stoneGeo} material={town.stoneMat} />
      <primitive object={town.lights} />
      <mesh geometry={tower.geo} material={tower.mat} />
      <primitive object={tower.fire} />
      <primitive object={smoke.puffs.mesh} />
      {BOAT_ROUTES.map((r, i) => (
        <Boat key={i} kind={r.kind} path={r.path} index={i} />
      ))}
    </group>
  )
}

