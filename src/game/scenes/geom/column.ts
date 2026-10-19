import { BufferAttribute, BufferGeometry, Color, LatheGeometry, Vector2 } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Roman Tuscan column (stuccoed): square plinth, torus base, shaft with entasis,
 * fluted above the painted lower third, echinus + abacus capital.
 * Origin at the bottom centre; total height ≈ `height`.
 */
export function createColumnGeometry(height = 3.55, radius = 0.27, lite = false): BufferGeometry {
  const parts: BufferGeometry[] = []
  // Lite: two samples per flute, fewer rings and lathe segments (~1.5k instead of ~4k triangles).
  const LATHE = lite ? 16 : 28
  const red = new Color('#8b3326')
  const cream = new Color('#ffffff')
  const stone = new Color('#e9e1d2')

  const paint = (g: BufferGeometry, fn: (y: number) => Color) => {
    const pos = g.getAttribute('position')
    const col = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const c = fn(pos.getY(i))
      col[i * 3] = c.r
      col[i * 3 + 1] = c.g
      col[i * 3 + 2] = c.b
    }
    g.setAttribute('color', new BufferAttribute(col, 3))
    return g
  }

  const plinthH = 0.13
  const plinthW = radius * 2.9
  // Plinth (box built manually for consistent attributes).
  {
    const g = boxGeo(plinthW, plinthH, plinthW)
    g.translate(0, plinthH / 2, 0)
    parts.push(paint(g, () => stone))
  }
  const shaftBottom = 0.3
  const capH = 0.34
  const shaftTop = height - capH
  // Torus base.
  {
    const pts: Vector2[] = []
    const r0 = radius * 1.28
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI
      pts.push(new Vector2(radius * 1.02 + Math.sin(a) * (r0 - radius * 1.02), plinthH + (1 - Math.cos(a)) * 0.07))
    }
    pts.push(new Vector2(radius * 1.04, shaftBottom))
    const g = new LatheGeometry(pts, LATHE)
    parts.push(paint(g, () => stone))
  }
  // Shaft.
  {
    const SEG = lite ? 40 : 60
    const flutes = 20
    const fluteStart = 1.2
    // Ring heights: uniform for the full mesh; for the lite one only where the profile changes
    // (a doubled ring keeps the red/cream paint line crisp).
    const H = shaftTop - shaftBottom
    const ringYs = lite
      ? [shaftBottom, fluteStart - 0.021, fluteStart - 0.019, fluteStart + 0.15, shaftBottom + H * 0.62, shaftBottom + H * 0.82, shaftTop - 0.18, shaftTop - 0.08, shaftTop]
      : Array.from({ length: 23 }, (_, j) => shaftBottom + (H * j) / 22)
    const RINGS = ringYs.length - 1
    const pos: number[] = []
    const uv: number[] = []
    const col: number[] = []
    const idx: number[] = []
    for (let j = 0; j <= RINGS; j++) {
      const y = ringYs[j]
      const t = (y - shaftBottom) / H
      // Entasis: slight swell then taper to ~0.83 r at the top.
      const r = radius * (1 - 0.17 * Math.pow(t, 1.6) + 0.025 * Math.sin(t * Math.PI))
      const fluteAmt = Math.min(1, Math.max(0, (y - fluteStart) / 0.15)) * Math.min(1, Math.max(0, (shaftTop - 0.08 - y) / 0.1))
      const c = y < fluteStart - 0.02 ? red : cream
      for (let i = 0; i <= SEG; i++) {
        const a = (i / SEG) * Math.PI * 2
        const f = Math.pow(Math.abs(Math.sin((a * flutes) / 2)), 0.7)
        const rr = r * (1 - 0.045 * fluteAmt * (1 - f))
        pos.push(Math.sin(a) * rr, y, Math.cos(a) * rr)
        uv.push((i / SEG) * 2 * Math.PI * radius, y)
        col.push(c.r, c.g, c.b)
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
    g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
    g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    parts.push(g.toNonIndexed())
  }
  // Capital: necking ring + echinus.
  {
    const rTop = radius * 0.83
    const pts: Vector2[] = [
      new Vector2(rTop * 1.0, shaftTop),
      new Vector2(rTop * 1.08, shaftTop + 0.02),
      new Vector2(rTop * 1.08, shaftTop + 0.06),
      new Vector2(rTop * 1.0, shaftTop + 0.08),
      new Vector2(rTop * 1.02, shaftTop + 0.12),
    ]
    for (let i = 1; i <= 8; i++) {
      const t = i / 8
      pts.push(new Vector2(rTop * 1.02 + (radius * 1.42 - rTop * 1.02) * Math.sin((t * Math.PI) / 2), shaftTop + 0.12 + t * 0.1))
    }
    const g = new LatheGeometry(pts, LATHE)
    parts.push(paint(g, () => cream))
  }
  // Abacus.
  {
    const g = boxGeo(radius * 3.0, 0.12, radius * 3.0)
    g.translate(0, height - 0.06, 0)
    parts.push(paint(g, () => cream))
  }
  const merged = mergeGeometries(
    parts.map((p) => {
      const g = p.index ? p.toNonIndexed() : p
      if (!g.getAttribute('uv')) g.setAttribute('uv', new BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2))
      return g
    }),
    false,
  )!
  merged.computeBoundingSphere()
  return merged
}

function boxGeo(w: number, h: number, d: number): BufferGeometry {
  const hw = w / 2
  const hh = h / 2
  const hd = d / 2
  const faces: [number[], number[]][] = [
    [[hw, -hh, hd, hw, -hh, -hd, hw, hh, -hd, hw, hh, hd], [1, 0, 0]],
    [[-hw, -hh, -hd, -hw, -hh, hd, -hw, hh, hd, -hw, hh, -hd], [-1, 0, 0]],
    [[-hw, hh, hd, hw, hh, hd, hw, hh, -hd, -hw, hh, -hd], [0, 1, 0]],
    [[-hw, -hh, -hd, hw, -hh, -hd, hw, -hh, hd, -hw, -hh, hd], [0, -1, 0]],
    [[-hw, -hh, hd, hw, -hh, hd, hw, hh, hd, -hw, hh, hd], [0, 0, 1]],
    [[hw, -hh, -hd, -hw, -hh, -hd, -hw, hh, -hd, hw, hh, -hd], [0, 0, -1]],
  ]
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  for (const [v, n] of faces) {
    const quad = [0, 1, 2, 0, 2, 3]
    const uvq = [0, 0, 1, 0, 1, 1, 0, 1]
    for (const k of quad) {
      pos.push(v[k * 3], v[k * 3 + 1], v[k * 3 + 2])
      nor.push(n[0], n[1], n[2])
      uv.push(uvq[k * 2] * w, uvq[k * 2 + 1] * h)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  return g
}
