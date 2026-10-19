import { useFrame } from '@react-three/fiber'
import { useEffect } from 'react'
import { Vector3, type Mesh, type Object3D, type Sphere } from 'three'

/**
 * Distance-based visibility for many static objects (instanced chunks, GLB
 * props, LOD levels), driven by one `useFrame` (see `<LodDriver />` in
 * World.tsx). Each entry is a sphere (centre + radius) with a visible
 * distance band [near, far) and an optional shadow distance; distances are
 * measured from the camera to the sphere's surface.
 *
 * Cost: one pass over the entries, only after the camera has moved more than
 * `STEP` metres (or after (un)registration) — no allocations per frame.
 */

export interface LodEntry {
  obj: Object3D
  x: number
  y: number
  z: number
  r: number
  /** Visible when near ≤ distance < far. */
  near: number
  far: number
  /** Meshes cast shadows only closer than this (NaN = leave castShadow alone). */
  shadow: number
  /** Meshes whose castShadow is driven by `shadow` (collected on registration). */
  casters: Mesh[]
}

const entries: LodEntry[] = []
let dirty = true
const last = new Vector3(1e9, 1e9, 1e9)
const cam = new Vector3()
const STEP = 0.35

/** Create an entry whose sphere is the object's world-space bounds (instanced bounds included). */
export function lodEntry(obj: Object3D, band: { near?: number; far?: number; shadow?: number }, sphere?: { x: number; y: number; z: number; r: number }): LodEntry {
  let s = sphere
  if (!s) {
    const m = obj as Mesh & { boundingSphere?: Sphere | null }
    if (m.isMesh && !m.boundingSphere && !m.geometry.boundingSphere) m.geometry.computeBoundingSphere()
    const bs = (m.isMesh ? (m.boundingSphere ?? m.geometry.boundingSphere) : null) ?? null
    if (bs) {
      obj.updateWorldMatrix(true, false)
      const c = bs.center.clone().applyMatrix4(obj.matrixWorld)
      s = { x: c.x, y: c.y, z: c.z, r: bs.radius * obj.matrixWorld.getMaxScaleOnAxis() }
    } else {
      const p = obj.getWorldPosition(new Vector3())
      s = { x: p.x, y: p.y, z: p.z, r: 1 }
    }
  }
  const casters: Mesh[] = []
  if (band.shadow !== undefined) {
    obj.traverse((o) => {
      const m = o as Mesh
      if (m.isMesh && m.castShadow) casters.push(m)
    })
  }
  return { obj, ...s, near: band.near ?? 0, far: band.far ?? Infinity, shadow: band.shadow ?? NaN, casters }
}

export function registerLod(list: LodEntry[]) {
  for (const e of list) entries.push(e)
  dirty = true
  return () => {
    for (const e of list) {
      const i = entries.indexOf(e)
      if (i >= 0) {
        entries[i] = entries[entries.length - 1]
        entries.pop()
      }
      // Leave the object in its default state for whoever reuses it.
      e.obj.visible = true
      for (const m of e.casters) m.castShadow = true
    }
    dirty = true
  }
}

/** Register entries for the lifetime of a component (pass a memoised list). */
export function useLod(list: LodEntry[] | null) {
  useEffect(() => (list && list.length ? registerLod(list) : undefined), [list])
}

export function updateLod(camera: Object3D) {
  camera.getWorldPosition(cam)
  if (!dirty && cam.distanceToSquared(last) < STEP * STEP) return
  dirty = false
  last.copy(cam)
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const dx = e.x - cam.x
    const dy = e.y - cam.y
    const dz = e.z - cam.z
    const d = Math.max(0, Math.sqrt(dx * dx + dy * dy + dz * dz) - e.r)
    const vis = d >= e.near && d < e.far
    e.obj.visible = vis
    if (vis && e.shadow === e.shadow) {
      const cast = d < e.shadow
      for (let k = 0; k < e.casters.length; k++) e.casters[k].castShadow = cast
    }
  }
}

/** Mounted once in the scene: runs the LOD pass before every render. */
export function LodDriver() {
  useFrame(({ camera }) => updateLod(camera))
  return null
}
