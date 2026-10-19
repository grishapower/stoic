import { useEffect, useMemo } from 'react'
import {
  ConeGeometry,
  CylinderGeometry,
  LatheGeometry,
  MeshStandardMaterial,
  SphereGeometry,
  Vector2,
  type BufferGeometry,
} from 'three'
import { useArchMaterials, type ArchMaterialKey } from '../materials/library'
import { useGame } from '../store'
import { evening } from '../world/evening'
import { groundHeight } from '../world/ground'
import { nearestOnPath } from '../world/path'
import { AEDICULA, ALLEY_HERMS, AMPHORAE, BEEHIVES, DOVECOTE, GOATS, WOODEN_BENCH } from '../world/props'
import { terrainHeight } from '../world/terrain'
import { Flame } from './Flame'
import { GeoBuilder } from './geom/builder'
import { CullGroup } from './CullGroup'
import { useStaticGeometry } from './staticGeometry'
import { GlbProp, hasModel, modelInfo } from './Props'

/** Small things along the walk are drawn only from nearby (per quality). */
const SMALL_FAR = { high: 110, medium: 60, low: 28 }

/**
 * Along the walk (concept c03): herms facing the cypress alley, a roadside
 * shrine with a burning lamp and flowers, amphorae by the porch, a rustic
 * bench, a dovecote, Roman beehives and goats grazing beyond the west wall.
 * Every piece uses its Meshy model when present, a procedural stand-in otherwise.
 */

type V3 = [number, number, number]

/** Yaw that turns a +Z-facing object toward the nearest point of the path. */
export function yawToPath(x: number, z: number) {
  const h = nearestOnPath(x, z)
  return Math.atan2(h.x - x, h.z - z)
}

function local(cx: number, cz: number, rot: number) {
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  return (lx: number, ly: number, lz: number): V3 => [cx + lx * c + lz * s, ly, cz - lx * s + lz * c]
}

export const HERM_YAWS = ALLEY_HERMS.map((h) => yawToPath(h.x, h.z))
/** Plastered pillar under the Meshy shrine (puts its niche floor at ~1 m). */
const SHRINE_PILLAR = modelInfo('aedicula')?.recommendedPillarHeight ?? 0.92
export const BENCH_YAW = yawToPath(WOODEN_BENCH.x, WOODEN_BENCH.z)

/* ------------------------------------------------------------ static GeoBuilder pieces */

function buildWalk(): Map<string, BufferGeometry> {
  const b = new GeoBuilder()

  // Herm pillars (the Meshy bearded head sits on top).
  ALLEY_HERMS.forEach((h, i) => {
    const y = terrainHeight(h.x, h.z) - 0.04
    const rot = HERM_YAWS[i]
    const L = local(h.x, h.z, rot)
    b.color = [0.98, 0.96, 0.92]
    b.orientedBox(L(0, y + 0.1, 0), [0.56, 0.2, 0.52], rot, 'marble')
    b.orientedBox(L(0, y + 0.79, 0), [0.34, 1.2, 0.3], rot, 'marble')
    b.orientedBox(L(0, y + 1.42, 0), [0.46, 0.12, 0.38], rot, 'marble')
    if (!hasModel('herm-bust')) b.orientedBox(L(0, y + 1.7, 0), [0.26, 0.44, 0.26], rot, 'marble')
  })

  // Roadside shrine: podium, painted niche, gabled roof (or just the pillar under the model).
  if (hasModel('aedicula')) {
    const { x, z, rotY } = AEDICULA
    const y = terrainHeight(x, z) - 0.05
    const L = local(x, z, rotY)
    b.color = [0.9, 0.86, 0.8]
    b.orientedBox(L(0, y + 0.05, 0.04), [0.86, 0.1, 0.8], rotY, 'stone')
    b.color = [1, 0.97, 0.93]
    b.orientedBox(L(0, y + SHRINE_PILLAR / 2, 0), [0.56, SHRINE_PILLAR, 0.5], rotY, 'plaster')
    b.orientedBox(L(0, y + SHRINE_PILLAR - 0.03, 0.01), [0.62, 0.06, 0.56], rotY, 'plaster')
  } else {
    const { x, z, rotY } = AEDICULA
    const y = terrainHeight(x, z) - 0.05
    const L = local(x, z, rotY)
    b.color = [0.9, 0.86, 0.8]
    b.orientedBox(L(0, y + 0.05, 0.05), [1.25, 0.1, 0.85], rotY, 'stone')
    b.color = [1, 0.97, 0.93]
    b.orientedBox(L(0, y + 0.5, 0), [1.0, 0.8, 0.62], rotY, 'plaster')
    // Niche: red back wall, side cheeks, lintel.
    b.color = [0.78, 0.28, 0.2]
    b.orientedBox(L(0, y + 1.25, -0.24), [0.8, 0.7, 0.12], rotY, (f) => (f === 'pz' ? 'plasterWarm' : 'plaster'))
    b.color = [1, 0.97, 0.93]
    for (const lx of [-0.42, 0.42]) b.orientedBox(L(lx, y + 1.25, 0), [0.16, 0.7, 0.62], rotY, 'plaster')
    b.orientedBox(L(0, y + 1.66, 0), [1.06, 0.12, 0.68], rotY, 'plaster')
    // Gable: front/back triangles + two roof slopes.
    const e = y + 1.72
    const peak = y + 2.0
    const front: V3 = [Math.sin(rotY), 0, Math.cos(rotY)]
    for (const lz of [0.34, -0.34]) {
      const dir: V3 = lz > 0 ? front : [-front[0], 0, -front[2]]
      b.triFacing('plaster', L(-0.53, e, lz), L(0.53, e, lz), L(0, peak, lz), dir)
    }
    b.color = [1, 1, 1]
    b.quadFacing('roof', L(-0.6, e - 0.03, 0.4), L(0, peak + 0.03, 0.4), L(0, peak + 0.03, -0.4), L(-0.6, e - 0.03, -0.4), [0, 1, 0])
    b.quadFacing('roof', L(0, peak + 0.03, 0.4), L(0.6, e - 0.03, 0.4), L(0.6, e - 0.03, -0.4), L(0, peak + 0.03, -0.4), [0, 1, 0])
  }

  // Rustic garden bench of thick planks.
  if (!hasModel('wooden-bench')) {
    const { x, z } = WOODEN_BENCH
    const rot = BENCH_YAW
    const y = terrainHeight(x, z) - 0.02
    const L = local(x, z, rot)
    b.color = [1, 1, 1]
    b.orientedBox(L(0, y + 0.44, 0), [1.6, 0.06, 0.38], rot, 'wood')
    for (const lx of [-0.62, 0.62]) {
      for (const lz of [-0.13, 0.13]) b.orientedBox(L(lx, y + 0.21, lz), [0.07, 0.42, 0.07], rot, 'woodDark')
      b.orientedBox(L(lx, y + 0.12, 0), [0.06, 0.05, 0.3], rot, 'woodDark')
    }
  }

  // Beehives: a stone shelf with a slab roof (the hives are separate meshes).
  if (!hasModel('beehives-roman')) {
    const { x, z, rotY } = BEEHIVES
    const y = terrainHeight(x, z) - 0.04
    const L = local(x, z, rotY)
    b.color = [0.92, 0.88, 0.82]
    b.orientedBox(L(0, y + 0.2, 0), [1.75, 0.4, 0.66], rotY, 'stone')
    for (const lx of [-0.82, 0.82]) b.orientedBox(L(lx, y + 0.62, -0.05), [0.14, 0.46, 0.56], rotY, 'stone')
    b.orientedBox(L(0, y + 0.9, -0.03), [1.95, 0.08, 0.78], rotY, 'stone')
  }
  return b.build()
}

/* ------------------------------------------------------------ lathe / round pieces */

function amphoraGeometry(): BufferGeometry {
  // Dressel 2–4 wine amphora, ~1.05 m, pointed toe.
  const prof: [number, number][] = [
    [0.001, 0],
    [0.028, 0.0],
    [0.034, 0.07],
    [0.05, 0.15],
    [0.1, 0.3],
    [0.145, 0.48],
    [0.158, 0.62],
    [0.15, 0.7],
    [0.115, 0.76],
    [0.062, 0.81],
    [0.048, 0.88],
    [0.048, 0.98],
    [0.064, 1.0],
    [0.064, 1.03],
    [0.001, 1.03],
  ]
  const g = new LatheGeometry(
    prof.map(([r, y]) => new Vector2(r, y)),
    22,
  )
  g.computeVertexNormals()
  return g
}

function useNoVc(mats: Record<ArchMaterialKey, MeshStandardMaterial>, key: ArchMaterialKey) {
  return useMemo(() => {
    const m = mats[key].clone()
    m.vertexColors = false
    return m
  }, [mats, key])
}

const AMPHORAE_CENTER = [AMPHORAE[1].x, groundHeight(AMPHORAE[1].x, AMPHORAE[1].z) + 0.5, AMPHORAE[1].z] as const

function Amphorae() {
  const mats = useArchMaterials()
  const terracotta = useNoVc(mats, 'terracotta')
  const res = useMemo(() => {
    const body = amphoraGeometry()
    // Two handles from neck to shoulder.
    const handle = new CylinderGeometry(0.016, 0.016, 0.26, 6)
    return { body, handle }
  }, [])
  useEffect(
    () => () => {
      res.body.dispose()
      res.handle.dispose()
      terracotta.dispose()
    },
    [res, terracotta],
  )
  const glb = hasModel('amphora')
  return (
    <CullGroup center={AMPHORAE_CENTER} radius={1.6} far={SMALL_FAR}>
      {AMPHORAE.map((a, i) => {
        const y = groundHeight(a.x, a.z) - 0.07
        // Leaning against each other, toes sunk into the soil.
        const tilt = 0.12 + (i % 2) * 0.1
        return (
          <group key={i} position={[a.x, y, a.z]} rotation={[0, a.rotY, 0]}>
            <group rotation={[tilt, 0, 0]}>
              {glb ? (
                <GlbProp id="amphora" position={[0, 0, 0]} />
              ) : (
                <>
                  <mesh geometry={res.body} material={terracotta} castShadow receiveShadow />
                  {[-1, 1].map((s) => (
                    <mesh key={s} geometry={res.handle} material={terracotta} position={[s * 0.1, 0.87, 0]} rotation={[0, 0, s * 0.42]} castShadow />
                  ))}
                </>
              )}
            </group>
          </group>
        )
      })}
    </CullGroup>
  )
}

function Dovecote() {
  const mats = useArchMaterials()
  const plaster = useNoVc(mats, 'plasterWarm')
  const roof = useNoVc(mats, 'roof')
  const res = useMemo(() => {
    const tower = new CylinderGeometry(1.25, 1.35, 4.2, 28, 1, true)
    tower.translate(0, 2.1, 0)
    const cap = new ConeGeometry(1.65, 1.25, 28, 1, true)
    cap.translate(0, 4.2 + 0.62, 0)
    const ledge = new CylinderGeometry(1.42, 1.42, 0.09, 28)
    ledge.translate(0, 3.05, 0)
    // Nesting holes: small dark boxes just proud of the wall.
    const hole = new SphereGeometry(0.075, 8, 6)
    hole.scale(1, 1.25, 0.35)
    const holeMat = new MeshStandardMaterial({ color: '#1c140e', roughness: 1 })
    const door = new CylinderGeometry(0.01, 0.01, 1, 4)
    return { tower, cap, ledge, hole, holeMat, door }
  }, [])
  useEffect(
    () => () => {
      for (const g of [res.tower, res.cap, res.ledge, res.hole, res.door]) g.dispose()
      res.holeMat.dispose()
      plaster.dispose()
      roof.dispose()
    },
    [res, plaster, roof],
  )
  const { x, z, rotY } = DOVECOTE
  const y = terrainHeight(x, z) - 0.1
  if (hasModel('dovecote')) return <GlbProp id="dovecote" position={[x, y, z]} rotationY={rotY} />
  const holes: [number, number, number, number][] = []
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + row * 0.22
      const hy = 3.3 + row * 0.27
      const r = 1.35 - 0.1 * (hy / 4.2) + 0.005 // tapered tower
      holes.push([Math.sin(a) * r, hy, Math.cos(a) * r, a])
    }
  }
  return (
    <group position={[x, y, z]} rotation={[0, rotY, 0]}>
      <mesh geometry={res.tower} material={plaster} castShadow receiveShadow />
      <mesh geometry={res.ledge} material={plaster} castShadow />
      <mesh geometry={res.cap} material={roof} castShadow />
      {holes.map(([hx, hy, hz, a], i) => (
        <mesh key={i} geometry={res.hole} material={res.holeMat} position={[hx, hy, hz]} rotation={[0, a, 0]} />
      ))}
      {/* Low door. */}
      <mesh material={res.holeMat} position={[0, 0.75, 1.33]} scale={[0.7, 1.5, 0.06]}>
        <boxGeometry />
      </mesh>
    </group>
  )
}

function Beehives() {
  const res = useMemo(() => {
    const hive = new CylinderGeometry(0.17, 0.165, 0.66, 14)
    hive.rotateX(Math.PI / 2)
    const clay = new MeshStandardMaterial({ color: '#a8835c', roughness: 0.95 })
    const end = new CylinderGeometry(0.03, 0.03, 0.02, 8)
    end.rotateX(Math.PI / 2)
    const dark = new MeshStandardMaterial({ color: '#20170f', roughness: 1 })
    return { hive, clay, end, dark }
  }, [])
  useEffect(
    () => () => {
      res.hive.dispose()
      res.end.dispose()
      res.clay.dispose()
      res.dark.dispose()
    },
    [res],
  )
  const { x, z, rotY } = BEEHIVES
  const y = terrainHeight(x, z) - 0.04
  if (hasModel('beehives-roman')) return <GlbProp id="beehives-roman" position={[x, y, z]} rotationY={rotY} />
  return (
    <group position={[x, y, z]} rotation={[0, rotY, 0]}>
      {[-0.54, -0.18, 0.18, 0.54].map((lx) => (
        <group key={lx} position={[lx, 0.4 + 0.17, 0]}>
          <mesh geometry={res.hive} material={res.clay} castShadow receiveShadow />
          {/* Entrance holes face front (+Z). */}
          <mesh geometry={res.end} material={res.dark} position={[0, -0.06, 0.33]} />
        </group>
      ))}
    </group>
  )
}

function Shrine() {
  const { x, z, rotY } = AEDICULA
  const y = terrainHeight(x, z) - 0.05
  const L = local(x, z, rotY)
  // Lamp on the niche floor; it burns all day and brightens at dusk.
  const nicheFloor = hasModel('aedicula') ? SHRINE_PILLAR + (modelInfo('aedicula')?.nicheFloorY ?? 0.08) : 0.9
  const lampPos = L(0, y + nicheFloor + 0.015, 0.06)
  const flamePos = L(0, y + nicheFloor + 0.05, 0.13)
  const lampBody = useMemo(() => {
    const g = new SphereGeometry(0.05, 12, 8)
    g.scale(1, 0.45, 1.5)
    return g
  }, [])
  const clay = useMemo(() => new MeshStandardMaterial({ color: '#9c5a36', roughness: 0.8 }), [])
  useEffect(
    () => () => {
      lampBody.dispose()
      clay.dispose()
    },
    [lampBody, clay],
  )
  return (
    <group>
      {hasModel('aedicula') && <GlbProp id="aedicula" position={[x, y + SHRINE_PILLAR, z]} rotationY={rotY} />}
      <CullGroup center={lampPos} radius={0.5} far={SMALL_FAR}>
        <mesh geometry={lampBody} material={clay} position={lampPos} rotation={[0, rotY, 0]} castShadow />
        <Flame position={flamePos} size={0.05} level={() => 0.6 + 0.4 * evening(useGame.getState().progress).lamps} seed={3} />
      </CullGroup>
    </group>
  )
}

export function WalkDecor() {
  // Suspends until the shared architectural textures are loaded (the stonework is drawn by <StaticBatch />).
  useArchMaterials()
  const geos = useMemo(buildWalk, [])
  useStaticGeometry(geos)
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos])
  return (
    <group>
      {ALLEY_HERMS.map((h, i) => (
        <GlbProp key={`herm-${i}`} id="herm-bust" position={[h.x, terrainHeight(h.x, h.z) - 0.04 + 1.48, h.z]} rotationY={HERM_YAWS[i]} scale={0.85} />
      ))}
      <Shrine />
      <Amphorae />
      {hasModel('wooden-bench') && (
        <GlbProp id="wooden-bench" position={[WOODEN_BENCH.x, terrainHeight(WOODEN_BENCH.x, WOODEN_BENCH.z) - 0.02, WOODEN_BENCH.z]} rotationY={BENCH_YAW} />
      )}
      <Dovecote />
      <Beehives />
      {GOATS.map((g, i) => (
        <GlbProp key={`goat-${i}`} id="goat" position={[g.x, terrainHeight(g.x, g.z) - 0.03, g.z]} rotationY={g.rotY} />
      ))}
    </group>
  )
}
