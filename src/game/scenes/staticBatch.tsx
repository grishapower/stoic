import { useEffect, useMemo, useState } from 'react'
import { Mesh, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { useArchMaterials, type ArchMaterialKey } from '../materials/library'
import { staticSources, subscribeStatic } from './staticGeometry'

/**
 * One draw call per architectural material for the whole estate.
 *
 * The villa, the grounds, the walk and terrace decor and the peristyle bench
 * each build their static stonework with a GeoBuilder (one geometry per
 * material). Drawn separately that is ~30 small meshes, most of them a few
 * dozen triangles — and twice as many draw calls with the shadow pass (and
 * again per eye in VR). Here every builder's geometry is concatenated per
 * material and drawn by `<StaticBatch />` (builders hand theirs over with
 * `useStaticGeometry`, staticGeometry.ts).
 */

/** Materials that should not cast shadows (dark interior openings). */
const NO_SHADOW = new Set(['interior'])

export function StaticBatch() {
  const mats = useArchMaterials()
  const [version, setVersion] = useState(0)
  // Sources may have registered before this mounted: subscribeStatic calls back once right away.
  useEffect(() => subscribeStatic(() => setVersion((v) => v + 1)), [])

  const meshes = useMemo(() => {
    void version
    const byKey = new Map<string, BufferGeometry[]>()
    for (const geos of staticSources()) {
      for (const [key, g] of geos) {
        if (!byKey.has(key)) byKey.set(key, [])
        byKey.get(key)!.push(g)
      }
    }
    const out: Mesh[] = []
    for (const [key, list] of byKey) {
      const material = mats[key as ArchMaterialKey]
      if (!material) continue
      const geo = list.length === 1 ? list[0].clone() : mergeGeometries(list, false)
      if (!geo) continue
      geo.computeBoundingSphere()
      const m = new Mesh(geo, material)
      m.name = `static:${key}`
      m.castShadow = !NO_SHADOW.has(key)
      m.receiveShadow = true
      out.push(m)
    }
    return out
  }, [mats, version])

  useEffect(() => () => meshes.forEach((m) => m.geometry.dispose()), [meshes])

  return (
    <group>
      {meshes.map((m) => (
        <primitive key={m.uuid} object={m} />
      ))}
    </group>
  )
}
