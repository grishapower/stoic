import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferAttribute, Color, DoubleSide, Matrix4, MeshStandardMaterial, Quaternion, RepeatWrapping, Vector3, type BufferGeometry, type Object3D } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createLeafTexture, type LeafKind } from '../materials/common'
import { useArchMaterials } from '../materials/library'
import { useGame, type Quality } from '../store'
import { rng } from '../world/noise'
import { CYPRESSES, OLIVES, PINES, SHRUBS, type TreeInstance } from '../world/vegetation'
import { CITRUS_POT_LIFT, CITRUS_TREES, citrusCanopy } from '../world/citrus'
import { blobGeometry, branchesGeometry, cardsGeometry, patchFoliage, spindleGeometry, type Clump } from './geom/foliage'
import { cellsOf, InstanceSource, RadialSet } from './geom/instances'
import { QUALITY } from './quality'

/**
 * Trees and shrubs: two or three procedural variants per species, instanced.
 *
 * Distance LOD around the camera (radii per quality in quality.ts): plants
 * within the detail radius are drawn with leaf cards and canopy cores (the
 * inner ring also casts shadows), everything beyond as a solid canopy on a
 * coarse trunk, in static 300 m cells so off-screen cells are culled. The
 * near/far split is re-picked when the camera has moved about a metre.
 */

interface Variant {
  trunk: BufferGeometry | null
  blobs: BufferGeometry | null
  cards: BufferGeometry
  /** Cheap distant LOD: solid canopy only (no leaf cards)… */
  farBlobs: BufferGeometry | null
  /** …on a coarse trunk (null: none / hidden by the canopy). */
  farTrunk: BufferGeometry | null
}

/** Tag every vertex as canopy (0) or bark (1) for the far material (see patchFoliage `bark`). */
function tagged(g: BufferGeometry, bark: number) {
  const out = g.index ? g.toNonIndexed() : g.clone()
  out.setAttribute('aBark', new BufferAttribute(new Float32Array(out.getAttribute('position').count).fill(bark), 1))
  return out
}

/** Far LOD as one geometry: canopy + coarse trunk share the far material (one draw call instead of two). */
function farGeometry(v: Variant): BufferGeometry | null {
  if (!v.farBlobs || !v.farTrunk) return v.farBlobs
  const a = tagged(v.farBlobs, 0)
  const b = tagged(v.farTrunk, 1)
  const merged = mergeGeometries([a, b], false)
  a.dispose()
  b.dispose()
  if (!merged) return v.farBlobs
  merged.computeBoundingSphere()
  return merged
}

/* ------------------------------------------------------------- Species builders */

function cypressVariant(seed: number): Variant {
  const rand = rng(seed)
  const height = 10 + rand() * 3
  const maxR = 0.85 + rand() * 0.2
  const clumps: Clump[] = []
  const n = 16
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n
    const y = 0.6 + t * (height - 0.6)
    const r = maxR * Math.pow(Math.sin(Math.PI * Math.min(0.97, 0.12 + t * 0.9)), 0.8) * (t > 0.85 ? 1 - (t - 0.85) * 3.5 : 1)
    clumps.push({ c: [(rand() - 0.5) * 0.15, y, (rand() - 0.5) * 0.15], r: Math.max(0.18, r), sy: 1.25 })
  }
  return {
    trunk: branchesGeometry([{ points: [[0, -0.2, 0], [0.02, 1.2, 0.01], [0, 3, 0]], r0: 0.2, r1: 0.1 }], height, 6),
    blobs: spindleGeometry(height, maxR * 0.98, seed + 1),
    farBlobs: spindleGeometry(height, maxR, seed + 1, 12, 9),
    farTrunk: null,
    cards: cardsGeometry(clumps, { cards: 34, size: [0.28, 0.45], seed: seed + 2, flexHeight: height, tint: [0.85, 1.15], depth: [0.92, 1.08] }),
  }
}

function oliveVariant(seed: number): Variant {
  const rand = rng(seed)
  const branches: { points: [number, number, number][]; r0: number; r1: number }[] = []
  // Gnarled, leaning main trunk.
  const lean = (rand() - 0.5) * 0.6
  const trunkTop: [number, number, number] = [lean, 1.5 + rand() * 0.4, (rand() - 0.5) * 0.4]
  branches.push({
    points: [
      [0, -0.3, 0],
      [0.12, 0.5, -0.05],
      [lean * 0.4 - 0.1, 1.0, 0.1],
      trunkTop,
    ],
    r0: 0.32,
    r1: 0.2,
  })
  const clumps: Clump[] = []
  const nb = 3 + Math.floor(rand() * 2)
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2 + rand() * 0.8
    const reach = 1.4 + rand() * 1.0
    const tip: [number, number, number] = [trunkTop[0] + Math.cos(a) * reach, trunkTop[1] + 1.2 + rand() * 0.9, trunkTop[2] + Math.sin(a) * reach]
    branches.push({
      points: [
        trunkTop,
        [trunkTop[0] + Math.cos(a) * reach * 0.45, trunkTop[1] + 0.55, trunkTop[2] + Math.sin(a) * reach * 0.45 + 0.1],
        tip,
      ],
      r0: 0.16,
      r1: 0.06,
    })
    clumps.push({ c: [tip[0], tip[1] + 0.45, tip[2]], r: 1.15 + rand() * 0.45, sy: 0.75 })
    clumps.push({ c: [tip[0] * 0.6, tip[1] + 0.1, tip[2] * 0.6], r: 0.9 + rand() * 0.3, sy: 0.7 })
  }
  clumps.push({ c: [trunkTop[0], trunkTop[1] + 1.9, trunkTop[2]], r: 1.25, sy: 0.65 })
  return {
    trunk: branchesGeometry(branches, 5, 7),
    blobs: blobGeometry(clumps, seed + 1, 5, 0.55),
    farBlobs: blobGeometry(clumps, seed + 1, 5, 0.95, 0),
    farTrunk: branchesGeometry(branches.slice(0, 1), 5, 5, 2),
    cards: cardsGeometry(clumps, { cards: 30, size: [0.7, 1.15], seed: seed + 2, flexHeight: 5, tint: [0.8, 1.1] }),
  }
}

function pineVariant(seed: number): Variant {
  const rand = rng(seed)
  const h = 6.2 + rand() * 1.8
  const lean: [number, number] = [(rand() - 0.5) * 1.4, (rand() - 0.5) * 1.4]
  const fork: [number, number, number] = [lean[0] * 0.75, h * 0.72, lean[1] * 0.75]
  const branches: { points: [number, number, number][]; r0: number; r1: number }[] = [
    { points: [[0, -0.3, 0], [lean[0] * 0.2, h * 0.35, lean[1] * 0.2], fork], r0: 0.34, r1: 0.2 },
  ]
  const R = 4.6 + rand() * 1.0
  const crown = h + 1.0
  const clumps: Clump[] = []
  // Umbrella canopy: a flattened dome of overlapping pads, limbs reaching each ring pad.
  clumps.push({ c: [fork[0], crown + 0.85, fork[2]], r: 2.4, sy: 0.42 })
  const rings: [number, number, number, number][] = [
    // [count, radius factor, pad radius, height offset]
    [7, 0.42, 2.05, 0.65],
    [12, 0.8, 1.75, 0.4],
  ]
  for (const [count, rf, pr, dh] of rings) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand() * 0.4
      const r = R * rf * (0.9 + rand() * 0.2)
      const c: [number, number, number] = [fork[0] + Math.cos(a) * r, crown + dh + rand() * 0.25, fork[2] + Math.sin(a) * r]
      clumps.push({ c, r: pr * (0.9 + rand() * 0.2), sy: 0.42 })
      if (rf < 0.6 || i % 2 === 0) {
        branches.push({
          points: [fork, [fork[0] + Math.cos(a) * r * 0.45, crown - 0.6, fork[2] + Math.sin(a) * r * 0.45], [c[0], c[1] - 0.35, c[2]]],
          r0: rf < 0.6 ? 0.17 : 0.11,
          r1: 0.05,
        })
      }
    }
  }
  return {
    trunk: branchesGeometry(branches, h + 2, 7),
    blobs: blobGeometry(clumps, seed + 1, h + 2, 0.9),
    farBlobs: blobGeometry(clumps, seed + 1, h + 2, 1.0, 0),
    // Trunk + the thick inner limbs (the outer ones hide under the canopy at a distance).
    farTrunk: branchesGeometry(branches.filter((b) => b.r0 > 0.12), h + 2, 4, 2),
    cards: cardsGeometry(clumps, { cards: 22, size: [1.0, 1.6], seed: seed + 2, flexHeight: h + 2, tint: [0.85, 1.1], depth: [0.9, 1.05] }),
  }
}

/** Citrus tree built from the same canopy layout the fruit is placed on (world/citrus.ts). */
function citrusVariant(variant: number): Variant {
  const { clumps, trunkTop } = citrusCanopy(variant)
  const branches: { points: [number, number, number][]; r0: number; r1: number }[] = [
    { points: [[0, -0.2, 0], [trunkTop[0] * 0.5, trunkTop[1] * 0.5, trunkTop[2] * 0.5], trunkTop], r0: 0.11, r1: 0.08 },
  ]
  for (const cl of clumps.slice(1, 5)) {
    branches.push({ points: [trunkTop, [(trunkTop[0] + cl.c[0]) / 2, (trunkTop[1] + cl.c[1]) / 2 + 0.1, (trunkTop[2] + cl.c[2]) / 2], cl.c], r0: 0.06, r1: 0.025 })
  }
  const cs: Clump[] = clumps.map((c) => ({ c: c.c, r: c.r, sy: c.sy }))
  return {
    trunk: branchesGeometry(branches, 3, 6),
    blobs: blobGeometry(cs, 900 + variant, 3, 0.62, 2),
    farBlobs: blobGeometry(cs, 900 + variant, 3, 0.98, 0),
    farTrunk: branchesGeometry(branches.slice(0, 1), 3, 4, 2),
    cards: cardsGeometry(cs, { cards: 46, size: [0.32, 0.55], seed: 950 + variant, flexHeight: 3, tint: [0.85, 1.12], depth: [0.72, 1.0] }),
  }
}

function shrubVariant(seed: number, kind: 'myrtle' | 'oleander' | 'rosemary'): Variant {
  const rand = rng(seed)
  const clumps: Clump[] = []
  const h = kind === 'oleander' ? 1.7 : kind === 'rosemary' ? 0.7 : 1.1
  const n = 4 + Math.floor(rand() * 3)
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2
    const r = rand() * 0.5
    clumps.push({ c: [Math.cos(a) * r, h * (0.4 + rand() * 0.45), Math.sin(a) * r], r: (0.45 + rand() * 0.25) * (h / 1.1) ** 0.6, sy: 0.85 })
  }
  return {
    trunk: null,
    blobs: blobGeometry(clumps, seed + 1, h * 2, 0.6),
    farBlobs: blobGeometry(clumps, seed + 1, h * 2, 0.95, 0),
    farTrunk: null,
    cards: cardsGeometry(clumps, { cards: 18, size: [0.4, 0.7], seed: seed + 2, flexHeight: h * 1.6, tint: [0.8, 1.1] }),
  }
}

/* ------------------------------------------------------------- Instancing + distance LOD */

interface Species {
  name: string
  kind: 'tree' | 'shrub'
  variants: Variant[]
  instances: TreeInstance[]
  leaf: MeshStandardMaterial
  blob: MeshStandardMaterial
  farBlob: MeshStandardMaterial
  /** Far LOD material of the lower presets (see foliageMaterials). */
  farLit: MeshStandardMaterial
  /** Bounding radius of one plant around its base (crown reach / height, with sway). */
  pad: number
  /** Far LOD keeps every variant (citrus: the fruit hangs on the variant's canopy). */
  keepFarVariants?: boolean
  /** Per variant: the far LOD geometry (canopy + trunk merged), filled once. */
  far: (BufferGeometry | null)[]
  /** Per variant: canopy core + trunk in one geometry (cypress, citrus: the trunk hides in the canopy), or null. */
  coreWithTrunk: (BufferGeometry | null)[]
}

/** Trunk drawn by the canopy core's material (flat bark tone): one near draw call less per variant. */
function coreWithTrunk(v: Variant): BufferGeometry | null {
  if (!v.blobs || !v.trunk) return null
  const a = tagged(v.blobs, 0)
  const b = tagged(v.trunk, 1)
  const merged = mergeGeometries([a, b], false)
  a.dispose()
  b.dispose()
  merged?.computeBoundingSphere()
  return merged
}

const BARK_TONE = '#5b4b3d'

function foliageMaterials(kind: LeafKind, blobColor: string, transl: number) {
  const tex = createLeafTexture(kind)
  if (kind === 'cypress') {
    // Dense scale-leaf texture for the solid spindle core.
    const core = createLeafTexture('cypress', true)
    core.wrapS = core.wrapT = RepeatWrapping
    const leaf = new MeshStandardMaterial({ map: tex, alphaTest: 0.42, side: DoubleSide, vertexColors: true, roughness: 0.85, metalness: 0 })
    leaf.alphaToCoverage = true
    patchFoliage(leaf, { sway: 0.35, translucency: transl })
    const blob = new MeshStandardMaterial({ map: core, color: new Color(blobColor), vertexColors: true, roughness: 0.92, metalness: 0 })
    patchFoliage(blob, { sway: 0.35, translucency: transl * 0.5, bark: BARK_TONE })
    const farBlob = blob
    return { leaf, blob, farBlob, farLit: blob }
  }
  const leaf = new MeshStandardMaterial({ map: tex, alphaTest: 0.42, side: DoubleSide, vertexColors: true, roughness: 0.82, metalness: 0 })
  // Soft, anti-aliased leaf edges with MSAA (no sorting needed).
  leaf.alphaToCoverage = true
  patchFoliage(leaf, { sway: 1, translucency: transl })
  // Dense, tileable leaf texture on the solid core: reads as foliage even up close.
  const core = createLeafTexture(kind, true)
  core.wrapS = core.wrapT = RepeatWrapping
  const blob = new MeshStandardMaterial({ map: core, color: new Color(blobColor).multiplyScalar(1.6), vertexColors: true, roughness: 0.9, metalness: 0 })
  patchFoliage(blob, { sway: 1, translucency: transl * 0.4, nearFade: [0.7, 1.6], bark: BARK_TONE })
  // Distant canopies: a lighter tone stands in for the leaf cards' colour.
  const farBlob = new MeshStandardMaterial({ map: tex, color: new Color(blobColor).multiplyScalar(1.5), vertexColors: true, roughness: 0.95, metalness: 0 })
  // Distant trunks are merged into the canopy mesh and drawn in a flat bark tone.
  patchFoliage(farBlob, { sway: 0.3, translucency: transl * 0.5, bark: BARK_TONE })
  // Far LOD that starts a few metres away (lower presets): the dense core texture in the leaves' own tone, so a
  // plant keeps its brightness when its leaf cards drop out (farBlob's sparse texture reads almost black up close).
  const farLit = new MeshStandardMaterial({ map: core, color: new Color(1.15, 1.15, 1.15), vertexColors: true, roughness: 0.85, metalness: 0 })
  patchFoliage(farLit, { sway: 0.5, translucency: transl * 0.8, bark: BARK_TONE })
  return { leaf, blob, farBlob, farLit }
}


interface NearRing {
  set: RadialSet
  rMin: number
  rMax: number
}

interface FarChunk {
  set: RadialSet
  x: number
  z: number
  r: number
  /** Drawn between these distances (the near LOD takes over inside `detail`). */
  detail: number
  cut: number
  state: 'full' | 'partial' | 'empty' | 'new'
}

interface Built {
  objects: Object3D[]
  near: NearRing[]
  far: FarChunk[]
  sets: RadialSet[]
}

/** Far-LOD cells: big, so the cheap distant canopies cost few draw calls but off-screen cells are still culled. */
const FAR_CELL = 300
/** Re-pick the near/far sets after the camera moved this far (m, horizontal). */
const REPICK = 1.0

function buildSets(species: Species[], sources: InstanceSource[], bark: MeshStandardMaterial, quality: Quality): Built {
  const q = QUALITY[quality]
  const objects: Object3D[] = []
  const near: NearRing[] = []
  const far: FarChunk[] = []
  const sets: RadialSet[] = []
  species.forEach((sp, si) => {
    const src = sources[si]
    const tree = sp.kind === 'tree'
    const detail = tree ? q.treeDetail : q.shrubDetail
    const shadow = Math.min(detail, tree ? q.treeShadow : q.shrubShadow)
    const cut = tree ? Infinity : q.shrubFar
    const nv = sp.variants.length
    // Fewer shapes on lower quality: extra variants fold onto the first ones (positions never change).
    const nNear = sp.keepFarVariants ? nv : Math.max(1, Math.min(nv, tree ? q.treeVariants : q.shrubVariants))
    const variantOf = (i: number) => Math.min(nv - 1, Math.floor(sp.instances[i].v * nv)) % nNear
    // Distant shrubs are formless blobs: one shape is enough. Citrus keeps its shapes (the fruit hangs on
    // them) unless the preset asks for a single far variant.
    const nFar = sp.keepFarVariants && q.farVariants > 1 ? nv : tree ? Math.max(1, Math.min(nv, q.farVariants)) : 1

    // Near: full detail around the camera; a shadow-casting inner ring and (if shorter) a plain outer ring.
    sp.variants.forEach((v, vi) => {
      const members: number[] = []
      for (let i = 0; i < src.count; i++) if (variantOf(i) === vi) members.push(i)
      if (members.length === 0) return
      const rings: [number, number, boolean][] = []
      if (shadow > 0) rings.push([0, shadow, true])
      if (shadow < detail) rings.push([shadow, detail, false])
      for (const [rMin, rMax, cast] of rings) {
        const parts = []
        const core = q.mergeNearTrunks ? sp.coreWithTrunk[vi] : null
        if (core) parts.push({ geometry: core, material: sp.blob, castShadow: cast, receiveShadow: true, name: `veg:${sp.name}:blob` })
        else {
          if (v.trunk) parts.push({ geometry: v.trunk, material: bark, castShadow: cast, receiveShadow: true, name: `veg:${sp.name}:trunk` })
          if (v.blobs) parts.push({ geometry: v.blobs, material: sp.blob, castShadow: cast, receiveShadow: true, name: `veg:${sp.name}:blob` })
        }
        parts.push({ geometry: v.cards, material: sp.leaf, castShadow: cast, receiveShadow: true, name: `veg:${sp.name}:cards` })
        const set = new RadialSet(src, members, parts, sp.pad)
        sets.push(set)
        near.push({ set, rMin, rMax })
        objects.push(...set.meshes)
      }
    })

    // Far: solid canopies in static cells; members inside the detail radius (or beyond the cut) are skipped.
    for (let fv = 0; fv < nFar; fv++) {
      const farGeo = sp.far[fv]
      if (!farGeo) continue
      const members: number[] = []
      for (let i = 0; i < src.count; i++) if (variantOf(i) % nFar === fv) members.push(i)
      // Shrubs: one set per kind (they are cut off at `shrubFar`, so the picked set is compact anyway).
      for (const cell of tree ? cellsOf(src.xs, src.zs, FAR_CELL, members) : [members]) {
        const material = q.farLit ? sp.farLit : sp.farBlob
        const parts = [{ geometry: farGeo, material, castShadow: false, receiveShadow: false, name: `veg:${sp.name}:far` }]
        const set = new RadialSet(src, cell, parts, sp.pad)
        sets.push(set)
        objects.push(...set.meshes)
        let cx = 0
        let cz = 0
        for (const i of cell) {
          cx += src.xs[i]
          cz += src.zs[i]
        }
        cx /= cell.length
        cz /= cell.length
        let r = 0
        for (const i of cell) r = Math.max(r, Math.hypot(src.xs[i] - cx, src.zs[i] - cz))
        far.push({ set, x: cx, z: cz, r, detail, cut, state: 'new' })
      }
    }
  })
  return { objects, near, far, sets }
}

/** Re-pick which plants are drawn in full detail (cheap; runs when the camera has moved ~1 m). */
function pick(built: Built, cx: number, cz: number) {
  for (const n of built.near) n.set.select(cx, cz, n.rMin, n.rMax)
  for (const f of built.far) {
    const dc = Math.hypot(f.x - cx, f.z - cz)
    const dMin = dc - f.r
    const dMax = dc + f.r
    if (dMin >= f.detail && dMax < f.cut) {
      if (f.state !== 'full') f.set.selectAll()
      f.state = 'full'
    } else if (dMax < f.detail || dMin >= f.cut) {
      if (f.state !== 'empty') f.set.clear()
      f.state = 'empty'
    } else {
      f.set.select(cx, cz, f.detail, f.cut)
      f.state = 'partial'
    }
  }
}

const camPos = new Vector3()

export function Vegetation() {
  const arch = useArchMaterials()
  const quality = useGame((s) => s.settings.quality)

  // Geometry, materials and instance matrices: built once.
  const base = useMemo(() => {
    const bark = arch.bark.clone()
    patchFoliage(bark, { sway: 0.4, translucency: 0 })

    const defs: Omit<Species, 'far' | 'coreWithTrunk'>[] = []
    const cyp = foliageMaterials('cypress', '#9cb37e', 0.7)
    defs.push({ name: 'cypress', kind: 'tree', variants: [1, 2, 3].map((k) => cypressVariant(100 + k)), instances: CYPRESSES, pad: 14, ...cyp })
    const olv = foliageMaterials('olive', '#66724f', 0.45)
    defs.push({ name: 'olive', kind: 'tree', variants: [1, 2, 3].map((k) => oliveVariant(200 + k * 7)), instances: OLIVES, pad: 7, ...olv })
    const pin = foliageMaterials('pine', '#4a6638', 0.45)
    defs.push({ name: 'pine', kind: 'tree', variants: [1, 2].map((k) => pineVariant(300 + k * 11)), instances: PINES, pad: 11, ...pin })

    const cit = foliageMaterials('citrus', '#365e2c', 0.5)
    cit.leaf.roughness = 0.5 // glossy citrus leaves
    defs.push({
      name: 'citrus',
      kind: 'tree',
      variants: [0, 1, 2].map((k) => citrusVariant(k)),
      instances: CITRUS_TREES.map((t) => ({ x: t.x, y: t.y + (t.potted ? CITRUS_POT_LIFT : 0), z: t.z, scale: t.scale, rot: t.rot, v: t.variant / 3 + 0.01 })),
      pad: 3.5,
      keepFarVariants: true,
      ...cit,
    })

    const shrubKinds = ['myrtle', 'rosemary', 'oleander'] as const
    for (const kind of shrubKinds) {
      const mats = foliageMaterials(kind === 'oleander' ? 'oleander' : 'shrub', kind === 'rosemary' ? '#4a5a3e' : '#344a26', 0.7)
      if (kind === 'rosemary') {
        mats.leaf.color.set('#a9b59a')
        mats.farLit.color.set('#a9b59a').multiplyScalar(1.15)
      }
      defs.push({
        name: kind,
        kind: 'shrub',
        variants: [1, 2].map((k) => shrubVariant(400 + k * 13 + kind.length, kind)),
        instances: SHRUBS.filter((s) => s.kind === kind),
        pad: 3,
        ...mats,
      })
    }

    // Canopy materials read `aBark` (see patchFoliage `bark`): every geometry they draw must carry it —
    // a missing attribute reads whatever generic value WebGL has for that slot, not necessarily 0.
    for (const d of defs) {
      for (const v of d.variants) {
        for (const g of [v.blobs, v.farBlobs]) {
          if (g && !g.getAttribute('aBark')) g.setAttribute('aBark', new BufferAttribute(new Float32Array(g.getAttribute('position').count), 1))
        }
      }
    }
    const species: Species[] = defs.map((d) => ({
      ...d,
      far: d.variants.map(farGeometry),
      coreWithTrunk: d.name === 'cypress' || d.name === 'citrus' ? d.variants.map(coreWithTrunk) : d.variants.map(() => null),
    }))

    const m = new Matrix4()
    const qt = new Quaternion()
    const p = new Vector3()
    const s = new Vector3()
    const up = new Vector3(0, 1, 0)
    const sources = species.map((sp) => {
      const src = new InstanceSource(sp.instances.length)
      sp.instances.forEach((t, i) => {
        qt.setFromAxisAngle(up, t.rot)
        p.set(t.x, t.y - 0.05, t.z)
        s.setScalar(t.scale)
        src.set(i, m.compose(p, qt, s).elements)
      })
      return src
    })
    return { species, sources, bark }
  }, [arch])

  const built = useMemo(() => buildSets(base.species, base.sources, base.bark, quality), [base, quality])
  const last = useRef({ x: Infinity, z: Infinity, built: null as Built | null })

  useFrame(({ camera }) => {
    camera.getWorldPosition(camPos)
    const l = last.current
    if (l.built === built && Math.hypot(camPos.x - l.x, camPos.z - l.z) < REPICK) return
    l.built = built
    l.x = camPos.x
    l.z = camPos.z
    pick(built, camPos.x, camPos.z)
  })

  useEffect(() => () => built.sets.forEach((s) => s.dispose()), [built])
  useEffect(
    () => () => {
      for (const sp of base.species) {
        for (const v of sp.variants) for (const g of [v.trunk, v.blobs, v.cards, v.farBlobs, v.farTrunk]) g?.dispose()
        sp.far.forEach((g, i) => g !== sp.variants[i].farBlobs && g?.dispose())
        sp.coreWithTrunk.forEach((g) => g?.dispose())
      }
      for (const mat of new Set(base.species.flatMap((s) => [s.leaf, s.blob, s.farBlob, s.farLit]))) {
        mat.map?.dispose()
        mat.dispose()
      }
      // The bark clone shares its textures with the architecture library.
      base.bark.dispose()
    },
    [base],
  )

  return (
    <group>
      {built.objects.map((o) => (
        <primitive key={o.uuid} object={o} />
      ))}
    </group>
  )
}
