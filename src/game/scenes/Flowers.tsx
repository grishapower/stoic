import { useEffect, useMemo } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Sphere,
  Vector2,
  Vector3,
} from 'three'
import { globalUniforms } from '../materials/common'
import { useGame } from '../store'
import { buildFlowers, FLOWER_SPECS, type FlowerInstance } from '../world/flowers'
import { cellsOf } from './geom/instances'
import { lodEntry, useLod } from './lod'
import { QUALITY } from './quality'

/**
 * Flowers, instanced: one draw call per 16 m cell (cells off-screen or beyond
 * the fade band of quality.ts are skipped). The template mesh has a stem with
 * two leaves (scaled by stem height) and a six-petal head (scaled by head
 * radius) — per-instance attributes keep the head round on tall stems.
 */

const CELL = 16

function template(): BufferGeometry {
  const pos: number[] = []
  const part: number[] = [] // 0 stem/leaf, 1 petal
  const center: number[] = [] // 1 at the head centre, 0 at petal tips
  const nor: number[] = []
  const push = (x: number, y: number, z: number, p: number, c: number) => {
    pos.push(x, y, z)
    part.push(p)
    center.push(c)
    nor.push(0, 1, 0)
  }
  // Stem: two crossed quads, x/z in head-radius units, y 0..1 of stem height.
  const w = 0.12
  for (const [dx, dz] of [
    [w, 0],
    [0, w],
  ]) {
    push(-dx, 0, -dz, 0, 0)
    push(dx, 0, dz, 0, 0)
    push(dx * 0.6, 1, dz * 0.6, 0, 0)
    push(-dx, 0, -dz, 0, 0)
    push(dx * 0.6, 1, dz * 0.6, 0, 0)
    push(-dx * 0.6, 1, -dz * 0.6, 0, 0)
  }
  // Two narrow leaves.
  for (const [a, y0] of [
    [0.4, 0.18],
    [2.9, 0.34],
  ]) {
    const cx = Math.cos(a)
    const cz = Math.sin(a)
    const L = 2.4
    push(0, y0, 0, 0, 0)
    push(cx * L * 0.5 - cz * 0.35, y0 + 0.08, cz * L * 0.5 + cx * 0.35, 0, 0)
    push(cx * L, y0 + 0.1, cz * L, 0, 0)
    push(0, y0, 0, 0, 0)
    push(cx * L, y0 + 0.1, cz * L, 0, 0)
    push(cx * L * 0.5 + cz * 0.35, y0 + 0.08, cz * L * 0.5 - cx * 0.35, 0, 0)
  }
  // Head: six diamond petals; y = cup rise (scaled by the kind's tilt).
  const P = 6
  for (let i = 0; i < P; i++) {
    const a = (i / P) * Math.PI * 2
    const c = Math.cos(a)
    const s = Math.sin(a)
    const mid = 0.55
    const half = 0.32
    const l: [number, number, number] = [c * mid - s * half, 0.45, s * mid + c * half]
    const r: [number, number, number] = [c * mid + s * half, 0.45, s * mid - c * half]
    const tip: [number, number, number] = [c, 1, s]
    push(0, 0, 0, 1, 1)
    push(...l, 1, 0.45)
    push(...tip, 1, 0)
    push(0, 0, 0, 1, 1)
    push(...tip, 1, 0)
    push(...r, 1, 0.45)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3))
  g.setAttribute('aPart', new BufferAttribute(new Float32Array(part), 1))
  g.setAttribute('aCenter', new BufferAttribute(new Float32Array(center), 1))
  return g
}

function flowerMaterial(fade: [number, number]) {
  const mat = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.75, metalness: 0, side: DoubleSide })
  const uFade = { value: new Vector2(fade[0], fade[1]) }
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, globalUniforms, { uStem: { value: new Color('#4d6a2c') }, uFade })
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform float uWind;
uniform vec2 uFade;
attribute float aPart;
attribute float aCenter;
attribute vec4 aFlower;
attribute vec3 aCenterCol;
varying float vPart;
varying float vCenter;
varying vec3 vCenterCol;
varying float vStemY;`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed;
{
  float fh = aFlower.x;
  float fr = aFlower.y;
  if (aPart > 0.5) transformed = vec3(position.x * fr, fh + position.y * fr * aFlower.z, position.z * fr);
  else transformed = vec3(position.x * fr, position.y * fh, position.z * fr);
  vec4 base = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float k = clamp(transformed.y / max(fh, 0.01), 0.0, 1.3);
  float gust = 0.6 + 0.4 * sin(uTime * 0.7 + base.x * 0.21 + base.z * 0.17);
  float sw = (0.25 + uWind) * gust * k * k * fh;
  transformed.x += sin(uTime * 1.9 + aFlower.w) * 0.06 * sw;
  transformed.z += cos(uTime * 1.55 + aFlower.w * 1.3) * 0.05 * sw;
  float cd = distance(base.xyz, cameraPosition);
  transformed *= 1.0 - smoothstep(uFade.x, uFade.y, cd);
  vPart = aPart;
  vCenter = aCenter;
  vCenterCol = aCenterCol;
  vStemY = position.y;
}`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uStem;
varying float vPart;
varying float vCenter;
varying vec3 vCenterCol;
varying float vStemY;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 petal = mix(diffuseColor.rgb, vCenterCol, smoothstep(0.55, 0.95, vCenter));
  vec3 stem = uStem * (0.75 + 0.35 * vStemY);
  diffuseColor.rgb = mix(stem, petal, step(0.5, vPart));
}`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
normal = normalize(vNormal); // same light on both faces of thin petals/leaves`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
// Thin petals glow a little when lit from behind.
totalEmissiveRadiance += diffuseColor.rgb * 0.08 * step(0.5, vPart);`,
      )
  }
  mat.customProgramCacheKey = () => 'flowers'
  return mat
}

function flowerChunk(tpl: BufferGeometry, mat: MeshStandardMaterial, list: FlowerInstance[]) {
  const geo = new BufferGeometry()
  for (const name of ['position', 'normal', 'aPart', 'aCenter']) geo.setAttribute(name, tpl.getAttribute(name))
  const params = new Float32Array(list.length * 4)
  const centers = new Float32Array(list.length * 3)
  const col = new Color()
  list.forEach((f, i) => {
    const s = FLOWER_SPECS[f.kind]
    params.set([f.h, f.r, s.tilt, f.phase], i * 4)
    col.set(s.center)
    centers.set([col.r, col.g, col.b], i * 3)
  })
  geo.setAttribute('aFlower', new InstancedBufferAttribute(params, 4))
  geo.setAttribute('aCenterCol', new InstancedBufferAttribute(centers, 3))
  // The template is in head-radius units; real flowers are at most ~1.5 m tall and narrow.
  geo.boundingSphere = new Sphere(new Vector3(0, 0.75, 0), 0.9)

  const inst = new InstancedMesh(geo, mat, list.length)
  const m = new Matrix4()
  const q = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const p = new Vector3()
  const one = new Vector3(1, 1, 1)
  list.forEach((f, i) => {
    q.setFromAxisAngle(up, f.rot)
    p.set(f.x, f.y, f.z)
    m.compose(p, q, one)
    inst.setMatrixAt(i, m)
    inst.setColorAt(i, col.set(FLOWER_SPECS[f.kind].color).offsetHSL(0, 0, Math.sin(f.phase * 3.1) * 0.5 * 0.06))
  })
  inst.castShadow = false
  inst.receiveShadow = true
  inst.name = 'flowers'
  inst.computeBoundingSphere()
  return inst
}

export function Flowers() {
  const quality = useGame((s) => s.settings.quality)
  const built = useMemo(() => {
    const flowers = buildFlowers(quality)
    const fade = QUALITY[quality].flowerFade
    const tpl = template()
    const mat = flowerMaterial(fade)
    const meshes = cellsOf(
      flowers.map((f) => f.x),
      flowers.map((f) => f.z),
      CELL,
    ).map((cell) => flowerChunk(tpl, mat, cell.map((i) => flowers[i])))
    const lod = meshes.map((m) => lodEntry(m, { far: fade[1] }))
    return { meshes, lod, tpl, mat }
  }, [quality])
  useLod(built.lod)

  useEffect(
    () => () => {
      for (const m of built.meshes) {
        m.geometry.dispose()
        m.dispose()
      }
      built.tpl.dispose()
      built.mat.dispose()
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
