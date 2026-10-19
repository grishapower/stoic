import { useEffect, useMemo } from 'react'
import { CylinderGeometry, DoubleSide, MeshStandardMaterial, SphereGeometry, type BufferGeometry } from 'three'
import { createLeafTexture } from '../materials/common'
import { useArchMaterials } from '../materials/library'
import { PERGOLA_DEF, TERRACE_DEF, TERRACE_PROPS, VIEWPOINT_DEF } from '../world/architecture'
import { ESTATE_BOUNDARY, TERRACE_Y } from '../world/layout'
import { rng } from '../world/noise'
import { terrainHeight } from '../world/terrain'
import { GeoBuilder } from './geom/builder'
import { CullGroup } from './CullGroup'
import { useStaticGeometry } from './staticGeometry'
import { hasModel } from './Props'

/** The pergola vine (leaf cards) is drawn only from nearby on lower quality. */
const VINE_CENTER = [PERGOLA_DEF.x, terrainHeight(PERGOLA_DEF.x, PERGOLA_DEF.z) + 2.5, PERGOLA_DEF.z] as const
const VINE_FAR = { high: Infinity, medium: 110, low: 50 }
import { cardsGeometry, patchFoliage, type Clump } from './geom/foliage'

/**
 * Garden structures along the walk: pergola with the writing table, the
 * viewpoint parapet, the sea terrace, herms and the estate's dry-stone wall.
 */

type V3 = [number, number, number]

function local(cx: number, cz: number, rot: number) {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  return (lx: number, ly: number, lz: number): V3 => [cx + lx * c + lz * s, ly, cz - lx * s + lz * c]
}

function buildGrounds() {
  const b = new GeoBuilder()
  const rand = rng(8080)

  /* ---------------- Pergola */
  {
    const { x, z, rotY, width, depth, height } = PERGOLA_DEF
    const y0 = terrainHeight(x, z)
    const L = local(x, z, rotY)
    // Floor of stone slabs.
    b.color = [0.95, 0.92, 0.86]
    b.orientedBox(L(0, y0 - 0.5, 0), [width + 0.8, 1.06, depth + 0.8], rotY, (f) => (f === 'ny' ? null : 'paving'))
    // Pillars.
    for (const [px, pz] of [
      [-width / 2, -depth / 2],
      [width / 2, -depth / 2],
      [-width / 2, depth / 2],
      [width / 2, depth / 2],
    ]) {
      b.color = [1, 0.97, 0.93]
      b.orientedBox(L(px, y0 + height / 2, pz), [0.34, height, 0.34], rotY, 'plaster')
      b.orientedBox(L(px, y0 + 0.08, pz), [0.48, 0.16, 0.48], rotY, 'marble')
      b.orientedBox(L(px, y0 + height - 0.05, pz), [0.44, 0.1, 0.44], rotY, 'marble')
    }
    // Beams (along the width) and rafters (across).
    b.color = [1, 1, 1]
    for (const pz of [-depth / 2, depth / 2]) b.orientedBox(L(0, y0 + height + 0.1, pz), [width + 0.9, 0.2, 0.16], rotY, 'woodDark')
    for (let i = 0; i < 8; i++) {
      const px = -width / 2 - 0.2 + (i / 7) * (width + 0.4)
      b.orientedBox(L(px, y0 + height + 0.27, 0), [0.1, 0.13, depth + 1.0], rotY, 'wood')
    }
    // Writing table, stool, scrolls, tablet, inkwell.
    const t = PERGOLA_DEF.table
    const T = local(t.x, t.z, rotY)
    const ty = terrainHeight(t.x, t.z) + 0.02
    if (!hasModel('writing-table')) {
    b.color = [1, 1, 1]
    b.orientedBox(T(0, ty + 0.74, 0), [1.45, 0.06, 0.72], rotY, 'wood')
    for (const [lx, lz] of [
      [-0.64, -0.29],
      [0.64, -0.29],
      [-0.64, 0.29],
      [0.64, 0.29],
    ]) {
      b.orientedBox(T(lx, ty + 0.36, lz), [0.07, 0.72, 0.07], rotY, 'woodDark')
    }
    b.orientedBox(T(0, ty + 0.18, 0), [1.3, 0.04, 0.05], rotY, 'woodDark')
    }
    // Stool (sella) behind the table, unless the wicker chair model takes its place.
    if (!hasModel('wicker-chair')) {
      b.orientedBox(T(0.1, ty + 0.46, 0.75), [0.55, 0.05, 0.4], rotY, 'wood')
      for (const [lx, lz] of [
        [-0.22, 0.6],
        [0.22, 0.6],
        [-0.22, 0.9],
        [0.22, 0.9],
      ]) {
        b.orientedBox(T(lx + 0.1, ty + 0.22, lz), [0.05, 0.44, 0.05], rotY, 'woodDark')
      }
    }
    if (!hasModel('writing-table')) {
    // Wax tablet (diptych) and an inkwell.
    b.color = [0.55, 0.42, 0.3]
    b.orientedBox(T(0.35, ty + 0.785, 0.05), [0.32, 0.03, 0.24], rotY + 0.15, 'woodDark')
    b.color = [0.25, 0.22, 0.2]
    b.orientedBox(T(-0.45, ty + 0.81, -0.18), [0.06, 0.08, 0.06], rotY, 'woodDark')
    }
  }

  /* ---------------- Viewpoint parapet (brick with marble coping) */
  {
    const { x, z, rotY, length, height, thick } = VIEWPOINT_DEF
    const y0 = terrainHeight(x, z)
    const L = local(x, z, rotY)
    b.color = [1, 1, 1]
    b.orientedBox(L(0, y0 + height / 2 - 0.3, 0), [length, height + 0.6, thick], rotY, 'brick')
    b.color = [0.97, 0.95, 0.9]
    b.orientedBox(L(0, y0 + height + 0.04, 0), [length + 0.12, 0.1, thick + 0.12], rotY, 'marble')
  }

  /* ---------------- Sea terrace */
  {
    const T = TERRACE_DEF
    const y = TERRACE_Y
    b.color = [1, 0.98, 0.94]
    b.box([T.minX, y - 0.8, T.minZ], [T.maxX, y + 0.02, T.maxZ], (f) => (f === 'ny' ? null : 'paving'))
    // Retaining wall dropping toward the cliff.
    b.color = [0.92, 0.88, 0.82]
    b.box([T.minX - 0.4, y - 12, T.minZ - 0.6], [T.maxX + 0.4, y + 0.02, T.minZ], (f) => (f === 'py' ? null : 'stone'))
    b.box([T.minX - 0.4, y - 9, T.minZ], [T.minX, y + 0.02, T.maxZ - 4], (f) => (f === 'py' ? null : 'stone'))
    b.box([T.maxX, y - 9, T.minZ], [T.maxX + 0.4, y + 0.02, T.maxZ - 4], (f) => (f === 'py' ? null : 'stone'))
    // Parapet (pluteus) with marble coping: low on the sea side (keeps the bay in view from the
    // exedra), taller on the flanks.
    const ph = 0.82
    const pf = 0.58
    const pt = 0.38
    const z0 = T.balustradeZ
    b.color = [1, 0.97, 0.93]
    b.box([T.minX, y, z0 - pt / 2], [T.maxX, y + pf, z0 + pt / 2], () => 'plaster')
    b.box([T.minX, y, z0 + pt / 2], [T.minX + pt, y + ph, T.maxZ - 5], () => 'plaster')
    b.box([T.maxX - pt, y, z0 + pt / 2], [T.maxX, y + ph, T.maxZ - 5], () => 'plaster')
    b.color = [0.96, 0.94, 0.9]
    b.box([T.minX - 0.06, y + pf, z0 - pt / 2 - 0.06], [T.maxX + 0.06, y + pf + 0.09, z0 + pt / 2 + 0.06], () => 'marble')
    b.box([T.minX - 0.06, y + ph, z0 + pt / 2], [T.minX + pt + 0.06, y + ph + 0.09, T.maxZ - 5], () => 'marble')
    b.box([T.maxX - pt - 0.06, y + ph, z0 + pt / 2], [T.maxX + 0.06, y + ph + 0.09, T.maxZ - 5], () => 'marble')
    // Red panel band on the parapet's inner face.
    b.color = [0.9, 0.38, 0.27]
    b.box([T.minX + 0.5, y + 0.12, z0 + pt / 2], [T.maxX - 0.5, y + 0.44, z0 + pt / 2 + 0.006], (f) => (f === 'pz' ? 'plasterWarm' : null))

    // (The sea-facing seat is now the exedra — see TerraceDecor.tsx.)
  }

  /* ---------------- Herms (pillar + generic bearded bust) */
  for (const [hx, hz] of TERRACE_PROPS.herms) {
    const y = TERRACE_Y
    b.color = [0.98, 0.96, 0.92]
    b.box([hx - 0.3, y, hz - 0.3], [hx + 0.3, y + 0.18, hz + 0.3], () => 'marble')
    b.box([hx - 0.18, y + 0.18, hz - 0.16], [hx + 0.18, y + 1.38, hz + 0.16], () => 'marble')
    b.box([hx - 0.26, y + 1.32, hz - 0.18], [hx + 0.26, y + 1.48, hz + 0.18], () => 'marble')
  }

  /* ---------------- Estate dry-stone wall */
  for (let i = 0; i < ESTATE_BOUNDARY.length; i++) {
    const [ax, az] = ESTATE_BOUNDARY[i]
    const [bx, bz] = ESTATE_BOUNDARY[(i + 1) % ESTATE_BOUNDARY.length]
    if (az < -54 && bz < -54) continue // terrace front
    const len = Math.hypot(bx - ax, bz - az)
    const n = Math.max(1, Math.round(len / 1.6))
    const rot = -Math.atan2(bz - az, bx - ax)
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n
      const cx = ax + (bx - ax) * t
      const cz = az + (bz - az) * t
      const gy = terrainHeight(cx, cz)
      const h = 0.62 + rand() * 0.18
      const s = 0.85 + rand() * 0.2
      b.color = [s, s * 0.98, s * 0.95]
      b.orientedBox([cx, gy + h / 2 - 0.25, cz], [len / n + 0.08, h + 0.5, 0.55 + rand() * 0.1], rot + (rand() - 0.5) * 0.03, 'stone')
    }
  }
  return b.build()
}

/** Herm busts (spheres for heads) — simple stand-ins until the Meshy herm is integrated. */
function herBusts() {
  const head = new SphereGeometry(0.15, 16, 12)
  head.scale(0.9, 1.1, 0.95)
  const beard = new SphereGeometry(0.12, 12, 8)
  beard.scale(1, 0.9, 0.8)
  return { head, beard }
}

export function Grounds() {
  const mats = useArchMaterials()
  const geos = useMemo(() => buildGrounds(), [])
  useStaticGeometry(geos)
  const busts = useMemo(() => herBusts(), [])

  // Vine foliage on the pergola.
  const vine = useMemo(() => {
    const { x, z, rotY, width, depth, height } = PERGOLA_DEF
    const y0 = terrainHeight(x, z)
    const rand = rng(515)
    const L = local(0, 0, rotY)
    const clumps: Clump[] = []
    for (let i = 0; i < 14; i++) {
      const lx = (rand() - 0.5) * (width + 0.6)
      const lz = (rand() - 0.5) * (depth + 0.6)
      const p = L(lx, 0, lz)
      clumps.push({ c: [p[0], height + 0.45 + rand() * 0.25, p[2]], r: 0.7 + rand() * 0.4, sy: 0.45 })
    }
    // Trunks of the vine climbing two pillars.
    for (const [px, pz] of [
      [-width / 2, depth / 2],
      [width / 2, -depth / 2],
    ]) {
      const p = L(px, 0, pz)
      for (let k = 0; k < 4; k++) clumps.push({ c: [p[0] + (rand() - 0.5) * 0.3, 0.6 + k * 0.6, p[2] + (rand() - 0.5) * 0.3], r: 0.35, sy: 1 })
    }
    const geo = cardsGeometry(clumps, { cards: 34, size: [0.45, 0.75], seed: 77, flexHeight: height + 1, tint: [0.8, 1.1] })
    geo.translate(x, y0, z)
    const tex = createLeafTexture('shrub')
    const mat = new MeshStandardMaterial({ map: tex, alphaTest: 0.42, side: DoubleSide, vertexColors: true, roughness: 0.8, color: '#b9c98f' })
    mat.alphaToCoverage = true
    patchFoliage(mat, { sway: 0.6, translucency: 0.9 })
    return { geo, mat, tex }
  }, [])

  // Scrolls on the writing table.
  const scrolls = useMemo(() => {
    const g = new CylinderGeometry(0.045, 0.045, 0.34, 14)
    g.rotateZ(Math.PI / 2)
    return g
  }, [])

  useEffect(
    () => () => {
      geos.forEach((g: BufferGeometry) => g.dispose())
      busts.head.dispose()
      busts.beard.dispose()
      vine.geo.dispose()
      vine.mat.dispose()
      vine.tex.dispose()
      scrolls.dispose()
    },
    [geos, busts, vine, scrolls],
  )

  const t = PERGOLA_DEF.table
  const ty = terrainHeight(t.x, t.z) + 0.02 + 0.8

  return (
    <group>
      {!hasModel('herm-bust') &&
        TERRACE_PROPS.herms.map(([hx, hz], i) => (
        <group key={i} position={[hx, TERRACE_Y + 1.62, hz]} rotation={[0, Math.PI, 0]}>
          <mesh geometry={busts.head} material={mats.marble} castShadow />
          <mesh geometry={busts.beard} material={mats.marble} position={[0, -0.1, 0.06]} castShadow />
        </group>
      ))}
      <CullGroup center={VINE_CENTER} radius={5} far={VINE_FAR}>
        <mesh geometry={vine.geo} material={vine.mat} castShadow receiveShadow />
      </CullGroup>
      {!hasModel('writing-table') && (
      <group position={[t.x, ty, t.z]} rotation={[0, PERGOLA_DEF.rotY, 0]}>
        <mesh geometry={scrolls} material={mats.parchment} position={[-0.1, 0, -0.05]} rotation={[0, 0.3, 0]} castShadow />
        <mesh geometry={scrolls} material={mats.parchment} position={[0.05, 0, 0.18]} rotation={[0, -0.2, 0]} castShadow />
        <mesh geometry={scrolls} material={mats.parchment} position={[-0.25, 0.08, 0.1]} rotation={[0, 0.9, 0]} castShadow />
      </group>
      )}
    </group>
  )
}
