import { useEffect, useMemo } from 'react'
import { BufferAttribute, IcosahedronGeometry, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import { useArchMaterials } from '../materials/library'
import { useGame } from '../store'
import { SEA_LEVEL } from '../world/layout'
import { rng } from '../world/noise'
import { terrainHeight } from '../world/terrain'
import { cellsOf } from './geom/instances'
import { lodEntry, useLod } from './lod'

/**
 * Boulders along the foot of the cliffs where the sea meets the rock — seen
 * from the terrace when looking down over the parapet.
 */
function boulderGeometry() {
  const g = new IcosahedronGeometry(1, 2)
  const p = g.getAttribute('position')
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    // Flattened, lumpy, slightly faceted stone.
    const k = 1 + 0.22 * Math.sin(x * 3.1 + 1) * Math.sin(y * 2.7) * Math.sin(z * 3.3 + 2) + 0.12 * Math.sin(x * 7 + z * 5)
    p.setXYZ(i, x * k * 1.15, y * k * 0.7, z * k)
  }
  g.computeVertexNormals()
  // Planar UVs in metres-ish so the rock texture tiles naturally.
  const uv = g.getAttribute('uv')
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) + p.getZ(i) * 0.5, p.getY(i))
  // The shared stone material uses vertex colours: wet, darker base; drier top.
  const col = new Float32Array(p.count * 3)
  for (let i = 0; i < p.count; i++) {
    const v = 0.55 + 0.35 * Math.min(1, Math.max(0, p.getY(i) * 0.8 + 0.5))
    col[i * 3] = v
    col[i * 3 + 1] = v * 0.97
    col[i * 3 + 2] = v * 0.92
  }
  g.setAttribute('color', new BufferAttribute(col, 3))
  return g
}

/** Boulders are only seen looking down from the terrace and the viewpoint: cells drawn up to this far. */
const SHORE_FAR = { high: Infinity, medium: 200, low: 60 }

export function Shore() {
  const mats = useArchMaterials()
  const quality = useGame((s) => s.settings.quality)
  const meshes = useMemo(() => {
    const rand = rng(4040)
    const list: { x: number; y: number; z: number; s: number; r: number }[] = []
    let tries = 0
    while (list.length < 90 && tries++ < 20000) {
      const x = -130 + rand() * 230
      const z = -130 + rand() * 170
      const h = terrainHeight(x, z)
      if (h < SEA_LEVEL - 2.5 || h > SEA_LEVEL + 3) continue
      list.push({ x, y: Math.min(h, SEA_LEVEL + 0.5), z, s: 0.8 + rand() * rand() * 4, r: rand() * Math.PI * 2 })
    }
    const geo = boulderGeometry()
    const m = new Matrix4()
    const q = new Quaternion()
    const axis = new Vector3()
    const matrices = list.map((b) => {
      axis.set(rand() - 0.5, 4, rand() - 0.5).normalize()
      q.setFromAxisAngle(axis, b.r)
      return m.compose(new Vector3(b.x, b.y, b.z), q, new Vector3(b.s, b.s * (0.7 + rand() * 0.5), b.s)).clone()
    })
    // 60 m cells along the coast: frustum- and distance-culled separately.
    return cellsOf(
      list.map((b) => b.x),
      list.map((b) => b.z),
      60,
    ).map((cell) => {
      const inst = new InstancedMesh(geo, mats.stone, cell.length)
      cell.forEach((bi, i) => inst.setMatrixAt(i, matrices[bi]))
      inst.receiveShadow = true
      inst.castShadow = false
      inst.name = 'shore'
      inst.computeBoundingSphere()
      return inst
    })
  }, [mats])
  const lod = useMemo(() => meshes.map((inst) => lodEntry(inst, { far: SHORE_FAR[quality] })), [meshes, quality])
  useLod(lod)

  useEffect(
    () => () => {
      meshes[0]?.geometry.dispose()
      meshes.forEach((inst) => inst.dispose())
    },
    [meshes],
  )

  return (
    <>
      {meshes.map((inst) => (
        <primitive key={inst.uuid} object={inst} />
      ))}
    </>
  )
}
