import { useEffect, useMemo } from 'react'
import { suspend } from 'suspend-react'
import { Box3, BufferAttribute, BufferGeometry, Color, MeshStandardMaterial, Sphere, Vector2, Vector3 } from 'three'
import { loadAllTextureSets } from '../materials/textures'
import { whiteTexture } from '../materials/common'
import { baseHeight, terrainHeight } from '../world/terrain'
import { fbm } from '../world/noise'
import { SEA_LEVEL } from '../world/layout'
import { COVE } from '../world/props'
import { createGroundMask, MASK_MIN_X, MASK_MIN_Z, MASK_SIZE } from './groundMask'

/**
 * Terrain: a detailed near grid over the estate and a coarse far grid for the
 * surrounding hills. Texture splatting (meadow / garden / gravel / rock) is done
 * in a patched MeshStandardMaterial so lights, shadows, fog and IBL still work.
 */

interface GridSpec {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  step: number
  /** Skip cells fully inside this rect (used by the far grid). */
  hole?: { minX: number; maxX: number; minZ: number; maxZ: number }
  coarse?: boolean
}

/** Coarse landform for the far ring. */
function farHeight(x: number, z: number) {
  const ramp = Math.min(1, Math.max(0, (Math.hypot(x, z) - 60) / 140))
  return baseHeight(x, z) + fbm(x * 0.02, z * 0.02, 4) * 6 * ramp
}

/** farHeight sampled on the far lattice and bilinearly interpolated (matches far mesh edges). */
function farBilinear(x: number, z: number) {
  const gx = (x - -1200) / 16
  const gz = (z - -268) / 16
  const i = Math.floor(gx)
  const j = Math.floor(gz)
  const fx = gx - i
  const fz = gz - j
  const x0 = -1200 + i * 16
  const z0 = -268 + j * 16
  const a = farHeight(x0, z0)
  const b = farHeight(x0 + 16, z0)
  const c = farHeight(x0, z0 + 16)
  const d = farHeight(x0 + 16, z0 + 16)
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz
}

/** Detailed terrain that blends into the far landform near the grid edge. */
function nearHeight(x: number, z: number) {
  const e = Math.min(x - NEAR.minX, NEAR.maxX - x, z - NEAR.minZ, NEAR.maxZ - z)
  const w = Math.min(1, Math.max(0, e / 18))
  const t = w * w * (3 - 2 * w)
  if (t >= 1) return terrainHeight(x, z)
  return farBilinear(x, z) + (terrainHeight(x, z) - farBilinear(x, z)) * t
}

function buildGrid(spec: GridSpec): BufferGeometry {
  const nx = Math.round((spec.maxX - spec.minX) / spec.step) + 1
  const nz = Math.round((spec.maxZ - spec.minZ) / spec.step) + 1
  const pos = new Float32Array(nx * nz * 3)
  const nor = new Float32Array(nx * nz * 3)
  const uv = new Float32Array(nx * nz * 2)
  const splat = new Float32Array(nx * nz * 3)
  const h = spec.coarse ? farHeight : nearHeight
  const heights = new Float32Array(nx * nz)
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = spec.minX + i * spec.step
      const z = spec.minZ + j * spec.step
      heights[j * nx + i] = h(x, z)
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      const x = spec.minX + i * spec.step
      const z = spec.minZ + j * spec.step
      const y = heights[k]
      pos[k * 3] = x
      pos[k * 3 + 1] = y
      pos[k * 3 + 2] = z
      const hl = heights[j * nx + Math.max(0, i - 1)]
      const hr = heights[j * nx + Math.min(nx - 1, i + 1)]
      const hd = heights[Math.max(0, j - 1) * nx + i]
      const hu = heights[Math.min(nz - 1, j + 1) * nx + i]
      let ax = hl - hr
      let ay = 2 * spec.step
      let az = hd - hu
      const l = Math.hypot(ax, ay, az)
      ax /= l
      ay /= l
      az /= l
      nor[k * 3] = ax
      nor[k * 3 + 1] = ay
      nor[k * 3 + 2] = az
      uv[k * 2] = x
      uv[k * 2 + 1] = z
      const slope = 1 - ay
      // Rock on steep slopes, and everything below the terrace level by the sea (cliff tops, shore).
      const belowEstate = Math.min(1, Math.max(0, (-5.15 - y) / 0.8))
      const rock = Math.min(1, Math.max(0, (slope - 0.18) / 0.22)) + (y < SEA_LEVEL + 2.5 ? 1 : 0) + belowEstate
      splat[k * 3] = Math.min(1, rock)
      splat[k * 3 + 1] = fbm(x * 0.035 + 7, z * 0.035 - 3, 3) * 0.5 + 0.5
      splat[k * 3 + 2] = fbm(x * 0.11 - 2, z * 0.11 + 9, 2) * 0.5 + 0.5
    }
  }
  const idx: number[] = []
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      if (spec.hole) {
        const x0 = spec.minX + i * spec.step
        const z0 = spec.minZ + j * spec.step
        const x1 = x0 + spec.step
        const z1 = z0 + spec.step
        const hole = spec.hole
        if (x0 >= hole.minX && x1 <= hole.maxX && z0 >= hole.minZ && z1 <= hole.maxZ) continue
      }
      const a = j * nx + i
      const b = a + 1
      const c = a + nx
      const d = c + 1
      idx.push(a, c, b, b, c, d)
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(pos, 3))
  geo.setAttribute('normal', new BufferAttribute(nor, 3))
  geo.setAttribute('uv', new BufferAttribute(uv, 2))
  geo.setAttribute('aSplat', new BufferAttribute(splat, 3))
  geo.setIndex(nx * nz > 65535 ? new BufferAttribute(new Uint32Array(idx), 1) : new BufferAttribute(new Uint16Array(idx), 1))
  geo.computeBoundingSphere()
  geo.computeBoundingBox()
  return geo
}

/**
 * Split a grid into tiles × tiles pieces that share the vertex buffers (one
 * index buffer each), so the camera — and in VR each eye — skips the tiles
 * outside its view.
 */
function tileGrid(geo: BufferGeometry, spec: GridSpec, tiles: number): BufferGeometry[] {
  const nx = Math.round((spec.maxX - spec.minX) / spec.step) + 1
  const nz = Math.round((spec.maxZ - spec.minZ) / spec.step) + 1
  const pos = geo.getAttribute('position')
  const out: BufferGeometry[] = []
  for (let ti = 0; ti < tiles; ti++) {
    for (let tj = 0; tj < tiles; tj++) {
      const i0 = Math.floor(((nx - 1) * ti) / tiles)
      const i1 = Math.floor(((nx - 1) * (ti + 1)) / tiles)
      const j0 = Math.floor(((nz - 1) * tj) / tiles)
      const j1 = Math.floor(((nz - 1) * (tj + 1)) / tiles)
      const idx = new Uint32Array((i1 - i0) * (j1 - j0) * 6)
      let k = 0
      let minY = Infinity
      let maxY = -Infinity
      for (let j = j0; j < j1; j++) {
        for (let i = i0; i < i1; i++) {
          const a = j * nx + i
          const b = a + 1
          const c = a + nx
          const d = c + 1
          idx[k++] = a
          idx[k++] = c
          idx[k++] = b
          idx[k++] = b
          idx[k++] = c
          idx[k++] = d
        }
      }
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const y = pos.getY(j * nx + i)
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
      const g = new BufferGeometry()
      for (const name of ['position', 'normal', 'uv', 'aSplat']) g.setAttribute(name, geo.getAttribute(name))
      g.setIndex(new BufferAttribute(idx, 1))
      const x0 = spec.minX + i0 * spec.step
      const x1 = spec.minX + i1 * spec.step
      const z0 = spec.minZ + j0 * spec.step
      const z1 = spec.minZ + j1 * spec.step
      g.boundingBox = new Box3(new Vector3(x0, minY - 0.1, z0), new Vector3(x1, maxY + 0.1, z1))
      g.boundingSphere = g.boundingBox.getBoundingSphere(new Sphere())
      out.push(g)
    }
  }
  return out
}

// The far lattice (16 m) is aligned with the near grid bounds so the seam has no T-gaps.
const FAR_STEP = 16
const NEAR: GridSpec = { minX: -96, maxX: 96, minZ: -108, maxZ: 100, step: 0.8 }
const FAR: GridSpec = {
  minX: -1200,
  maxX: 1392,
  minZ: -268,
  maxZ: 1396,
  step: FAR_STEP,
  hole: { minX: NEAR.minX, maxX: NEAR.maxX, minZ: NEAR.minZ, maxZ: NEAR.maxZ },
  coarse: true,
}

function useTerrainMaterial(far: boolean) {
  const sets = suspend(() => loadAllTextureSets(['ground-meadow', 'ground-garden', 'path-gravel', 'rock-cliff']), ['terrain-textures'])
  const mask = useMemo(() => createGroundMask(), [])
  const material = useMemo(() => {
    const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 })
    const meadow = sets['ground-meadow']
    const garden = sets['ground-garden']
    const gravel = sets['path-gravel']
    const rock = sets['rock-cliff']
    const uniforms = {
      uMeadow: { value: meadow.map ?? whiteTexture() },
      uGarden: { value: garden.map ?? whiteTexture() },
      uGravel: { value: gravel.map ?? whiteTexture() },
      uRock: { value: rock.map ?? whiteTexture() },
      uMask: { value: mask },
      uMaskMin: { value: new Vector2(MASK_MIN_X, MASK_MIN_Z) },
      uMaskSize: { value: MASK_SIZE },
      // Tints let the flat-colour fallback look right when textures are missing.
      uMeadowTint: { value: new Color(meadow.map ? '#ffffff' : '#9a8a5a') },
      uDryTint: { value: new Color('#c9b57e') },
      uGardenTint: { value: new Color(garden.map ? '#e0e8c8' : '#5d6b3a') },
      uGravelTint: { value: new Color(gravel.map ? '#ffffff' : '#c2b195') },
      uRockTint: { value: new Color(rock.map ? '#cfc2ad' : '#8f8676') },
      uFar: { value: far ? 1 : 0 },
      uCove: { value: new Vector3(COVE.x, COVE.z, COVE.radius) },
      uSea: { value: SEA_LEVEL },
    }
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute vec3 aSplat;
varying vec3 vSplat;
varying vec3 vWPos;
varying vec3 vWNormal;`,
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
vSplat = aSplat;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNormal = normalize(mat3(modelMatrix) * objectNormal);`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform sampler2D uMeadow;
uniform sampler2D uGarden;
uniform sampler2D uGravel;
uniform sampler2D uRock;
uniform sampler2D uMask;
uniform vec2 uMaskMin;
uniform float uMaskSize;
uniform vec3 uMeadowTint;
uniform vec3 uDryTint;
uniform vec3 uGardenTint;
uniform vec3 uGravelTint;
uniform vec3 uRockTint;
uniform float uFar;
uniform vec3 uCove;
uniform float uSea;
varying vec3 vSplat;
varying vec3 vWPos;
varying vec3 vWNormal;
// Triplanar with explicit gradients so planes with no weight (and whole layers
// with no weight, below) can be skipped inside branches without mip artefacts.
vec3 triplanar(sampler2D t, vec3 p, vec3 n, vec3 dpx, vec3 dpy) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  vec3 c = vec3(0.0);
  if (w.x > 0.02) c += textureGrad(t, p.zy, dpx.zy, dpy.zy).rgb * w.x;
  if (w.y > 0.02) c += textureGrad(t, p.xz, dpx.xz, dpy.xz).rgb * w.y;
  if (w.z > 0.02) c += textureGrad(t, p.xy, dpx.xy, dpy.xy).rgb * w.z;
  return c / max(0.0001, (w.x > 0.02 ? w.x : 0.0) + (w.y > 0.02 ? w.y : 0.0) + (w.z > 0.02 ? w.z : 0.0));
}`,
        )
        .replace(
          '#include <map_fragment>',
          `
vec2 wuv = vWPos.xz;
// Gradients taken before any branch (layers below are sampled only where they show).
vec3 dpx = dFdx(vWPos);
vec3 dpy = dFdy(vWPos);
vec3 wn = normalize(vWNormal);
float dist = length(vWPos - cameraPosition);
// Meadow with anti-tiling: two scales blended by macro noise.
vec3 m1 = texture2D(uMeadow, wuv * 0.21).rgb;
vec3 m2 = texture2D(uMeadow, wuv * 0.047 + vec2(0.37, 0.71)).rgb;
vec3 meadow = mix(m1, m2, 0.25 + 0.5 * vSplat.z) * uMeadowTint;
meadow = mix(meadow, meadow * uDryTint * 1.25, smoothstep(0.35, 0.85, vSplat.y) * 0.7);
vec4 mask = texture2D(uMask, (wuv - uMaskMin) / uMaskSize);
float inMask = step(0.0, wuv.x - uMaskMin.x) * step(0.0, uMaskMin.x + uMaskSize - wuv.x) * step(0.0, wuv.y - uMaskMin.y) * step(0.0, uMaskMin.y + uMaskSize - wuv.y);
mask *= inMask * (1.0 - uFar);
// Break up the path edge with texture-driven noise.
float edgeN = (m1.g - 0.35) * 0.9;
float pathW = smoothstep(0.32, 0.62, mask.r + edgeN * 0.35);
// Sand in the little cove (flat, just above the waterline); it reuses the gravel texture.
float coveD = length((vWPos.xz - uCove.xy) * vec2(1.0, 1.15));
float flatness = 1.0 - smoothstep(0.2, 0.45, 1.0 - wn.y);
float sand = smoothstep(uCove.z, uCove.z * 0.55, coveD) * flatness * (1.0 - smoothstep(uSea + 2.5, uSea + 3.5, vWPos.y));
vec3 gardenC = vec3(0.0);
if (mask.g > 0.002) {
  gardenC = textureGrad(uGarden, wuv * 0.33, dpx.xz * 0.33, dpy.xz * 0.33).rgb * uGardenTint;
  // Beds are a low green sward over the soil (the lawn blades sit on top).
  gardenC = mix(gardenC, vec3(0.13, 0.2, 0.07) * (0.75 + 1.2 * dot(gardenC, vec3(0.333))), 0.55);
}
vec3 gravelC = vec3(0.0);
if (pathW > 0.002 || sand > 0.002) gravelC = textureGrad(uGravel, wuv * 0.42, dpx.xz * 0.42, dpy.xz * 0.42).rgb * uGravelTint;
float rockW = clamp(vSplat.x, 0.0, 1.0);
vec3 rockC = vec3(0.0);
if (rockW > 0.002) {
  vec3 r1 = triplanar(uRock, vWPos * 0.09, wn, dpx * 0.09, dpy * 0.09);
  vec3 r2 = triplanar(uRock, vWPos * 0.027 + 3.7, wn, dpx * 0.027, dpy * 0.027);
  rockC = mix(r1, r2, 0.45) * uRockTint * mix(0.62, 1.0, vSplat.z);
}
vec3 col = meadow;
col = mix(col, gardenC, mask.g);
col = mix(col, gravelC, pathW);
// Maquis / scrub patches: darker olive-green blotches on the open slopes.
float scrub = smoothstep(0.5, 0.7, vSplat.z) * (1.0 - mask.g) * (1.0 - pathW);
col = mix(col, col * vec3(0.55, 0.62, 0.42), scrub * mix(0.35, 0.8, uFar));
// Hills beyond the estate: olive-green maquis with dry grass between.
float hills = max(uFar, smoothstep(40.0, 72.0, length(vWPos.xz - vec2(0.0, 5.0))));
vec3 maquis = mix(vec3(0.19, 0.22, 0.12), vec3(0.34, 0.33, 0.19), vSplat.y);
col = mix(col, maquis * (0.8 + 0.4 * m2.g), hills * (0.6 + 0.35 * smoothstep(0.3, 0.6, vSplat.z)));
col = mix(col, rockC, rockW);
// Sand: wet and darker at the water's edge.
{
  vec3 sandC = gravelC * vec3(1.15, 1.05, 0.88) * mix(0.62, 1.0, smoothstep(uSea + 0.1, uSea + 0.9, vWPos.y));
  col = mix(col, sandC, sand);
}
col *= 1.0 - mask.b * 0.32;
// Distant flattening to avoid shimmering.
col = mix(col, vec3(dot(col, vec3(0.33))) * 0.5 + col * 0.5, smoothstep(250.0, 900.0, dist) * 0.4);
diffuseColor.rgb *= col;
`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `float roughnessFactor = roughness;
roughnessFactor = mix(0.97, 0.88, pathW);`,
        )
    }
    m.customProgramCacheKey = () => (far ? 'terrain-far' : 'terrain-near')
    return m
  }, [sets, mask, far])
  useEffect(() => () => material.dispose(), [material])
  return material
}

export function Terrain() {
  const nearTiles = useMemo(() => tileGrid(buildGrid(NEAR), NEAR, 3), [])
  const farGeo = useMemo(() => buildGrid(FAR), [])
  const nearMat = useTerrainMaterial(false)
  const farMat = useTerrainMaterial(true)
  useEffect(
    () => () => {
      // The tiles share their vertex buffers: dispose them together.
      nearTiles.forEach((g) => g.dispose())
      farGeo.dispose()
    },
    [nearTiles, farGeo],
  )
  return (
    <group>
      {nearTiles.map((g, i) => (
        <mesh key={i} geometry={g} material={nearMat} receiveShadow />
      ))}
      <mesh geometry={farGeo} material={farMat} receiveShadow />
    </group>
  )
}
