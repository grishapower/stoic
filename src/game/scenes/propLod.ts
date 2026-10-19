import { useEffect } from 'react'
import { Box3, Sphere, type Object3D } from 'three'
import { useGame } from '../store'
import { lodEntry, registerLod } from './lod'
import { QUALITY } from './quality'

const box = new Box3()
const sphere = new Sphere()

/**
 * Distance culling for a placed (static) model: hidden beyond
 * min(maxFar, max(minFar, size × farPerMetre)), shadows only within `props.shadow` and only
 * for props bigger than `minShadowSize` (quality.ts). Size = bounding diameter.
 */
export function usePropLod(obj: Object3D, shadows = true) {
  const quality = useGame((s) => s.settings.quality)
  useEffect(() => {
    const q = QUALITY[quality].props
    obj.updateWorldMatrix(true, true)
    box.setFromObject(obj).getBoundingSphere(sphere)
    if (sphere.isEmpty()) return
    const size = sphere.radius * 2
    const entry = lodEntry(
      obj,
      { far: Math.min(q.maxFar, Math.max(q.minFar, size * q.farPerMetre)), shadow: shadows && size >= q.minShadowSize ? q.shadow : 0 },
      { x: sphere.center.x, y: sphere.center.y, z: sphere.center.z, r: sphere.radius },
    )
    return registerLod([entry])
  }, [obj, quality, shadows])
}
