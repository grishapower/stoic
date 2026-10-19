import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Euler, InstancedMesh, Matrix4, Quaternion, Sphere, Vector3, type Material, type Mesh, type Object3D } from 'three'
import { globalUniforms } from '../materials/common'
import { useGame } from '../store'
import { evening } from '../world/evening'
import { buildScatter, COVE_FIRE, type ScatterSet } from '../world/scatter'
import { terrainHeight } from '../world/terrain'
import { smokeTexture } from './Bay'
import { Flame } from './Flame'
import { InstanceSource, RadialSet } from './geom/instances'
import { Puffs } from './geom/puffs'
import { lodEntry, useLod } from './lod'
import { hasModel, modelUrl, Quiet } from './Props'
import { QUALITY } from './quality'

/**
 * Open CC0 models scattered as instanced meshes: one InstancedMesh per
 * (variant node, sub-mesh). Variant sets keep all variants at the origin,
 * so a node's meshes are taken relative to the node itself.
 *
 * Plants along the walk are drawn only within `scatter.plantFar` of the
 * camera (re-picked per instance when the camera has moved a metre, so they
 * cost one draw call per sub-mesh), with fewer shape variants on lower
 * quality; the cove's rocks and gear are static and distance-culled like the
 * GLB props (quality.ts).
 */

const PLANTS = new Set(['helichrysum-clump', 'calendula-wild', 'dry-scrub'])
/** Sets whose shape variants may be folded together on lower quality (one draw call per variant). */
const FOLDABLE = new Set([...PLANTS, 'iceplant-coastal'])
const ROCKS = new Set(['rock-coast-ledge', 'rock-boulder-block', 'rock-rubble-cluster', 'rock-boulder-jagged', 'rock-limestone-slab', 'rock-boulder-pale'])
const REPICK = 1.0
const camPos = new Vector3()

interface PlantRing {
  set: RadialSet
  rMin: number
  rMax: number
}

function ScatterSetMesh({ set }: { set: ScatterSet }) {
  const gltf = useGLTF(modelUrl(set.id), false, true)
  const quality = useGame((s) => s.settings.quality)
  const built = useMemo(() => {
    const q = QUALITY[quality]
    const plant = PLANTS.has(set.id)
    gltf.scene.updateMatrixWorld(true)
    // Fewer shape variants on lower quality: fold the extra nodes onto the kept ones.
    const nodes = [...new Set(set.items.map((it) => it.node ?? ''))].sort()
    const keep = FOLDABLE.has(set.id) ? nodes.slice(0, Math.max(1, q.scatter.maxVariants)) : nodes
    const byNode = new Map<string, typeof set.items>()
    for (const it of set.items) {
      const key = keep[nodes.indexOf(it.node ?? '') % keep.length]
      if (!byNode.has(key)) byNode.set(key, [])
      byNode.get(key)!.push(it)
    }
    const statics: { inst: InstancedMesh; size: number }[] = []
    const rings: PlantRing[] = []
    const objects: Object3D[] = []
    const inv = new Matrix4()
    const rel = new Matrix4()
    const m = new Matrix4()
    const qt = new Quaternion()
    const e = new Euler()
    const p = new Vector3()
    const sc = new Vector3()
    const cast = set.castShadow && (ROCKS.has(set.id) || set.id === 'jetty-section' || set.id === 'wooden-tub' ? q.scatter.rockShadow : true)
    for (const [node, items] of byNode) {
      const src: Object3D | undefined = node ? gltf.scene.getObjectByName(node) : gltf.scene
      if (!src) {
        console.warn(`[scatter] ${set.id}: node ${node} not found`)
        continue
      }
      inv.copy(src.matrixWorld).invert()
      src.traverse((o) => {
        const mesh = o as Mesh
        if (!mesh.isMesh) return
        rel.multiplyMatrices(inv, mesh.matrixWorld)
        const source = new InstanceSource(items.length)
        items.forEach((it, i) => {
          qt.setFromEuler(e.set(0, it.rotY, 0))
          m.compose(p.set(it.x, it.y, it.z), qt, sc.setScalar(it.scale))
          m.multiply(rel)
          source.set(i, m.elements)
        })
        const material = mesh.material as Material
        if (plant) {
          if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere()
          const pad = mesh.geometry.boundingSphere!.radius * 3 + 0.5
          const members = items.map((_, i) => i)
          const shadow = set.castShadow ? Math.min(q.scatter.plantShadow, q.scatter.plantFar) : 0
          const bands: [number, number, boolean][] = []
          if (shadow > 0) bands.push([0, shadow, true])
          if (shadow < q.scatter.plantFar) bands.push([shadow, q.scatter.plantFar, false])
          for (const [rMin, rMax, c] of bands) {
            const rs = new RadialSet(source, members, [{ geometry: mesh.geometry, material, castShadow: c, receiveShadow: true, name: `scatter:${set.id}` }], pad)
            rings.push({ set: rs, rMin, rMax })
            objects.push(...rs.meshes)
          }
        } else {
          const inst = new InstancedMesh(mesh.geometry, material, items.length)
          for (let i = 0; i < items.length; i++) inst.instanceMatrix.array.set(source.matrices.subarray(i * 16, i * 16 + 16), i * 16)
          inst.name = `scatter:${set.id}`
          inst.castShadow = cast
          inst.receiveShadow = true
          inst.computeBoundingSphere()
          // Size of one item (not of the spread-out set) decides its draw distance.
          if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere()
          const size = mesh.geometry.boundingSphere!.radius * 2 * rel.getMaxScaleOnAxis() * Math.max(...items.map((it) => it.scale))
          statics.push({ inst, size })
          objects.push(inst)
        }
      })
    }
    const lod = statics.map(({ inst, size }) => lodEntry(inst, { far: Math.min(q.scatter.coveFar, Math.max(q.props.minFar, size * q.props.farPerMetre)) }))
    return { objects, rings, statics, lod }
  }, [gltf, set, quality])
  useLod(built.lod)
  const last = useRef({ x: Infinity, z: Infinity, built: null as unknown })

  useFrame(({ camera }) => {
    if (built.rings.length === 0) return
    camera.getWorldPosition(camPos)
    const l = last.current
    if (l.built === built && Math.hypot(camPos.x - l.x, camPos.z - l.z) < REPICK) return
    l.built = built
    l.x = camPos.x
    l.z = camPos.z
    for (const r of built.rings) r.set.select(camPos.x, camPos.z, r.rMin, r.rMax)
  })

  useEffect(
    () => () => {
      built.statics.forEach((m) => m.inst.dispose())
      built.rings.forEach((r) => r.set.dispose())
    },
    [built],
  )
  return (
    <>
      {built.objects.map((o) => (
        <primitive key={o.uuid} object={o} />
      ))}
    </>
  )
}

/* ------------------------------------------------------------ Fishermen's fire */

const PUFFS = 16

function CoveFire() {
  const base = useMemo(() => new Vector3(COVE_FIRE.x, terrainHeight(COVE_FIRE.x, COVE_FIRE.z) + 0.08, COVE_FIRE.z), [])
  // All puffs in one instanced draw call.
  const res = useMemo(() => {
    const tex = smokeTexture()
    const puffs = new Puffs(PUFFS, tex, '#cfc6bb', new Sphere(new Vector3(base.x + 6, base.y + 18, base.z - 1.5), 26))
    return { tex, puffs }
  }, [base])
  useEffect(
    () => () => {
      res.tex.dispose()
      res.puffs.dispose()
    },
    [res],
  )
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const wind = globalUniforms.uWind.value
    for (let i = 0; i < PUFFS; i++) {
      // A thin plume that climbs past the cliff top, so the fire reads from the terrace.
      const life = (t * 0.035 + i / PUFFS) % 1
      res.puffs.set(
        i,
        base.x + life * life * (6 + wind * 10),
        base.y + 0.5 + life * 34,
        base.z - life * 3,
        0.6 + life * 7,
        Math.sin(Math.PI * Math.min(1, life * 1.6)) * 0.3 * (1 - life * 0.7),
      )
    }
    res.puffs.commit()
  })
  return (
    <group>
      <primitive object={res.puffs.mesh} />
      <Flame position={[base.x, base.y, base.z]} size={0.32} level={() => 0.45 + 0.55 * evening(useGame.getState().progress).lamps} light={0} seed={11} />
    </group>
  )
}

export function OpenScatter() {
  const quality = useGame((s) => s.settings.quality)
  const sets = useMemo(() => buildScatter(quality).filter((s) => hasModel(s.id)), [quality])
  return (
    <group>
      {sets.map((set) => (
        <Quiet key={set.id}>
          <Suspense fallback={null}>
            <ScatterSetMesh set={set} />
          </Suspense>
        </Quiet>
      ))}
      {hasModel('stone-fire-pit') && <CoveFire />}
    </group>
  )
}
