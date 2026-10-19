import { useGLTF } from '@react-three/drei'
import { Component, Suspense, useEffect, useMemo, type ReactNode } from 'react'
import {
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Mesh,
  type Object3D,
} from 'three'
import { createLeafTexture } from '../materials/common'
import { useArchMaterials } from '../materials/library'
import { groundHeight } from '../world/ground'
import { TERRACE_Y } from '../world/layout'
import { rng } from '../world/noise'
import { COVE, COVE_BOAT, EXEDRA, SUNDIAL, TERRACE_PERGOLA, TERRACE_STATUES } from '../world/props'
import { sky } from './atmosphere'
import { GeoBuilder } from './geom/builder'
import { cardsGeometry, patchFoliage, type Clump } from './geom/foliage'
import { CullGroup } from './CullGroup'
import { useStaticGeometry } from './staticGeometry'
import { hasModel } from './Props'
import { usePropLod } from './propLod'

const DIAL_CENTER = [SUNDIAL.x, TERRACE_Y + 1, SUNDIAL.z] as const
const DIAL_FAR = { high: 90, medium: 50, low: 24 }
const VINE_CENTER = [(TERRACE_PERGOLA.minX + TERRACE_PERGOLA.maxX) / 2, TERRACE_Y + 2, (TERRACE_PERGOLA.minZ + TERRACE_PERGOLA.maxZ) / 2] as const
const VINE_FAR = { high: Infinity, medium: 120, low: 60 }
const COVE_CENTER = [COVE.x, groundHeight(COVE.x, COVE.z) + 1.5, COVE.z + 3] as const
const COVE_FAR = { high: Infinity, medium: 150, low: 75 }

/**
 * Terrace furniture: the exedra bench (procedural until a model exists), a
 * Roman hemicyclium sundial whose gnomon shadow is computed exactly from the
 * sun, a vine pergola, statue pedestals, and the little cove below.
 */

const modelsModules = import.meta.glob('../../data/generated/models.json', { eager: true, import: 'default' })
const models = (Object.values(modelsModules)[0] ?? {}) as Record<string, { file: string; waterline?: number }>

class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override render() {
    return this.state.failed ? null : this.props.children
  }
}

function Glb({ id, position, rotationY = 0, scale = 1 }: { id: string; position: [number, number, number]; rotationY?: number; scale?: number }) {
  const gltf = useGLTF(import.meta.env.BASE_URL + models[id].file, false, true)
  const obj = useMemo(() => {
    const g = gltf.scene.clone(true)
    g.traverse((o: Object3D) => {
      const m = o as Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = true
      }
    })
    return g
  }, [gltf])
  usePropLod(obj)
  return <primitive object={obj} position={position} rotation={[0, rotationY, 0]} scale={scale} />
}

function Model(props: { id: string; position: [number, number, number]; rotationY?: number; scale?: number }) {
  if (!hasModel(props.id)) return null
  return (
    <Quiet>
      <Suspense fallback={null}>
        <Glb {...props} />
      </Suspense>
    </Quiet>
  )
}

/* ------------------------------------------------------------ Static stonework */

function buildStonework(withExedra: boolean) {
  const b = new GeoBuilder()
  const y = TERRACE_Y
  if (withExedra) {
    // Exedra: seat slabs, backrest and supports along a semicircle (sitters face −Z).
    const n = 18
    for (let i = 0; i < n; i++) {
      const a0 = ((EXEDRA.arcFrom + ((EXEDRA.arcTo - EXEDRA.arcFrom) * i) / n) * Math.PI) / 180
      const a1 = ((EXEDRA.arcFrom + ((EXEDRA.arcTo - EXEDRA.arcFrom) * (i + 1)) / n) * Math.PI) / 180
      const am = (a0 + a1) / 2
      const seg = EXEDRA.radius * (a1 - a0) + 0.02
      const rot = -am - Math.PI / 2
      const at = (rr: number, yy: number): [number, number, number] => [EXEDRA.x + Math.cos(am) * rr, y + yy, EXEDRA.z + Math.sin(am) * rr]
      b.color = [1, 0.99, 0.96]
      b.orientedBox(at(EXEDRA.radius, EXEDRA.seatHeight - 0.04), [seg, 0.08, 0.56], rot, 'marble')
      b.color = [0.95, 0.94, 0.9]
      b.orientedBox(at(EXEDRA.radius + 0.36, 0.62), [(EXEDRA.radius + 0.36) * (a1 - a0) + 0.02, 0.9, 0.14], rot, 'marble')
      if (i % 3 === 0) b.orientedBox(at(EXEDRA.radius, 0.2), [0.16, 0.4, 0.46], rot, 'marble')
    }
  }
  // Sundial pedestal: a column with base and capital; the dial block sits on top.
  const s = SUNDIAL
  b.color = [0.97, 0.95, 0.9]
  b.box([s.x - 0.32, y, s.z - 0.32], [s.x + 0.32, y + 0.12, s.z + 0.32], () => 'marble')
  b.box([s.x - 0.17, y + 0.12, s.z - 0.17], [s.x + 0.17, y + 0.5, s.z + 0.17], () => 'marble')
  b.box([s.x - 0.26, y + 0.5, s.z - 0.26], [s.x + 0.26, y + 0.58, s.z + 0.26], () => 'marble')
  // Dial block around the bowl (bottom, back and side cheeks).
  const top = y + 0.58
  b.box([s.x - 0.3, top, s.z - 0.22], [s.x + 0.3, top + 0.24, s.z + 0.22], () => 'marble')
  b.box([s.x - 0.3, top + 0.24, s.z - 0.01], [s.x + 0.3, top + 0.46, s.z + 0.22], () => 'marble')
  b.box([s.x - 0.3, top + 0.24, s.z - 0.22], [s.x - 0.21, top + 0.46, s.z - 0.01], () => 'marble')
  b.box([s.x + 0.21, top + 0.24, s.z - 0.22], [s.x + 0.3, top + 0.46, s.z - 0.01], () => 'marble')
  // Statue pedestals along the parapet.
  for (const p of TERRACE_STATUES) {
    b.color = [0.97, 0.95, 0.9]
    b.box([p.x - 0.42, y, p.z - 0.42], [p.x + 0.42, y + 0.16, p.z + 0.42], () => 'marble')
    b.box([p.x - 0.32, y + 0.16, p.z - 0.32], [p.x + 0.32, y + 1.02, p.z + 0.32], () => 'marble')
    b.box([p.x - 0.4, y + 1.02, p.z - 0.4], [p.x + 0.4, y + 1.12, p.z + 0.4], () => 'marble')
  }
  // Pergola: posts and beams.
  const pg = TERRACE_PERGOLA
  const xs = [pg.minX, pg.maxX]
  const zs = [pg.minZ, (pg.minZ + pg.maxZ) / 2, pg.maxZ]
  for (const px of xs) {
    for (const pz of zs) {
      b.color = [1, 0.97, 0.93]
      b.box([px - 0.16, y, pz - 0.16], [px + 0.16, y + pg.height, pz + 0.16], () => 'plaster')
      b.color = [0.62, 0.24, 0.17]
      b.box([px - 0.165, y, pz - 0.165], [px + 0.165, y + 0.9, pz + 0.165], () => 'plasterWarm')
    }
  }
  b.color = [1, 1, 1]
  for (const px of xs) b.box([px - 0.09, y + pg.height, pg.minZ - 0.4], [px + 0.09, y + pg.height + 0.2, pg.maxZ + 0.4], () => 'woodDark')
  for (let z = pg.minZ - 0.2; z <= pg.maxZ + 0.2; z += 0.75) b.box([pg.minX - 0.5, y + pg.height + 0.2, z - 0.05], [pg.maxX + 0.5, y + pg.height + 0.32, z + 0.05], () => 'wood')
  // Cove: poles for drying nets.
  const poles: [number, number][] = [
    [COVE.x - 3.2, COVE.z + 3.2],
    [COVE.x - 0.4, COVE.z + 3.8],
    [COVE.x + 2.4, COVE.z + 3.3],
  ]
  for (const [px, pz] of poles) {
    const gy = groundHeight(px, pz)
    b.color = [0.8, 0.7, 0.55]
    b.box([px - 0.05, gy - 0.3, pz - 0.05], [px + 0.05, gy + 2.2, pz + 0.05], () => 'woodDark')
  }
  return { geos: b.build(), poles }
}

/* ------------------------------------------------------------ Sundial bowl */

function hourLineTexture() {
  const w = 512
  const h = 256
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.fillStyle = '#efe9dd'
  g.fillRect(0, 0, w, h)
  g.strokeStyle = 'rgba(60,45,35,0.75)'
  g.lineWidth = 2
  // 11 hour lines (12 Roman hours of daylight) radiating across the bowl.
  for (let k = 1; k < 12; k++) {
    const x = (k / 12) * w
    g.beginPath()
    g.moveTo(x, h * 0.08)
    g.lineTo(x, h * 0.92)
    g.stroke()
  }
  // Day curves: winter solstice, equinox, summer solstice.
  g.lineWidth = 1.5
  for (const v of [0.3, 0.52, 0.74]) {
    g.beginPath()
    g.moveTo(w * 0.04, v * h)
    g.lineTo(w * 0.96, v * h)
    g.stroke()
  }
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

function netTexture() {
  const s = 256
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  g.clearRect(0, 0, s, s)
  g.strokeStyle = 'rgba(214,196,160,0.95)'
  g.lineWidth = 2
  for (let i = -s; i < s * 2; i += 16) {
    g.beginPath()
    g.moveTo(i, 0)
    g.lineTo(i + s, s)
    g.stroke()
    g.beginPath()
    g.moveTo(i + s, 0)
    g.lineTo(i, s)
    g.stroke()
  }
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.wrapS = t.wrapT = RepeatWrapping
  t.repeat.set(3, 1.5)
  return t
}

export function TerraceDecor() {
  // Suspends until the shared architectural textures are loaded (the stonework is drawn by <StaticBatch />).
  useArchMaterials()
  const exedraModel = hasModel('exedra-bench')
  const stone = useMemo(() => buildStonework(!exedraModel), [exedraModel])
  useStaticGeometry(stone.geos)

  const dial = useMemo(() => {
    const s = SUNDIAL
    const top = TERRACE_Y + 0.58
    const center = new Vector3(s.x, top + 0.46, s.z - 0.22)
    const r = 0.21
    // Concave quarter sphere (lower, front), seen from inside.
    // phi ∈ [0, π] → z ≥ centre: the scoop goes back into the block.
    const bowl = new SphereGeometry(r, 36, 18, 0, Math.PI, Math.PI / 2, Math.PI / 2)
    bowl.translate(center.x, center.y, center.z)
    const tex = hourLineTexture()
    const mat = new MeshStandardMaterial({ map: tex, roughness: 0.85, side: 1 /* BackSide */ })
    // Gnomon: horizontal bronze rod from the back rim to the sphere's centre (tip), as on a hemicyclium.
    const A = new Vector3(s.x, center.y, center.z + r * 0.98)
    const B = new Vector3(s.x, center.y, center.z + 0.004)
    const uniforms = {
      uSunDir: { value: sky.sunDir },
      uGA: { value: A },
      uGB: { value: B },
      uGR: { value: 0.0045 },
    }
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms)
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vDialW;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvDialW = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uSunDir; uniform vec3 uGA; uniform vec3 uGB; uniform float uGR; varying vec3 vDialW;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
{
  // Exact shadow of the gnomon rod: distance between the ray toward the sun and the rod.
  vec3 u = normalize(uSunDir); vec3 v = uGB - uGA; vec3 w = vDialW - uGA;
  float a = dot(u,u), b = dot(u,v), c = dot(v,v), d = dot(u,w), e = dot(v,w);
  float D = max(a*c - b*b, 1e-6);
  float sc = max((b*e - c*d) / D, 0.0);
  float tc = clamp((a*e - b*d) / D, 0.0, 1.0);
  float dist = length(w + sc*u - tc*v);
  float sh = 1.0 - smoothstep(uGR, uGR * 3.0, dist);
  diffuseColor.rgb *= 1.0 - 0.62 * sh;
}`,
        )
    }
    mat.customProgramCacheKey = () => 'sundial-bowl'
    const rod = new CylinderGeometry(0.004, 0.004, A.distanceTo(B), 6)
    rod.rotateX(Math.PI / 2)
    rod.translate((A.x + B.x) / 2, A.y, (A.z + B.z) / 2)
    const bronze = new MeshStandardMaterial({ color: '#6d5132', metalness: 0.8, roughness: 0.4 })
    return { bowl, mat, tex, rod, bronze }
  }, [])

  const vines = useMemo(() => {
    const pg = TERRACE_PERGOLA
    const rand = rng(626)
    const clumps: Clump[] = []
    for (let i = 0; i < 16; i++) {
      clumps.push({ c: [pg.minX + rand() * (pg.maxX - pg.minX), pg.height + 0.4 + rand() * 0.2, pg.minZ + rand() * (pg.maxZ - pg.minZ)], r: 0.7 + rand() * 0.4, sy: 0.4 })
    }
    for (const px of [pg.minX, pg.maxX]) {
      for (let k = 0; k < 4; k++) clumps.push({ c: [px + (rand() - 0.5) * 0.3, 0.5 + k * 0.6, pg.maxZ + (rand() - 0.5) * 0.3], r: 0.32, sy: 1 })
    }
    const geo = cardsGeometry(clumps, { cards: 34, size: [0.45, 0.75], seed: 88, flexHeight: pg.height + 1, tint: [0.8, 1.1] })
    geo.translate(0, TERRACE_Y, 0)
    const tex = createLeafTexture('shrub')
    const mat = new MeshStandardMaterial({ map: tex, alphaTest: 0.42, side: DoubleSide, vertexColors: true, roughness: 0.8, color: '#b9c98f' })
    mat.alphaToCoverage = true
    patchFoliage(mat, { sway: 0.6, translucency: 0.9 })
    return { geo, mat, tex }
  }, [])

  const nets = useMemo(() => {
    const tex = netTexture()
    const mat = new MeshStandardMaterial({ map: tex, alphaTest: 0.3, transparent: false, side: DoubleSide, roughness: 1, color: '#d9c7a2' })
    const geos: BufferGeometry[] = []
    for (let i = 0; i < stone.poles.length - 1; i++) {
      const [ax, az] = stone.poles[i]
      const [bx, bz] = stone.poles[i + 1]
      const len = Math.hypot(bx - ax, bz - az)
      const g = new PlaneGeometry(len, 1.7, 8, 4)
      // Sagging net between two poles.
      const p = g.getAttribute('position')
      for (let k = 0; k < p.count; k++) {
        const u = p.getX(k) / len + 0.5
        p.setZ(k, Math.sin(u * Math.PI) * 0.18)
        p.setY(k, p.getY(k) - Math.sin(u * Math.PI) * 0.22)
      }
      g.computeVertexNormals()
      g.rotateY(-Math.atan2(bz - az, bx - ax))
      const gy = (groundHeight(ax, az) + groundHeight(bx, bz)) / 2
      g.translate((ax + bx) / 2, gy + 1.25, (az + bz) / 2)
      geos.push(g)
    }
    return { mat, tex, geos }
  }, [stone])

  useEffect(
    () => () => {
      stone.geos.forEach((g) => g.dispose())
      dial.bowl.dispose()
      dial.mat.dispose()
      dial.tex.dispose()
      dial.rod.dispose()
      dial.bronze.dispose()
      vines.geo.dispose()
      vines.mat.dispose()
      vines.tex.dispose()
      nets.geos.forEach((g) => g.dispose())
      nets.mat.dispose()
      nets.tex.dispose()
    },
    [stone, dial, vines, nets],
  )

  const boatY = groundHeight(COVE_BOAT.x, COVE_BOAT.z)
  return (
    <group>
      <CullGroup center={DIAL_CENTER} radius={0.6} far={DIAL_FAR}>
        <mesh geometry={dial.bowl} material={dial.mat} receiveShadow />
        <mesh geometry={dial.rod} material={dial.bronze} castShadow />
      </CullGroup>
      <CullGroup center={VINE_CENTER} radius={6} far={VINE_FAR}>
        <mesh geometry={vines.geo} material={vines.mat} castShadow receiveShadow />
      </CullGroup>
      <CullGroup center={COVE_CENTER} radius={5} far={COVE_FAR}>
        {nets.geos.map((g, i) => (
          <mesh key={i} geometry={g} material={nets.mat} />
        ))}
      </CullGroup>
      {/* Model pivot is 1.325 m behind its arc centre (opening +Z); turned to face the sea. */}
      {exedraModel && <Model id="exedra-bench" position={[EXEDRA.x, TERRACE_Y, EXEDRA.z + 1.325]} rotationY={Math.PI} />}
      {TERRACE_STATUES.map((p, i) => (
        <Model key={i} id={i % 2 === 0 ? 'statue-muse' : 'statue-youth'} position={[p.x, TERRACE_Y + 1.12, p.z]} rotationY={p.rotY} />
      ))}
      {/* A boat drawn up on the sand, tilted on its keel. */}
      {/* Origin is the waterline; the keel is 0.38 m below it. */}
      <group position={[COVE_BOAT.x, boatY + 0.3, COVE_BOAT.z]} rotation={[0, COVE_BOAT.rotY, 0.14]}>
        <Model id="fishing-boat" position={[0, 0, 0]} />
      </group>
    </group>
  )
}
