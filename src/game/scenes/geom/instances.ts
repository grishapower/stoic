import { InstancedBufferAttribute, InstancedMesh, Sphere, Vector3, type BufferGeometry, type Material } from 'three'

/**
 * Instance sets whose members are picked by distance from the camera, for
 * distance LOD without a draw call per spatial cell:
 *
 * - `InstanceSource` holds every instance's matrix and position once;
 * - `RadialSet` is a group of InstancedMeshes (e.g. trunk + canopy + leaf
 *   cards of one tree variant) sharing one instance-matrix buffer; `select()`
 *   copies in the instances whose horizontal distance to a point lies in
 *   [rMin, rMax) and fits the bounding sphere around them, so frustum culling
 *   (camera and shadow camera) still works.
 *
 * `select()` is meant to run when the camera has moved a metre or so, not
 * every frame; it allocates nothing.
 */

export class InstanceSource {
  readonly count: number
  readonly matrices: Float32Array
  readonly xs: Float32Array
  readonly ys: Float32Array
  readonly zs: Float32Array

  constructor(count: number) {
    this.count = count
    this.matrices = new Float32Array(count * 16)
    this.xs = new Float32Array(count)
    this.ys = new Float32Array(count)
    this.zs = new Float32Array(count)
  }

  /** Store instance i (matrix in column-major order, as Matrix4.elements). */
  set(i: number, elements: ArrayLike<number>) {
    this.matrices.set(elements, i * 16)
    this.xs[i] = elements[12]
    this.ys[i] = elements[13]
    this.zs[i] = elements[14]
  }
}

export class RadialSet {
  readonly meshes: InstancedMesh[] = []
  readonly matrix: InstancedBufferAttribute
  /** Indices into the source that this set may show. */
  readonly members: Uint32Array
  /** Extra radius around instance origins for the bounding sphere (object size). */
  readonly pad: number
  count = 0
  private readonly sphere = new Sphere()
  private readonly lo = new Vector3()
  private readonly hi = new Vector3()
  readonly source: InstanceSource

  constructor(
    source: InstanceSource,
    members: ArrayLike<number>,
    parts: { geometry: BufferGeometry; material: Material; castShadow: boolean; receiveShadow: boolean; name?: string }[],
    pad: number,
  ) {
    this.source = source
    this.members = Uint32Array.from(members)
    this.pad = pad
    const capacity = Math.max(1, this.members.length)
    this.matrix = new InstancedBufferAttribute(new Float32Array(capacity * 16), 16)
    for (const p of parts) {
      const m = new InstancedMesh(p.geometry, p.material, capacity)
      m.instanceMatrix = this.matrix
      m.castShadow = p.castShadow
      m.receiveShadow = p.receiveShadow
      m.boundingSphere = this.sphere
      if (p.name) m.name = p.name
      m.count = 0
      m.visible = false
      this.meshes.push(m)
    }
  }

  /** Show the members with rMin ≤ horizontal distance to (cx, cz) < rMax. */
  select(cx: number, cz: number, rMin: number, rMax: number) {
    const s = this.source
    const arr = this.matrix.array as Float32Array
    const min2 = rMin * rMin
    const max2 = rMax * rMax
    const lo = this.lo.set(Infinity, Infinity, Infinity)
    const hi = this.hi.set(-Infinity, -Infinity, -Infinity)
    let n = 0
    for (let k = 0; k < this.members.length; k++) {
      const i = this.members[k]
      const dx = s.xs[i] - cx
      const dz = s.zs[i] - cz
      const d2 = dx * dx + dz * dz
      if (d2 < min2 || d2 >= max2) continue
      // Plain copy: subarray() would allocate a view per instance.
      const src = s.matrices
      const from = i * 16
      const to = n * 16
      for (let e = 0; e < 16; e++) arr[to + e] = src[from + e]
      const x = s.xs[i]
      const y = s.ys[i]
      const z = s.zs[i]
      if (x < lo.x) lo.x = x
      if (y < lo.y) lo.y = y
      if (z < lo.z) lo.z = z
      if (x > hi.x) hi.x = x
      if (y > hi.y) hi.y = y
      if (z > hi.z) hi.z = z
      n++
    }
    this.count = n
    if (n > 0) {
      this.sphere.center.addVectors(lo, hi).multiplyScalar(0.5)
      this.sphere.radius = lo.distanceTo(hi) * 0.5 + this.pad
      this.matrix.clearUpdateRanges()
      this.matrix.addUpdateRange(0, n * 16)
      this.matrix.needsUpdate = true
    }
    for (const m of this.meshes) {
      m.count = n
      m.visible = n > 0
    }
    return n
  }

  /** Show every member (static use). */
  selectAll() {
    return this.select(0, 0, 0, Infinity)
  }

  /** Show nothing. */
  clear() {
    this.count = 0
    for (const m of this.meshes) {
      m.count = 0
      m.visible = false
    }
  }

  dispose() {
    for (const m of this.meshes) m.dispose()
  }
}

/** Group item indices into square cells of `size` metres (static spatial chunks). */
export function cellsOf(xs: ArrayLike<number>, zs: ArrayLike<number>, size: number, indices?: ArrayLike<number>): number[][] {
  const cells = new Map<string, number[]>()
  const n = indices ? indices.length : xs.length
  for (let k = 0; k < n; k++) {
    const i = indices ? indices[k] : k
    const key = `${Math.floor(xs[i] / size)},${Math.floor(zs[i] / size)}`
    let c = cells.get(key)
    if (!c) cells.set(key, (c = []))
    c.push(i)
  }
  return [...cells.values()]
}
