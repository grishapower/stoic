import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, type BufferGeometry, type MeshStandardMaterial } from 'three'
import { audio } from '../audio/engine'
import { runtime } from '../runtime'
import { game, useGame, type Quality } from '../store'
import { groundHeight } from '../world/ground'
import { BEEHIVES } from '../world/props'
import {
  BEE_RIG,
  beeGeometry,
  BUTTERFLY_RIG,
  butterflyGeometry,
  DOVE_RIG,
  doveGeometry,
  GULL_RIG,
  gullGeometry,
  LIZARD_RIG,
  lizardGeometry,
  SWALLOW_RIG,
  swallowGeometry,
} from './geometry'
import { BUTTERFLY_SPECIES } from './insects'
import { createButterflyAtlas, createLifeMaterial } from './material'
import type { InstanceBuffers } from './math'
import { AmbientLifeSim, LIFE_KINDS, type LifeEvents, type LifeInput, type LifeKind } from './sim'

/**
 * Ambient life: gulls over the bay, swallows over the lawns, doves on the
 * roofs / bird bath / dovecote, butterflies, bees and two wall lizards.
 * One InstancedMesh per species (6 draw calls, no shadows); all logic lives in
 * the plain-TS simulation (sim.ts), this component only uploads its buffers.
 */

/** Sounds fired by the simulation (safe no-ops before the audio unlock). */
const events: LifeEvents = {
  coo: (p) => audio.life?.dove(p),
  flutter: (p, n) => audio.life?.flutter(p, n),
  gull: (p, near) => audio.life?.gull(p, near),
}

const input: LifeInput = { eye: runtime.player.eye, feet: runtime.player.pos, progress: 0 }

interface Built {
  sim: AmbientLifeSim
  meshes: InstancedMesh[]
  attrs: { mesh: InstancedMesh; anim: InstancedBufferAttribute; anim2: InstancedBufferAttribute }[]
  /** Step the simulation and flag the instance buffers for upload. */
  frame: (dt: number) => void
  dispose: () => void
}

function attach(geo: BufferGeometry, mat: MeshStandardMaterial, buf: InstanceBuffers, atlas: boolean): Built['attrs'][number] {
  const mesh = new InstancedMesh(geo, mat, Math.max(1, buf.count))
  mesh.count = buf.count
  const matrix = new InstancedBufferAttribute(buf.matrix, 16)
  matrix.setUsage(DynamicDrawUsage)
  mesh.instanceMatrix = matrix
  mesh.instanceColor = new InstancedBufferAttribute(buf.color, 3)
  const anim = new InstancedBufferAttribute(buf.anim, 4)
  anim.setUsage(DynamicDrawUsage)
  const anim2 = new InstancedBufferAttribute(buf.anim2, 4)
  anim2.setUsage(DynamicDrawUsage)
  geo.setAttribute('aAnim', anim)
  geo.setAttribute('aAnim2', anim2)
  if (atlas) geo.setAttribute('aAtlas', new InstancedBufferAttribute(buf.atlas, 1))
  // Instances move every frame anywhere in the world: skip culling (6 tiny draws).
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.matrixAutoUpdate = false
  return { mesh, anim, anim2 }
}

function build(quality: Quality): Built {
  const sim = new AmbientLifeSim(quality)
  const atlas = createButterflyAtlas(BUTTERFLY_SPECIES.length)
  const parts: Record<LifeKind, { geo: BufferGeometry; mat: MeshStandardMaterial }> = {
    gulls: { geo: gullGeometry(), mat: createLifeMaterial({ rig: GULL_RIG, roughness: 0.8 }) },
    swallows: { geo: swallowGeometry(), mat: createLifeMaterial({ rig: SWALLOW_RIG, roughness: 0.55 }) },
    doves: { geo: doveGeometry(), mat: createLifeMaterial({ rig: DOVE_RIG, roughness: 0.85 }) },
    butterflies: { geo: butterflyGeometry(), mat: createLifeMaterial({ rig: BUTTERFLY_RIG, atlas: { texture: atlas, cells: BUTTERFLY_SPECIES.length }, roughness: 0.7 }) },
    bees: { geo: beeGeometry(), mat: createLifeMaterial({ rig: BEE_RIG, roughness: 0.6 }) },
    lizards: { geo: lizardGeometry(), mat: createLifeMaterial({ rig: LIZARD_RIG, spineK: 9, roughness: 0.65 }) },
  }
  const attrs = LIFE_KINDS.map((k) => attach(parts[k].geo, parts[k].mat, sim.buffers[k], k === 'butterflies'))
  return {
    sim,
    meshes: attrs.map((a) => a.mesh),
    attrs,
    frame: (dt) => {
      input.progress = game().progress
      sim.update(dt, input, events)
      for (const a of attrs) {
        a.mesh.instanceMatrix.needsUpdate = true
        a.anim.needsUpdate = true
        a.anim2.needsUpdate = true
      }
    },
    dispose: () => {
      for (const k of LIFE_KINDS) {
        parts[k].geo.dispose()
        parts[k].mat.dispose()
      }
      atlas.dispose()
      for (const a of attrs) a.mesh.dispose()
    },
  }
}

export function AmbientLife() {
  const quality = useGame((s) => s.settings.quality)
  const built = useMemo(() => build(quality), [quality])
  useEffect(() => () => built.dispose(), [built])

  // The hum of the hives (positional, only audible nearby).
  useEffect(() => {
    audio.life?.configure({ beehives: [{ x: BEEHIVES.x, y: groundHeight(BEEHIVES.x, BEEHIVES.z) + 0.8, z: BEEHIVES.z }] })
  }, [])

  useFrame((_, delta) => built.frame(Math.min(delta, 1 / 20)))

  return (
    <group>
      {built.meshes.map((m) => (
        <primitive key={m.uuid} object={m} />
      ))}
    </group>
  )
}
