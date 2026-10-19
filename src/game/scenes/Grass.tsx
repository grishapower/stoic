import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, Color, DoubleSide, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector2, Vector3 } from 'three'
import { globalUniforms, WIND_GLSL } from '../materials/common'
import { useGame } from '../store'
import { fbm, rng } from '../world/noise'
import { nearestOnPath } from '../world/path'
import { terrainHeight } from '../world/terrain'
import { blockedByArchitecture, insideEstate } from '../world/vegetation'
import { GARDEN_FLOOR } from '../world/architecture'
import { foliageUniforms } from './geom/foliage'
import { cellsOf } from './geom/instances'
import { lodEntry, useLod } from './lod'
import { QUALITY } from './quality'

/**
 * Dry Mediterranean grass: instanced tapered blades with wind, backlit
 * translucency and distance fade. Receives shadows (long evening shadows).
 * Counts, blade segments and the fade band per quality are in quality.ts; the
 * blades are split into 14 m cells so cells off-screen or past the fade are
 * not drawn at all.
 */

const CELL = 14

function bladeGeometry(segments: number): BufferGeometry {
  // Tapered blade: `segments` quads narrowing to a tip triangle; uv.y = height factor.
  const w = 0.022
  const ys = segments >= 3 ? [0, 0.35, 0.7, 1] : [0, 0.5, 1]
  const levels = ys.length - 1
  const pos: number[] = []
  const uv: number[] = []
  for (let i = 0; i < levels; i++) {
    const k = 1 - ys[i] * 0.85
    pos.push(-w * k, ys[i], 0, w * k, ys[i], 0)
    uv.push(0, ys[i], 1, ys[i])
  }
  pos.push(0, 1, 0)
  uv.push(0.5, 1)
  const idx: number[] = []
  for (let i = 0; i < levels - 1; i++) {
    const a = i * 2
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const top = (levels - 1) * 2
  idx.push(top, top + 1, top + 2)
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  // Normals pointing up give soft, uniform shading for thin blades.
  const n = new Float32Array((pos.length / 3) * 3)
  for (let i = 0; i < n.length; i += 3) n[i + 1] = 1
  g.setAttribute('normal', new BufferAttribute(n, 3))
  g.setIndex(idx)
  return g
}

function placeBlades(count: number): Blade[] {
  const rand = rng(99)
  const out: Blade[] = []
  let tries = 0
  while (out.length < count && tries++ < count * 6) {
    const x = -40 + rand() * 76
    const z = -56 + rand() * 106
    if (!insideEstate(x, z)) continue
    if (blockedByArchitecture(x, z, 0.3)) continue
    const d = nearestOnPath(x, z).d
    if (d < 1.35) continue
    // Patchy density.
    const n = fbm(x * 0.09 + 3, z * 0.09 - 1, 3)
    if (n < -0.15 + rand() * 0.25) continue
    const edge = Math.min(1, (d - 1.35) / 1.5)
    const h = (0.16 + rand() * 0.3) * (0.55 + 0.45 * edge) * (0.8 + n * 0.5)
    out.push({ x, y: terrainHeight(x, z) - 0.02, z, h, rot: rand() * Math.PI, lean: (rand() - 0.5) * 0.5, tint: rand() })
  }
  return out
}

interface Blade {
  x: number
  y: number
  z: number
  h: number
  rot: number
  lean: number
  tint: number
}

function grassMaterial(base: string, tip: string, key: string, fade: [number, number]) {
  const mat = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0, side: DoubleSide })
  const uFade = { value: new Vector2(fade[0], fade[1]) }
  // Far blades are widened so the thinning field still reads as a cover.
  const uWiden = { value: new Vector2(fade[0] * 0.46, fade[1] * 0.81) }
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, globalUniforms, foliageUniforms, {
      uBase: { value: new Color(base) },
      uTip: { value: new Color(tip) },
      uFade,
      uWiden,
    })
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
${WIND_GLSL}
uniform vec2 uFade;
uniform vec2 uWiden;
varying float vH;
varying vec3 vGWPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vH = uv.y;
{
vec4 wp = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
float camD = distance(wp.xyz, cameraPosition);
float fade = 1.0 - smoothstep(uFade.x, uFade.y, camD);
transformed.y *= fade;
transformed.x *= mix(1.0, 2.0, smoothstep(uWiden.x, uWiden.y, camD));
vec3 off = windOffset(wp.xyz, 1.0) * 0.55 * uv.y * uv.y;
transformed.x += off.x;
transformed.z += off.z;
}`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vGWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uBase;
uniform vec3 uTip;
uniform vec3 uSunDirW;
uniform vec3 uSunColorF;
varying float vH;
varying vec3 vGWPos;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
diffuseColor.rgb *= mix(uBase, uTip, smoothstep(0.0, 1.0, vH));`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
vec3 toCam = normalize(cameraPosition - vGWPos);
float back = pow(max(dot(-toCam, uSunDirW), 0.0), 4.0);
totalEmissiveRadiance += diffuseColor.rgb * uSunColorF * back * 0.55 * vH;
}`,
      )
  }
  mat.customProgramCacheKey = () => 'grass-' + key
  return mat
}

/** One instanced mesh per 14 m cell (frustum- and distance-culled). */
function createGrassChunks(blades: Blade[], geo: BufferGeometry, mat: MeshStandardMaterial, hue: number, name: string) {
  const m = new Matrix4()
  const q = new Quaternion()
  const tilt = new Quaternion()
  const p = new Vector3()
  const sc = new Vector3()
  const ax = new Vector3()
  const up = new Vector3(0, 1, 0)
  const c = new Color()
  const xs = blades.map((b) => b.x)
  const zs = blades.map((b) => b.z)
  return cellsOf(xs, zs, CELL).map((cell) => {
    const inst = new InstancedMesh(geo, mat, cell.length)
    cell.forEach((bi, i) => {
      const b = blades[bi]
      ax.set(Math.sin(b.rot) * b.lean, 1, Math.cos(b.rot) * b.lean).normalize()
      q.setFromAxisAngle(up, b.rot)
      tilt.setFromUnitVectors(up, ax)
      q.premultiply(tilt)
      p.set(b.x, b.y, b.z)
      sc.set(1, b.h, 1)
      m.compose(p, q, sc)
      inst.setMatrixAt(i, m)
      c.setHSL(hue + b.tint * 0.08, 0.18 + b.tint * 0.18, 0.5 + b.tint * 0.22)
      inst.setColorAt(i, c)
    })
    inst.receiveShadow = true
    inst.castShadow = false
    inst.name = name
    inst.computeBoundingSphere()
    // Wind sway and the widened far blades.
    inst.boundingSphere!.radius += 0.6
    return inst
  })
}

/** Short green lawn inside the peristyle beds (between hedges and paths). */
function placeLawn(count: number): Blade[] {
  const rand = rng(4711)
  const out: Blade[] = []
  let tries = 0
  while (out.length < count && tries++ < count * 8) {
    const x = (rand() * 2 - 1) * 9.0
    const z = 30 + (rand() * 2 - 1) * 7.1
    if (Math.abs(x) < 1.45 || Math.abs(z - 30) < 1.45) continue // cross paths + hedges
    if (Math.hypot(x, z - 30) < 3.7) continue // fountain path + arc hedge
    if (Math.abs(x) > 8.9 || Math.abs(z - 30) > 6.95) continue // outer hedges
    out.push({ x, y: GARDEN_FLOOR - 0.01, z, h: 0.07 + rand() * 0.1, rot: rand() * Math.PI, lean: (rand() - 0.5) * 0.6, tint: rand() })
  }
  return out
}

export function Grass() {
  const quality = useGame((s) => s.settings.quality)
  const built = useMemo(() => {
    const g = QUALITY[quality].grass
    const geo = bladeGeometry(g.segments)
    const dryMat = grassMaterial('#4f5530', '#a99e62', 'dry', g.fade)
    const lawnMat = grassMaterial('#2f4a22', '#7d9a4c', 'lawn', g.fade)
    const meshes = [
      ...createGrassChunks(placeBlades(g.count), geo, dryMat, 0.12, 'grass:dry'),
      ...createGrassChunks(placeLawn(g.lawn), geo, lawnMat, 0.2, 'grass:lawn'),
    ]
    const lod = meshes.map((m) => lodEntry(m, { far: g.fade[1] + 0.5 }))
    return { meshes, lod, geo, mats: [dryMat, lawnMat] }
  }, [quality])
  useLod(built.lod)

  useEffect(
    () => () => {
      built.geo.dispose()
      built.mats.forEach((m) => m.dispose())
      built.meshes.forEach((m) => m.dispose())
    },
    [built],
  )

  return (
    <>
      {built.meshes.map((m) => (
        <primitive key={m.uuid} object={m} />
      ))}
    </>
  )
}
