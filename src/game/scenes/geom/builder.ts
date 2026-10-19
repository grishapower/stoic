import { BufferAttribute, BufferGeometry } from 'three'

/**
 * Static geometry builder: accumulates quads/triangles per material key with
 * world-space planar UVs (in metres), then emits one merged BufferGeometry per
 * key. Keeps draw calls low for architecture.
 */

type V3 = [number, number, number]

export type FaceName = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz'

interface Bucket {
  pos: number[]
  nor: number[]
  uv: number[]
  col: number[]
}

export class GeoBuilder {
  private buckets = new Map<string, Bucket>()
  /** Optional vertex colour applied to subsequently added faces. */
  color: V3 = [1, 1, 1]

  private bucket(key: string): Bucket {
    let b = this.buckets.get(key)
    if (!b) {
      b = { pos: [], nor: [], uv: [], col: [] }
      this.buckets.set(key, b)
    }
    return b
  }

  /** Add a triangle with explicit UVs. */
  tri(key: string, a: V3, b: V3, c: V3, ua: [number, number], ub: [number, number], uc: [number, number], n?: V3) {
    const bk = this.bucket(key)
    const nn = n ?? normalOf(a, b, c)
    for (const [p, u] of [
      [a, ua],
      [b, ub],
      [c, uc],
    ] as [V3, [number, number]][]) {
      bk.pos.push(p[0], p[1], p[2])
      bk.nor.push(nn[0], nn[1], nn[2])
      bk.uv.push(u[0], u[1])
      bk.col.push(this.color[0], this.color[1], this.color[2])
    }
  }

  /** Quad a-b-c-d (counter-clockwise when seen from the front) with planar UVs from the normal. */
  quad(key: string, a: V3, b: V3, c: V3, d: V3, uvOffset: [number, number] = [0, 0]) {
    const n = normalOf(a, b, c)
    const uv = (p: V3): [number, number] => planarUV(p, n, uvOffset)
    this.tri(key, a, b, c, uv(a), uv(b), uv(c), n)
    this.tri(key, a, c, d, uv(a), uv(c), uv(d), n)
  }

  /** Quad whose winding is flipped if needed so its normal points along `dir`. */
  quadFacing(key: string, a: V3, b: V3, c: V3, d: V3, dir: V3) {
    const n = normalOf(a, b, c)
    if (n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] < 0) this.quad(key, b, a, d, c)
    else this.quad(key, a, b, c, d)
  }

  /** Triangle flipped if needed to face `dir`; UVs planar. */
  triFacing(key: string, a: V3, b: V3, c: V3, dir: V3) {
    let n = normalOf(a, b, c)
    if (n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] < 0) {
      const t = a
      a = b
      b = t
      n = normalOf(a, b, c)
    }
    const uv = (p: V3) => planarUV(p, n, [0, 0])
    this.tri(key, a, b, c, uv(a), uv(b), uv(c), n)
  }

  /**
   * Axis-aligned box. `faceKey` maps each face to a material key (or null to skip the face).
   */
  box(min: V3, max: V3, faceKey: (face: FaceName) => string | null) {
    const [x0, y0, z0] = min
    const [x1, y1, z1] = max
    const faces: [FaceName, V3, V3, V3, V3][] = [
      ['px', [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
      ['nx', [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
      ['py', [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]],
      ['ny', [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
      ['pz', [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
      ['nz', [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
    ]
    for (const [name, a, b, c, d] of faces) {
      const key = faceKey(name)
      if (key) this.quad(key, a, b, c, d)
    }
  }

  /** Rotated box (about Y) centred at c with size s. Planar UVs computed in world space. */
  orientedBox(c: V3, s: V3, rotY: number, key: string | ((face: FaceName) => string | null)) {
    const cos = Math.cos(rotY)
    const sin = Math.sin(rotY)
    const tr = (lx: number, ly: number, lz: number): V3 => [c[0] + lx * cos + lz * sin, c[1] + ly, c[2] - lx * sin + lz * cos]
    const hx = s[0] / 2
    const hy = s[1] / 2
    const hz = s[2] / 2
    const fk = typeof key === 'string' ? () => key : key
    const faces: [FaceName, V3, V3, V3, V3][] = [
      ['px', tr(hx, -hy, hz), tr(hx, -hy, -hz), tr(hx, hy, -hz), tr(hx, hy, hz)],
      ['nx', tr(-hx, -hy, -hz), tr(-hx, -hy, hz), tr(-hx, hy, hz), tr(-hx, hy, -hz)],
      ['py', tr(-hx, hy, hz), tr(hx, hy, hz), tr(hx, hy, -hz), tr(-hx, hy, -hz)],
      ['ny', tr(-hx, -hy, -hz), tr(hx, -hy, -hz), tr(hx, -hy, hz), tr(-hx, -hy, hz)],
      ['pz', tr(-hx, -hy, hz), tr(hx, -hy, hz), tr(hx, hy, hz), tr(-hx, hy, hz)],
      ['nz', tr(hx, -hy, -hz), tr(-hx, -hy, -hz), tr(-hx, hy, -hz), tr(hx, hy, -hz)],
    ]
    for (const [name, a, b, cc, d] of faces) {
      const k = fk(name)
      if (k) this.quad(k, a, b, cc, d)
    }
  }

  keys() {
    return [...this.buckets.keys()]
  }

  build(): Map<string, BufferGeometry> {
    const out = new Map<string, BufferGeometry>()
    for (const [key, b] of this.buckets) {
      const g = new BufferGeometry()
      g.setAttribute('position', new BufferAttribute(new Float32Array(b.pos), 3))
      g.setAttribute('normal', new BufferAttribute(new Float32Array(b.nor), 3))
      g.setAttribute('uv', new BufferAttribute(new Float32Array(b.uv), 2))
      g.setAttribute('color', new BufferAttribute(new Float32Array(b.col), 3))
      g.computeBoundingSphere()
      g.computeBoundingBox()
      out.set(key, g)
    }
    return out
  }
}

export function normalOf(a: V3, b: V3, c: V3): V3 {
  const ux = b[0] - a[0]
  const uy = b[1] - a[1]
  const uz = b[2] - a[2]
  const vx = c[0] - a[0]
  const vy = c[1] - a[1]
  const vz = c[2] - a[2]
  let nx = uy * vz - uz * vy
  let ny = uz * vx - ux * vz
  let nz = ux * vy - uy * vx
  const l = Math.hypot(nx, ny, nz) || 1
  nx /= l
  ny /= l
  nz /= l
  return [nx, ny, nz]
}

/** World-space planar UV (metres) chosen by the dominant normal axis. */
export function planarUV(p: V3, n: V3, off: [number, number]): [number, number] {
  const ax = Math.abs(n[0])
  const ay = Math.abs(n[1])
  const az = Math.abs(n[2])
  if (ay >= ax && ay >= az) return [p[0] + off[0], -p[2] + off[1]]
  if (ax >= az) return [(n[0] > 0 ? -p[2] : p[2]) + off[0], p[1] + off[1]]
  return [(n[2] > 0 ? p[0] : -p[0]) + off[0], p[1] + off[1]]
}
