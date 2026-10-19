import { useEffect, useMemo } from 'react'
import { InstancedMesh, Matrix4, type BufferGeometry } from 'three'
import { useArchMaterials, type ArchMaterialKey } from '../materials/library'
import { useGame } from '../store'
import {
  COLUMN,
  ENTABLATURE,
  GARDEN_FLOOR,
  HOUSE_BLOCKS,
  PORCH_RECT,
  PORTICO_WALLS,
  WALL_EW_X,
  WALL_N_Z,
  peristyleColumns,
  type WallDef,
} from '../world/architecture'
import { GeoBuilder, type FaceName } from './geom/builder'
import { createColumnGeometry } from './geom/column'
import { useStaticGeometry } from './staticGeometry'

/**
 * The villa: peristyle colonnade, porticos with frescoed walls, roofs, the house
 * volumes and the paved porch. Built procedurally and merged per material.
 */

const CL = { minX: -10, maxX: 10, minZ: 22, maxZ: 38 } // column line

function buildVilla(): Map<string, BufferGeometry> {
  const b = new GeoBuilder()
  const all = (k: string) => () => k

  /* ---------------- Stylobate (stone curb along the column line) */
  b.color = [0.93, 0.9, 0.85]
  const sw = 0.48
  const sb = GARDEN_FLOOR - 0.06
  b.box([CL.minX - sw, sb, CL.maxZ - sw], [CL.maxX + sw, 0.02, CL.maxZ + sw], all('marble'))
  b.box([CL.minX - sw, sb, CL.minZ - sw], [CL.maxX + sw, 0.02, CL.minZ + sw], all('marble'))
  b.box([CL.minX - sw, sb, CL.minZ + sw], [CL.minX + sw, 0.02, CL.maxZ - sw], all('marble'))
  b.box([CL.maxX - sw, sb, CL.minZ + sw], [CL.maxX + sw, 0.02, CL.maxZ - sw], all('marble'))

  /* ---------------- Portico floors (cocciopesto-like reddish paving) */
  b.color = [1.0, 0.86, 0.78]
  const fy0 = -0.3
  b.box([-WALL_EW_X, fy0, CL.maxZ + sw], [WALL_EW_X, 0.0, WALL_N_Z], (f) => (f === 'py' ? 'paving' : null))
  b.box([CL.maxX + sw, fy0, 21.8], [WALL_EW_X, 0.0, CL.maxZ + sw], (f) => (f === 'py' ? 'paving' : null))
  b.box([-WALL_EW_X, fy0, 21.8], [CL.minX - sw, 0.0, CL.maxZ + sw], (f) => (f === 'py' ? 'paving' : null))

  /* ---------------- Porch outside the south colonnade */
  b.color = [1, 0.97, 0.92]
  b.box([PORCH_RECT.minX, -0.6, PORCH_RECT.minZ], [PORCH_RECT.maxX, 0.015, CL.minZ - sw], (f) => (f === 'ny' ? null : 'paving'))
  // Low edge kerb.
  b.color = [0.9, 0.86, 0.8]
  b.box([PORCH_RECT.minX, -0.6, PORCH_RECT.minZ - 0.25], [PORCH_RECT.maxX, 0.12, PORCH_RECT.minZ + 0.05], (f) => (f === 'ny' ? null : 'marble'))

  /* ---------------- Entablature on the column line */
  const ent = ENTABLATURE
  const ed = ent.depth / 2
  b.color = [1, 0.98, 0.94]
  const entBox = (x0: number, z0: number, x1: number, z1: number) => {
    b.box([x0, ent.bottom, z0], [x1, ent.top - 0.12, z1], all('plaster'))
    // Cornice lip.
    b.box([x0 - 0.08, ent.top - 0.12, z0 - 0.08], [x1 + 0.08, ent.top, z1 + 0.08], all('plaster'))
  }
  entBox(CL.minX - ed, CL.maxZ - ed, CL.maxX + ed, CL.maxZ + ed)
  entBox(CL.minX - ed, CL.minZ - ed, CL.maxX + ed, CL.minZ + ed)
  entBox(CL.minX - ed, CL.minZ + ed, CL.minX + ed, CL.maxZ - ed)
  entBox(CL.maxX - ed, CL.minZ + ed, CL.maxX + ed, CL.maxZ - ed)
  // Painted frieze band (ochre) on the garden-facing side.
  b.color = [0.95, 0.72, 0.45]
  const fb0 = ent.bottom + 0.3
  const fb1 = ent.bottom + 0.4
  b.box([CL.minX - ed - 0.005, fb0, CL.maxZ - ed - 0.005], [CL.maxX + ed + 0.005, fb1, CL.maxZ - ed], (f) => (f === 'nz' ? 'plasterWarm' : null))
  b.box([CL.minX - ed - 0.005, fb0, CL.minZ + ed], [CL.maxX + ed + 0.005, fb1, CL.minZ + ed + 0.005], (f) => (f === 'pz' ? 'plasterWarm' : null))
  b.box([CL.minX + ed, fb0, CL.minZ + ed], [CL.minX + ed + 0.005, fb1, CL.maxZ - ed], (f) => (f === 'px' ? 'plasterWarm' : null))
  b.box([CL.maxX - ed - 0.005, fb0, CL.minZ + ed], [CL.maxX - ed, fb1, CL.maxZ - ed], (f) => (f === 'nx' ? 'plasterWarm' : null))

  /* ---------------- Portico walls with openings and doors */
  for (const w of PORTICO_WALLS) buildWall(b, w)

  /* ---------------- Portico roofs (mono-pitch toward the garden) */
  const eaveY = ent.top + 0.02
  const ridgeY = 5.25
  const over = 0.55
  const rt = 0.14
  b.color = [1, 1, 1]
  // North portico roof: from wall (z = WALL_N_Z) down to the column line (z = CL.maxZ).
  roofPlane(b, [-WALL_EW_X - 0.2, ridgeY, WALL_N_Z + 0.25], [WALL_EW_X + 0.2, ridgeY, WALL_N_Z + 0.25], [WALL_EW_X + 0.2, eaveY - 0.12, CL.maxZ - over], [-WALL_EW_X - 0.2, eaveY - 0.12, CL.maxZ - over], rt)
  // East.
  roofPlane(b, [WALL_EW_X + 0.25, ridgeY, CL.maxZ + 1.5], [WALL_EW_X + 0.25, ridgeY, 21.6], [CL.maxX - over, eaveY - 0.12, 21.6], [CL.maxX - over, eaveY - 0.12, CL.maxZ + 1.5], rt)
  // West.
  roofPlane(b, [-WALL_EW_X - 0.25, ridgeY, 21.6], [-WALL_EW_X - 0.25, ridgeY, CL.maxZ + 1.5], [CL.minX + over, eaveY - 0.12, CL.maxZ + 1.5], [CL.minX + over, eaveY - 0.12, 21.6], rt)

  /* ---------------- House volumes */
  for (const h of HOUSE_BLOCKS) {
    b.color = [1, 0.97, 0.92]
    const faces = (f: FaceName): string | null => {
      if (f === 'ny' || f === 'py') return null
      // Faces coinciding with portico walls are hidden.
      if (h.minZ === WALL_N_Z && f === 'nz') return null
      if (h.minX === WALL_EW_X && f === 'nx') return null
      if (h.maxX === -WALL_EW_X && f === 'px') return null
      return 'plaster'
    }
    b.box([h.minX, -0.4, h.minZ], [h.maxX, h.height, h.maxZ], faces)
    // Painted plinth band on the exterior.
    b.color = [0.82, 0.62, 0.48]
    b.box([h.minX - 0.02, -0.4, h.minZ - 0.02], [h.maxX + 0.02, 0.55, h.maxZ + 0.02], (f) => (faces(f) ? 'plasterWarm' : null))
    hipRoof(b, h.minX - 0.5, h.maxX + 0.5, h.minZ - 0.5, h.maxZ + 0.5, h.height, 0.42)
  }
  // Small high windows on the exterior (dark recesses with wooden lintels).
  const win = (x: number, z: number, axis: 'x' | 'z', y = 3.5) => {
    const w = 0.55
    const hgt = 0.8
    if (axis === 'z') {
      b.box([x - w / 2, y, z - 0.03], [x + w / 2, y + hgt, z + 0.03], (f) => (f === 'nz' || f === 'pz' ? 'interior' : null))
      b.box([x - w / 2 - 0.1, y + hgt, z - 0.06], [x + w / 2 + 0.1, y + hgt + 0.12, z + 0.06], all('woodDark'))
    } else {
      b.box([x - 0.03, y, z - w / 2], [x + 0.03, y + hgt, z + w / 2], (f) => (f === 'nx' || f === 'px' ? 'interior' : null))
      b.box([x - 0.06, y + hgt, z - w / 2 - 0.1], [x + 0.06, y + hgt + 0.12, z + w / 2 + 0.1], all('woodDark'))
    }
  }
  for (const x of [15.5, 17.5]) win(x, 21.6, 'z')
  for (const x of [-15.5, -17.5]) win(x, 21.6, 'z')
  for (const z of [26, 31, 36]) {
    win(19.5, z, 'x')
    win(-19.5, z, 'x')
  }
  for (const x of [-15, -9, -3, 3, 9, 15]) win(x, 51, 'z', 3.9)

  return b.build()
}

function buildWall(b: GeoBuilder, w: WallDef) {
  const horizontal = w.a[1] === w.b[1]
  const t = w.thick / 2
  const from = horizontal ? w.a[0] : w.a[1]
  const to = horizontal ? w.b[0] : w.b[1]
  const fixed = horizontal ? w.a[1] : w.a[0]
  const innerFace: FaceName = horizontal ? (w.innerSide < 0 ? 'nz' : 'pz') : w.innerSide < 0 ? 'nx' : 'px'
  const faceKey = (f: FaceName): string | null => {
    if (f === 'ny') return null
    if (f === innerFace) return w.fresco ? 'fresco' : 'plaster'
    return 'plaster'
  }
  const piece = (a0: number, a1: number, y0: number, y1: number, keyFn: (f: FaceName) => string | null = faceKey) => {
    if (a1 - a0 < 0.01) return
    if (horizontal) b.box([a0, y0, fixed - t], [a1, y1, fixed + t], keyFn)
    else b.box([fixed - t, y0, a0], [fixed + t, y1, a1], keyFn)
  }
  b.color = [1, 1, 1]
  const ops = [...w.openings].sort((x, y) => x.at - y.at)
  let cur = from
  for (const o of ops) {
    const o0 = o.at - o.width / 2
    const o1 = o.at + o.width / 2
    piece(cur, o0, -0.3, w.height)
    // Lintel above the opening.
    piece(o0, o1, o.height, w.height)
    // Door frame (wood) and closed double door set into the opening.
    b.color = [1, 1, 1]
    const frame = (a0: number, a1: number, y0: number, y1: number, depth: number, key: ArchMaterialKey) => {
      if (horizontal) b.box([a0, y0, fixed - depth], [a1, y1, fixed + depth], all(key))
      else b.box([fixed - depth, y0, a0], [fixed + depth, y1, a1], all(key))
    }
    frame(o0, o0 + 0.1, 0, o.height, t + 0.03, 'woodDark')
    frame(o1 - 0.1, o1, 0, o.height, t + 0.03, 'woodDark')
    frame(o0, o1, o.height - 0.1, o.height, t + 0.03, 'woodDark')
    const mid = o.at
    frame(o0 + 0.1, mid - 0.01, 0, o.height - 0.1, 0.06, 'wood')
    frame(mid + 0.01, o1 - 0.1, 0, o.height - 0.1, 0.06, 'wood')
    // Bronze-ish studs row suggested by a darker rail.
    frame(o0 + 0.1, o1 - 0.1, o.height * 0.45, o.height * 0.45 + 0.07, 0.075, 'woodDark')
    cur = o1
  }
  piece(cur, to, -0.3, w.height)
}

function all(k: string) {
  return () => k
}

function roofPlane(
  b: GeoBuilder,
  hiA: [number, number, number],
  hiB: [number, number, number],
  loB: [number, number, number],
  loA: [number, number, number],
  thick: number,
) {
  // Top (tiles), underside (wooden ceiling) and the eave edge (both sides).
  b.color = [1, 1, 1]
  b.quadFacing('roof', loA, loB, hiB, hiA, [0, 1, 0])
  const d = (p: [number, number, number]): [number, number, number] => [p[0], p[1] - thick, p[2]]
  b.quadFacing('ceiling', d(hiA), d(hiB), d(loB), d(loA), [0, -1, 0])
  b.color = [0.8, 0.55, 0.42]
  b.quad('terracotta', d(loA), d(loB), loB, loA)
  b.quad('terracotta', d(loB), d(loA), loA, loB)
}

function hipRoof(b: GeoBuilder, x0: number, x1: number, z0: number, z1: number, y: number, pitch: number) {
  const w = x1 - x0
  const d = z1 - z0
  const rise = (Math.min(w, d) / 2) * pitch
  const top = y + rise
  b.color = [1, 1, 1]
  const up = (dx: number, dz: number): [number, number, number] => [dx, 1, dz]
  if (w >= d) {
    const inset = d / 2
    const r0: [number, number, number] = [x0 + inset, top, (z0 + z1) / 2]
    const r1: [number, number, number] = [x1 - inset, top, (z0 + z1) / 2]
    b.quadFacing('roof', [x0, y, z1], [x1, y, z1], r1, r0, up(0, 1))
    b.quadFacing('roof', [x1, y, z0], [x0, y, z0], r0, r1, up(0, -1))
    b.triFacing('roof', [x0, y, z0], [x0, y, z1], r0, up(-1, 0))
    b.triFacing('roof', [x1, y, z1], [x1, y, z0], r1, up(1, 0))
  } else {
    const inset = w / 2
    const r0: [number, number, number] = [(x0 + x1) / 2, top, z0 + inset]
    const r1: [number, number, number] = [(x0 + x1) / 2, top, z1 - inset]
    b.quadFacing('roof', [x1, y, z1], [x1, y, z0], r0, r1, up(1, 0))
    b.quadFacing('roof', [x0, y, z0], [x0, y, z1], r1, r0, up(-1, 0))
    b.triFacing('roof', [x1, y, z0], [x0, y, z0], r0, up(0, -1))
    b.triFacing('roof', [x0, y, z1], [x1, y, z1], r1, up(0, 1))
  }
  // Eave fascia.
  b.color = [0.8, 0.55, 0.42]
  const f = 0.16
  b.quad('terracotta', [x0, y - f, z1], [x1, y - f, z1], [x1, y, z1], [x0, y, z1])
  b.quad('terracotta', [x1, y - f, z0], [x0, y - f, z0], [x0, y, z0], [x1, y, z0])
  b.quad('terracotta', [x1, y - f, z1], [x1, y - f, z0], [x1, y, z0], [x1, y, z1])
  b.quad('terracotta', [x0, y - f, z0], [x0, y - f, z1], [x0, y, z1], [x0, y, z0])
}

export function Villa() {
  const mats = useArchMaterials()
  const geos = useMemo(() => buildVilla(), [])
  // Drawn by <StaticBatch /> together with the other builders' stonework (one call per material).
  useStaticGeometry(geos)
  // The light (VR) preset uses a lighter column mesh: 26 columns, drawn twice with the shadow pass.
  const lite = useGame((s) => s.settings.quality === 'low')
  const columns = useMemo(() => {
    const geo = createColumnGeometry(COLUMN.height, COLUMN.radius, lite)
    const pts = peristyleColumns()
    const mesh = new InstancedMesh(geo, mats.column, pts.length)
    const m = new Matrix4()
    pts.forEach(([x, z], i) => {
      m.makeRotationY(((i * 37) % 7) * 0.05)
      m.setPosition(x, 0.02, z)
      mesh.setMatrixAt(i, m)
    })
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.computeBoundingSphere()
    return mesh
  }, [mats, lite])

  useEffect(
    () => () => {
      geos.forEach((g) => g.dispose())
      columns.geometry.dispose()
      columns.dispose()
    },
    [geos, columns],
  )

  return (
    <group>
      <primitive object={columns} />
    </group>
  )
}
