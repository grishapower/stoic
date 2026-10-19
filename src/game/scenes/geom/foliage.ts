import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  IcosahedronGeometry,
  TubeGeometry,
  Vector3,
  type Material,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { WIND_GLSL, globalUniforms } from '../../materials/common'
import { sky } from '../atmosphere'
import { rng } from '../../world/noise'

/**
 * Procedural tree/shrub geometry (leaf cards + tubes) and the foliage material
 * patch (wind sway + backlit translucency + soft radial normals).
 */

export interface Clump {
  c: [number, number, number]
  r: number
  /** Vertical squash (1 = sphere). */
  sy?: number
}

/** Leaf cards scattered over clump surfaces. Attributes: position, normal (radial), uv, color, aFlex. */
export function cardsGeometry(clumps: Clump[], opts: { cards: number; size: [number, number]; seed: number; flexHeight: number; tint?: [number, number]; depth?: [number, number] }): BufferGeometry {
  const rand = rng(opts.seed)
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const col: number[] = []
  const flex: number[] = []
  const tmpN = new Vector3()
  const right = new Vector3()
  const up = new Vector3()
  for (const cl of clumps) {
    const n = Math.round(opts.cards * (cl.r / 1.0) ** 1.4)
    for (let i = 0; i < Math.max(4, n); i++) {
      // Random direction biased to the upper hemisphere and outward.
      const u = rand() * 2 - 1
      const th = rand() * Math.PI * 2
      const s = Math.sqrt(1 - u * u)
      tmpN.set(s * Math.cos(th), u * 0.85 + 0.15, s * Math.sin(th)).normalize()
      const depth = (opts.depth?.[0] ?? 0.55) + rand() * ((opts.depth?.[1] ?? 1.05) - (opts.depth?.[0] ?? 0.55))
      const cx = cl.c[0] + tmpN.x * cl.r * depth
      const cy = cl.c[1] + tmpN.y * cl.r * depth * (cl.sy ?? 1)
      const cz = cl.c[2] + tmpN.z * cl.r * depth
      const size = opts.size[0] + rand() * (opts.size[1] - opts.size[0])
      // Card plane: roughly facing the outward normal, random roll.
      right.set(-tmpN.z, 0, tmpN.x)
      if (right.lengthSq() < 1e-4) right.set(1, 0, 0)
      right.normalize()
      up.crossVectors(tmpN, right).normalize()
      const roll = rand() * Math.PI
      const cr = Math.cos(roll)
      const sr = Math.sin(roll)
      const ax = right.x * cr + up.x * sr
      const ay = right.y * cr + up.y * sr
      const az = right.z * cr + up.z * sr
      const bx = -right.x * sr + up.x * cr
      const by = -right.y * sr + up.y * cr
      const bz = -right.z * sr + up.z * cr
      const h = size / 2
      const corners = [
        [-h, -h],
        [h, -h],
        [h, h],
        [-h, h],
      ]
      const tint = opts.tint ? opts.tint[0] + rand() * (opts.tint[1] - opts.tint[0]) : 0.85 + rand() * 0.3
      // AO: darker inside and below.
      const ao = 0.55 + 0.45 * Math.min(1, depth) * (0.75 + 0.25 * tmpN.y)
      const v: number[][] = corners.map(([p, q]) => [cx + ax * p + bx * q, cy + ay * p + by * q, cz + az * p + bz * q])
      const uvs = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]
      for (const k of [0, 1, 2, 0, 2, 3]) {
        pos.push(v[k][0], v[k][1], v[k][2])
        // Radial normal from the clump centre (soft, volumetric shading).
        const nx = v[k][0] - cl.c[0]
        const ny = (v[k][1] - cl.c[1]) / (cl.sy ?? 1)
        const nz = v[k][2] - cl.c[2]
        const l = Math.hypot(nx, ny, nz) || 1
        nor.push(nx / l, ny / l, nz / l)
        uv.push(uvs[k][0], uvs[k][1])
        col.push(tint * ao, tint * ao, tint * ao)
        flex.push(Math.min(1.5, Math.max(0, v[k][1] / opts.flexHeight)) ** 1.5)
      }
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  g.setAttribute('aFlex', new BufferAttribute(new Float32Array(flex), 1))
  g.computeBoundingSphere()
  return g
}

/** Solid inner blobs (prevent see-through canopies). */
export function blobGeometry(clumps: Clump[], seed: number, flexHeight: number, scale = 0.72, detail = 1): BufferGeometry {
  const rand = rng(seed)
  const parts: BufferGeometry[] = []
  for (const cl of clumps) {
    const g = new IcosahedronGeometry(cl.r * scale, detail)
    const p = g.getAttribute('position')
    const n = g.getAttribute('normal')
    const jitter = rand() * 10
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i)
      const y = p.getY(i)
      const z = p.getZ(i)
      // Smooth (position-based) lumpiness so duplicated seam vertices stay welded.
      const k = 0.9 + 0.12 * Math.sin(x * 5.1 + jitter) * Math.sin(y * 4.3 + jitter * 0.7) * Math.sin(z * 4.7)
      p.setXYZ(i, x * k, y * k * (cl.sy ?? 1), z * k)
      // Radial normals: soft, volumetric shading without facets.
      const l = Math.hypot(x, y, z) || 1
      n.setXYZ(i, x / l, y / l, z / l)
    }
    g.translate(cl.c[0], cl.c[1], cl.c[2])
    parts.push(g)
  }
  const m = mergeGeometries(parts, false)!
  const n = m.getAttribute('position').count
  const col = new Float32Array(n * 3)
  const flex = new Float32Array(n)
  // Keep the icosahedron's spherical UVs (tiled) so a dense leaf texture covers the core.
  const srcUv = m.getAttribute('uv')
  const uv = new Float32Array(n * 2)
  const nor = m.getAttribute('normal')
  for (let i = 0; i < n; i++) {
    // Sky-facing top brighter, underside darker (soft AO), never near-black.
    const up = nor.getY(i) * 0.5 + 0.5
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0.5 + 0.42 * up
    flex[i] = Math.min(1.5, Math.max(0, m.getAttribute('position').getY(i) / flexHeight)) ** 1.5
    uv[i * 2] = (srcUv ? srcUv.getX(i) : 0.5) * 4
    uv[i * 2 + 1] = (srcUv ? srcUv.getY(i) : 0.5) * 2
  }
  m.setAttribute('color', new BufferAttribute(col, 3))
  m.setAttribute('aFlex', new BufferAttribute(flex, 1))
  m.setAttribute('uv', new BufferAttribute(uv, 2))
  parts.forEach((p) => p.dispose())
  return m
}

/** Smooth spindle core for an Italian cypress (lathe with gentle noise, UVs for a foliage texture). */
export function spindleGeometry(height: number, maxR: number, seed: number, RINGS = 28, SEG = 18): BufferGeometry {
  const rand = rng(seed)
  const phase = rand() * 10
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const col: number[] = []
  const flex: number[] = []
  const idx: number[] = []
  const y0 = 0.5
  for (let j = 0; j <= RINGS; j++) {
    const t = j / RINGS
    const y = y0 + t * (height - y0)
    // Narrow base, full lower-middle, long pointed top.
    const prof = Math.pow(Math.sin(Math.PI * Math.min(1, 0.06 + t * 0.94)), 0.75) * (1 - 0.35 * t * t)
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2
      const bump = 1 + 0.1 * Math.sin(a * 3 + t * 9 + phase) * Math.sin(t * 23 + phase) + 0.05 * Math.sin(a * 7 + t * 31)
      const r = Math.max(0.02, maxR * prof * bump)
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r)
      const nx = Math.cos(a)
      const nz = Math.sin(a)
      const ny = 0.35 * (1 - t) - 0.1
      const l = Math.hypot(nx, ny, nz)
      nor.push(nx / l, ny / l, nz / l)
      uv.push((i / SEG) * 3, t * height * 0.9)
      const ao = 0.55 + 0.45 * Math.min(1, t * 1.6)
      col.push(ao, ao, ao)
      flex.push(Math.pow(t, 1.5))
    }
  }
  for (let j = 0; j < RINGS; j++) {
    for (let i = 0; i < SEG; i++) {
      const a = j * (SEG + 1) + i
      const b = a + SEG + 1
      idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  g.setAttribute('aFlex', new BufferAttribute(new Float32Array(flex), 1))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}

/** A trunk/branch made of tubes along curves; colour attribute + flex. */
export function branchesGeometry(
  branches: { points: [number, number, number][]; r0: number; r1: number }[],
  flexHeight: number,
  radial = 7,
  /** Tube segments per control point (4 = smooth; 2 for distant LODs). */
  segsPerPoint = 4,
): BufferGeometry {
  const parts: BufferGeometry[] = []
  for (const br of branches) {
    const curve = new CatmullRomCurve3(br.points.map((p) => new Vector3(...p)))
    const segs = Math.max(segsPerPoint, br.points.length * segsPerPoint)
    const g = new TubeGeometry(curve, segs, 1, radial, false)
    // Taper radius along the tube: scale each ring around the curve point.
    const pos = g.getAttribute('position')
    const pts = curve.getSpacedPoints(segs)
    for (let i = 0; i <= segs; i++) {
      const t = i / segs
      const r = br.r0 + (br.r1 - br.r0) * t
      const c = pts[i]
      for (let j = 0; j <= radial; j++) {
        const k = i * (radial + 1) + j
        if (k >= pos.count) continue
        pos.setXYZ(k, c.x + (pos.getX(k) - c.x) * r, c.y + (pos.getY(k) - c.y) * r, c.z + (pos.getZ(k) - c.z) * r)
      }
    }
    g.computeVertexNormals()
    parts.push(g)
  }
  const m = mergeGeometries(parts, false)!
  const n = m.getAttribute('position').count
  const col = new Float32Array(n * 3).fill(1)
  const flex = new Float32Array(n)
  for (let i = 0; i < n; i++) flex[i] = Math.min(1.2, Math.max(0, m.getAttribute('position').getY(i) / flexHeight)) ** 2 * 0.35
  m.setAttribute('color', new BufferAttribute(col, 3))
  m.setAttribute('aFlex', new BufferAttribute(flex, 1))
  parts.forEach((p) => p.dispose())
  return m
}

/** Shared uniforms for foliage translucency. */
export const foliageUniforms = {
  uSunDirW: { value: sky.sunDir },
  uSunColorF: { value: new Color('#ffcf9a') },
}

/**
 * Patch a MeshStandardMaterial for foliage: wind sway (needs attribute aFlex),
 * backlit translucency, optional instancing-aware world position.
 */
export function patchFoliage(
  material: Material,
  opts: {
    sway: number
    translucency: number
    nearFade?: [number, number]
    /** Geometry may carry `aBark` (1 = trunk): those vertices get this flat bark colour (× vertex colour) instead of the leaf texture. */
    bark?: string
  },
) {
  const bark = opts.bark ? new Color(opts.bark) : null
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, globalUniforms, foliageUniforms, {
      uSway: { value: opts.sway },
      uTransl: { value: opts.translucency },
      uBark: { value: bark ?? new Color() },
    })
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aFlex;
uniform float uSway;
varying vec3 vFolWPos;
${bark ? 'attribute float aBark;\nvarying float vBark;' : ''}
${WIND_GLSL}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  vec4 wp0 = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wp0 = instanceMatrix * wp0;
  #endif
  wp0 = modelMatrix * wp0;
  vec3 off = windOffset(wp0.xyz, aFlex * uSway);
  transformed += off;
  ${bark ? 'vBark = aBark;' : ''}
}`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
{
  vec4 wpf = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wpf = instanceMatrix * wpf;
  #endif
  vFolWPos = (modelMatrix * wpf).xyz;
}`,
      )
    const near = opts.nearFade
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uSunDirW;
uniform vec3 uSunColorF;
uniform float uTransl;
uniform vec3 uBark;
varying vec3 vFolWPos;
${bark ? 'varying float vBark;' : 'const float vBark = 0.0;'}`,
      )
      .replace(
        '#include <color_fragment>',
        bark
          ? `#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, uBark * vColor.rgb, vBark);`
          : '#include <color_fragment>',
      )
      .replace(
        '#include <clipping_planes_fragment>',
        near
          ? `#include <clipping_planes_fragment>
{
  // Dissolve solid canopy cores right in front of the camera (dithered) so
  // reaching into a tree shows leaves, not a smooth dark shell.
  float camD = distance(vFolWPos, cameraPosition);
  float keep = smoothstep(${near[0].toFixed(2)}, ${near[1].toFixed(2)}, camD);
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  if (dither > keep) discard;
}`
          : '#include <clipping_planes_fragment>',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  vec3 toCam = normalize(cameraPosition - vFolWPos);
  float back = pow(max(dot(-toCam, uSunDirW), 0.0), 5.0);
  totalEmissiveRadiance += diffuseColor.rgb * uSunColorF * back * uTransl * (1.0 - vBark);
}`,
      )
  }
  material.customProgramCacheKey = () => `foliage-${opts.sway}-${opts.translucency}-${opts.nearFade ? opts.nearFade.join('_') : 'n'}-${bark ? 'b' : ''}`
}
