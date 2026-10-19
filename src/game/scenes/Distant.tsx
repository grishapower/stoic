import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, Color, MeshLambertMaterial } from 'three'
import { fbm } from '../world/noise'
import { SEA_LEVEL } from '../world/layout'
import { applyDirectionalFog } from './atmosphere'

/**
 * Far scenery: a mountainous peninsula across the bay (east/south-east) and an
 * island near the sunset. Simple ridge meshes lost in haze.
 */

interface RidgeSpec {
  points: [number, number][] // crest polyline in XZ
  height: (t: number) => number // crest height along the ridge (m above sea)
  width: number // half-width at the base
  seed: number
  /** Which side faces the viewer (1 = left of travel direction). */
}

function buildRidge(spec: RidgeSpec): BufferGeometry {
  const SEG = 160
  const ACROSS = 9
  // Resample the crest polyline.
  const lens: number[] = [0]
  for (let i = 1; i < spec.points.length; i++) {
    const [ax, az] = spec.points[i - 1]
    const [bx, bz] = spec.points[i]
    lens.push(lens[i - 1] + Math.hypot(bx - ax, bz - az))
  }
  const total = lens[lens.length - 1]
  const pos: number[] = []
  const col: number[] = []
  for (let i = 0; i <= SEG; i++) {
    const s = (i / SEG) * total
    let k = 1
    while (k < lens.length - 1 && lens[k] < s) k++
    const t0 = (s - lens[k - 1]) / (lens[k] - lens[k - 1] || 1)
    const [ax, az] = spec.points[k - 1]
    const [bx, bz] = spec.points[k]
    const cx = ax + (bx - ax) * t0
    const cz = az + (bz - az) * t0
    const dx = (bx - ax) / (lens[k] - lens[k - 1] || 1)
    const dz = (bz - az) / (lens[k] - lens[k - 1] || 1)
    const nx = -dz
    const nz = dx
    const tt = i / SEG
    const crest = spec.height(tt) * (0.82 + 0.3 * fbm(tt * 9 + spec.seed, spec.seed, 4))
    for (let j = 0; j <= ACROSS; j++) {
      const u = (j / ACROSS) * 2 - 1 // −1..1 across
      const w = spec.width * (0.85 + 0.3 * fbm(tt * 5 + 3, u * 2 + spec.seed, 3))
      const profile = Math.pow(Math.max(0, 1 - Math.abs(u)), 1.35)
      const rough = fbm(tt * 40 + spec.seed, u * 6, 4) * 0.12
      const y = SEA_LEVEL - 4 + (crest * (profile + rough * profile))
      pos.push(cx + nx * u * w, y, cz + nz * u * w)
      // Vertex colour: olive-green maquis, darker wooded patches, rock near the crest.
      const forest = fbm(tt * 25 + 7, u * 4 + spec.seed, 3) > 0.12 ? 0.62 : 1
      const g = (0.85 + rough * 1.5) * forest
      const rock = Math.max(0, profile - 0.78) * 4
      const cr = 0.2 + rock * 0.22
      const cg = 0.22 + rock * 0.14
      const cb = 0.14 + rock * 0.2
      col.push(cr * g, cg * g, cb * g)
    }
  }
  const idx: number[] = []
  const row = ACROSS + 1
  for (let i = 0; i < SEG; i++) {
    for (let j = 0; j < ACROSS; j++) {
      const a = i * row + j
      const b = a + 1
      const c = a + row
      const d = c + 1
      idx.push(a, b, c, b, d, c)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

const ISLAND: RidgeSpec = {
  points: [
    [-2600, -2650],
    [-2050, -2950],
    [-1500, -3200],
  ],
  height: (t) => 90 + 230 * Math.pow(Math.sin(t * Math.PI), 0.7) + 90 * Math.max(0, Math.sin(t * Math.PI * 2.6)),
  width: 520,
  seed: 9.1,
}

const NEAR_HILLS: RidgeSpec = {
  points: [
    [-900, 820],
    [-300, 900],
    [300, 950],
    [900, 820],
  ],
  height: (t) => 110 + 90 * Math.sin(t * Math.PI),
  width: 700,
  seed: 2.7,
}

export function Distant() {
  // The peninsula across the bay is now Vesuvius and its coast (see Bay.tsx).
  const geos = useMemo(() => [buildRidge(ISLAND), buildRidge(NEAR_HILLS)], [])
  const material = useMemo(() => {
    const m = new MeshLambertMaterial({ vertexColors: true, color: new Color('#ffffff') })
    applyDirectionalFog(m)
    return m
  }, [])
  // The island sits against the sunset: back-lit, so mostly cool aerial ambient.
  const islandMat = useMemo(() => {
    const m = new MeshLambertMaterial({ vertexColors: true, color: new Color('#3c3a44'), emissive: new Color('#353247') })
    applyDirectionalFog(m, undefined, 0.9, 0.3)
    return m
  }, [])
  useEffect(
    () => () => {
      geos.forEach((g) => g.dispose())
      material.dispose()
      islandMat.dispose()
    },
    [geos, material, islandMat],
  )
  return (
    <group>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g} material={i === 0 ? islandMat : material} />
      ))}
    </group>
  )
}
