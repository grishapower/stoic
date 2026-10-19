import { useGLTF } from '@react-three/drei'
import { Component, Suspense, useMemo, type ReactNode } from 'react'
import { Group, Mesh, MeshStandardMaterial, type Object3D } from 'three'
import { HERO_OLIVES, PERGOLA_DEF, POTS, TERRACE_PROPS } from '../world/architecture'
import { groundHeight } from '../world/ground'
import { TERRACE_Y } from '../world/layout'
import { CITRUS_TREES } from '../world/citrus'
import { VIEWPOINT_BENCH } from '../world/props'
import { usePropLod } from './propLod'

/**
 * Props from GLB files: Meshy-generated (models.json) and open CC0 models
 * (open-models.json), both meshopt + WebP. `hasModel()` lets procedural
 * geometry skip pieces a model replaces.
 */

export interface ModelEntry {
  file: string
  size?: [number, number, number]
  notes?: string
  waterline?: number
  /** Special points recorded by the asset pipeline (model space, metres). */
  flamePoint?: [number, number, number]
  spoutTip?: [number, number, number]
  nicheFloorY?: number
  recommendedPillarHeight?: number
}
const modelsModules = import.meta.glob('../../data/generated/models.json', { eager: true, import: 'default' })
const openModules = import.meta.glob('../../data/generated/open-models.json', { eager: true, import: 'default' })
const models = {
  ...((Object.values(openModules)[0] ?? {}) as Record<string, ModelEntry>),
  ...((Object.values(modelsModules)[0] ?? {}) as Record<string, ModelEntry>),
}

export function hasModel(id: string) {
  return !!models[id]
}

export function modelInfo(id: string): ModelEntry | undefined {
  return models[id]
}

function url(id: string) {
  return import.meta.env.BASE_URL + models[id].file
}

export function modelUrl(id: string) {
  return url(id)
}

interface PropProps {
  id: string
  position: [number, number, number]
  rotationY?: number
  /** Full Euler rotation (overrides rotationY). */
  rotation?: [number, number, number]
  scale?: number | [number, number, number]
  shadows?: boolean
  /** Variant sets (open models): use only this node, e.g. "driftwood_b". */
  node?: string
}

function GlbInstance({ id, position, rotationY = 0, rotation, scale = 1, shadows = true, node }: PropProps) {
  const gltf = useGLTF(url(id), false, true)
  const obj = useMemo(() => {
    const src = (node && gltf.scene.getObjectByName(node)) || gltf.scene
    const g = src.clone(true) as Group
    if (src !== gltf.scene) g.position.set(0, 0, 0)
    g.traverse((o: Object3D) => {
      const m = o as Mesh
      if (m.isMesh) {
        m.castShadow = shadows
        m.receiveShadow = true
        const mat = m.material as MeshStandardMaterial
        if (mat && 'roughness' in mat) mat.roughness = Math.max(mat.roughness, 0.55)
      }
    })
    return g
  }, [gltf, shadows, node])
  usePropLod(obj, shadows)
  return <primitive object={obj} position={position} rotation={rotation ?? [0, rotationY, 0]} scale={scale} />
}

export class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch(err: unknown) {
    console.warn('[props] model failed to load', err)
  }
  override render() {
    return this.state.failed ? null : this.props.children
  }
}

export function GlbProp(p: PropProps) {
  if (!hasModel(p.id)) return null
  return (
    <Quiet>
      <Suspense fallback={null}>
        <GlbInstance {...p} />
      </Suspense>
    </Quiet>
  )
}

export function Props() {
  const t = PERGOLA_DEF.table
  return (
    <group>
      <GlbProp id="stone-bench" position={[VIEWPOINT_BENCH.x, groundHeight(VIEWPOINT_BENCH.x, VIEWPOINT_BENCH.z), VIEWPOINT_BENCH.z]} rotationY={VIEWPOINT_BENCH.rotY} scale={1.1} />
      {/* Writer's side (+Z) toward the stool. */}
      <GlbProp id="writing-table" position={[t.x, groundHeight(t.x, t.z), t.z]} rotationY={PERGOLA_DEF.rotY} />
      {/* Herms face the middle of the terrace. */}
      {TERRACE_PROPS.herms.map(([x, z], i) => (
        <GlbProp key={`herm-${i}`} id="herm-bust" position={[x, TERRACE_Y + 1.48, z]} rotationY={x < 0 ? Math.PI / 2 : -Math.PI / 2} scale={0.85} />
      ))}
      {POTS.map(([x, z], i) => (
        <GlbProp
          key={`pot-${i}`}
          id={i % 3 === 1 ? 'amphora-planter-tall' : 'amphora-planter'}
          position={[x, groundHeight(x, z) - 0.02, z]}
          rotationY={i * 1.3}
          scale={i % 3 === 1 ? 0.85 : 0.75}
        />
      ))}
      {/* Terracotta pots for the potted citrus on the porch. */}
      {CITRUS_TREES.filter((t) => t.potted).map((t) => (
        <GlbProp key={`citrus-pot-${t.id}`} id="amphora-planter" position={[t.x, t.y - 0.02, t.z]} rotationY={t.rot} scale={0.75} />
      ))}
      {HERO_OLIVES.map(([x, z, r, s], i) => (
        <GlbProp key={`olive-${i}`} id="olive-tree" position={[x, groundHeight(x, z) - 0.05, z]} rotationY={r} scale={s} />
      ))}
    </group>
  )
}
