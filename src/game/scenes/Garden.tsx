import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { suspend } from 'suspend-react'
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
  type Texture,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { useArchMaterials } from '../materials/library'
import { loadWaterNormals } from '../materials/textures'
import { flatNormalTexture } from '../materials/common'
import { FOUNTAIN_BASIN, GARDEN_FLOOR, GARDEN_HEDGES, POTS } from '../world/architecture'
import { groundHeight } from '../world/ground'
import { rng } from '../world/noise'
import { GeoBuilder } from './geom/builder'
import { CullGroup } from './CullGroup'
import { hasModel } from './Props'

/** The fountain, hedges and pots stand inside the walled peristyle: not drawn from far away. */
const GARDEN_CENTER = [0, 0.5, 30] as const
const GARDEN_FAR = { high: Infinity, medium: 110, low: 50 }

/** Lathe with a white vertex colour: the shared marble material multiplies by vertex colours (none = black). */
function lathe(pts: [number, number][], seg = 48) {
  const g = new LatheGeometry(pts.map(([r, y]) => new Vector2(r, y)), seg)
  g.setAttribute('color', new BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3))
  return g
}

function hedgeTexture(): CanvasTexture {
  const s = 256
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  g.fillStyle = '#2f4424'
  g.fillRect(0, 0, s, s)
  const rand = rng(55)
  const cols = ['#3d5a2c', '#4a6a34', '#2a3d20', '#567a3c', '#33502a']
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = cols[Math.floor(rand() * cols.length)]
    g.beginPath()
    g.ellipse(rand() * s, rand() * s, 2 + rand() * 3, 1.2 + rand() * 1.5, rand() * Math.PI, 0, Math.PI * 2)
    g.fill()
  }
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.wrapS = t.wrapT = RepeatWrapping
  t.repeat.set(2.6, 2.6)
  return t
}

function streakTexture(): CanvasTexture {
  const w = 128
  const h = 256
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, w, h)
  const rand = rng(77)
  for (let i = 0; i < 90; i++) {
    const x = rand() * w
    const a = 0.25 + rand() * 0.6
    g.strokeStyle = `rgba(255,255,255,${a})`
    g.lineWidth = 0.6 + rand() * 1.6
    g.beginPath()
    const y0 = rand() * h
    g.moveTo(x, y0)
    g.lineTo(x + (rand() - 0.5) * 2, y0 + 30 + rand() * 120)
    g.stroke()
  }
  const t = new CanvasTexture(c)
  t.wrapS = t.wrapT = RepeatWrapping
  t.repeat.set(5, 1)
  return t
}

export function Garden() {
  const mats = useArchMaterials()
  const normals = suspend(() => loadWaterNormals(), ['water-normals'])

  const fountain = useMemo(() => {
    const y0 = GARDEN_FLOOR
    const basin = lathe([
      [2.0, y0 - 0.05],
      [2.0, y0 + 0.42],
      [2.07, y0 + 0.46],
      [2.07, y0 + 0.54],
      [1.98, y0 + 0.57],
      [1.72, y0 + 0.57],
      [1.68, y0 + 0.5],
      [1.68, y0 + 0.1],
      [0.0001, y0 + 0.1],
    ])
    const pedestal = lathe([
      [0.34, y0 + 0.1],
      [0.34, y0 + 0.2],
      [0.24, y0 + 0.27],
      [0.18, y0 + 0.5],
      [0.16, y0 + 1.05],
      [0.2, y0 + 1.12],
      [0.3, y0 + 1.16],
      [0.62, y0 + 1.28],
      [0.68, y0 + 1.36],
      [0.66, y0 + 1.4],
      [0.58, y0 + 1.37],
      [0.3, y0 + 1.3],
      [0.0001, y0 + 1.29],
    ])
    const spout = lathe([
      [0.0001, y0 + 1.3],
      [0.09, y0 + 1.32],
      [0.1, y0 + 1.4],
      [0.06, y0 + 1.52],
      [0.0001, y0 + 1.6],
    ], 16)
    const waterBasin = new CircleGeometry(1.69, 48)
    waterBasin.rotateX(-Math.PI / 2)
    waterBasin.translate(0, y0 + 0.44, 0)
    const waterBowl = new CircleGeometry(0.6, 32)
    waterBowl.rotateX(-Math.PI / 2)
    waterBowl.translate(0, y0 + 1.37, 0)
    const curtain = new CylinderGeometry(0.67, 0.72, 0.95, 40, 1, true)
    curtain.translate(0, y0 + 0.92, 0)
    const jet = new CylinderGeometry(0.012, 0.03, 0.32, 8, 1, true)
    jet.translate(0, y0 + 1.75, 0)

    const prep = (t: Texture | null, rep: number) => {
      if (!t) return flatNormalTexture()
      const c = t.clone()
      c.wrapS = c.wrapT = RepeatWrapping
      c.repeat.set(rep, rep)
      c.needsUpdate = true
      return c
    }
    const nTex = prep(normals, 1.6)
    const water = new MeshPhysicalMaterial({
      color: new Color('#16302c'),
      roughness: 0.04,
      metalness: 0,
      normalMap: nTex,
      normalScale: new Vector2(0.25, 0.25),
      clearcoat: 1,
      clearcoatRoughness: 0.02,
    })
    const streak = streakTexture()
    const curtainMat = new MeshStandardMaterial({
      color: new Color('#e9f3f2'),
      alphaMap: streak,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: DoubleSide,
      roughness: 0.15,
      metalness: 0,
    })
    // Same-material pieces merged: one draw call each for the stone and the water surfaces.
    const stone = mergeGeometries([basin, pedestal, spout], false)!
    const pools = mergeGeometries([waterBasin.toNonIndexed(), waterBowl.toNonIndexed()], false)!
    for (const g of [basin, pedestal, spout, waterBasin, waterBowl]) g.dispose()
    return { stone, pools, curtain, jet, water, curtainMat, nTex, streak }
  }, [normals])

  const hedges = useMemo(() => {
    const b = new GeoBuilder()
    const rand = rng(12)
    for (const h of GARDEN_HEDGES) {
      const [ax, az] = h.a
      const [bx, bz] = h.b
      const len = Math.hypot(bx - ax, bz - az)
      const n = Math.max(1, Math.round(len / 0.55))
      const rot = -Math.atan2(bz - az, bx - ax)
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n
        const cx = ax + (bx - ax) * t
        const cz = az + (bz - az) * t
        const hh = 0.42 + (rand() - 0.5) * 0.07
        const w = 0.44 + (rand() - 0.5) * 0.05
        const shade = 0.85 + rand() * 0.2
        const seg = len / n + 0.05
        // Body, then two narrowing layers for a clipped, rounded top.
        b.color = [shade * 0.9, shade * 0.9, shade * 0.9]
        b.orientedBox([cx, GARDEN_FLOOR + hh / 2 - 0.02, cz], [seg, hh, w], rot, 'hedge')
        b.color = [shade, shade, shade]
        b.orientedBox([cx, GARDEN_FLOOR + hh + 0.025, cz], [seg - 0.02, 0.06, w - 0.07], rot, 'hedge')
        b.color = [shade * 1.08, shade * 1.08, shade * 1.08]
        b.orientedBox([cx, GARDEN_FLOOR + hh + 0.07, cz], [seg - 0.06, 0.04, w - 0.18], rot, 'hedge')
      }
    }
    const geo = b.build().get('hedge')!
    const tex = hedgeTexture()
    const mat = new MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.95, metalness: 0 })
    return { geo, mat, tex }
  }, [])

  const pots = useMemo(() => {
    const geo = lathe([
      [0.0001, 0],
      [0.2, 0],
      [0.24, 0.05],
      [0.36, 0.25],
      [0.4, 0.45],
      [0.36, 0.58],
      [0.3, 0.62],
      [0.34, 0.66],
      [0.33, 0.69],
      [0.27, 0.66],
      [0.27, 0.6],
    ], 28)
    geo.computeVertexNormals()
    const col = new Float32Array(geo.getAttribute('position').count * 3).fill(1)
    geo.setAttribute('color', new BufferAttribute(col, 3))
    const mesh = new InstancedMesh(geo, mats.terracotta, POTS.length)
    const m = new Matrix4()
    POTS.forEach(([x, z], i) => {
      m.makeRotationY(i)
      m.setPosition(x, groundHeight(x, z) - 0.02, z)
      mesh.setMatrixAt(i, m)
    })
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.computeBoundingSphere()
    return mesh
  }, [mats])

  useEffect(
    () => () => {
      const f = fountain
      ;[f.stone, f.pools, f.curtain, f.jet].forEach((g: BufferGeometry) => g.dispose())
      f.water.dispose()
      f.curtainMat.dispose()
      f.streak.dispose()
      if (f.nTex !== flatNormalTexture()) f.nTex.dispose()
      hedges.geo.dispose()
      hedges.mat.dispose()
      hedges.tex.dispose()
      pots.geometry.dispose()
      pots.dispose()
    },
    [fountain, hedges, pots],
  )

  useFrame((state) => {
    const t = state.clock.elapsedTime
    fountain.streak.offset.y = -t * 0.9
    fountain.nTex.offset.set(t * 0.02, t * 0.017)
  })

  return (
    <CullGroup center={GARDEN_CENTER} radius={12} far={GARDEN_FAR}>
      <group position={[FOUNTAIN_BASIN.x, 0, FOUNTAIN_BASIN.z]}>
        <mesh geometry={fountain.stone} material={mats.marble} castShadow receiveShadow />
        <mesh geometry={fountain.pools} material={fountain.water} receiveShadow />
        <mesh geometry={fountain.curtain} material={fountain.curtainMat} renderOrder={2} />
        <mesh geometry={fountain.jet} material={fountain.curtainMat} renderOrder={2} />
      </group>
      <mesh geometry={hedges.geo} material={hedges.mat} castShadow receiveShadow />
      {!hasModel('amphora-planter') && <primitive object={pots} />}
    </CullGroup>
  )
}
