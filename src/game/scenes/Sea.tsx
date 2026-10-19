import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { suspend } from 'suspend-react'
import { CircleGeometry, Color, MeshPhysicalMaterial, RepeatWrapping, Vector2, type Texture } from 'three'
import { loadWaterNormals } from '../materials/textures'
import { flatNormalTexture } from '../materials/common'
import { SEA_LEVEL } from '../world/layout'
import { applyDirectionalFog } from './atmosphere'

/**
 * The sea: a large disc with a physical material — sky reflections come from
 * the environment map, the sun glitter path from the directional light's GGX
 * highlight on two scrolling normal layers (base + clearcoat).
 */
export function Sea() {
  const normals = suspend(() => loadWaterNormals(), ['water-normals'])

  const { material, nA, nB } = useMemo(() => {
    const prep = (t: Texture | null, rep: number) => {
      if (!t) return flatNormalTexture()
      const c = t.clone()
      c.wrapS = c.wrapT = RepeatWrapping
      c.repeat.set(rep, rep)
      c.anisotropy = 8
      c.needsUpdate = true
      return c
    }
    const nA = prep(normals, 900)
    const nB = prep(normals, 2600)
    const m = new MeshPhysicalMaterial({
      color: new Color('#0b2f3f'),
      roughness: 0.16,
      metalness: 0,
      normalMap: nA,
      normalScale: new Vector2(0.55, 0.55),
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      clearcoatNormalMap: nB,
      clearcoatNormalScale: new Vector2(0.35, 0.35),
      envMapIntensity: 1.0,
      specularIntensity: 1,
      ior: 1.333,
    })
    applyDirectionalFog(m, (shader) => {
      // Darker, slightly greener water near the cliffs (shallows), deeper blue offshore.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float shoreD = length(vFogWorldPos.xz - vec2(0.0, -40.0));
        diffuseColor.rgb = mix(diffuseColor.rgb * vec3(0.8, 1.15, 1.05), diffuseColor.rgb, smoothstep(40.0, 180.0, shoreD));`,
      )
    })
    return { material: m, nA, nB }
  }, [normals])

  const geometry = useMemo(() => {
    const g = new CircleGeometry(9000, 96)
    g.rotateX(-Math.PI / 2)
    return g
  }, [])

  useEffect(
    () => () => {
      material.dispose()
      geometry.dispose()
      if (nA !== flatNormalTexture()) nA.dispose()
      if (nB !== flatNormalTexture()) nB.dispose()
    },
    [material, geometry, nA, nB],
  )

  useFrame((state) => {
    const t = state.clock.elapsedTime
    nA.offset.set(t * 0.0021, t * 0.0013)
    nB.offset.set(-t * 0.0016, t * 0.0024)
  })

  // After the land and everything on it (before the sky): the depth test then skips the costly
  // water shading wherever the cliffs and the terrace hide it (no hidden-surface removal on mobile GPUs).
  return <mesh geometry={geometry} material={material} position={[0, SEA_LEVEL, 0]} renderOrder={5} />
}
