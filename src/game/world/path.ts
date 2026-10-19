import { CatmullRomCurve3, Vector3 } from 'three'
import { ROUTE } from './layout'

/**
 * The garden path / Seneca's route as a dense, arc-length parameterised
 * polyline (smooth centripetal Catmull-Rom through ROUTE). Pure XZ — heights
 * come from terrain.ts.
 */

const SAMPLE_STEP = 0.5

const curve = new CatmullRomCurve3(
  ROUTE.map(([x, z]) => new Vector3(x, 0, z)),
  false,
  'centripetal',
)

const approxLength = curve.getLength()
const sampleCount = Math.ceil(approxLength / SAMPLE_STEP)

const px = new Float64Array(sampleCount + 1)
const pz = new Float64Array(sampleCount + 1)
const ps = new Float64Array(sampleCount + 1)

{
  const v = new Vector3()
  let acc = 0
  for (let i = 0; i <= sampleCount; i++) {
    curve.getPointAt(i / sampleCount, v)
    px[i] = v.x
    pz[i] = v.z
    if (i > 0) acc += Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1])
    ps[i] = acc
  }
}

export const PATH_LENGTH = ps[sampleCount]

/** Arc length (m) of the route at each ROUTE control point. */
export const ROUTE_POINT_S: number[] = ROUTE.map(([x, z]) => nearestOnPath(x, z).s)

export interface PathHit {
  /** Distance from the query point to the path centre line. */
  d: number
  /** Arc length of the nearest point. */
  s: number
  x: number
  z: number
}

export function nearestOnPath(x: number, z: number, out?: PathHit): PathHit {
  let best = Infinity
  let bestS = 0
  let bx = px[0]
  let bz = pz[0]
  for (let i = 0; i < sampleCount; i++) {
    const ax = px[i]
    const az = pz[i]
    const dx = px[i + 1] - ax
    const dz = pz[i + 1] - az
    const len2 = dx * dx + dz * dz
    let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const cx = ax + dx * t
    const cz = az + dz * t
    const d2 = (x - cx) * (x - cx) + (z - cz) * (z - cz)
    if (d2 < best) {
      best = d2
      bestS = ps[i] + (ps[i + 1] - ps[i]) * t
      bx = cx
      bz = cz
    }
  }
  const hit = out ?? { d: 0, s: 0, x: 0, z: 0 }
  hit.d = Math.sqrt(best)
  hit.s = bestS
  hit.x = bx
  hit.z = bz
  return hit
}

function indexAt(s: number) {
  if (s <= 0) return 0
  if (s >= PATH_LENGTH) return sampleCount - 1
  let lo = 0
  let hi = sampleCount
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (ps[mid] <= s) lo = mid
    else hi = mid
  }
  return lo
}

/** Point on the path at arc length s (clamped). Writes into out = [x, z]. */
export function pathPointAt(s: number, out: [number, number] = [0, 0]): [number, number] {
  const i = indexAt(s)
  const seg = ps[i + 1] - ps[i]
  const t = seg > 0 ? Math.min(1, Math.max(0, (s - ps[i]) / seg)) : 0
  out[0] = px[i] + (px[i + 1] - px[i]) * t
  out[1] = pz[i] + (pz[i + 1] - pz[i]) * t
  return out
}

/** Unit tangent (direction of travel) at arc length s. */
export function pathTangentAt(s: number, out: [number, number] = [0, 0]): [number, number] {
  const a = pathPointAt(Math.max(0, s - 0.6), [0, 0])
  const b = pathPointAt(Math.min(PATH_LENGTH, s + 0.6), [0, 0])
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const l = Math.hypot(dx, dz) || 1
  out[0] = dx / l
  out[1] = dz / l
  return out
}

/** Dense samples for building path geometry. */
export function pathSamples(): { x: Float64Array; z: Float64Array; s: Float64Array; count: number } {
  return { x: px, z: pz, s: ps, count: sampleCount + 1 }
}
